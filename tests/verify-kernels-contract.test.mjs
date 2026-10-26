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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEY_PACKAGES, driftReport, parseSteps, resolvedVersions, scanLeaks,
} from '../scripts/verify-across-kernels.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const source = readFileSync(join(root, 'scripts', 'verify-across-kernels.mjs'), 'utf8');

/**
 * 造一棵"内核树"：写入若干 `@deepseek-ai/<name>/package.json`。
 * @param {Record<string, string>} versions - 包名（不带 scope）→ 版本。
 * @returns {string} 树根。
 */
function fakeTree(versions) {
  const dir = mkdtempSync(join(tmpdir(), 'xk-tree-'));
  for (const [name, version] of Object.entries(versions)) {
    const pkgDir = join(dir, 'node_modules', '@deepseek-ai', name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version }));
  }
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
