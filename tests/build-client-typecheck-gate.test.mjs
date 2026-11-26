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
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canBuild, disposeAll, stageBuildableTree } from './helpers/staged-build.mjs';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const buildable = canBuild(root);

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
  disposeAll(staged);
});

/**
 * 暂存一份可构建的最小工作树，塞一个 **client 侧**类型错误（host 的 tsconfig 不收 `src/client`），
 * 并给 `lib/client.js` 放哨兵。
 *
 * 暂存与环境口径收在 `tests/helpers/staged-build.mjs`（issue #208 卫生第 5 条）。本文件
 * 只保留自己的那一步：哨兵要放在 **client** 产物上，因为这一面测的是「client 检查失败时
 * 还没有写出 lib/client.js」（失败发生在 esbuild 打包之前）。
 * @returns {ReturnType<typeof stageBuildableTree>} 夹具句柄。
 */
function stageClientFailingTree() {
  const tree = stageBuildableTree(root, 'client-gate');
  staged.push(tree);
  tree.write('lib/client.js', '// CLIENT-SENTINEL 失败路径不得改写这行\n');
  tree.injectTypeError('src/client/__clientGateProbe.ts', '端到端夹具');
  return tree;
}

const clientFailing = buildable ? (() => {
  const tree = stageClientFailingTree();
  return { tree, sentinel: tree.read('lib/client.js'), ...tree.runBuild() };
})() : null;

test('端到端：client 类型错误让 build 非零退出', { skip: !buildable }, () => {
  assert.ok(clientFailing, '夹具应已就绪');
  assert.equal(clientFailing.signal, null, `构建被信号打断：${clientFailing.signal}`);
  assert.notEqual(clientFailing.status, 0, '退出 0 说明闸门失效，又回到「warn 后继续」');
  assert.match(clientFailing.stderr, /client tsc 失败/);
  assert.match(clientFailing.stderr, /1 条错误/);
  assert.doesNotMatch(clientFailing.stderr, /构建完成|✅/, '失败路径不能再打成功勾');
});

test('端到端：失败的构建没写出 lib/client.js（哨兵字节原样）', { skip: !buildable }, () => {
  assert.ok(clientFailing, '夹具应已就绪');
  assert.equal(
    clientFailing.tree.read('lib/client.js'),
    clientFailing.sentinel,
    'lib/client.js 被改写：client 检查必须排在 esbuild 打包之前',
  );
});

test('端到端：诊断本体要能看见（runTypecheck 抓的是管道，不打出来等于吞了）', { skip: !buildable }, () => {
  assert.ok(clientFailing, '夹具应已就绪');
  assert.match(clientFailing.stdout, /__clientGateProbe\.ts\(\d+,\d+\): error TS\d+/);
});
