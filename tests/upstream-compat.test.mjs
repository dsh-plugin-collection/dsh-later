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
import { createAfterRecord as createAfterScheduleRecord } from '../lib/schedule-compat.js';
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
import { Config } from '../lib/index.js';

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
  // 走 compat 包装器：0.1.7 的 create*Record 需要 title，由包装器按 prompt 派生。
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

/**
 * peer 与 dev 的**意图不同**，守卫也据此分开：
 *
 *  - `peerDependencies` = 声明「支持哪些代次」→ 必须等于 KERNEL_GENERATIONS 拼出的
 *    完整范围，由 `scripts/sync-peer-matrix.mjs` 单一事实来源生成。
 *  - `devDependencies` = 本地编译/测试**实际跑在哪一代** → 必须是**某一个具体代次**，
 *    且该代次在已验证列表里。
 *
 * 为什么 dev 不再跟随完整范围：范围串会让 npm 解析到**满足条件的最老可用版本**
 * （实测解析到 0.1.2-rc.1），于是测试环境与真实运行环境（0.1.5-rc.3）长期脱节 ——
 * 之前 peer 缺口漏掉正是这个原因。dev 固定在**已验证的最新代次**，才能让 tsc 与
 * 测试在接近运行时的 API 面上执行，提前暴露漂移。
 */
test('peerDependencies 与 KERNEL_GENERATIONS 完整范围一致', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const { packageName, range } of peerMatrixEntries()) {
    assert.equal(
      pkg.peerDependencies?.[packageName],
      range,
      `peerDependencies.${packageName} 与 KERNEL_GENERATIONS 不同步——改 upstream-compat 后跑 scripts/sync-peer-matrix.mjs`,
    );
  }
  for (const name of KERNEL_SCOPED_PACKAGES) {
    assert.ok(name.startsWith('@deepseek-ai/'), name);
  }
});

test('devDependencies 固定到某个已验证代次（不与 peer 范围混同）', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const generationIds = KERNEL_GENERATIONS.map((g) => g.id);
  const latest = generationIds[generationIds.length - 1];
  const pinned = [];

  for (const name of KERNEL_SCOPED_PACKAGES) {
    const dev = pkg.devDependencies?.[name];
    assert.ok(dev !== undefined, `devDependencies.${name} 缺失`);
    // 必须是精确版本（可带 ^ 前缀），不能是范围串
    assert.doesNotMatch(dev, /\|\|/, `devDependencies.${name} 不应是范围串（当前 ${dev}）`);
    const version = dev.replace(/^[\^~]/, '');
    assert.ok(
      generationIds.includes(version),
      `devDependencies.${name} = ${dev} 不在已验证代次 [${generationIds.join(', ')}] 内`,
    );
    pinned.push(version);
  }

  // 全部 kernel-scoped 包应固定在同一代次（混代次会让类型面自相矛盾）
  assert.equal(
    new Set(pinned).size,
    1,
    `devDependencies 代次不一致：${JSON.stringify(pinned)}`,
  );
  // 且应是最新已验证代次 —— 让本地尽可能贴近运行时
  assert.equal(pinned[0], latest, `devDependencies 应固定到最新已验证代次 ${latest}（当前 ${pinned[0]}）`);
});

test('dev 与运行时代次的对齐说明（防止再次悄悄脱节）', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dev = pkg.devDependencies['@deepseek-ai/dsh-agent'].replace(/^[\^~]/, '');
  // 这条断言记录「本地开发用的代次」；升级依赖时同步更新此常量，
  // 使代次变更在 diff 中显式可见，而不是被 install 悄悄改掉。
  assert.equal(dev, '0.2.0-rc.2', 'devDependency 代次变更需同时更新本断言');
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

/**
 * 0.2.0 settings 轨道的静态护栏。
 *
 * 背景：0.2.0 的 `ctx.settings` 是 `SettingsForms`（无 `register()`），设置页
 * 表单由 `describe()` 从 `entry.fiber.runtime.Config` 生成。有三处**静默失效**
 * 的坑，本测试逐一锁住：
 *
 * 1. `Config` 未标 `volatile` → `volatileForm()` 返回 undefined → 宿主认为
 *    「无 live 字段」→ 设置页不生成（且不报错，见 dsh-settings
 *    `if (form === void 0) throw new Error(...has no volatile fields)` 仅在
 *    写入路径抛，读取路径静默跳过）。
 * 2. 表单字段只放在别处（如旧的 SchedulerSettingsSchema）而不在 `Config` 上 →
 *    0.2.0 读不到。
 * 3. 客户端用 settings namespace（'dsh-later'）而非**条目 id**（'later'）寻址 →
 *    `whileServed` 永不命中 → 卡片不挂载。
 */
test('0.2.0：Config 标了 volatile 且字段齐全（否则设置页不生成）', () => {
  const json = Config.toJSON();
  const refs = json.refs;
  const root = refs[String(json.uid)] ?? Object.values(refs).find((r) => r.type === 'object' && r.dict);
  assert.ok(root, 'Config.toJSON() 应能取到根对象节点');
  assert.equal(root.type, 'object');
  assert.equal(
    root.meta?.volatile,
    true,
    "Config 必须 .volatile()：否则 dsh-settings 的 volatileForm() 返回 undefined，0.2.0 设置页静默不生成",
  );

  // 与 docs / 设置卡一致的可编辑字段集合
  const expected = [
    'maxSchedules',
    'allowLongPrompts',
    'maxPromptChars',
    'showButton',
    'steerDelivery',
    'confirmDelivery',
    'onUnconfirmed',
    'clockIconStyle',
    'advancedSyntax',
  ];
  assert.deepEqual(
    Object.keys(root.dict ?? {}).sort(),
    [...expected].sort(),
    '可编辑字段必须全部声明在 Config 上（0.2.0 只读 Config 生成表单）',
  );
});

test('0.2.0：客户端寻址键为条目 id（later），非 settings namespace', () => {
  const src = readFileSync(join(root, 'src', 'client', 'index.tsx'), 'utf8');
  assert.match(src, /const ENTRY_ID = 'later'/);
  // configForms.get / whileServed 必须用 ENTRY_ID
  assert.match(src, /forms\.get\(ENTRY_ID\)/, 'configForms.get 必须用条目 id');
  assert.match(src, /whileServed\(\[ENTRY_ID\]/, 'whileServed 必须用条目 id');
  assert.doesNotMatch(
    src,
    /forms\.get\(SETTINGS_NS\)|whileServed\(\[SETTINGS_NS\]/,
    '不得用 settings namespace 寻址 configForms（0.2.0 会静默拿到空表单）',
  );
});

test('0.2.0：条目 id 与 cordis.patch.yml 的 id 一致', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  const idMatch = /-\s*insert:\s*\n\s*-\s*id:\s*(\S+)/.exec(patch);
  assert.ok(idMatch, 'cordis.patch.yml 应有 insert[].id');
  const entryId = idMatch[1];

  const hostSrc = readFileSync(join(root, 'src', 'index.ts'), 'utf8');
  const clientSrc = readFileSync(join(root, 'src', 'client', 'index.tsx'), 'utf8');
  assert.match(hostSrc, new RegExp(`const ENTRY_ID = '${entryId}'`), 'host 的 ENTRY_ID 应与 patch 一致');
  assert.match(clientSrc, new RegExp(`const ENTRY_ID = '${entryId}'`), 'client 的 ENTRY_ID 应与 patch 一致');
});

test('0.2.0：host 侧探测 register 缺失后走 describe() 轨道', () => {
  const src = readFileSync(join(root, 'src', 'index.ts'), 'utf8');
  // 必须存在 describe() 轨道，且用 ENTRY_ID 匹配 ns
  assert.match(src, /typeof forms\.describe === 'function'/, '应探测 SettingsForms.describe');
  assert.match(src, /candidate\.ns === ENTRY_ID/, 'describe() 结果应按条目 id 匹配');
  // 订阅文档更新以维持 live 语义
  assert.match(src, /settings\/document-updated/, '应订阅 settings/document-updated 保持 live');
});

/**
 * Config 里每个可编辑字段都必须真的出现在设置卡里。
 *
 * 为什么需要：0.2.0 的表单由 `Config` 生成，但**渲染哪些行由 SECTIONS 决定**。
 * 只加 Config 字段、忘了加 section 条目时，宿主不会报错——字段就在 schema 里，
 * 却在设置页上无处可点，等于该功能没有开关（本次加 advancedSyntax 时两边都要动，
 * 正是最容易只改一半的组合）。反向不校验：智能时段的 5 个 HH:mm 字段历史上就
 * 只存在于设置卡、不在 Config 里，那是另一件事，不该由这条测试顺带掩盖。
 */
test('Config 的每个可编辑字段都在设置卡 SECTIONS 中有对应行', () => {
  const json = Config.toJSON();
  const refs = json.refs;
  const root2 =
    refs[String(json.uid)] ?? Object.values(refs).find((r) => r.type === 'object' && r.dict);
  const configKeys = Object.keys(root2.dict ?? {});
  assert.ok(configKeys.length >= 9, `Config 字段解析异常：${configKeys.join(',')}`);

  const card = readFileSync(join(root, 'src', 'client', 'components', 'SchedulerSettingsCard.tsx'), 'utf8');
  const renderedKeys = new Set(
    [...card.matchAll(/key:\s*'([A-Za-z]+)'/g)].map((m) => m[1]),
  );
  /**
   * 曾经的缺口（`allowLongPrompts` / `maxPromptChars` 只有 host 侧管线、设置卡
   * 从未渲染，README「在设置里开启长文本」因此是不可达的指引）**已补齐**：
   * 两行现在都在 display section，并带 §6.3 的联动禁用（关闭时禁用+灰显，
   * 切换开关不自动改数值）。豁免名单随之清空。
   *
   * 下面那个循环**保留**：名单空时它恒不进入，但机制还在——日后若某个字段
   * 需要临时豁免，加一项即可；而「Config 声明了却没渲染」始终会被 `missing`
   * 拦住，这条才是本测试的主要价值。
   */
  const KNOWN_UNRENDERED = [];
  const missing = configKeys.filter((key) => !renderedKeys.has(key) && !KNOWN_UNRENDERED.includes(key));
  assert.deepEqual(missing, [], `这些 Config 字段没有设置卡入口：${missing.join(', ')}`);
  for (const key of KNOWN_UNRENDERED) {
    assert.ok(!renderedKeys.has(key), `${key} 已在设置卡出现——请把它从 KNOWN_UNRENDERED 豁免里删掉`);
    assert.ok(configKeys.includes(key), `Config 不再声明 ${key}，请同步清理豁免列表`);
  }

  // 双语字典也必须覆盖每个渲染字段的 label/hint key，否则界面上直接显示 key 名
  const client = readFileSync(join(root, 'src', 'client', 'index.tsx'), 'utf8');
  const labelKeys = [...card.matchAll(/(?:labelKey|hintKey|titleKey|ariaKey):\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
  const absent = [...new Set(labelKeys)].filter((key) => {
    const re = new RegExp(`\\b${key}:`, 'g');
    return (client.match(re) ?? []).length < 2; // zh 与 en 各一次
  });
  assert.deepEqual(absent, [], `这些文案 key 缺少 zh/en 之一：${absent.join(', ')}`);
});
