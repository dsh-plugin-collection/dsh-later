/**
 * issue #56：`npm run build` 在 host tsc 失败时不得静默降级 esbuild 后照常打勾。
 *
 * 原先兜底是**默认行为**，代价是产物形态漂移：lib/index.js 从逐文件 tsc 产物
 * （≈24.6KB，import './projection.js' 等兄弟模块）变成 esbuild 单文件 bundle
 * （≈128KB，兄弟模块被内联），模块身份/状态单例被复制，一次性带出 34 条假测试
 * 失败，把真正的类型错误埋掉。
 *
 * 本文件钉两层（与 tests/build-no-silent-deploy.test.mjs 同一套做法）：
 *  1. 纯策略：默认关，开要显式，优先级与 `--no-deploy`/`--deploy`/`DSH_LATER_RELINK`
 *     同构；
 *  2. 接线：build.mjs 的失败路径必须真的挂在策略后面，且文案说清代价。
 * 端到端（真塞类型错误跑构建）在 tests/build-artifact-shape.test.mjs。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  shouldAllowFallback,
  FALLBACK_REFUSED_NOTICE,
  FALLBACK_ALLOWED_NOTICE,
} from '../scripts/build-fallback-policy.mjs';

const repoRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

/* ---------------- 1. 策略：默认关，开要显式 ---------------- */

test('默认不允许兜底（这是本 issue 的全部意义，别改成开）', () => {
  assert.equal(shouldAllowFallback([], {}), false);
  assert.equal(shouldAllowFallback([], { DSH_LATER_BUILD_FALLBACK: '' }), false);
  assert.equal(shouldAllowFallback(['--silent'], {}), false);
});

test('--allow-fallback（及别名）显式开闸', () => {
  assert.equal(shouldAllowFallback(['--allow-fallback'], {}), true);
  assert.equal(shouldAllowFallback(['--allow-esbuild-fallback'], {}), true);
  assert.equal(shouldAllowFallback(['--fallback'], {}), true);
  // 同时给出时 --no-fallback 胜出（显式拒绝优先级最高，见下一条）
  assert.equal(shouldAllowFallback(['--no-fallback', '--allow-fallback'], {}), false);
});

test('DSH_LATER_BUILD_FALLBACK 环境变量可开闸，取值宽松', () => {
  for (const v of ['1', 'true', 'TRUE', ' yes ', 'on']) {
    assert.equal(shouldAllowFallback([], { DSH_LATER_BUILD_FALLBACK: v }), true, `${v} 应视为开`);
  }
  for (const v of ['0', 'false', 'no', '', 'banana']) {
    assert.equal(shouldAllowFallback([], { DSH_LATER_BUILD_FALLBACK: v }), false, `${v} 应视为关`);
  }
});

test('--no-fallback 优先级最高（可在脚本里强制关掉环境的影响）', () => {
  assert.equal(shouldAllowFallback(['--no-fallback'], { DSH_LATER_BUILD_FALLBACK: '1' }), false);
  assert.equal(shouldAllowFallback(['--no-esbuild-fallback'], { DSH_LATER_BUILD_FALLBACK: 'true' }), false);
});

test('优先级与 relink 策略同构：--no-X > --X > 环境变量 > 默认关', () => {
  // 四条一起摆出来，防止后来者把顺序写反（relink 的默认是关，这里也必须关）
  assert.equal(shouldAllowFallback(['--no-fallback', '--allow-fallback'], { DSH_LATER_BUILD_FALLBACK: '1' }), false);
  assert.equal(shouldAllowFallback(['--allow-fallback'], { DSH_LATER_BUILD_FALLBACK: '0' }), true);
  assert.equal(shouldAllowFallback([], { DSH_LATER_BUILD_FALLBACK: '1' }), true);
  assert.equal(shouldAllowFallback([], {}), false);
});

/* ---------------- 2. 文案：代价与开闸路径都要说清 ---------------- */

test('拒绝兜底时必须说清代价与显式开闸方式（否则会被当成「构建坏了」）', () => {
  assert.match(FALLBACK_REFUSED_NOTICE, /lib\/ 未被改写/);
  assert.match(FALLBACK_REFUSED_NOTICE, /--allow-fallback/);
  assert.match(FALLBACK_REFUSED_NOTICE, /DSH_LATER_BUILD_FALLBACK/);
  assert.match(FALLBACK_REFUSED_NOTICE, /24\.6KB/);
  assert.match(FALLBACK_REFUSED_NOTICE, /128KB/);
});

test('兜底告警必须醒目，并写明「产物形态不同、测试结果不可用于判定回归」', () => {
  assert.match(FALLBACK_ALLOWED_NOTICE, /警告/);
  assert.match(FALLBACK_ALLOWED_NOTICE, /🟥/);
  assert.match(
    FALLBACK_ALLOWED_NOTICE,
    /产物形态与逐文件 tsc 不同，测试结果不可用于判定回归/,
    '这句是判据：读者要立刻知道这份产物不能用来判定回归',
  );
  assert.match(FALLBACK_ALLOWED_NOTICE, /单例被复制/);
});

/* ---------------- 3. 接线：失败路径挂在策略后面 ---------------- */

test('build.mjs 的 host tsc 失败路径由 shouldAllowFallback 把关', () => {
  const src = read('build.mjs');
  assert.match(src, /from '\.\/scripts\/build-fallback-policy\.mjs'/);
  assert.match(src, /shouldAllowFallback\(argv\)/);
  // exit(1) 必须在策略判断之后：默认路径先中止，不碰兜底写盘
  const gate = src.indexOf('if (!shouldAllowFallback(');
  const exit = src.indexOf('process.exit(1)');
  const fallbackWrite = src.indexOf('writeFileSync(`lib/${name}`');
  assert.ok(gate > 0, '必须存在 shouldAllowFallback 闸门判断');
  assert.ok(exit > gate, 'process.exit(1) 必须位于闸门之后（默认失败）');
  assert.ok(fallbackWrite > exit, '兜底写盘必须位于闸门与 exit 之后（默认路径碰不到）');
});

test('host tsc 以 --noEmitOnError 运行（失败时 lib/ 不被改写）', () => {
  // tsc 默认即使有类型错误也 emit；不加这个开关，「非零退出」与「lib/ 未被改写」
  // 就不能同时成立。端到端在 build-artifact-shape.test.mjs 里实测。
  assert.match(
    read('build.mjs'),
    /npx tsc -p tsconfig\.json --noEmitOnError/,
    'host tsc 必须带 --noEmitOnError，否则失败时仍会写 lib/',
  );
});

test('兜底时不得再打「tsc 产物」绿勾（收尾回报要如实）', () => {
  const src = read('build.mjs');
  const tail = src.slice(src.indexOf('if (hostFallbackUsed)'));
  assert.match(tail, /esbuild 兜底/, '兜底收尾必须标明是 esbuild 兜底');
  assert.match(tail, /测试结果不可用于判定回归/);
  assert.match(src, /hostFallbackUsed = true/, '兜底路径必须置位，供收尾回报使用');
});

test('package.json 的 build 入口保持纯构建（开闸走参数/环境变量，不另加 script）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.build, 'node build.mjs');
});

/* ---------------- 4. 共享夹具：三个 build 门禁不再各抄一份暂存逻辑 ---------------- */

/**
 * issue #208 卫生第 5 条：三个 build 门禁原先各自抄一份「复制工作树 + 假 HOME + 清空环境开关
 * + PATH 前置」。手抄的代价不是几行重复，而是**口径会分叉**：任一份漏清一个环境开关
 * （`DSH_LATER_RELINK` / `DSH_LATER_BUILD_FALLBACK`）或漏前置 `.bin`，同一份代码在两台机器上
 * 就会走不同分支，而失败信息里看不出是这个差异造成的。
 *
 * 这里钉的是「口径只有一处实现」这件事本身：三个文件都必须 import 共享 helper，
 * 且不得再出现自己的 `cpSync(join(repoRoot, 'src')` / `symlinkSync(...node_modules)` 暂存块。
 * 共享**机器**但不共享**树**：每个文件各自 stage（node --test 默认按文件并行，
 * 共享一棵树会互相投毒 —— 一个文件注入的 host 类型错误会让另一个文件的 client 面也红）。
 */
test('结构：三个 build 门禁都走 tests/helpers/staged-build.mjs，不再各抄一份暂存块', () => {
  const files = [
    'build-artifact-shape.test.mjs',
    'build-client-typecheck-gate.test.mjs',
    'build-no-silent-deploy.test.mjs',
  ];
  for (const name of files) {
    const body = read(join('tests', name));
    assert.match(
      body,
      /from '\.\/helpers\/staged-build\.mjs'/,
      `${name} 必须 import 共享夹具：暂存/环境口径只能有一处实现`,
    );
    // 只 import `canBuild` 等于「借了个判定、树还是自己搭的」：那正是分叉的入口。
    // 所以要求**真正拿机器**的导出（stage 树 / 跑构建）至少在 import 名单里出现一个。
    assert.match(
      body,
      /import \{[^}]*\b(stageBuildableTree|runBuildIn)\b[^}]*\} from '\.\/helpers\/staged-build\.mjs'/,
      `${name} 只 import 了判定，没有用共享夹具 stage/跑构建 —— 暂存块还是自己那份`,
    );
    assert.doesNotMatch(
      body,
      /cpSync\(join\([^)]*'src'\)/,
      `${name} 里还有自己的 src 复制块 —— 暂存逻辑又分叉了`,
    );
    assert.doesNotMatch(
      body,
      /symlinkSync\(join\([^)]*'node_modules'/,
      `${name} 里还有自己的 node_modules 软链 —— 暂存逻辑又分叉了`,
    );
    // 环境开关不能在门槛测试里另写一遍：漏清一条就换分支。
    assert.doesNotMatch(
      body,
      /DSH_LATER_BUILD_FALLBACK: ''/,
      `${name} 自己清环境开关 = 与 helper 的第二份口径`,
    );
  }
  // 真正拿机器的那一处：helper 自己必须清两个开关并前置 .bin。
  const helper = read('tests/helpers/staged-build.mjs');
  for (const token of ["DSH_LATER_RELINK: ''", "DSH_LATER_BUILD_FALLBACK: ''", 'node_modules/.bin']) {
    assert.ok(helper.includes(token), `helper 缺环境口径：${token}`);
  }
  // 互不污染：三份暂存树用**不同**的临时目录前缀，失败时一眼看得出是谁留下的。
  // 互不污染：临时目录前缀带上 purpose（失败时一眼看得出是谁留下的）。
  assert.match(helper, /mkdtempSync\(join\(tmpdir\(\), `dsh-later-\$\{purpose\}-`\)\)/,
    'stageBuildableTree 必须按 purpose 分开临时目录');
  const shape = read(join('tests', files[0]));
  const clientGate = read(join('tests', files[1]));
  assert.match(shape, /stageBuildableTree\(repoRoot, 'issue56'\)/, 'host 面用自己的 purpose');
  assert.match(clientGate, /stageBuildableTree\(root, 'client-gate'\)/, 'client 面用自己的 purpose');
});
