/**
 * issue #56 的判据层：`lib/index.js` 必须是**逐文件 tsc 产物**，兜底产物必须判红。
 *
 * 为什么单独一层：tsc 路径与 esbuild 兜底路径写出的文件同名（都是 lib/index.js），
 * 光看「构建成功」分不出来。形态差异是：逐文件产物 index.js 用 `from './x.js'`
 * 引用兄弟模块（≈24.6KB）；兜底产物把兄弟模块内联成单文件（≈128KB，还带
 * esbuild 的 `// src/xxx.ts` 分节注释），模块身份/状态单例被复制。
 *
 * 这里三层：
 *  1. 纯函数判据（快）：仓库里那份产物是逐文件形态；
 *  2. 反例（防止判据永远通过）：真打一份 esbuild bundle，判据必须判红；
 *  3. 端到端（真代价）：在 src/ 塞类型错误跑构建——
 *     · 默认：非零退出 + lib/ 字节级未被改写 + 仍是逐文件产物；
 *     · 显式 --allow-fallback：才降级，且产物被同一条判据判红（证明兜底真的会漂移）。
 *
 * 端到端在临时目录里复制一份工作树跑（不污染本仓库的 src/lib，可与其它测试文件
 * 并行；node --test 默认并行跑文件）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  inspectHostArtifact,
  assertPerFileArtifact,
  HOST_INDEX_BYTE_CAP,
} from '../scripts/build-artifact-shape.mjs';

const repoRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');
const readBytes = (path) => readFileSync(path, 'utf8');

const canBuild =
  existsSync(join(repoRoot, 'node_modules/esbuild')) &&
  existsSync(join(repoRoot, 'node_modules/typescript'));

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
  { skip: !canBuild },
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
  for (const dir of staged) rmSync(dir, { recursive: true, force: true });
});

/**
 * 复制一份可构建的最小工作树到临时目录，塞一个 host 类型错误，并给 lib/index.js
 * 放一个带 SENTINEL 的哨兵（内容 = 真实逐文件产物 + 一行标记）。
 *
 * 为什么复制：直接在仓库 src/ 里塞错误会与并行跑的其它测试文件抢同一份源码；
 * 临时副本还能用「哨兵字节是否原样」直接判「lib/ 未被改写」。
 */
function stageFailingTree() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-later-issue56-'));
  staged.push(dir);

  for (const rel of ['build.mjs', 'tsconfig.json', 'tsconfig.client.json', 'package.json']) {
    cpSync(join(repoRoot, rel), join(dir, rel));
  }
  cpSync(join(repoRoot, 'src'), join(dir, 'src'), { recursive: true });
  // build.mjs 只 import scripts/*.mjs 里的策略模块；不复制 capture/seam-check 等目录
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const name of readdirSync(join(repoRoot, 'scripts'))) {
    if (name.endsWith('.mjs')) cpSync(join(repoRoot, 'scripts', name), join(dir, 'scripts', name));
  }
  symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');

  // 哨兵：真实逐文件产物 + 一行标记。tsc 若在失败时仍然 emit，这行会消失。
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(
    join(dir, 'lib/index.js'),
    `// ISSUE56-SENTINEL 逐文件 tsc 产物，失败路径不得改写\n${read('lib/index.js')}`,
  );

  // 人为制造 host 类型错误（tsconfig.json 的 include 会收进来；client tsconfig 不收）
  writeFileSync(
    join(dir, 'src/__issue56_type_error.ts'),
    '// issue #56 端到端夹具：故意让 host tsc 失败\nexport const issue56NotANumber: number = "not a number";\n',
  );
  return dir;
}

/** 在隔离的临时树里跑一次 build.mjs（假 HOME，环境开关清空，避免真实 profile/环境干扰）。 */
function runBuild(dir, argv = [], extraEnv = {}) {
  const home = join(dir, 'fake-home');
  mkdirSync(home, { recursive: true });
  const result = spawnSync(process.execPath, ['build.mjs', ...argv], {
    cwd: dir,
    env: {
      ...process.env,
      HOME: home,
      XDG_CACHE_HOME: join(home, '.cache'),
      DSH_LATER_RELINK: '',
      DSH_LATER_BUILD_FALLBACK: '',
      // 让 build.mjs 里的 `npx tsc` 直接命中已安装的 tsc，不依赖网络
      PATH: `${join(repoRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal,
  };
}

/** 默认路径（未开闸）的一次失败构建：两个测试共用，避免重复跑 tsc。 */
const refused = canBuild
  ? (() => {
      const dir = stageFailingTree();
      const sentinel = readBytes(join(dir, 'lib/index.js'));
      return { dir, sentinel, ...runBuild(dir) };
    })()
  : null;

test('端到端：host 类型错误时 build 非零退出（默认不再静默降级）', { skip: !canBuild }, () => {
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

test('端到端：失败的构建不得改写 lib/（哨兵字节级原样、无新增产物）', { skip: !canBuild }, () => {
  assert.ok(refused, '夹具应已就绪');
  assert.equal(
    readBytes(join(refused.dir, 'lib/index.js')),
    refused.sentinel,
    'lib/index.js 被改写了：失败路径必须让 lib/ 保持原样',
  );
  assert.equal(
    existsSync(join(refused.dir, 'lib/__issue56_type_error.js')),
    false,
    'tsc 在失败时仍 emit 了：host tsc 必须带 --noEmitOnError',
  );
});

test('结构守卫：失败的构建之后 lib/index.js 仍是逐文件 tsc 产物', { skip: !canBuild }, () => {
  assert.ok(refused, '夹具应已就绪');
  const report = inspectHostArtifact(readBytes(join(refused.dir, 'lib/index.js')));
  assert.equal(
    report.ok,
    true,
    `默认路径的产物形态漂移了（应保持逐文件 tsc）：\n- ${report.problems.join('\n- ')}`,
  );
  assert.equal(report.shape, 'tsc-per-file');
});

/* ---------------- 4. 端到端：显式开闸才降级，且兜底产物被判红 ---------------- */

test('端到端：--allow-fallback 才降级，兜底产物被同一判据判红', { skip: !canBuild }, () => {
  const dir = stageFailingTree();
  const sentinel = readBytes(join(dir, 'lib/index.js'));
  const gated = runBuild(dir, ['--allow-fallback']);
  const text = readBytes(join(dir, 'lib/index.js'));

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

test('端到端：DSH_LATER_BUILD_FALLBACK=1 与 --allow-fallback 等价地开闸', { skip: !canBuild }, () => {
  const dir = stageFailingTree();
  const sentinel = readBytes(join(dir, 'lib/index.js'));
  const gated = runBuild(dir, [], { DSH_LATER_BUILD_FALLBACK: '1' });
  const text = readBytes(join(dir, 'lib/index.js'));

  assert.equal(gated.signal, null, `构建被信号打断：${gated.signal}`);
  assert.equal(gated.status, 0, `环境变量开闸后应成功退出，stderr=${gated.stderr}`);
  assert.notEqual(text, sentinel, '环境变量开闸后也应真的用兜底产物覆写 lib/index.js');
  assert.equal(inspectHostArtifact(text).shape, 'bundled');
});
