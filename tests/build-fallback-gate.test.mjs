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
