/**
 * `scripts/verify-across-kernels.mjs` 的口径契约（issue #97）。
 *
 * 这个脚本是"某代次到底支不支持"的判决者，所以它自己的口径必须可复核 —— 三条缺陷都是
 * **它说得比事实更肯定**造成的：
 *
 *  1. 请求 rc.1、装出来 rc.3 的组合，被报成"rc.1 已通过"；
 *  2. 只覆盖装配/功能，两条真红（跨代 tsc、老代次不导出 `evaluatePluginCompatibility`）
 *     根本不在它的面上；
 *  3. 越界自检只扫 `~/.dsh/sessions`，`plugin-state/` 里的残留被漏掉，还对外说过"已清理"。
 *
 * 这里的断言都跑在**纯函数**上（注入临时目录），不需要网络、不需要内核树 —— 门禁脚本的
 * 口径本身不该只有在"这台机器上装齐了 7 代"时才可验证。
 * @module tests/verify-kernels-contract
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEY_PACKAGES, driftReport, ensureTreePeers, parseSteps, resolvedVersions, scanLeaks,
} from '../scripts/verify-across-kernels.mjs';
import {
  auditPluginSources, planPeerBackfill, resolveBootEntry, toShortName, toSpecifier,
} from '../scripts/kernel-assembly.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const source = readFileSync(join(root, 'scripts', 'verify-across-kernels.mjs'), 'utf8');

/**
 * 往树里写一个 `@deepseek-ai/<name>` 包。
 *
 * `spec` 给字符串就是"只写版本"（旧用法）；给对象还能表达三件真树里会发生的事：
 *  - `at: 'dsh'` —— 嵌在 `@deepseek-ai/dsh/node_modules/` 下（纯装启动器时 npm 就这么铺）；
 *  - `peers` / `optional` —— peer 声明与 `peerDependenciesMeta.optional`；
 *  - `entry: false` —— 只有清单、没有 `lib/index.js`。
 * @param {string} base 树根。
 * @param {string} name 包名（不带 scope）。
 * @param {string|{version: string, at?: string, peers?: object, optional?: object, entry?: boolean}} spec
 * @returns {string} 写入的包目录。
 */
function addPackage(base, name, spec) {
  const shape = typeof spec === 'string' ? { version: spec } : spec;
  const dir = shape.at === undefined
    ? join(base, 'node_modules', '@deepseek-ai', name)
    : join(base, 'node_modules', '@deepseek-ai', shape.at, 'node_modules', '@deepseek-ai', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `@deepseek-ai/${name}`,
    version: shape.version,
    // 真实内核包都带 main/exports；缺了它，bare 解析会**穿过去找到别处那份**（调试时实测：
    // 落到开发仓的 .pnpm 上），审计于是报"解析到被测树之外"——假红。夹具必须与真包同形。
    main: 'lib/index.js',
    exports: { '.': './lib/index.js' },
    ...(shape.peers ? { peerDependencies: shape.peers } : {}),
    ...(shape.optional ? { peerDependenciesMeta: shape.optional } : {}),
  }));
  if (shape.entry !== false) {
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'index.js'), 'export {};\n');
  }
  return dir;
}

/**
 * 造一棵"内核树"：写入若干 `@deepseek-ai/<name>/package.json`。
 * @param {Record<string, string>} versions - 包名（不带 scope）→ 版本。
 * @returns {string} 树根。
 */
function fakeTree(versions) {
  const dir = mkdtempSync(join(tmpdir(), 'xk-tree-'));
  for (const [name, version] of Object.entries(versions)) addPackage(dir, name, version);
  return dir;
}

test('parseSteps：认四个面、去重，拼错必须当场报错（拼错比没跑更危险：它看起来像跑过了）', () => {
  assert.deepEqual(parseSteps('mount,function'), ['mount', 'function']);
  assert.deepEqual(parseSteps('mount,type,type,gate'), ['mount', 'type', 'gate']);
  assert.deepEqual(parseSteps(' mount , function '), ['mount', 'function']);
  assert.throws(() => parseSteps('mount,typ'), /未知 steps：typ/);
  assert.throws(() => parseSteps('mount,all'), /未知 steps：all/);
});

test('parseSteps：默认值是 mount,function（type/gate 会起子进程与装依赖，不进默认）', () => {
  assert.match(source, /parseSteps\(opt\('steps', 'mount,function'\)\)/);
});

test('resolvedVersions：读出实际解析到的版本，没装的记 null（不是猜一个）', () => {
  const tree = fakeTree({ dsh: '0.1.5-rc.1', 'dsh-app-boot': '0.1.5-rc.3' });
  const got = resolvedVersions(tree, ['dsh', 'dsh-app-boot', 'dsh-base']);
  assert.deepEqual(got, { dsh: '0.1.5-rc.1', 'dsh-app-boot': '0.1.5-rc.3', 'dsh-base': null });
});

test('driftReport：请求 rc.1 却解析到 rc.3 必须报漂移（#97 #1 的现场）', () => {
  const tree = fakeTree({
    dsh: '0.1.5-rc.1',
    'dsh-app-boot': '0.1.5-rc.3', // caret 带出来的更晚 rc —— 正是被误报成"rc.1 已通过"的那种
    'dsh-base': '0.1.5-rc.3',
    'dsh-schedule': '0.1.5-rc.1',
  });
  const report = driftReport(tree, '0.1.5-rc.1', ['dsh', 'dsh-app-boot', 'dsh-base', 'dsh-schedule', 'dsh-session']);
  assert.deepEqual(report.drifted.sort(), ['dsh-app-boot 0.1.5-rc.1→0.1.5-rc.3', 'dsh-base 0.1.5-rc.1→0.1.5-rc.3']);
  assert.equal(report.packages.dsh.resolved, '0.1.5-rc.1');
  // 没装的包（null）不算漂移：那是"该代次没有这个包"，与"版本错了"是两件事
  assert.equal(report.packages['dsh-session'].resolved, null);
  assert.ok(!report.drifted.some((d) => d.includes('dsh-session')));
});

test('driftReport：全部与请求一致时空漂移（pin 生效的正常态）', () => {
  const tree = fakeTree({ dsh: '0.1.5-rc.1', 'dsh-app-boot': '0.1.5-rc.1' });
  const report = driftReport(tree, '0.1.5-rc.1', ['dsh', 'dsh-app-boot']);
  assert.deepEqual(report.drifted, []);
});

test('KEY_PACKAGES：必须含启动器与组合漂移最常发生的那几个包', () => {
  for (const name of ['dsh', 'dsh-app-boot', 'dsh-base', 'dsh-schedule']) {
    assert.ok(KEY_PACKAGES.includes(name), `${name} 必须在关键包清单里，否则漂移检测看不见它`);
  }
});

test('scanLeaks：三类目录 + 根级文件都要扫（只扫 sessions 会漏掉 plugin-state 的残留）', () => {
  const dsh = mkdtempSync(join(tmpdir(), 'xk-dsh-'));
  const touch = (rel, content = '{}') => {
    const p = join(dsh, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
    return p;
  };
  const inSessions = touch('sessions/proj/xk-abc');
  const inStorages = touch('storages/deep/xk-def.json');
  const inPluginState = touch('plugin-state/later/xk-mgh.json'); // #97 #3 的现场
  const atRoot = touch('xk-root.json');
  const innocent = touch('plugin-state/later/normal.json');
  touch('sessions/proj/keep.json');

  const found = scanLeaks(dsh, 'xk-').sort();
  assert.deepEqual(found.sort(), [atRoot, inPluginState, inSessions, inStorages].sort());
  assert.ok(!found.includes(innocent), '不带本次前缀的文件不许被当成残留');
});

test('scanLeaks：目录本身命中即算（会话目录名就是会话 id）且不再往下重复报', () => {
  const dsh = mkdtempSync(join(tmpdir(), 'xk-dsh-'));
  const sessionDir = join(dsh, 'sessions', 'proj', 'xk-dir');
  mkdirSync(join(sessionDir, 'nested'), { recursive: true });
  writeFileSync(join(sessionDir, 'nested', 'event.jsonl'), '{}');
  const found = scanLeaks(dsh, 'xk-');
  assert.deepEqual(found, [sessionDir]);
});

test('scanLeaks：目录不存在不抛错（干净机器上第一次跑）', () => {
  const dsh = mkdtempSync(join(tmpdir(), 'xk-empty-'));
  assert.deepEqual(scanLeaks(dsh, 'xk-'), []);
});

test('结构：类型面必须复用 scripts/typecheck-all.mjs（别在门禁脚本里再写一遍 && 短路）', () => {
  assert.match(source, /from '\.\/typecheck-all\.mjs'/, '类型面必须复用汇总逻辑（issue #96 的教训）');
  assert.match(source, /runTypecheck\(/);
  assert.doesNotMatch(source, /-p tsconfig\.json[^\n]*&&/, '不许再出现 tsc a && tsc b');
  assert.match(source, /tsconfig\.client\.json|DEFAULT_PROJECTS|runTypecheck/, 'client 项目必须在类型面里');
});

test('结构：门禁面必须双判（本代次自己的判定 + 最新语义），并把两值都留在产物里', () => {
  assert.match(source, /evaluateGate\(/, '必须真的调那个函数，而不是读 engines 字符串推断');
  assert.match(source, /return \{ own, latest/, '产物里要同时有本代次与最新语义两个判定');
  assert.match(source, /record\.gate = gateFace\(/, '两个判定都要写进产物（JSON 里能被复核）');
});

test('结构：pin exact + 漂移降级（否则"rc.1 已通过"会悄悄变成"rc.1 启动器 + rc.3 组件"）', () => {
  assert.match(source, /--legacy-peer-deps/);
  assert.match(source, /\.xk-pinned/);
  assert.match(source, /UNDETERMINED[\s\S]{0,120}漂移|漂移[\s\S]{0,120}UNDETERMINED/);
});

test('结构：越界自检覆盖面写死在代码里（不是只在文档里承诺）', () => {
  for (const sub of ['sessions', 'storages', 'plugin-state']) {
    assert.match(source, new RegExp(`'${sub}'`), `${sub}/ 必须在自检里`);
  }
});

/* ------------------------------------------------------------------ *
 * 装配口径（issue #110）：内核包按**实际落点**找、peer 逐轮补齐全树、插件解析必须落在被测树上。
 *
 * 这三条以前只是注释里的打算，于是脚本把自己的装配毛病报成了内核事实：0.1.5-rc.1 曾被
 * 判「装不起来」，而同一棵树补齐 peer 后 mount 是 GREEN。下面的断言全部跑在**假树结构**上
 * （真目录、真 package.json、真 require 解析，没有网络、没有 boot），
 * 目的是"这台机器上装齐 7 代"不再是验证门禁口径的前提。树的构造用文件顶部的 `addPackage()`
 * （`at: 'dsh'` 就是"嵌在 `@deepseek-ai/dsh/node_modules/` 下"，纯装启动器时 npm 的铺法）。
 * ------------------------------------------------------------------ */

test('resolveBootEntry：纯装启动器时 app-boot 嵌在 dsh/node_modules 下，也必须找到（rc.1 的现场）', () => {
  const base = mkdtempSync(join(tmpdir(), 'xk-boot-'));
  addPackage(base, 'dsh', { version: '0.1.5-rc.1' });
  addPackage(base, 'dsh-app-boot', { version: '0.1.5-rc.1', at: 'dsh' });
  const got = resolveBootEntry(base);
  assert.ok(got.entry !== null, '嵌套落点必须能解析到，否则脚本会报一条假红 Cannot find module');
  assert.equal(got.nested, true);
  assert.ok(got.entry.endsWith(join('@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')));
});

test('resolveBootEntry：顶层与嵌套都有时取顶层（pin 装齐的树是正常形态）', () => {
  const base = mkdtempSync(join(tmpdir(), 'xk-boot-'));
  addPackage(base, 'dsh', { version: '0.2.1-rc.2' });
  addPackage(base, 'dsh-app-boot', { version: '0.2.1-rc.2' });
  addPackage(base, 'dsh-app-boot', { version: '0.2.1-rc.2', at: 'dsh' });
  const got = resolveBootEntry(base);
  assert.equal(got.nested, false);
  assert.equal(got.entry, join(base, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'));
});

test('resolveBootEntry：找不到时 entry=null 且把找过的位置交出去（不许静默换路径继续跑）', () => {
  const base = mkdtempSync(join(tmpdir(), 'xk-boot-'));
  mkdirSync(join(base, 'node_modules', '@deepseek-ai'), { recursive: true });
  const got = resolveBootEntry(base);
  assert.equal(got.entry, null);
  assert.ok(got.searched.length > 0, '必须报告找过哪些位置，错误才可诊断');
  assert.ok(got.searched.some((p) => p === join(base, 'node_modules', '@deepseek-ai', 'dsh-app-boot')));
});

test('resolvedVersions / driftReport：嵌套树里的版本读得出来，漂移不再集体失明', () => {
  // 旧实现只读顶层 ⇒ 嵌套树每个包都读成 null，而 null 的口径是"该代次没有这个包"，
  // "pin 后仍漂移"那行于是永远不出现，混装树看起来反而最干净。
  const base = mkdtempSync(join(tmpdir(), 'xk-nest-'));
  const packages = ['dsh', 'dsh-app-boot', 'dsh-base', 'dsh-schedule'];
  addPackage(base, 'dsh', { version: '0.1.5-rc.1' });
  addPackage(base, 'dsh-app-boot', { version: '0.1.5-rc.3', at: 'dsh' });
  addPackage(base, 'dsh-base', { version: '0.1.5-rc.3', at: 'dsh' });
  addPackage(base, 'dsh-schedule', { version: '0.1.5-rc.1', at: 'dsh' });
  const got = resolvedVersions(base, packages);
  assert.deepEqual(got, {
    dsh: '0.1.5-rc.1',
    'dsh-app-boot': '0.1.5-rc.3',
    'dsh-base': '0.1.5-rc.3',
    'dsh-schedule': '0.1.5-rc.1',
  });
  const drift = driftReport(base, '0.1.5-rc.1', packages);
  assert.deepEqual(drift.drifted.sort(), ['dsh-app-boot 0.1.5-rc.1→0.1.5-rc.3', 'dsh-base 0.1.5-rc.1→0.1.5-rc.3']);
});

test('planPeerBackfill：靠 peer 拿兄弟包的（jsonl→persistence）必须被规划进去，并 pin 到请求代次', () => {
  const plan = planPeerBackfill([
    { name: 'dsh-base', version: '0.1.5-rc.1', peers: { '@deepseek-ai/dsh-session-persistence-jsonl': '^0.1.5-rc.1' }, optional: new Set() },
    { name: 'dsh-session-persistence-jsonl', version: '0.1.5-rc.1', peers: { '@deepseek-ai/dsh-session-persistence': '^0.1.5-rc.1' }, optional: new Set() },
  ], { version: '0.1.5-rc.1', published: () => true });
  // jsonl 本身在树里（dsh-base 的 peer 因此不算缺口），缺的只有它靠 peer 拿的那个兄弟包。
  assert.deepEqual(plan.specs, ['@deepseek-ai/dsh-session-persistence@0.1.5-rc.1']);
  assert.deepEqual(plan.missing, [{
    dep: '@deepseek-ai/dsh-session-persistence',
    range: '^0.1.5-rc.1',
    from: 'dsh-session-persistence-jsonl',
  }], 'missing 要带上是谁声明的这个 peer，否则报"缺件"时报不出来源');
});

test('planPeerBackfill：optional 的 peer 跳过，非 dsh* 的 peer 按声明范围装（不跟内核版本号）', () => {
  const plan = planPeerBackfill([
    {
      name: 'dsh-app-boot',
      version: '0.1.5-rc.1',
      peers: {
        '@deepseek-ai/cordis': '~4.0.5',
        '@deepseek-ai/dsh-launch-environment': '^0.1.5-rc.1',
        '@deepseek-ai/dsh-optional-thing': '^0.1.5-rc.1',
      },
      optional: new Set(['@deepseek-ai/dsh-optional-thing']),
    },
  ], { version: '0.1.5-rc.1', published: (name) => name === 'dsh-launch-environment' });
  assert.deepEqual(plan.specs, ['@deepseek-ai/cordis@~4.0.5', '@deepseek-ai/dsh-launch-environment@0.1.5-rc.1']);
  assert.deepEqual(plan.skippedOptional, ['dsh-optional-thing']);
  // 该代次没发布的 dsh* peer 不 pin（pin 一个不存在的版本会让整条 npm i 失败）。
  const unpublished = planPeerBackfill([
    { name: 'dsh-app-boot', version: '0.1.5-rc.1', peers: { '@deepseek-ai/dsh-never-published': '^0.1.5-rc.1' }, optional: new Set() },
  ], { version: '0.1.5-rc.1', published: () => false });
  assert.deepEqual(unpublished.specs, ['@deepseek-ai/dsh-never-published@^0.1.5-rc.1']);
});

test('ensureTreePeers：迭代到收敛（第 1 轮补一批，补完再扫就没有缺口）', () => {
  const base = mkdtempSync(join(tmpdir(), 'xk-peers-'));
  addPackage(base, 'dsh', { version: '0.1.5-rc.1' });
  addPackage(base, 'dsh-app-boot', { version: '0.1.5-rc.1' });
  addPackage(base, 'dsh-session-persistence-jsonl', {
    version: '0.1.5-rc.1',
    peers: { '@deepseek-ai/dsh-session-persistence': '^0.1.5-rc.1' },
  });
  const seen = [];
  const fakeInstall = (specs) => {
    seen.push(specs.slice());
    // 模拟 npm：把请求的包铺进顶层 node_modules（peer 的 peer 也一起带上）。
    for (const spec of specs) {
      const name = spec.replace(/^@deepseek-ai\//, '').split('@')[0];
      addPackage(base, name, { version: '0.1.5-rc.1' });
    }
    return 0;
  };
  const got = ensureTreePeers(base, '0.1.5-rc.1', fakeInstall, { published: () => true });
  assert.deepEqual(seen, [['@deepseek-ai/dsh-session-persistence@0.1.5-rc.1'], []].filter((x) => x.length > 0));
  assert.deepEqual(got.installed, ['@deepseek-ai/dsh-session-persistence']);
  assert.deepEqual(got.stillMissing, [], '补齐后不许再报缺口');
  assert.deepEqual(got.blocking, []);
  assert.equal(got.rounds, 2, '应当是"装一轮 + 再扫一轮确认收敛"，不是一轮就宣布完事');
});

test('ensureTreePeers：装不动时把仍缺的报出来，启动器自己声明的那条算 blocking', () => {
  const base = mkdtempSync(join(tmpdir(), 'xk-peers-'));
  addPackage(base, 'dsh', { version: '0.1.5-rc.1' });
  addPackage(base, 'dsh-app-boot', {
    version: '0.1.5-rc.1',
    peers: { '@deepseek-ai/cordis-plugin-group': '^1.0.2' },
  });
  const got = ensureTreePeers(base, '0.1.5-rc.1', () => 1, { published: () => false });
  assert.deepEqual(got.stillMissing, ['@deepseek-ai/cordis-plugin-group']);
  assert.deepEqual(got.blocking, ['@deepseek-ai/cordis-plugin-group'], '缺这条 boot() 起不来 ⇒ 必须报未判定而不是继续 mount');
  assert.equal(got.rounds, 1, 'npm 非零就停，不许把时间烧在重试上');
});

test('auditPluginSources：清单给全名（KERNEL_SCOPED_PACKAGES 的真实形状）也必须能解析', () => {
  // 这条就是"假树喂短名、真树喂全名"漏掉的那个 bug：无脑拼 scope 会得到
  // @deepseek-ai/@deepseek-ai/dsh-agent，于是 8 个包全"解析不到"、每次 mount 都判红。
  const { tree, copy } = profilePair();
  addPackage(tree, 'dsh', { version: '0.1.5-rc.1' });
  addPackage(tree, 'dsh-agent', { version: '0.1.5-rc.1' });
  const got = auditPluginSources({
    copyDir: copy, treeRoot: tree, runtime: '0.1.5-rc.1',
    packages: ['@deepseek-ai/dsh-agent'],
  });
  assert.equal(got.ok, true, JSON.stringify(got.offenders));
  assert.equal(got.checked, 1);
  assert.deepEqual(['dsh-agent', '@deepseek-ai/dsh-llm'].map(toSpecifier),
    ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm'], '两种写法都要规整成全名');
  assert.deepEqual(['dsh-agent', '@deepseek-ai/dsh-llm'].map(toShortName),
    ['dsh-agent', 'dsh-llm'], 'offender 里报的是短名，两种输入要归一');
});

test('auditPluginSources：插件解析到的每个包都在这棵树里且版本等于宿主 ⇒ 同一次 mount 才作数', () => {
  const { tree, copy } = profilePair();
  addPackage(tree, 'dsh', { version: '0.1.5-rc.1' });
  addPackage(tree, 'dsh-agent', { version: '0.1.5-rc.1' });
  addPackage(tree, 'dsh-schedule', { version: '0.1.5-rc.1' });
  const got = auditPluginSources({ copyDir: copy, treeRoot: tree, runtime: '0.1.5-rc.1', packages: ['dsh-agent', 'dsh-schedule'] });
  assert.equal(got.ok, true, JSON.stringify(got.offenders));
  assert.equal(got.checked, 2);
});

test('auditPluginSources：混装（插件解析 rc.3、宿主 rc.1）必须报出来 —— 那条 GREEN 证明的不是 rc.1', () => {
  const { tree, copy } = profilePair();
  addPackage(tree, 'dsh', { version: '0.1.5-rc.1' });
  addPackage(tree, 'dsh-agent', { version: '0.1.5-rc.3' });
  const got = auditPluginSources({ copyDir: copy, treeRoot: tree, runtime: '0.1.5-rc.1', packages: ['dsh-agent'] });
  assert.equal(got.ok, false);
  assert.equal(got.offenders.length, 1);
  assert.match(got.offenders[0].reason, /0\.1\.5-rc\.3/);
  assert.match(got.offenders[0].reason, /0\.1\.5-rc\.1/);
});

test('auditPluginSources：解析跑到树外（开发仓那份宿主包）要报，而不是安静算过', () => {
  const base = mkdtempSync(join(tmpdir(), 'xk-outside-'));
  const tree = join(base, 'tree');
  const elsewhere = join(base, 'elsewhere');
  mkdirSync(join(tree, 'node_modules', '@deepseek-ai'), { recursive: true });
  addPackage(tree, 'dsh', { version: '0.1.5-rc.1' });
  addPackage(elsewhere, 'dsh-agent', { version: '0.2.1-rc.2' });
  const copy = join(tree, 'profile', 'node_modules', 'dsh-later');
  mkdirSync(copy, { recursive: true });
  // 插件解析根里挂的是**别处**那份 dsh-agent（软链），这就是"双实例"的形状。
  mkdirSync(join(tree, 'profile', 'node_modules', '@deepseek-ai'), { recursive: true });
  symlinkSync(join(elsewhere, 'node_modules', '@deepseek-ai', 'dsh-agent'), join(tree, 'profile', 'node_modules', '@deepseek-ai', 'dsh-agent'), 'dir');
  const got = auditPluginSources({ copyDir: copy, treeRoot: tree, runtime: '0.1.5-rc.1', packages: ['dsh-agent'] });
  assert.equal(got.ok, false);
  assert.match(got.offenders[0].reason, /被测树之外/);
});

test('auditPluginSources：解析不到也算 offender（"没测到"不等于"测过了"）', () => {
  const { tree, copy } = profilePair();
  addPackage(tree, 'dsh', { version: '0.1.5-rc.1' });
  const got = auditPluginSources({ copyDir: copy, treeRoot: tree, runtime: '0.1.5-rc.1', packages: ['dsh-nothing-here'] });
  assert.equal(got.ok, false);
  assert.match(got.offenders[0].reason, /解析不到/);
});

/** 造一对"被测树 + profile 里的插件实体副本"，并把树的 @deepseek-ai 软链进副本的解析根。 */
function profilePair() {
  const base = mkdtempSync(join(tmpdir(), 'xk-audit-'));
  const tree = join(base, 'tree');
  mkdirSync(join(tree, 'node_modules', '@deepseek-ai'), { recursive: true });
  const copy = join(base, 'profile', 'node_modules', 'dsh-later');
  mkdirSync(copy, { recursive: true });
  // 注意：scope 目录由软链本身创建 —— 先 mkdir 出来会让 symlinkSync 报 EEXIST。
  symlinkSync(join(tree, 'node_modules', '@deepseek-ai'), join(base, 'profile', 'node_modules', '@deepseek-ai'), 'dir');
  return { tree, copy, base };
}
