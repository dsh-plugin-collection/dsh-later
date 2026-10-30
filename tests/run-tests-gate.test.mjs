/**
 * `npm test` 不得在「一条测试都没跑」时退出 0（scripts/run-tests.mjs 的门禁）。
 *
 * ## 这个文件在防什么
 *
 * 原先的 test 脚本是 `node --test "tests/*.test.mjs"`：glob 交给 node 展开，而 node 在展开
 * 为空时**照跑不误**。实测 `node --test "tests/NOPE-*.test.mjs"` 打印 `# tests 0 / # pass 0`
 * 并以 **0** 退出。于是 pattern 打错、tests/ 没被 checkout、测试文件整体改名，在 CI 上都表现为
 * 一条绿色测试步骤：门禁什么都没跑，却宣布通过。空跑的红利是零，代价是「以后没人敢信这条绿」。
 *
 * ## 断言分四层
 *  1. **展开**（纯函数，零子进程）：默认 pattern 得到全部测试文件；零匹配 throw；
 *     helpers/ 与别的 worktree 不可能被收进来。
 *  2. **计数解析**：tap / spec / 带 ANSI 三种输出都取到 pass，取不到时返回 undefined（由调用方判红）。
 *  3. **接线**：package.json 的 test 与 CI 的测试步骤都必须走这一个入口，防有人顺手改回 glob。
 *  4. **端到端**（真起子进程）：零匹配非零退出、显式列表真跑得通、node --test 的退出码被传播。
 *
 * ## 已知边界（别让后人以为 pass 计数无所不能）
 * 一个「文件被收进列表但里面一条 test 都没注册」的情况，node 会把**文件本身**记成
 * `# tests 1 / # pass 1`（实测），pass 计数抓不到它。挡住它的是第 1 层（列表只收 `*.test.mjs`
 * 的真实文件）加用例自己的 `test()` 声明，不是 pass 数。
 * @module tests/run-tests-gate
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PATTERN,
  NoTestFilesError,
  expandTestFiles,
  parseSummary,
} from '../scripts/run-tests.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const scriptPath = join(root, 'scripts', 'run-tests.mjs');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

/* ---------------- 1. 展开 ---------------- */

test('默认 pattern 展开成全部顶层测试文件，且每个都真实存在', () => {
  assert.equal(DEFAULT_PATTERN, 'tests/*.test.mjs', '默认口径就是这五个字符，改它要连带改 CI 里的说明');
  const files = expandTestFiles(DEFAULT_PATTERN, root);
  const onDisk = readdirSync(join(root, 'tests'))
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => `tests/${name}`)
    .sort();
  assert.deepEqual(files, onDisk, '展开结果与 tests/ 目录内容不一致');
  assert.ok(files.length >= 50, `只展开出 ${files.length} 个文件，不像全量`);
  for (const file of files) {
    assert.match(file, /^tests\/[^/]+\.test\.mjs$/, `路径不合规：${file}`);
    assert.ok(existsSync(join(root, file)), `${file} 不存在：展开结果与文件系统不一致`);
  }
});

test('零匹配必须 throw（这是本 issue 的全部意义，别改成「返回空数组继续跑」）', () => {
  for (const pattern of [
    'tests/NOPE-*.test.mjs',
    'tests/__no_such__.test.mjs',
    'no-such-dir/*.test.mjs',
    'tests/README-*.md',
  ]) {
    assert.throws(() => expandTestFiles(pattern, root), NoTestFilesError, `${pattern} 居然没判红`);
  }
});

test('helpers/ 里的共享夹具不会被当成测试文件收进来', () => {
  assert.equal(existsSync(join(root, 'tests', 'helpers', 'ownership-state.mjs')), true, '夹具本体要在');
  assert.throws(() => expandTestFiles('tests/helpers/*.test.mjs', root), NoTestFilesError);
  assert.ok(
    expandTestFiles('tests/**/*.test.mjs', root).every((f) => !f.includes('/helpers/')),
    '递归形式也不得把 helpers/ 收进来',
  );
});

test('`**` 形式覆盖默认形式，且从根下钻不会跑到 node_modules / 别的 worktree', () => {
  const flat = expandTestFiles(DEFAULT_PATTERN, root);
  const deep = expandTestFiles('tests/**/*.test.mjs', root);
  assert.deepEqual(deep.slice(0, flat.length), flat, '`tests/**` 应至少包含全部顶层文件且顺序一致');
  assert.ok(
    expandTestFiles('**/tests/*.test.mjs', root).every((f) => f.startsWith('tests/')),
    '下钻必须跳过 node_modules/.git/.agents：把别的 worktree 的测试算进 pass 数，是另一种假绿',
  );
});

/* ---------------- 2. 计数解析 ---------------- */

test('parseSummary 认得 tap、spec、带 ANSI 三种汇总，取不到时给 undefined', () => {
  assert.deepEqual(parseSummary('# tests 620\n# pass 620\n# fail 0\n'), {
    tests: 620,
    pass: 620,
    fail: 0,
  });
  assert.equal(parseSummary('ℹ tests 16\nℹ pass 16\nℹ fail 0\n').pass, 16, 'spec reporter 的汇总行');
  assert.equal(
    parseSummary('\u001b[2mℹ pass 7\u001b[22m\n').pass,
    7,
    '带色输出也要取得到：按行首锚定就把解析挂在「有没有颜色」上',
  );
  assert.equal(parseSummary('# tests 0\n# pass 0\n').pass, 0, '0 要如实返回 0，交由调用方判红');
  assert.deepEqual(parseSummary('no summary here'), { tests: undefined, pass: undefined, fail: undefined });
  assert.equal(parseSummary('').pass, undefined, '空输出解析不出 pass（调用方要判红，不能当 0 放行）');
});

test('parseSummary 取的是末尾那份汇总，不是中途撞见的字面量', () => {
  // 实测踩过：某条用例失败时，它的源码/断言文本会被打进 TAP，里面就带着 `# pass 0` 这种字面量。
  // 按第一次匹配取值会把整轮汇总读成 0，一条真·全绿的 run 反而判红。
  const polluted = [
    '# Subtest: something',
    'not ok 1 - something',
    '  ---',
    "  error: 'actual: \"# tests 0\\n# pass 0\"'",
    '  ...',
    '1..2',
    '# tests 2',
    '# pass 2',
    '# fail 0',
  ].join('\n');
  assert.equal(parseSummary(polluted).pass, 2);
  assert.equal(parseSummary(polluted).fail, 0);
});

/* ---------------- 3. 接线 ---------------- */

/**
 * 取 CI 里**真正会执行**的东西（`run:` 那几行），注释不参与判定。
 * 不这么切的话，注释里解释「为什么不用 node --test / 不加字节门禁」的原话会被自己的
 * doesNotMatch 判红，等于逼着说明文字改写。步骤顺序、执行内容才是可执行的契约。
 * @param {string} ci - ci.yml 全文。
 * @returns {string} 按出现顺序拼起来的 run 命令。
 */
function ciRunLines(ci) {
  return ci
    .split('\n')
    .filter((line) => /^\s*run:\s*/.test(line))
    .map((line) => line.replace(/^\s*run:\s*/, '').trim())
    .join('\n');
}

const ciRuns = ciRunLines(read(join('.gitea', 'workflows', 'ci.yml')));

test('package.json 的 test 走 run-tests 入口，不再把展开交给 node 的 glob', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs');
  assert.doesNotMatch(pkg.scripts.test, /node --test/, 'test 脚本里不该再出现裸的 node --test：展开与判空都在 run-tests');
});

test('CI 的测试步骤仍走 npm test，展开判定只在 run-tests 一处', () => {
  assert.match(ciRuns, /(^|\n)npm test(\n|$)/, 'CI 必须经过同一个入口，否则本地与 CI 判据分叉');
  assert.doesNotMatch(ciRuns, /node --test/, 'CI 不得自己拼 node --test：那会绕过 run-tests 的判空与判数');
});

test('CI 在测试之前先 build：lib/ 是已提交产物，不重编就测的是上一次提交', () => {
  const build = ciRuns.indexOf('npm run build');
  const testStep = ciRuns.indexOf('npm test');
  assert.ok(build >= 0, 'CI 必须有 npm run build 这一步：lib/ 是已提交产物，tests/ 里一大批文件 import ../lib/');
  assert.ok(testStep > build, 'build 必须在 test 之前，否则测的还是旧 lib/');
  // 字节新鲜度门禁刻意不加，理由（含两条实测依据）写在 ci.yml 的注释里，那边是这件事唯一的家。
  assert.doesNotMatch(
    ciRuns,
    /git diff --exit-code -- lib/,
    '产物字节在本仓库不是稳定量（符号链接布局 + caret 版 esbuild/tsc）；要先证明稳定再谈加这道门禁',
  );
});

/* ---------------- 4. 端到端 ---------------- */

/**
 * 本段还顺带钉住一件事：下面两个用例是**跑在 node --test 里面**去起 `node scripts/run-tests.mjs`
 * 的，而 node 给测试子进程设了 `NODE_TEST_CONTEXT=child-v8`。带着它再递归起测试，node 会
 * `skipping running files` 并**以 0 退出、不产出任何汇总**（v22.22.2 实测）。run-tests 在 spawn
 * 前清掉这个变量，所以这里能拿到真输出；去掉那个清理，这两条会以「解析不到 pass 计数」失败。
 */
const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** 起真脚本（不经 npm，省一层 shell），cwd 可控。 */
function runScript(cwd, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('端到端：零匹配时脚本非零退出，并说清「一条测试都没跑」', () => {
  const run = runScript(root, ['--pattern', 'tests/NOPE-*.test.mjs']);
  assert.equal(run.signal, null, '不该被信号打断');
  assert.notEqual(run.status, 0, '零匹配必须非零退出；退 0 就是那条会空跑的门禁又开了');
  assert.match(run.stderr, /匹配到 0 个测试文件/);
  assert.match(run.stderr, /一条测试都没跑/, '要说清性质，否则读日志的人会以为「没有失败所以通过」');
  assert.equal(run.stdout, '', '零匹配时不该起 node --test，stdout 必须是空的');
});

test('端到端：显式文件列表这条路真跑得通（子集 + pass 解析 + 退 0）', () => {
  const run = runScript(root, ['--pattern', 'tests/bar-geometry.test.mjs']);
  assert.equal(run.status, 0, `应当通过，实际 stderr:\n${run.stderr}`);
  assert.match(run.stdout, /pass\s+16/, 'bar-geometry 是 16 条用例，pass 数要被如实转发出来');
  assert.match(run.stderr, /run-tests: 1 个文件/, '结论行要有文件数，光看 pass 数看不出是不是全量');
});

test('端到端：node --test 的退出码被传播，不会被「本地判定」盖成 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-run-tests-fail-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 't'));
  writeFileSync(
    join(dir, 't', 'boom.test.mjs'),
    "import { test } from 'node:test';\ntest('deliberate failure', () => { throw new Error('boom'); });\n",
  );
  const run = runScript(dir, ['--pattern', 't/*.test.mjs']);
  assert.notEqual(run.status, 0, '用例失败必须让 npm test 失败');
  assert.match(run.stdout, /fail\s+1/, '失败计数应原样出现在转发出来的 node --test 输出里');
});

test('端到端：认不出的参数不被静默吞掉（转交 node --test 后由它判红）', () => {
  const run = runScript(root, ['--paltern', 'tests/bar-geometry.test.mjs']);
  assert.notEqual(run.status, 0, '手滑写成 --paltern 时，绝不能「照默认全量跑完再退 0」');
});
