/**
 * issue #56 的判据层：`lib/index.js` 必须是**逐文件 tsc 产物**，兜底产物必须判红。
 *
 * 为什么单独一层：tsc 路径与 esbuild 兜底路径写出的文件同名（都是 lib/index.js），
 * 光看「构建成功」分不出来。形态差异是：逐文件产物 index.js 用 `from './x.js'`
 * 引用兄弟模块（≈24.6KB）；兜底产物把兄弟模块内联成单文件（≈128KB，还带
 * esbuild 的 `// src/xxx.ts` 分节注释），模块身份/状态单例被复制。
 *
 * 这里四层：
 *  1. 纯函数判据（快）：仓库里那份产物是逐文件形态；
 *  2. 反例（防止判据永远通过）：真打一份 esbuild bundle，判据必须判红；
 *  3. 对照组（issue #208 卫生第 5 条补）：同一份暂存树**不塞类型错误**时必须构建成功
 *     —— 否则下面几条「非零退出」可能来自夹具坏了（漏复制文件、注入写错路径），
 *     而它们照样全绿；
 *  4. 端到端（真代价）：在 src/ 塞类型错误跑构建——
 *     · 默认：非零退出 + lib/ 字节级未被改写 + 仍是逐文件产物；
 *     · 显式 --allow-fallback：才降级，且产物被同一条判据判红（证明兜底真的会漂移）。
 *
 * 端到端在临时目录里复制一份工作树跑（不污染本仓库的 src/lib，可与其它测试文件
 * 并行；node --test 默认并行跑文件）。暂存与运行环境的口径收在
 * `tests/helpers/staged-build.mjs`（三个 build 门禁文件共用，见该模块头注释）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  inspectHostArtifact,
  assertPerFileArtifact,
  HOST_INDEX_BYTE_CAP,
} from '../scripts/build-artifact-shape.mjs';
import { canBuild, disposeAll, stageBuildableTree } from './helpers/staged-build.mjs';

const repoRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');
const readBytes = (path) => readFileSync(path, 'utf8');

const buildable = canBuild(repoRoot);

/** 兜底路径的 externals（与 build.mjs 保持一致；只求形态，不求逐字节等价）。 */
const FALLBACK_EXTERNALS = [
  '@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-schedule', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-settings', 'zod',
];

/* ---------------- 1. 判据：仓库里的产物是逐文件 tsc 产物 ---------------- */

test('lib/index.js 是逐文件 tsc 产物：保留相对导入、远低于兜底体积', () => {
  const report = inspectHostArtifact(read('lib/index.js'));
  assert.equal(report.shape, 'tsc-per-file', `形态不对：\n- ${report.problems.join('\n- ')}`);
  assert.equal(report.ok, true);
  assert.ok(
    report.bytes <= HOST_INDEX_BYTE_CAP,
    `体积 ${report.bytes}B 超过上限 ${HOST_INDEX_BYTE_CAP}B`,
  );
  assert.ok(
    report.relativeImports >= 1,
    '逐文件产物必须用相对导入引用兄弟模块（被拍平=已被 bundle）',
  );
  assert.deepEqual(report.inlinedMarkers, [], '逐文件产物不应出现 esbuild 的 // src/*.ts 分节注释');
});

/* ---------------- 2. 反例：真 bundle 必须判红 ---------------- */

test(
  '反例：真实的 esbuild 兜底产物必须被同一条判据判红（判据不是永远通过的摆设）',
  { skip: !buildable },
  async () => {
    // 用与 build.mjs 兜底路径相同的选项打一份真 bundle（write:false，不落盘）
    const result = await build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      write: false,
      logLevel: 'error',
      external: FALLBACK_EXTERNALS,
      absWorkingDir: repoRoot,
    });
    const bundled = result.outputFiles[0].text;

    const report = inspectHostArtifact(bundled);
    assert.equal(report.ok, false, '兜底产物必须判红，否则判据守不住任何东西');
    assert.equal(report.shape, 'bundled');
    assert.ok(report.bytes > HOST_INDEX_BYTE_CAP, `兜底产物应超过体积上限，实际 ${report.bytes}B`);
    assert.equal(report.relativeImports, 0, 'bundle 不应再有相对导入（兄弟模块已内联）');
    assert.ok(report.inlinedMarkers.length > 0, 'bundle 应出现 // src/*.ts 内联分节注释');
    assert.throws(
      () => assertPerFileArtifact(bundled, '兜底 lib/index.js'),
      /不是逐文件 tsc 产物/,
      'assertPerFileArtifact 必须对兜底产物抛错',
    );
  },
);

/* ---------------- 3. 端到端：类型错误 → 默认失败、lib/ 不动 ---------------- */

const staged = [];

after(() => {
  disposeAll(staged);
});

/**
 * 暂存一份可构建的最小工作树，塞一个 host 类型错误，并给 lib/index.js 放哨兵。
 *
 * 暂存与运行环境的口径（复制哪些文件、假 HOME、清空环境开关、PATH 前置）全部收在
 * `tests/helpers/staged-build.mjs`（issue #208 卫生第 5 条：三个 build 门禁文件原先各抄一份，
 * `PATH` / 环境开关漏一条就会让同一份代码在两台机器上走不同分支）。这里只保留
 * **本文件独有**的那一步：哨兵内容 = 真实逐文件产物 + 一行标记。
 * @returns {ReturnType<typeof stageBuildableTree>} 夹具句柄。
 */
function stageFailingTree() {
  const tree = stageBuildableTree(repoRoot, 'issue56');
  staged.push(tree);
  // 哨兵：真实逐文件产物 + 一行标记。tsc 若在失败时仍然 emit，这行会消失。
  tree.write('lib/index.js', `// ISSUE56-SENTINEL 逐文件 tsc 产物，失败路径不得改写\n${read('lib/index.js')}`);
  // 人为制造 host 类型错误（tsconfig.json 的 include 会收进来；client tsconfig 不收）
  tree.injectTypeError('src/__issue56_type_error.ts', 'issue #56 端到端夹具');
  return tree;
}

/** 默认路径（未开闸）的一次失败构建：两个测试共用，避免重复跑 tsc。 */
const refused = buildable
  ? (() => {
      const tree = stageFailingTree();
      const sentinel = readBytes(tree.path('lib/index.js'));
      return { tree, sentinel, ...tree.runBuild() };
    })()
  : null;

test('端到端：host 类型错误时 build 非零退出（默认不再静默降级）', { skip: !buildable }, () => {
  assert.ok(refused, '夹具应已就绪');
  assert.equal(refused.signal, null, `构建被信号打断：${refused.signal}`);
  assert.notEqual(
    refused.status,
    0,
    '默认路径必须非零退出；退出 0 说明闸门失效、又静默兜底了',
  );
  assert.match(refused.stderr, /host tsc 失败/, '必须说清是 tsc 失败而不是别的错误');
  assert.match(refused.stderr, /--allow-fallback/, '必须给出显式开闸方式');
});

test('端到端：失败的构建不得改写 lib/（哨兵字节级原样、无新增产物）', { skip: !buildable }, () => {
  assert.ok(refused, '夹具应已就绪');
  assert.equal(
    readBytes(refused.tree.path('lib/index.js')),
    refused.sentinel,
    'lib/index.js 被改写了：失败路径必须让 lib/ 保持原样',
  );
  assert.equal(
    existsSync(refused.tree.path('lib/__issue56_type_error.js')),
    false,
    'tsc 在失败时仍 emit 了：host tsc 必须带 --noEmitOnError',
  );
});

test('结构守卫：失败的构建之后 lib/index.js 仍是逐文件 tsc 产物', { skip: !buildable }, () => {
  assert.ok(refused, '夹具应已就绪');
  const report = inspectHostArtifact(readBytes(refused.tree.path('lib/index.js')));
  assert.equal(
    report.ok,
    true,
    `默认路径的产物形态漂移了（应保持逐文件 tsc）：\n- ${report.problems.join('\n- ')}`,
  );
  assert.equal(report.shape, 'tsc-per-file');
});

/* ---------------- 4. 端到端：显式开闸才降级，且兜底产物被判红 ---------------- */

/**
 * 对照组：**同一棵暂存树、同一个 helper，不塞类型错误时构建必须成功**。
 *
 * 没有这一条，上面三条「失败」就不能归因于「类型错误」——共享夹具改坏（比如
 * `injectTypeError` 写到 tsconfig 收不到的路径、或者复制漏了 `scripts/*.mjs`）时，
 * 构建会因为别的原因失败，而「非零退出」照样成立，三条断言全绿。
 * 这一条把「红是注入造成的」变成可测命题：同一套机器在干净树上必须绿。
 */
test('对照组：不塞类型错误时，同一份暂存树构建成功（证明失败是注入造成的）', { skip: !buildable }, () => {
  const tree = stageBuildableTree(repoRoot, 'issue56-control');
  staged.push(tree);
  const clean = tree.runBuild();
  assert.equal(clean.signal, null, `构建被信号打断：${clean.signal}`);
  assert.equal(clean.status, 0, `干净树必须构建成功，否则「注入后失败」不是类型错误的功劳：\n${clean.stderr.slice(-1200)}`);
  assert.ok(
    existsSync(tree.path('lib/index.js')),
    '干净构建必须真的写出 lib/index.js（否则失败路径的「未改写」断言会平凡成立）',
  );
  assert.equal(
    existsSync(tree.path('lib/__issue56_type_error.js')),
    false,
    '对照组里没有注入文件，不该有这个产物',
  );
});

test('端到端：--allow-fallback 才降级，兜底产物被同一判据判红', { skip: !buildable }, () => {
  const tree = stageFailingTree();
  const sentinel = readBytes(tree.path('lib/index.js'));
  const gated = tree.runBuild(['--allow-fallback']);
  const text = readBytes(tree.path('lib/index.js'));

  assert.equal(gated.signal, null, `构建被信号打断：${gated.signal}`);
  assert.equal(gated.status, 0, `显式开闸后应成功退出，stderr=${gated.stderr}`);
  assert.notEqual(text, sentinel, '开闸后应真的用兜底产物覆写 lib/index.js');

  const report = inspectHostArtifact(text);
  assert.equal(report.ok, false, '兜底产物必须被检出：否则「开过闸」这件事就不可见了');
  assert.equal(report.shape, 'bundled');

  const output = `${gated.stdout}\n${gated.stderr}`;
  assert.match(
    output,
    /产物形态与逐文件 tsc 不同，测试结果不可用于判定回归/,
    '兜底时必须打出醒目告警',
  );
  assert.match(output, /esbuild 兜底/, '收尾回报不得再冒充 tsc 产物');
});

test('端到端：DSH_LATER_BUILD_FALLBACK=1 与 --allow-fallback 等价地开闸', { skip: !buildable }, () => {
  const tree = stageFailingTree();
  const sentinel = readBytes(tree.path('lib/index.js'));
  const gated = tree.runBuild([], { DSH_LATER_BUILD_FALLBACK: '1' });
  const text = readBytes(tree.path('lib/index.js'));

  assert.equal(gated.signal, null, `构建被信号打断：${gated.signal}`);
  assert.equal(gated.status, 0, `环境变量开闸后应成功退出，stderr=${gated.stderr}`);
  assert.notEqual(text, sentinel, '环境变量开闸后也应真的用兜底产物覆写 lib/index.js');
  assert.equal(inspectHostArtifact(text).shape, 'bundled');
});
