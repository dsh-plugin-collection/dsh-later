/**
 * client 类型检查不过必须让 `npm run build` 失败（原先是 warn 后继续）。
 *
 * ## 这个文件在防什么
 *
 * build.mjs 的 client 段原先是：
 *
 * ```js
 * try { execSync('npx tsc -p tsconfig.client.json --noEmit', { stdio: 'inherit' }); }
 * catch { console.warn('⚠️ client tsc 遇到依赖类型差异，继续用 esbuild 构建…'); }
 * ```
 *
 * 于是类型错误只换来一行 ⚠️，接着照常产出 lib/client.js，末尾还打 ✅，而
 * `package.json` 的 `prepublishOnly` = `npm run build`：**带着 client 类型错误也能发布**。
 * 更糟的是当时 CI 根本不跑 build（只 typecheck + test），这条路径在 CI 上从不被走一遍。
 * 宿主侧同类问题由 issue #56 收口，本轮把 client 侧补齐。
 *
 * ## 三层断言
 *  1. **接线**：client 检查复用 `scripts/typecheck-all.mjs` 的 runTypecheck（「什么算红」只有一处
 *     定义，#96 的教训），且失败路径非零退出；不自带第二套 `npx tsc` 调用。
 *  2. **语义保留**：这里**仍然不套** #56 的兜底闸门。原注释的理由是对的，也继续成立：
 *     client 产物无论类型检查过不过都是同一个 esbuild bundle，不存在「逐文件 tsc → 单文件
 *     bundle」的形态漂移。所以本文件断言的是「没有兜底形态」，不是「有兜底但默认关」。
 *  3. **端到端**：在临时工作树里塞一个 client 类型错误跑构建，必须非零退出，且
 *     `lib/client.js` 的哨兵字节原样（证明失败发生在写产物之前，不是写完再报错）。
 *
 * 端到端在临时目录复制工作树跑（不污染本仓库 src/lib；node --test 默认并行跑文件）。
 * @module tests/build-client-typecheck-gate
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const canBuild =
  existsSync(join(root, 'node_modules/esbuild')) && existsSync(join(root, 'node_modules/typescript'));

/* ---------------- 1. 接线 ---------------- */

test('build.mjs 的 client 检查复用 typecheck-all 的 runTypecheck，不再自带 npx tsc', () => {
  const src = read('build.mjs');
  assert.match(src, /import \{ runTypecheck \} from '\.\/scripts\/typecheck-all\.mjs'/);
  assert.match(src, /runTypecheck\(\{ projects: \['tsconfig\.client\.json'\] \}\)/);
  assert.doesNotMatch(
    src,
    /tsc -p tsconfig\.client\.json/,
    '不得再写第二套 client tsc 调用：两处实现迟早对「什么算红」产生分歧（issue #96 同因）',
  );
});

test('失败即退出：旧的「warn 后继续」文案与 try/catch 吞异常都不许回来', () => {
  const src = read('build.mjs');
  assert.doesNotMatch(src, /继续用 esbuild 构建/, '这行 warn 就是本轮的病灶本身');
  assert.doesNotMatch(src, /client tsc 遇到依赖类型差异/);
  const clientGate = src.indexOf("runTypecheck({ projects: ['tsconfig.client.json'] })");
  assert.ok(clientGate > 0, 'client 检查段必须存在');
  const clientExit = src.indexOf('process.exit(1)', clientGate);
  assert.ok(clientExit > clientGate, 'client 检查失败路径必须非零退出');
  assert.ok(!/try\s*\{[^}]*runTypecheck/.test(src), '不得把 runTypecheck 包进吞异常的 try/catch');
});

test('顺序：client 检查在写 lib/client.js 之前（失败时不留半成品）', () => {
  const src = read('build.mjs');
  const gate = src.indexOf("runTypecheck({ projects: ['tsconfig.client.json'] })");
  const bundle = src.indexOf("entryPoints: ['src/client/index.tsx']");
  const write = src.indexOf("writeFileSync('lib/client.js'");
  assert.ok(gate > 0 && bundle > gate && write > bundle, '顺序必须是：检查 → 打包 → 写盘');
});

test('判据覆盖：找不到 tsc 与 tsconfig 缺席都判红，不能静默跳过', () => {
  const src = read('build.mjs');
  assert.match(src, /clientCheck\.tsc === undefined/, '没有 tsc 是环境问题，用退出码 2 与类型回归区分开');
  assert.match(src, /clientCheck\.missing\.length > 0/, 'tsconfig.client.json 不在就等于门禁空转，必须判红');
  assert.match(src, /clientCheck\.ok/, '结论取自 runTypecheck 的汇总，不自己重算');
});

/* ---------------- 2. 语义保留：不引入 client 兜底形态 ---------------- */

test('#56 的兜底闸门只管 host，client 侧不得出现第二种产物形态', () => {
  const src = read('build.mjs');
  const clientGate = src.indexOf("runTypecheck({ projects: ['tsconfig.client.json'] })");
  const clientBlock = src.slice(clientGate, src.indexOf("entryPoints: ['src/client/index.tsx']"));
  assert.doesNotMatch(clientBlock, /shouldAllowFallback|FALLBACK_ALLOWED_NOTICE|hostFallbackUsed/,
    'client 段不参与兜底策略：它的理由是不漂移，不是可以降级');
  assert.match(src, /不存在「逐文件 tsc → 单文件 bundle」的形态漂移/,
    '原注释的理由要留在原地，否则下一个人会「顺手」给 client 也加一层兜底');
  // lib/client.js 只能被那一处 esbuild 写出
  const writes = src.split("writeFileSync('lib/client.js'").length - 1;
  assert.equal(writes, 1, '出现第二处写 lib/client.js 就等于引入了形态切换');
});

/* ---------------- 3. 端到端 ---------------- */

const staged = [];
after(() => {
  for (const dir of staged) rmSync(dir, { recursive: true, force: true });
});

/**
 * 复制一份可构建的最小工作树，塞一个 **client 侧**类型错误（host 项目不收这个路径），
 * 并给 lib/client.js 放哨兵。
 * @returns {string} 临时工作树路径。
 */
function stageClientFailingTree() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-later-client-gate-'));
  staged.push(dir);
  for (const rel of ['build.mjs', 'tsconfig.json', 'tsconfig.client.json', 'package.json']) {
    cpSync(join(root, rel), join(dir, rel));
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const name of readdirSync(join(root, 'scripts'))) {
    if (name.endsWith('.mjs')) cpSync(join(root, 'scripts', name), join(dir, 'scripts', name));
  }
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');

  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib/client.js'), '// CLIENT-SENTINEL 失败路径不得改写这行\n');
  writeFileSync(
    join(dir, 'src/client/__clientGateProbe.ts'),
    '// 端到端夹具：故意让 client tsc 失败（host 的 tsconfig 不收 src/client）\n' +
      'export const clientGateNotANumber: number = "not a number";\n',
  );
  return dir;
}

/** 在隔离的临时树里跑一次 build.mjs（假 HOME + 清空环境开关，绝不碰真实 profile）。 */
function runBuild(dir) {
  const home = join(dir, 'fake-home');
  mkdirSync(home, { recursive: true });
  const result = spawnSync(process.execPath, ['build.mjs'], {
    cwd: dir,
    env: {
      ...process.env,
      HOME: home,
      DSH_LATER_RELINK: '',
      DSH_LATER_BUILD_FALLBACK: '',
      PATH: `${join(root, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const clientFailing = canBuild ? (() => {
  const dir = stageClientFailingTree();
  return { dir, sentinel: readFileSync(join(dir, 'lib/client.js'), 'utf8'), ...runBuild(dir) };
})() : null;

test('端到端：client 类型错误让 build 非零退出', { skip: !canBuild }, () => {
  assert.ok(clientFailing, '夹具应已就绪');
  assert.equal(clientFailing.signal, null, `构建被信号打断：${clientFailing.signal}`);
  assert.notEqual(clientFailing.status, 0, '退出 0 说明闸门失效，又回到「warn 后继续」');
  assert.match(clientFailing.stderr, /client tsc 失败/);
  assert.match(clientFailing.stderr, /1 条错误/);
  assert.doesNotMatch(clientFailing.stderr, /构建完成|✅/, '失败路径不能再打成功勾');
});

test('端到端：失败的构建没写出 lib/client.js（哨兵字节原样）', { skip: !canBuild }, () => {
  assert.ok(clientFailing, '夹具应已就绪');
  assert.equal(
    readFileSync(join(clientFailing.dir, 'lib/client.js'), 'utf8'),
    clientFailing.sentinel,
    'lib/client.js 被改写：client 检查必须排在 esbuild 打包之前',
  );
});

test('端到端：诊断本体要能看见（runTypecheck 抓的是管道，不打出来等于吞了）', { skip: !canBuild }, () => {
  assert.ok(clientFailing, '夹具应已就绪');
  assert.match(clientFailing.stdout, /__clientGateProbe\.ts\(\d+,\d+\): error TS\d+/);
});
