/**
 * 消息 `source.kind` 的判定依据（issue #75）：内核版本优先，符号探测兜底。
 *
 * ## 这个文件在防什么
 *
 * 上游两个破坏性变更**不在同一个 rc 落地**：`0.1.7-rc.1` 已经删掉消息
 * `source.kind:'plugin'`（v4 准入在写入时刻直接 throw），而
 * `renderEveryReminderBatchFraming` → `renderRecurringReminderBatchFraming` 的改名要到
 * `rc.2`。老实现拿改名当「是不是 0.1.7」的判据，于是在 rc.1 这代选 `plugin` →
 * **提醒到点 100% 不投递，而且没有任何可读的错误**（实测：会话日志里既无
 * `schedule/change operation:dispatch`，也没有那句校验报错——它在宿主 stdout；
 * `fold` 从 active 1 → 0 是窗口过期，不是消费）。
 *
 * 更关键的是：**换个符号探测也救不回来**。实测 `@deepseek-ai/dsh-schedule` 在
 * `0.1.5-rc.1` 与 `0.1.7-rc.1` 两版里的导出面逐符号相同
 * （`renderEveryReminderBatchFraming` ✅ 两边都有、`allocateScheduleId` ✅ 两边都有、
 * `renderRecurringReminderBatchFraming` ❌ 两边都无）。所以 issue 里建议的
 * 「改用 `allocateScheduleId` 判定」同样会把 rc.1 判成 legacy。能区分这两代的
 * 只有版本号——本文件就把这条钉死，包括阈值边界本身。
 *
 * 原报告在真实宿主上跑出来的矩阵（本文件第 4 组用装好的版本树复核版本号这一半，
 * 投递那一半见 `devkit/func-later.mjs --case drive-gates`，判据写在 PR 里）：
 *
 * | 版本 | plugin kind 是否被收 | render 新名是否存在 | 老实现选到 |
 * |---|---|---|---|
 * | 0.1.5-rc.1 | 是 | 否 | plugin ✅ |
 * | 0.1.7-rc.1 | **否** | **否** | plugin ❌（事故） |
 * | 0.1.7-rc.2 | 否 | 是 | schedule ✅ |
 * | 0.2.1-rc.2 | 否 | 是 | schedule ✅ |
 * @module tests/kernel-version-source-kind
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  KERNEL_VERSION_SPECIFIERS,
  PLUGIN_KIND_RETIRED_SINCE,
  compareVersions,
  parseVersion,
  readKernelVersion,
  versionAtLeast,
} from '../lib/upstream-compat.js';
import {
  messageSourceDecision,
  resetMessageSourceDecision,
  scheduleMessageSource,
} from '../lib/schedule-compat.js';

/** 注入一组「内核事实」，取回判定结果（每例都要清缓存：判定是进程级 memo 的）。 */
function decide({ version, specifier = '@deepseek-ai/dsh', modernRenderName = false, warn = () => {} }) {
  resetMessageSourceDecision();
  try {
    return messageSourceDecision({
      readKernel: () => (version === undefined ? undefined : { version, specifier }),
      hasModernRenderName: () => modernRenderName,
      warn,
    });
  } finally {
    resetMessageSourceDecision();
  }
}

// ── 1. 事故本身 ────────────────────────────────────────────────────────────────────

test('0.1.7-rc.1 必须选 schedule：这是提醒 100% 不投递的那一代', () => {
  // 符号探测在这一代说「还是 0.1.5」——正因为这样，判定不能交给它。
  const d = decide({ version: '0.1.7-rc.1', modernRenderName: false });
  assert.equal(d.kind, 'schedule', 'rc.1 上 plugin kind 已被 v4 准入拒绝，选 plugin 就是静默丢提醒');
  assert.equal(d.via, 'kernel-version');
  assert.match(d.detail, /0\.1\.7-rc\.1/);
});

// 注意：0.1.1 / 0.1.2 / 0.1.5 已按 issue #95 移出支持矩阵，但**判定函数仍须对它们给出正确结论**
// —— 版本读到老值时不能因为"不支持"就随便选一个。这些断言测的是规则本身，不是支持声明。
test('更早代次仍选 plugin：把 schedule 塞给 0.1.5 同样是准入拒绝', () => {
  for (const version of ['0.1.1-rc.2', '0.1.2-rc.1', '0.1.5-rc.1', '0.1.5-rc.3']) {
    assert.equal(decide({ version, modernRenderName: false }).kind, 'plugin', `${version} 应仍走 plugin`);
  }
});

test('rc.2 与 0.2.x 选 schedule', () => {
  for (const version of ['0.1.7-rc.2', '0.1.7', '0.2.0-rc.2', '0.2.1-rc.2']) {
    assert.equal(decide({ version, modernRenderName: true }).kind, 'schedule', `${version} 应走 schedule`);
  }
});

test('交出的 source 形状：schedule 不带 plugin 标签，plugin 带', () => {
  resetMessageSourceDecision();
  try {
    messageSourceDecision({ readKernel: () => ({ version: '0.1.7-rc.1', specifier: '@deepseek-ai/dsh' }) });
    const modern = scheduleMessageSource('摘要');
    assert.equal(modern.kind, 'schedule');
    assert.equal('plugin' in modern, false, '0.1.7+ 的 MessageSourceMap 里没有 plugin，多带一个键就是往非法形状里塞东西');
    assert.equal(modern.form, 'notice');
    assert.equal(modern.summary, '摘要');

    resetMessageSourceDecision();
    messageSourceDecision({ readKernel: () => ({ version: '0.1.5-rc.1', specifier: '@deepseek-ai/dsh' }) });
    const legacy = scheduleMessageSource('摘要');
    assert.equal(legacy.kind, 'plugin');
    assert.equal(typeof legacy.plugin, 'string');
    assert.ok(legacy.plugin.length > 0, 'plugin 标签不能是空串：0.1.5 的准入要求它标识生产者');
  } finally {
    resetMessageSourceDecision();
  }
});

// ── 2. 阈值与比较器（判定的地基，坏在这里会全线判错）──────────────────────────────

test('阈值就是实测淘汰 plugin kind 的那一版', () => {
  assert.equal(PLUGIN_KIND_RETIRED_SINCE, '0.1.7-rc.1');
});

test('versionAtLeast 在预发布边界上的行为（阈值本身是 rc.1，比较必须分得清 rc 之间）', () => {
  const at = (v) => versionAtLeast(v, PLUGIN_KIND_RETIRED_SINCE);
  assert.equal(at('0.1.5-rc.3'), false, '0.1.5 线不能被判成已淘汰');
  assert.equal(at('0.1.6-alpha.2'), false);
  assert.equal(at('0.1.7-alpha.2'), false, 'alpha 线未验证过 plugin kind 淘汰，保守按旧代处理');
  assert.equal(at('0.1.7-rc.1'), true, '边界含等号：这一代就已经拒绝 plugin');
  assert.equal(at('0.1.7-rc.2'), true);
  assert.equal(at('0.1.7'), true, '正式版高于同版本号预发布');
  assert.equal(at('0.2.1-rc.2'), true);
});

test('预发布标识按 semver §11 比，不做字符串比大小', () => {
  // 字符串比会写出 rc.10 < rc.2；这里必须按数字标识比。
  assert.equal(compareVersions('0.1.7-rc.10', '0.1.7-rc.2'), 1);
  assert.equal(compareVersions('0.1.7-rc.1', '0.1.7-rc.1'), 0);
  assert.equal(compareVersions('0.1.7-alpha.9', '0.1.7-rc.1'), -1);
  assert.equal(compareVersions('0.1.7', '0.1.7-rc.2'), 1);
  assert.equal(compareVersions('0.1.7-rc.1', undefined), undefined, '读不出的一律 undefined，绝不猜成很旧或很新');
  assert.equal(compareVersions('garbage', '0.1.7-rc.1'), undefined);
  assert.equal(versionAtLeast('not-a-version', PLUGIN_KIND_RETIRED_SINCE), undefined);
});

test('parseVersion 容忍 v 前缀与 build metadata，拒绝含糊形状', () => {
  assert.deepEqual(parseVersion('v0.1.7-rc.1'), { major: 0, minor: 1, patch: 7, pre: ['rc', 1] });
  assert.deepEqual(parseVersion('0.1.7-rc.1+build.9'), { major: 0, minor: 1, patch: 7, pre: ['rc', 1] });
  assert.equal(parseVersion('0.1.7-rc.1+build.9').major, 0);
  assert.equal(parseVersion('0.17'), undefined, '两段式不是我们关心的形状，判 undefined 而不是补 0');
  assert.equal(parseVersion(''), undefined);
});

// ── 3. 版本读不到时的兜底：可用，但必须可见 ────────────────────────────────────────

test('兜底才用符号探测：一个判定周期里探测一次、警告一次', () => {
  const warnings = [];
  const opts = (modernRenderName) => ({
    readKernel: () => undefined,
    hasModernRenderName: () => modernRenderName,
    warn: (message) => warnings.push(message),
  });

  resetMessageSourceDecision();
  try {
    // 周期内第二次调用命中缓存：既不重复探测，也不再刷警告。
    assert.equal(messageSourceDecision(opts(false)).kind, 'plugin', '没有新名 ⇒ 兜底按旧代处理');
    assert.equal(messageSourceDecision(opts(true)).kind, 'plugin', '兜底结论按进程缓存，第二次不该改主意');
    assert.equal(warnings.length, 1, `降级要留一句话且只留一句，实际 ${warnings.length} 条`);
    assert.match(warnings[0], /0\.1\.7-rc\.1/, '警告必须点名是哪一代容易判错，否则等于没说');
    assert.match(warnings[0], /dsh-schedule|package\.json/, '警告要给出排查方向（哪一路读不到）');

    // 新进程语义（清缓存后）认那个改名信号：兜底路径本身没写反。
    resetMessageSourceDecision();
    assert.equal(messageSourceDecision(opts(true)).kind, 'schedule');
  } finally {
    resetMessageSourceDecision();
  }
});

// ── 4. 读版本这件事本身 ────────────────────────────────────────────────────────────

test('候选 specifier 依次尝试：先命中即用，解析不到就换下一路', () => {
  const FILES = new Map([
    ['/x/node_modules/@deepseek-ai/dsh/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' })],
    ['/x/node_modules/@deepseek-ai/dsh-schedule/package.json', JSON.stringify({ name: '@deepseek-ai/dsh-schedule', version: '0.1.7-rc.1' })],
    // pnpm 的真实形状：入口埋在 .pnpm/<pkg>@<ver>/node_modules/<pkg>/lib 里，向上要多走几层。
    ['/x/node_modules/.pnpm/dsh@0.1.7-rc.1/node_modules/@deepseek-ai/dsh/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-rc.1' })],
  ]);
  const readFile = (filePath) => {
    const hit = FILES.get(filePath);
    if (hit === undefined) throw new Error(`ENOENT ${filePath}`);
    return hit;
  };
  // specifier 里带 scope，node_modules 下也是 `@scope/name` 两层——不能把 scope 去掉拼路径。
  const resolveExcept = (blocked) => (specifier) => {
    if (blocked.includes(specifier)) throw new Error('ERR_MODULE_NOT_FOUND');
    return `file:///x/node_modules/${specifier}/lib/index.js`;
  };

  assert.deepEqual(
    readKernelVersion({ resolve: resolveExcept([]), readFile }),
    { version: '0.2.1-rc.2', specifier: '@deepseek-ai/dsh' },
    '两个都解析得到时应取候选表的第一个（宿主本体）',
  );
  assert.deepEqual(
    readKernelVersion({ resolve: resolveExcept(['@deepseek-ai/dsh']), readFile }),
    { version: '0.1.7-rc.1', specifier: '@deepseek-ai/dsh-schedule' },
    '宿主包看不见时必须换 peer 包：pnpm 隔离布局下这是常态，不是异常',
  );
  assert.equal(
    readKernelVersion({ resolve: () => { throw new Error('ERR_MODULE_NOT_FOUND'); }, readFile }),
    undefined,
    '全都读不到时返回 undefined，由调用方降级并警告——绝不猜一个代次',
  );
  assert.deepEqual(
    readKernelVersion({
      resolve: () => 'file:///x/node_modules/.pnpm/dsh@0.1.7-rc.1/node_modules/@deepseek-ai/dsh/lib/index.js',
      readFile,
      specifiers: ['@deepseek-ai/dsh'],
    }),
    { version: '0.1.7-rc.1', specifier: '@deepseek-ai/dsh' },
    '从入口向上要能穿过 pnpm 深链：穿不过就等于每次投递都走兜底',
  );
});

test('候选表里既有宿主本体，也有插件必然解析得到的 peer', () => {
  assert.ok(KERNEL_VERSION_SPECIFIERS.includes('@deepseek-ai/dsh'));
  assert.ok(KERNEL_VERSION_SPECIFIERS.includes('@deepseek-ai/dsh-schedule'), '本插件静态 import 了它 ⇒ 这一路一定解析得到，是宿主包读不到时的主力后备');
});

// ── 5. 与真实安装对账（没有版本树时跳过，并说明为什么）────────────────────────────

const VERSION_STORE = process.env.DSH_VERSION_STORE ?? join(homedir(), 'dsh-versions');
const TREES = existsSync(VERSION_STORE)
  ? readdirSync(VERSION_STORE).filter((name) => existsSync(join(VERSION_STORE, name, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')))
  : [];
const TREE_SKIP = TREES.length > 0 ? false : `本机没有 DSH 版本树（${VERSION_STORE}）：CI 里不装多代内核，这条只在本地 dev loop 跑`;

test('真版本树里的版本号，判定结论与上游准入一致', { skip: TREE_SKIP }, () => {
  // 期望表来自 issue #75 的实测矩阵：只有 plugin kind 的淘汰边界是事实，不是推测。
  const EXPECT = {
    '0.1.1-rc.2': 'plugin',
    '0.1.5-rc.1': 'plugin',
    '0.1.7-rc.1': 'schedule',
    '0.1.7-rc.2': 'schedule',
    '0.2.0-rc.2': 'schedule',
    '0.2.1-rc.2': 'schedule',
  };
  for (const name of TREES) {
    const version = JSON.parse(readFileSync(join(VERSION_STORE, name, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version;
    const expected = EXPECT[version];
    if (expected === undefined) continue; // 本机装了张外的版本：不参与断言，只参与下面的「读得到」检查
    assert.equal(decide({ version }).kind, expected, `${version} 判错就是 issue #75 复发`);
  }
});

test('真版本树的 package.json 读得到 version（判定的输入源没断）', { skip: TREE_SKIP }, () => {
  for (const name of TREES) {
    const raw = readFileSync(join(VERSION_STORE, name, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8');
    assert.match(JSON.parse(raw).version, /^\d+\.\d+\.\d+/);
  }
});

// ── 6. 结构性护栏：别再退回「拿改名推断 kind 淘汰」─────────────────────────────────

test('schedule-compat 的主判据是版本，符号探测只活在兜底分支', () => {
  const src = readFileSync(new URL('../src/schedule-compat.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // 版本是主输入，阈值是实测那个版本号——两条都必须是代码，不是注释。
  assert.match(src, /const readKernel = options\.readKernel \?\? readKernelVersion;/, '判定必须真的读内核版本');
  assert.match(src, /versionAtLeast\(kernel\.version, PLUGIN_KIND_RETIRED_SINCE\)/, '阈值必须是那个实测版本号');
  // 旧的「拿改名推断 0.1.7」写法必须从调用点消失：它正是 rc.1 判错的原因。
  assert.doesNotMatch(src, /const isV17 =/, 'isV17 那种单符号推断不该再存在');
  // 符号探测只能在版本分支之后出现，且必须伴随一次可见警告。
  const versionBranch = src.indexOf('if (kernel !== undefined)');
  // 只认「存在性判定」那一处：`renderRecurringBatchFraming()` 里也按同一个名字取值，
  // 但那是择一调用（存在就用），不是代次判定——不加 `!== undefined` 会把两处混成一处。
  const probeAt = src.indexOf("pick<(r: readonly unknown[]) => string>('renderRecurringReminderBatchFraming') !== undefined");
  assert.ok(versionBranch >= 0 && probeAt > versionBranch, '符号探测必须排在版本判定之后（兜底），不是之前（主判据）');
  assert.match(src, /if \(!warnedFallback\)/, '兜底必须有可见警告');
  // scheduleMessageSource 自己不再做任何判定：它只消费结论。
  const body = src.slice(src.indexOf('export function scheduleMessageSource'));
  assert.doesNotMatch(body.slice(0, 500), /pick\(/, '调用点不该再自己做符号探测');
});

test('rc.1 已登记进代次矩阵，peer 枚举跟着带上它', () => {
  const compat = readFileSync(new URL('../src/upstream-compat.ts', import.meta.url), 'utf8');
  assert.match(compat, /id: '0\.1\.7-rc\.1'/, '代次表必须显式列 rc.1：它不是 rc.2 的预发布，是一代独立行为');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue;
    assert.match(range, /\^0\.1\.7-rc\.1/, `${name} 的 peer 枚举漏了 rc.1（scripts/sync-peer-matrix.mjs 没跑？）`);
  }
  // tuple 收口后，「rc.1 被正式承认」的表达从「engines 里有 <0.2.0-0 兜着」变成
  // **它自己那条下界恰为 rc.1**——这比原来更强：借更宽的下界蒙混不再可能。
  assert.match(pkg.engines.dsh, />=0\.1\.7-rc\.1\s/, 'engines 的 0.1.7 条款下界必须是 rc.1，不是 rc.2');
});
