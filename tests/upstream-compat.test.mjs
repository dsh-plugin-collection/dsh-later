/**
 * 上游跨代兼容矩阵护栏。
 *
 * 锁两件事：
 *  1. Session API 双轨探测（0.1.1 events/seedLength ↔ 0.1.2 ownEvents/inheritedEventCount）
 *     在 foldUserState / read* 上行为一致，且 seedLength 回退不再缺失。
 *  2. package.json peer 枚举与 src/upstream-compat.ts 的 KERNEL_GENERATIONS 同步
 *     ——新 rc 只改一处后跑 scripts/sync-peer-matrix.mjs，这里挡住漏同步。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAfterScheduleRecord } from '@deepseek-ai/dsh-schedule';
import {
  KERNEL_GENERATIONS,
  KERNEL_SCOPED_PACKAGES,
  detectSessionApi,
  peerMatrixEntries,
  peerRangeFor,
  readInheritedEventCount,
  readOwnEvents,
} from '../lib/upstream-compat.js';
import { foldUserState } from '../lib/user-tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 0.1.1 形状：.events 数组 + header.seedLength（无 ownEvents / inheritedEventCount）。 */
function legacySession(events, seedLength = 0) {
  return {
    header: { id: 'session-legacy', seedLength },
    events,
    append(type, data) {
      this.events.push({ type, data, seq: this.events.length, time: Date.now() });
    },
  };
}

/** 0.1.2 形状：ownEvents() + inheritedEventCount。 */
function modernSession(events, inheritedEventCount = 0) {
  const log = [...events];
  return {
    header: { id: 'session-modern' },
    inheritedEventCount,
    ownEvents() {
      return log;
    },
    append(type, data) {
      log.push({ type, data, seq: log.length, time: Date.now() });
    },
  };
}

/** 合法 schedule/change create 事件（严格解码：荷载仅 version/operation/schedule）。 */
function createChangeEvent(id) {
  const now = Date.now();
  const schedule = createAfterScheduleRecord(id, 'x', 3600, now);
  return {
    type: 'schedule/change',
    seq: 0,
    time: 0,
    data: { version: 1, operation: 'create', schedule },
  };
}

/**
 * 轻量 semver 比较（不引依赖：`semver` 不在 devDependencies 里）。
 *
 * 只处理本项目用到的形状 `major.minor.patch-rc.N`（以及 `0.0.1-rc.1`）。
 * 预发布一律排在同版本正式版**之前**，符合 semver 语义。
 */
function parseVer(v) {
  const [core, pre = ''] = v.split('-');
  const [major, minor, patch] = core.split('.').map(Number);
  const m = /^rc\.(\d+)$/.exec(pre);
  return { major, minor, patch, pre: m ? Number(m[1]) : -1, hasPre: pre.length > 0 };
}

/** a > b 时返回 true。 */
function verGt(a, b) {
  const x = parseVer(a);
  const y = parseVer(b);
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] > y[k];
  }
  // 正式版 > 预发布版；同为预发布则比 rc 序号
  if (x.hasPre !== y.hasPre) return !x.hasPre;
  return x.pre > y.pre;
}

/** `^major.minor.patch(-pre)` 是否覆盖 `version`。 */
function caretCovers(range, version) {
  const m = /^\^(\d+\.\d+\.\d+(?:-rc\.\d+)?)$/.exec(range.trim());
  if (m === null) return false;
  const lo = parseVer(m[1]);
  const v = parseVer(version);
  // caret 语义：major>0 锁 major；major=0 锁 minor（`^0.1.2` = >=0.1.2 <0.2.0）。
  // 本项目全部是 0.x，故次版本必须**相等**，不能只比大小 —— 否则
  // `^0.1.2-rc.1` 会误判为覆盖 `0.1.5-rc.1`，护栏就形同虚设。
  if (lo.major > 0) {
    if (v.major !== lo.major) return false;
  } else {
    if (v.major !== lo.major || v.minor !== lo.minor) return false;
  }
  if (v.patch !== lo.patch) return v.patch > lo.patch;
  if (v.hasPre !== lo.hasPre) return !v.hasPre; // 同版本正式版 > 预发布版
  return v.pre >= lo.pre;
}

test('KERNEL_GENERATIONS 结构不变量（首代 legacy，其余 own-events，范围自洽）', () => {
  assert.ok(KERNEL_GENERATIONS.length >= 2, '至少覆盖 0.1.1 与 0.1.2 两代');

  assert.equal(KERNEL_GENERATIONS[0].id, '0.1.1-rc.2');
  assert.equal(KERNEL_GENERATIONS[0].sessionApi, 'legacy-events');

  for (const [index, gen] of KERNEL_GENERATIONS.entries()) {
    if (index > 0) {
      assert.equal(gen.sessionApi, 'own-events', `${gen.id} 应为 own-events（0.1.2 起形状未变）`);
    }
    // 范围必须覆盖自身 id —— 否则等于声明了一个自己都不满足的区间
    assert.ok(
      caretCovers(gen.peerRange, gen.id),
      `${gen.id} 不满足自己的 peerRange ${gen.peerRange}`,
    );
    // peerRange 的下界必须**恰为**该代次本身，不能借更早的 range 蒙混。
    // 例：给 `0.1.5-rc.1` 写 `^0.1.2-rc.1` 虽然 semver 上"覆盖"了它（同 minor），
    // 但那等于声明插件从 0.1.2 起就支持这一代次 —— 而 0.1.5 是**单独验证**过的，
    // 代次表的意义正是逐代留痕，故下界必须与 id 一致。
    assert.equal(
      gen.peerRange,
      `^${gen.id}`,
      `${gen.id} 的 peerRange 应为 ^${gen.id}（逐代留痕，不借用更早下界）`,
    );
  }

  // 有序（递增）
  const ids = KERNEL_GENERATIONS.map((g) => g.id);
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(verGt(ids[i], ids[i - 1]), `代次表应递增：${ids[i - 1]} → ${ids[i]}`);
  }
});

test('verGt / caretCovers 自身行为正确（防护栏本身失效）', () => {
  assert.equal(verGt('0.1.5-rc.1', '0.1.2-rc.1'), true);
  assert.equal(verGt('0.1.2-rc.1', '0.1.5-rc.1'), false);
  assert.equal(verGt('0.1.5-rc.2', '0.1.5-rc.1'), true);
  assert.equal(verGt('0.1.5-rc.1', '0.1.5-rc.1'), false);

  assert.equal(caretCovers('^0.1.5-rc.1', '0.1.5-rc.1'), true);
  assert.equal(caretCovers('^0.1.5-rc.1', '0.1.5-rc.3'), true);
  // caret 在 0.x 上锁**次**版本、放开补丁号：^0.1.2 覆盖 0.1.5（同 minor）
  assert.equal(caretCovers('^0.1.2-rc.1', '0.1.5-rc.1'), true);
  // 但跨次版本不覆盖 —— 这才是要挡的错配
  assert.equal(caretCovers('^0.1.5-rc.1', '0.2.0-rc.1'), false);
  // 反向：范围下界高于目标版本时不覆盖
  assert.equal(caretCovers('^0.1.5-rc.1', '0.1.2-rc.1'), false);
  assert.equal(caretCovers('^0.1.5-rc.3', '0.1.5-rc.1'), false);
});

test('peerRangeFor：commands 额外并上 0.0.1-rc.1，其余仅内核代次', () => {
  const kernelRanges = KERNEL_GENERATIONS.map((g) => g.peerRange).join(' || ');
  assert.equal(peerRangeFor('@deepseek-ai/dsh-commands'), `^0.0.1-rc.1 || ${kernelRanges}`);
  assert.equal(peerRangeFor('@deepseek-ai/dsh-session'), kernelRanges);
  // 反例保护：非 commands 的包不得混入 0.0.1
  for (const { packageName, range } of peerMatrixEntries()) {
    if (packageName === '@deepseek-ai/dsh-commands') continue;
    assert.doesNotMatch(range, /0\.0\.1/, `${packageName} 不应带 0.0.1 范围`);
  }
});

test('package.json peer/dev 与 KERNEL_GENERATIONS 矩阵一致', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const { packageName, range } of peerMatrixEntries()) {
    assert.equal(
      pkg.peerDependencies?.[packageName],
      range,
      `peerDependencies.${packageName} 与 KERNEL_GENERATIONS 不同步——改 upstream-compat 后跑 scripts/sync-peer-matrix.mjs`,
    );
    assert.equal(
      pkg.devDependencies?.[packageName],
      range,
      `devDependencies.${packageName} 与 KERNEL_GENERATIONS 不同步`,
    );
  }
  for (const name of KERNEL_SCOPED_PACKAGES) {
    assert.ok(name.startsWith('@deepseek-ai/'), name);
  }
});

test('readOwnEvents：legacy 读 .events，modern 优先 ownEvents()', () => {
  const events = [createChangeEvent('schedule-1')];
  const a = legacySession(events);
  // modernSession 内部拷贝 log，引用身份不同——断言 deepEqual + 长度
  const b = modernSession(events);
  assert.equal(readOwnEvents(a), events);
  assert.deepEqual(readOwnEvents(b), events);
  assert.equal(readOwnEvents(b).length, 1);
  assert.equal(detectSessionApi(a), 'legacy-events');
  assert.equal(detectSessionApi(b), 'own-events');
});

test('readInheritedEventCount：modern 字段优先，legacy 回退 header.seedLength', () => {
  const events = [createChangeEvent('schedule-1'), createChangeEvent('schedule-2')];
  assert.equal(
    readInheritedEventCount({
      header: { seedLength: 99 },
      inheritedEventCount: 1,
    }),
    1,
  );
  // legacy：只有 seedLength（此前实现漏回退 → 恒 0）
  assert.equal(readInheritedEventCount(legacySession(events, 2)), 2);
  assert.equal(readInheritedEventCount({}), 0);
  assert.equal(readInheritedEventCount(legacySession(events, 0)), 0);
  assert.equal(readInheritedEventCount(modernSession(events, 0)), 0);
});

test('readInheritedEventCount：拒绝非 safe integer / 负数，回落下一档', () => {
  assert.equal(readInheritedEventCount({ inheritedEventCount: -1 }), 0);
  assert.equal(readInheritedEventCount({ inheritedEventCount: 1.5 }), 0);
  assert.equal(
    readInheritedEventCount({ inheritedEventCount: -1, header: { seedLength: 3 } }),
    3,
  );
});

test('foldUserState：两代形状对同一 live 日志 fold 结果一致', () => {
  const seedPayload = createChangeEvent('schedule-seed');
  const livePayload = createChangeEvent('schedule-live');

  const modern = modernSession([livePayload], 0);
  const modernState = foldUserState(modern);

  const legacy = legacySession([seedPayload, livePayload], 1);
  const legacyState = foldUserState(legacy);

  const ids = (state) => state.folded.active.map((r) => r.id).sort();
  assert.deepEqual(ids(modernState), ['schedule-live']);
  assert.deepEqual(ids(legacyState), ['schedule-live'], 'seedLength 切片必须排除继承前缀');
});

test('foldUserState：legacy 仅含 seed 时 active 为空（回归：seedLength 曾恒 0）', () => {
  const seedPayload = createChangeEvent('schedule-inherited');
  const session = legacySession([seedPayload], 1);
  const state = foldUserState(session);
  assert.deepEqual(state.folded.active, [], '继承前缀必须被排除');
});
