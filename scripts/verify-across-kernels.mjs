#!/usr/bin/env node
/**
 * 跨内核代次回归 · 在真内核上跑真入口（issue #75 / #76 的复发防线）。
 *
 * ## 为什么需要它
 *
 * 单测与 `typecheck` 都只在**本仓 devDependencies 那一版内核**上成立；而 #75 的故障
 * （0.1.7-rc.1 上提醒 100% 不投递）与 #76 的故障（`HH:mm` 被上游文法拒）都只在
 * **特定代次**上显形，跨代差异不会出现在本地 `npm test` 里。仓库已有的 `sync-peer-matrix`
 * 只同步 peer 范围，也不执行任何行为。
 *
 * 本脚本对每一个代次：拉起那一代**真内核**（不是 mock），经**注册命令的真实派发路径**
 * 执行判据，然后打印表格 + 落 JSON，退出码 0/1/2 可直接当门禁。
 *
 * ## 用法
 *
 *     npm run build
 *     node scripts/verify-across-kernels.mjs                       # 默认 mount,function
 *     node scripts/verify-across-kernels.mjs --steps mount,function,type,gate
 *     node scripts/verify-across-kernels.mjs --versions 0.1.7-rc.1,0.2.1-rc.2
 *     node scripts/verify-across-kernels.mjs --kernel-root ~/dsh-versions --hold 12
 *     node scripts/verify-across-kernels.mjs --no-install      # 只用已铺好的树，缺的报「未判定」
 *
 * 退出码：0 全绿；1 有红（真回归失败）；2 有未判定（代次装不出来 / 组合漂移，需要人看一眼）。
 *
 * ### 四个面（issue #97 补齐后两个）
 *
 * | step | 面 | 判据 |
 * |---|---|---|
 * | `mount` | 装配 | 真内核冷启动、插件 `activated`、AgentRegistry 可用 |
 * | `function` | 功能 | `at` 五种文法经真实命令派发 + 到点投递的事件形状 |
 * | `type` | 类型 | 把仓库 `@deepseek-ai/dsh*` 依赖线换成该代次后跑**两个** tsconfig（不短路） |
 * | `gate` | 门禁 | 用**该代次自己的** `evaluatePluginCompatibility` 判一遍，再用最新语义判一遍 |
 *
 * 后两个是 #97 补的：本轮实测的三条真红（0.1.5 跨代 tsc 19 条、0.1.2 的 `attachments`/`FileBlock`、
 * ≤0.1.5 的 app-boot 不导出 `evaluatePluginCompatibility`）**全部落在当时没覆盖的面上**，
 * 只能靠工作区外部工具手工补测 —— 那正是"结论寄存在某台机器上"，本脚本注释里写要避免的事。
 *
 * ## 口径：代次必须按 rc 粒度判，且"装出来的"未必是"请求的"（issue #97 #1）
 *
 * `@deepseek-ai/dsh@0.1.5-rc.1` 的依赖写的是 `dsh-app-boot: ^0.1.5-rc.1`，装出来实际是
 * `dsh-app-boot 0.1.5-rc.3` —— 于是"0.1.5-rc.1 已通过"这句话悄悄变成了"rc.1 启动器 + rc.3 组件"。
 * 而 #75 的教训恰恰是**代次按 rc 判**（0.1.7-rc.1 与 rc.2 的破坏性变更不在同一代落地）。
 * 所以这里：**装的时候 pin exact**（启动器 + 关键包逐包 pin），**报的时候记 requested/resolved 两列**，
 * 只要关键包解析到的版本与请求的不一致，结论直接降级为「未判定（组合漂移）」——不许假绿。
 *
 * ## 装配口径三条（住在 `scripts/kernel-assembly.mjs`，全部可在假树上断言）
 *
 * 这三条以前是"注释里的打算"，不是代码。后果是脚本把自己的装配毛病报成了内核事实：
 * `src/upstream-compat.ts` 的 0.1.5 条目一度写着「0.1.5-rc.1 装不起来」，而实测同一棵树
 * 补齐 peer 之后 mount 是 GREEN（`投递 spliced=1 / dispatch=Y / at 5/5`）。
 *
 * 1. **内核包按实际落点找，不写死顶层**（`resolveBootEntry` / `findScopedDir` / `indexScopedDirs`）。
 *    纯 `npm i @deepseek-ai/dsh@<v>` 会把整条线嵌到 `dsh/node_modules/` 下：写死顶层时
 *    启动器报 `Cannot find module`（假红），而 `dsh-base/cordis.patch.yml` 找不到则是
 *    **静少一层补丁**照样报绿（假绿）—— 同一个假设，两种相反的坏结果。找不到就未判定，
 *    并把找过的位置全部列出来。
 * 2. **peer 回填覆盖树里全部 `@deepseek-ai/*`，迭代到收敛**（`ensureTreePeers`）。
 *    `--legacy-peer-deps` 那一路不装 peer（保留它，否则 caret 会把整条线漂到更晚 rc，
 *    "请求代次=装出代次"这条判据作废），而上游把内核兄弟普遍声明成 peer。
 *    `optional: true` 的 peer 跳过（实测 0.1.5 树里 26 条）。
 * 3. **同源守卫**（`auditPluginSources`）：插件解析到的每个内核包必须落在这棵树里、
 *    且版本等于宿主 `dsh`。下面第 3 条判据纪律讲的是"应该"，这一条才是"检查"：
 *    不成立时这次 mount 证明的不是该代次，直接判红并单独占两行输出。
 *
 * ## 注意（三条判据纪律，都是踩过的坑）
 *
 * 1. **别用"日志里搜得到文本"当投递判据**：创建事件与命令回执里含同样的正文，
 *    会同时造成假绿和假红。真投递 = 一条 `agent/inbox/spliced` 且其 `inserted[].content`
 *    带 nonce，随后一条 `schedule/change operation:dispatch`。
 * 2. 会话日志是**多帧 zstd 拼接**（每次 flush 追加一帧），`zstdDecompressSync` 只解第一帧；
 *    这里按帧 magic 切分逐帧解。
 * 3. 内核模块必须解析到**被测那一代**：插件目录直接挂载会让它用自己 `node_modules` 里
 *    那份宿主包（版本矩阵当场失真）。所以是把插件实体副本放进 `<临时HOME>/profiles/…/node_modules`，
 *    再把该代版本树软链铺成同一层的 `node_modules`。⚠️ 这条过去只是**做法**，没有**判据**：
 *    铺错时脚本照样报绿，插件自己那句"内核模块出现双实例"的告警也会在这份汇总里被折掉。
 *    现在由上面装配口径第 3 条把它变成会判红的检查。
 *
 * ## 隔离与它的边界（别把自检当通用防线）
 *
 * 目录级隔离：临时 `DSH_HOME` + 版本树软链 + 插件实体副本。**没有** unshare / 容器，而
 * `function` 面会真的执行插件业务代码。对只写 `DSH_HOME` 内 `sessions/`、`storages/`、
 * `plugin-state/` 的插件（dsh-later 已实测确认）结论可信；换到有外发副作用的插件，先加遮蔽。
 * 越界自检覆盖这三类目录与 `~/.dsh` 根级文件（issue #97 #3：此前只扫 `sessions/`，
 * 于是 `~/.dsh/plugin-state/later/` 里的残留被漏掉，还对外说过"已清理"）。
 *
 * 与 devkit 的关系：devkit 是本机工作区里的工具集，CI 与别人的 checkout 都没有它；
 * 本脚本自包含（只依赖本仓 + 被测内核树 + pnpm/git），所以它是这份回归**长期该待的地方**。
 * @module scripts/verify-across-kernels
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { KERNEL_GENERATIONS, KERNEL_SCOPED_PACKAGES } from '../lib/upstream-compat.js';
import { runTypecheck } from './typecheck-all.mjs';
import {
  APP_BOOT_PACKAGE, auditPluginSources, findScopedDir, indexScopedDirs, planPeerBackfill,
  resolveBootEntry, scanScopedPackages,
} from './kernel-assembly.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const NAME = PKG.name;
const KERNEL_ROOT = resolve(opt('kernel-root', join(homedir(), 'dsh-versions')));
const HOLD = Number(opt('hold', 12));
const OUT_DIR = resolve(opt('out', join(ROOT, '.verify')));
const given = (opt('versions', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
const VERSIONS = given.length ? given : KERNEL_GENERATIONS.map((g) => g.id ?? g);
/** 本脚本只认这四个面；写错一个字母就当场报错，别静默当成默认值跑。 */
const KNOWN_STEPS = ['mount', 'function', 'type', 'gate'];

const STEPS = parseSteps(opt('steps', 'mount,function'));

/**
 * 参与"代次一致性"的关键包：启动器 + 插件真正依赖的内核包。
 *
 * 不把 cordis / schemastery / cosmokit 算进来：它们跟的不是同一个版本线（实测把
 * `@deepseek-ai/schemastery` 一起改成内核版本会 `ERR_PNPM_NO_MATCHING_VERSION`）。
 */
export const KEY_PACKAGES = [
  'dsh',
  'dsh-app-boot',
  'dsh-base',
  'dsh-schedule',
  'dsh-session',
  'dsh-agent',
  'dsh-commands',
  'dsh-llm',
  'dsh-settings',
  'dsh-tools',
  'dsh-session-projection',
];

/**
 * 解析 `--steps`。
 * @param {string} text - 逗号分隔，如 `mount,function,type`。
 * @returns {string[]} 去重后的步骤名。
 * @throws {Error} 含未知步骤时抛错（拼错的 `--steps typ` 会比"没跑"更糟：它看起来像跑过了）。
 */
export function parseSteps(text) {
  const steps = String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = steps.filter((s) => !KNOWN_STEPS.includes(s));
  if (unknown.length) throw new Error(`未知 steps：${unknown.join(', ')}（只认 ${KNOWN_STEPS.join(' / ')}）`);
  return [...new Set(steps)];
}

/**
 * 读出一棵树里关键包**实际**解析到的版本。
 * @param {string} treeRoot - 含 `node_modules/@deepseek-ai/*` 的目录。
 * @param {readonly string[]} [packages] - 关键包名（不带 scope）。
 * @returns {Record<string, string | null>} 包名 → 版本；没装为 null。
 */
export function resolvedVersions(treeRoot, packages = KEY_PACKAGES) {
  // 按实际落点读，不假设内核包在顶层：纯装启动器时整条线嵌在 `dsh/node_modules/` 下，
  // 只读顶层会把每个包都读成 null，而 null 的口径是"该代次没有这个包"—— 组合漂移于是
  // 对整棵树失明（混装树看起来反而最干净）。见 kernel-assembly.mjs 的 indexScopedDirs。
  const index = indexScopedDirs(treeRoot);
  const out = {};
  for (const name of packages) {
    const dir = index.get(name);
    const man = dir === undefined ? null : join(dir, 'package.json');
    out[name] = man !== null && existsSync(man) ? JSON.parse(readFileSync(man, 'utf8')).version : null;
  }
  return out;
}

/**
 * 组合漂移报告：请求的代次 vs 每个关键包实际解析到的版本。
 *
 * `null`（没装）不算漂移 —— 那是"该代次没有这个包"，由装配失败或缺失清单负责报，
 * 混进来会让"少了包"和"版本错了"两种问题长得一样。
 * @param {string} treeRoot - 内核树。
 * @param {string} requested - 请求的代次，如 `0.1.5-rc.1`。
 * @param {readonly string[]} [packages]
 * @returns {{ packages: Record<string, { requested: string, resolved: string | null }>, drifted: string[] }}
 */
export function driftReport(treeRoot, requested, packages = KEY_PACKAGES) {
  const resolved = resolvedVersions(treeRoot, packages);
  const out = {};
  const drifted = [];
  for (const [name, actual] of Object.entries(resolved)) {
    out[name] = { requested, resolved: actual };
    if (actual !== null && actual !== requested) drifted.push(`${name} ${requested}→${actual}`);
  }
  return { packages: out, drifted };
}

/**
 * 在 `~/.dsh` 下找本次测试的越界残留。
 *
 * 扫 `sessions/`、`storages/`、`plugin-state/` **与根级文件**——只扫 sessions 会漏掉
 * `plugin-state/later/xk-*.json` 这类（#97 #3 就是按残留现场发现的）。
 * @param {string} dshRoot - 真实 DSH_HOME，如 `~/.dsh`。
 * @param {string} [prefix] - 本次测试的 id 前缀，默认 `xk-`（与 `sessionId` 一致）。
 * @returns {string[]} 命中路径（文件或目录）。
 */
export function scanLeaks(dshRoot, prefix = 'xk-') {
  const found = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.name.startsWith(prefix)) { found.push(p); continue; }
      if (e.isDirectory() && e.name !== 'node_modules') walk(p);
    }
  };
  for (const sub of ['sessions', 'storages', 'plugin-state']) walk(join(dshRoot, sub));
  try {
    for (const e of readdirSync(dshRoot, { withFileTypes: true })) {
      if (e.isFile() && e.name.startsWith(prefix)) found.push(join(dshRoot, e.name));
    }
  } catch { /* 根目录不存在就是没泄漏 */ }
  return found;
}

/**
 * 该包在该代次有没有发布（决定"pin 清单"与 peer 回填里要不要带它）。
 *
 * 加了**进程内记忆**：peer 回填现在是逐包迭代（实测 0.1.5-rc.1 第 1 轮就缺 19 个），
 * 不记忆的话每轮都要为同一个包发一次 `npm view`，一次回归多花十几分钟在网络往返上。
 * 记忆以 `包名@版本` 为键，一次运行内该事实不会变。
 */
const publishedCache = new Map();
function published(name, version) {
  const key = `${name}@${version}`;
  if (publishedCache.has(key)) return publishedCache.get(key);
  const r = spawnSync('npm', ['view', `@deepseek-ai/${name}@${version}`, 'version', '--json'],
    { encoding: 'utf8', timeout: 60_000 });
  const value = r.status === 0 && String(r.stdout).includes(version);
  publishedCache.set(key, value);
  return value;
}

/**
 * 把树里**已经装上但版本不是请求代次**的 `@deepseek-ai/dsh*` 包也 pin 回去（最多 3 轮）。
 *
 * 为什么光 pin 关键包不够：`dsh-base` 的补丁会加载一批 dsh-* 插件（本机实测 0.1.5 树里
 * `dsh-session-persistence-jsonl` / `dsh-jobs-local` 等被 caret 带到了 **0.1.5-rc.3**），
 * 于是 rc.1 的启动器 + rc.3 的插件混装——这是 #97 #1 那条"请求的代次 ≠ 装出来的代次"发生在
 * 传递依赖上。
 *
 * ⚠️ 但别把 "plugin(s) failed to load" 归因给这种混装本身。实测：混装树在**补齐 peer** 之后能
 * mount 成功（0.1.5-rc.1 GREEN，投递 spliced=1 / dispatch=Y / at 5/5）。当时的 RED 有两个根因
 * 都在本脚本自己身上——① 写死顶层 `dsh-app-boot` 路径，而纯 rc.1 安装会把它嵌到
 * `dsh/node_modules` 下（`Cannot find module …/app-boot/lib/index.js`）；② `--legacy-peer-deps`
 * 跳过 peer，而旧的 `ensureBootPeers` 只补 app-boot 一棵线，`dsh-session-persistence-jsonl` 恰是
 * 靠 **peer** 拿 `dsh-session-persistence`（`Cannot find package`）。
 * 两处现都已修（`resolveBootEntry` 按实际落点找启动器；`ensureTreePeers` 逐轮补齐全树 peer）。
 * 留这条注释的理由是通用的一条：**判"该代不支持"之前，先确认这三条装配口径都过了** ——
 * 装配没过的 RED 是脚本的 RED，不是内核的 RED，拿它下调支持范围就是把工具缺陷固化成产品边界。
 *
 * 只处理 `@deepseek-ai/dsh*`：`cordis` / `cordis-plugin-*` / `schemastery` 各有自己的次版本线，
 * 跟着内核版本改会把树改坏（实测 ERR_PNPM_NO_MATCHING_VERSION 那一类）。
 * @param {string} root - 内核树根。
 * @param {string} version - 目标代次。
 * @returns {{ pinned: number, skipped: string[] }} 补 pin 的包数与被跳过的包（该代次无此版本）。
 */
function pinAllDrifted(root, version) {
  let pinned = 0;
  const skipped = [];
  for (let pass = 0; pass < 3; pass += 1) {
    // 整棵树的实际落点，含嵌套（见 resolvedVersions 的同一处理由）。
    const index = indexScopedDirs(root);
    if (index.size === 0) return { pinned, skipped };
    const specs = [];
    for (const [name, dir] of index) {
      if (!/^dsh(-|$)/.test(name)) continue;
      const man = join(dir, 'package.json');
      if (!existsSync(man)) continue;
      const actual = JSON.parse(readFileSync(man, 'utf8')).version;
      if (actual === version) continue;
      if (published(name, version)) specs.push(`@deepseek-ai/${name}@${version}`);
      else if (!skipped.includes(name)) skipped.push(name);
    }
    if (specs.length === 0) break;
    const r = spawnSync('npm', ['i', '--no-audit', '--no-fund', '--save-exact', '--legacy-peer-deps', ...specs],
      { cwd: root, encoding: 'utf8', timeout: 900_000 });
    if (r.status !== 0) break;
    pinned += specs.length;
  }
  return { pinned, skipped };
}

/**
 * 迭代补齐树里**全部** `@deepseek-ai/*` 声明的 peer（旧版只补 `dsh-app-boot` 一棵线）。
 *
 * 为什么必须扩到全部：`--legacy-peer-deps` 那一路**不装 peer**，而上游把内核兄弟普遍声明成
 * peer 而不是 dependency——实测 `dsh-session-persistence-jsonl` 的
 * `@deepseek-ai/dsh-session-persistence` 就在 `peerDependencies` 里。只补 app-boot 一棵线时，
 * 装配报 `Cannot find package '@deepseek-ai/dsh-session-persistence'`，脚本把它写成
 * 「装配失败 / 该代次装不起来」，于是**脚本自己的装配口径**被当成了内核事实
 * （`src/upstream-compat.ts` 的 0.1.5 条目曾据此把 0.1.5-rc.1 判死，实测补齐 peer 后同一棵树
 * mount 是 GREEN：投递 spliced=1 / dispatch=Y / at 5/5）。
 *
 * 收敛性：一轮装齐当轮全部缺件（一条 `npm i` 写全 —— 分次装会互相清理传递依赖，见
 * `kernelTree()` 里同样的教训），再扫一遍直到没有缺口。实测 0.1.5-rc.1 第 1 轮缺 19 个、
 * 第 2 轮 0 个。上限 6 轮只是火墙：真收敛不了要带着 `stillMissing` 出去，不许悄悄当补齐了。
 *
 * `optional: true` 的 peer 由 `planPeerBackfill()` 跳过（实测 0.1.5 树里有 26 条），
 * 那本来就是"该代次可以不提供"的声明，补它等于替这代多装东西。
 *
 * @param {string} root - 内核树根。
 * @param {string} version - 目标代次。
 * @param {(specs: string[]) => number} [install] - 装依赖；返回退出码（拆出来给测试注入）。
 * @param {{published?: (name: string, version: string) => boolean}} [options] - `published` 默认走 `npm view`。
 * @returns {{installed: string[], rounds: number, stillMissing: string[], blocking: string[]}}
 *   `blocking` = 仍未装上且**由 dsh-app-boot 自己声明**的 peer（缺它一定起不来）。
 */
export function ensureTreePeers(root, version, install = (specs) => spawnSync(
  'npm', ['i', '--no-audit', '--no-fund', '--save-exact', '--legacy-peer-deps', ...specs],
  { cwd: root, encoding: 'utf8', timeout: 900_000 },
).status, options = {}) {
  const isPublished = options.published ?? published;
  const planOf = () => planPeerBackfill(scanScopedPackages(root), { version, published: isPublished });
  const installed = [];
  let rounds = 0;
  let plan = planOf();
  for (let pass = 0; pass < 6; pass += 1) {
    rounds = pass + 1;
    if (plan.specs.length === 0) break;
    // 一轮装齐当轮全部缺口：分次 `npm i` 会让 npm 按"树里 package.json 的依赖"重算传递依赖，
    // 把上一次刚装上的东西当多余删掉（kernelTree() 里同样的教训）。
    installed.push(...plan.missing.map((m) => m.dep));
    const status = install(plan.specs);
    // 装不动就不要再转第二轮：npm 非零通常是范围本身无解，重试只会把时间烧光。
    if (status !== 0) break;
    // 装完重扫一遍：npm 会把新包连同它的传递依赖一起铺进树，缺口通常一次就收敛
    // （实测 0.1.5-rc.1：第 1 轮缺 19 个，第 2 轮 0 个）。
    plan = planOf();
  }
  const stillMissing = plan.missing.map((m) => m.dep);
  // 「挡路」的定义是**启动器自己**声明的 peer 仍缺：那一条缺了 boot() 一定起不来，报未判定；
  // 别的包声明的 peer 缺件交给 mount 自己报（实测有些代次确实带着缺失照样跑通）。
  // 按 dep 判断而不是按 `missing[].from`：同一依赖被多个包声明时 plan 只留第一条 `from`，
  // 按 from 过滤会把「app-boot 也声明了它」的那条漏掉。
  const bootDir = indexScopedDirs(root).get(APP_BOOT_PACKAGE);
  const bootPeerNames = new Set(Object.keys(readManifestPeers(bootDir)));
  const blocking = stillMissing.filter((dep) => bootPeerNames.has(dep));
  return { installed, rounds, stillMissing, blocking };
}

/** 读一个包目录的 peerDependencies；目录缺失/清单坏 ⇒ 空对象（不抛，交给上层判断）。 */
function readManifestPeers(dir) {
  if (dir === undefined || dir === null) return {};
  const man = join(dir, 'package.json');
  if (!existsSync(man)) return {};
  try {
    return JSON.parse(readFileSync(man, 'utf8')).peerDependencies ?? {};
  } catch {
    return {};
  }
}

/**
 * `resolveBootEntry()` 的带记忆包装（一棵树在一次运行里会被问很多次）。
 * @param {string} root
 * @returns {{entry: string|null, searched: string[], nested: boolean}}
 */
const bootEntryCache = new Map();
function bootEntryOf(root) {
  if (!bootEntryCache.has(root)) bootEntryCache.set(root, resolveBootEntry(root));
  return bootEntryCache.get(root);
}

/** 找不到启动器时的可诊断文案：把**找过的每一个位置**原样交出去。 */
function bootMissingNote(root, boot) {
  const wanted = join('@deepseek-ai', APP_BOOT_PACKAGE, 'lib', 'index.js');
  return `树里找不到启动器入口 @deepseek-ai/${APP_BOOT_PACKAGE}（相对路径 ${wanted}）；`
    + `从 ${root} 起找过 ${boot.searched.length} 个位置：${boot.searched.map((p) => p.replace(root, '<root>')).join(' , ') || '（顶层与嵌套 node_modules 都没有该包目录）'}`;
}

/**
 * 取该代次的内核树；没有就现装一次。
 *
 * **pin exact**（#97 #1）：只装 `dsh@<v>` 会让它 package.json 里的 `^<v>` 把兄弟包带到
 * 同 minor 的**更晚 rc**（0.1.5-rc.1 装出 rc.3 的 app-boot/base/schedule），"代次结论"当场失真。
 * 所以启动器装完后，把每个在该代次**有发布**的关键包再 `@<v>` 精确装一遍。
 * @param {string} version - 目标代次。
 * @returns {{ root: string | null, note: string | null, pinned: boolean }}
 */
function kernelTree(version) {
  if (version.startsWith('/')) return { root: version, note: null, pinned: false };
  const root = join(KERNEL_ROOT, version);
  const marker = join(root, '.xk-pinned');
  // 路径不写死顶层：纯 `npm i @deepseek-ai/dsh@<v>` 会把启动器嵌到 `dsh/node_modules/` 下，
  // 按顶层判断会把"树其实完整"误判成"树不完整"（这正是 0.1.5-rc.1 曾被判 RED 的两条根因之一）。
  const boot = () => bootEntryOf(root);
  const hasBoot = () => boot().entry !== null;
  if (existsSync(marker) && hasBoot()) return { root, note: '复用本地（已按代次 pin）', pinned: true };
  if (argv.includes('--no-install')) {
    return hasBoot()
      ? { root, note: '复用本地（该树未 pin，可能组合漂移）', pinned: false }
      : { root: null, note: `${bootMissingNote(root, boot())}，且 --no-install`, pinned: false };
  }
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(root, 'package.json'))) writeFileSync(join(root, 'package.json'), '{"private":true}\n');
  const pins = KEY_PACKAGES.filter((n) => published(n, version));
  const specs = pins.map((n) => `@deepseek-ai/${n}@${version}`);
  // **一条命令装齐**（启动器 + 关键包都 pin 到同一代次）。分两条装过一次，结果 npm 按"树里
  // package.json 的依赖"把前一条带来的传递依赖重算一遍，顺手把 `cordis-plugin-group` 当多余删了，
  // 于是装配报 `Cannot find package` —— 装依赖这种图问题只能一口气交给 npm，别自己分步。
  // `--save-exact` 是必须的：默认 `npm i pkg@0.1.5-rc.1` 会把 `^0.1.5-rc.1` 写进 package.json，
  // 于是**下一次**解析（重试 / 重跑）按 caret 取到同 minor 的更晚 rc —— pin 当场失效。
  const install = (extra = []) => spawnSync('npm', ['i', '--no-audit', '--no-fund', '--save-exact', ...extra, ...specs],
    { cwd: root, encoding: 'utf8', timeout: 900_000 });
  // 安装上限：CI 里一次意外卡死不该拖垮整条回归，未判定比假绿/假红都有用。
  let r = install();
  if (r.status !== 0 && /ERESOLVE|peer dep/i.test(`${r.stdout}${r.stderr}`)) {
    // 上游几代的 peer 范围自相矛盾（0.1.5 的 dsh-schedule 对 dsh-agent 的范围与它自己装的版本不一致）。
    // 我们只是**按版本 pin**，不是在挑特性，所以松 peer 不改变"这一代是什么版本"。
    // 代价是这一路不装 peer —— 缺的 peer 由 ensureTreePeers() 显式逐轮补齐，不再指望 npm。
    r = install(['--legacy-peer-deps']);
  }
  bootEntryCache.delete(root);
  if (!hasBoot()) {
    return { root: null, note: `npm i 后仍没有可执行的启动器：${bootMissingNote(root, boot())}`, pinned: false };
  }
  const peers = ensureTreePeers(root, version);
  if (peers.blocking.length) {
    return { root: null, note: `启动器的 peer 装不齐（${peers.blocking.join(', ')}）`, pinned: false };
  }
  // 传递依赖也会 caret 漂移（0.1.5 的插件被带到 rc.3）—— 装配前把整条 dsh-* 线拉回请求代次。
  const driftPins = pinAllDrifted(root, version);
  // 补 pin 后 peer 可能又缺（包版本变了，声明的 peer 也变），再迭代一轮。
  const peers2 = ensureTreePeers(root, version);
  bootEntryCache.delete(root);
  writeFileSync(marker, `${version}\n${pins.join('\n')}\n`);
  const drift = driftReport(root, version).drifted;
  const peerNote = [
    peers2.installed.length ? `补装 peer ${peers2.installed.length} 个/${peers2.rounds} 轮` : '',
    peers2.stillMissing.length ? `仍有非启动器 peer 缺失 ${peers2.stillMissing.length} 个` : '',
    driftPins.pinned ? `拉回 dsh-* 漂移 ${driftPins.pinned} 个` : '',
  ].filter(Boolean).map((x) => `；${x}`).join('');
  return {
    root,
    note: drift.length
      ? `现场安装（pin 后仍漂移：${drift.join(', ')}${peerNote}）`
      : `现场安装（pin ${pins.length} 个关键包${peerNote}）`,
    pinned: pins.length > 0,
  };
}

/** 按 zstd 帧 magic 切分逐帧解（多帧拼接的日志只解第一帧会漏掉后半）。 */
function unzstdAllFrames(buf) {
  const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
  const cuts = [0];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) cuts.push(i);
  }
  const parts = [];
  for (let k = 0; k < cuts.length; k += 1) {
    const from = cuts[k];
    const to = cuts[k + 1] ?? buf.length;
    if (to <= from) continue;
    try { parts.push(zstdDecompressSync(buf.subarray(from, to)).toString('utf8')); }
    catch (error) { parts.push(`#frame${k} 解码失败 ${String(error.message).slice(0, 60)}`); }
  }
  return parts.join('\n');
}

function readEvents(home) {
  const out = [];
  const stack = [home];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') stack.push(p); continue; }
      if (!/\.(jsonl|log)(\.zstd)?$/.test(e.name)) continue;
      try {
        if (statSync(p).size > 40 * 1024 * 1024) continue;
        const text = /\.zstd$/.test(e.name) ? unzstdAllFrames(readFileSync(p)) : readFileSync(p, 'utf8');
        for (const line of text.split('\n')) {
          if (!line.trim().startsWith('{')) continue;
          try { out.push({ ...JSON.parse(line), raw: line }); } catch { /* 非事件行跳过 */ }
        }
      } catch { /* 读不了就跳过这个文件 */ }
    }
  }
  return out;
}

/** 未来 N 天的本地日期（避免"时刻已过"被上游拒，从而污染 at 判据）。 */
function futureDate(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function atShapes() {
  const date = futureDate(3);
  const tz = 'Asia/Shanghai';
  return [
    { label: '面板原生 HH:mm', at: { date, time: '09:00', time_zone: tz }, mustBuild: true },
    { label: '个位小时带秒', at: { date, time: '9:00:00', time_zone: tz }, mustBuild: true },
    { label: '个位无秒', at: { date, time: '9:00', time_zone: tz }, mustBuild: true },
    { label: '严格基线', at: { date, time: '09:00:00', time_zone: tz }, mustBuild: true },
    // 无偏移字符串必须**被拒且给出可执行提示**：猜宿主时区会把用户意图的时刻改掉，比报错更糟。
    { label: '无偏移字符串应拒+提示', at: `${date} 09:00`, mustBuild: false, mustHint: true },
  ];
}

/** 装配 + 功能两面（mount / function）：与 #93 版本行为一致，只是记录更完整。 */
async function runOne(version) {
  const { root, note } = kernelTree(version);
  if (!root) return { version, verdict: 'UNDETERMINED', notes: [note ?? '无内核树'], at: [], delivery: null };
  // 启动器与 dsh-base 都按**实际落点**找（顶层优先，其次嵌套）。两处都不许静默将就：
  // 启动器找不到 ⇒ 未判定并列出找过的位置；dsh-base 找不到 ⇒ 未判定，因为少加载它那层补丁
  // 之后"mount 成功"证明的是半套树。
  const boot = bootEntryOf(root);
  if (boot.entry === null) {
    return { version, verdict: 'UNDETERMINED', notes: [bootMissingNote(root, boot)], at: [], delivery: null };
  }
  const base = findScopedDir(root, 'dsh-base');
  if (base.dir === null) {
    return {
      version,
      verdict: 'UNDETERMINED',
      notes: [`树里找不到 @deepseek-ai/dsh-base（它带 cordis.patch.yml 那层补丁），找过：${base.searched.map((p) => p.replace(root, '<root>')).join(' , ') || '（无）'}`],
      at: [], delivery: null,
    };
  }
  // 宿主版本按实际落点读（顶层假设的坑见 kernel-assembly.indexScopedDirs）。
  const dshDir = indexScopedDirs(root).get('dsh');
  const dshMan = dshDir === undefined ? null : join(dshDir, 'package.json');
  if (dshMan === null || !existsSync(dshMan)) {
    return {
      version,
      verdict: 'UNDETERMINED',
      notes: ['树里读不到 @deepseek-ai/dsh 的 package.json，无法确定宿主版本，也就无法判定插件解析到的是不是同一份内核'],
      at: [], delivery: null,
    };
  }
  const runtime = JSON.parse(readFileSync(dshMan, 'utf8')).version;
  // `--versions /abs/path` 时"请求的代次"就是那棵树自己的 dsh 版本；否则比较对象会变成一个路径串，
  // 于是每个包都被判成漂移 —— 一条看起来很吓人、其实毫无意义的红。
  const requested = version.startsWith('/') ? runtime : version;
  const drift = driftReport(root, requested);
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-xkernel-')));
  const profile = join(home, 'profiles', 'x');
  const nm = join(profile, 'node_modules');
  const record = { version, runtime, packages: drift.packages, notes: [], at: [], delivery: null };
  try {
    mkdirSync(nm, { recursive: true });
    for (const entry of readdirSync(join(root, 'node_modules'))) {
      if (entry === '.bin' || entry.startsWith('.')) continue;
      const src = join(root, 'node_modules', entry);
      if (entry.startsWith('@')) {
        mkdirSync(join(nm, entry), { recursive: true });
        for (const child of readdirSync(src)) symlinkSync(join(src, child), join(nm, entry, child), 'dir');
        continue;
      }
      symlinkSync(src, join(nm, entry), 'dir');
    }
    const copy = join(nm, NAME);
    mkdirSync(copy, { recursive: true });
    for (const f of ['package.json', 'cordis.patch.yml', 'icon.svg']) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(copy, f));
    for (const d of ['lib', 'locale', 'assets']) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(copy, d), { recursive: true });
    // 隔离的关键一行：不设 DSH_HOME 时内核会按真实 `~/.dsh` 落盘，
    // 于是"测试"变成"往你机器上写垃圾"（这台机器上真发生过：两条 xk-* 会话进了 ~/.dsh/sessions）。
    process.env.DSH_HOME = home;
    process.env.DSH_TELEMETRY_DISABLED = '1';
    // 宿主锚点指到**本次真在跑的那份启动器**。不指的话插件自己的同源护栏会拿 process.argv[1]
    // （= 本脚本，落在开发仓 node_modules 里）当宿主，于是一定报"双实例"、报的还是 rc.2 vs rc.3
    // 这种与本次被测无关的对照 —— 那条告警既不可信也会把真信号（下面的 sameSource）淹掉。
    process.env.DSH_LATER_HOST_ENTRY = boot.entry;
    const rootConfig = join(profile, 'cordis.yml');
    writeFileSync(rootConfig, '[]\n');
    const off = join(home, 'off.patch.yml');
    // hmr 行要求真实启动器给的 appReady；这里只要干净装配，显式关掉，别把无关警告当故障。
    writeFileSync(off, '- id: hmr\n  disabled: true\n');
    // 同源守卫（mount 的前提，不是附加信息）：插件解析到的每个内核包必须**就在这棵树里**且
    // 版本等于宿主 dsh。不成立时这次 mount 证明的不是"该代次可用"，直接判红、不去 boot。
    const sources = auditPluginSources({
      copyDir: copy,
      treeRoot: root,
      runtime,
      packages: KERNEL_SCOPED_PACKAGES,
    });
    record.sameSource = { ok: sources.ok, checked: sources.checked, offenders: sources.offenders };
    if (!sources.ok) {
      record.verdict = 'RED';
      record.notes.push(`同源守卫：插件解析到的内核模块与被测树不一致（${sources.offenders.length}/${sources.checked} 个包不对），本次 mount 不作数`);
      for (const o of sources.offenders.slice(0, 8)) record.notes.push(`  ✗ ${o.name}：${o.reason}`);
      record.notes.unshift(note ? `内核树：${note}` : `内核树：${boot.entry.replace(root, '<root>')}`);
      return record;
    }
    const appBoot = boot.entry;
    const bootModule = await import(pathToFileURL(appBoot).href);
    const layers = [join(base.dir, 'cordis.patch.yml'), join(copy, 'cordis.patch.yml'), off];
    const patches = layers.flatMap((f) => existsSync(f) ? bootModule.loadOverlayPatches('dsh-xkernel', f) : []);
    const ctx = await bootModule.boot('dsh-xkernel', rootConfig, patches, (c) => {
      c.provide('profileContext', { name: 'x', dir: profile, patchPath: join(profile, 'cordis.patch.yml'), installAnchor: root, startedBundles: [], cwd: home, home, overlays: [] });
    });
    if (!ctx.agents) throw new Error('没有 ctx.agents（AgentRegistry 未装配）');
    const sessionId = `xk-${Date.now().toString(36)}`;
    const handle = await ctx.agents.create({ sessionId, meta: { cwd: home } });
    const agent = handle?.agent ?? handle;

    // 判据 1：at 文法形状经真实命令派发
    for (const shape of atShapes()) {
      const nonce = `XK-AT-${Math.random().toString(36).slice(2, 8)}`;
      let kind = '?';
      let text = '';
      try {
        const exec = await ctx.commands.execute(agent, `/user-schedule-create ${JSON.stringify({ prompt: nonce, at: shape.at })}`, [], new AbortController().signal);
        kind = exec?.result?.kind ?? exec?.kind ?? '?';
        text = String(exec?.result?.text ?? '');
      } catch (error) { text = `抛错 ${String(error.message).slice(0, 80)}`; }
      const built = kind === 'success' && !/"ok":false|invalid_rule/.test(text);
      const hinted = /偏移|offset|RFC|Z|时区/.test(text);
      const pass = shape.mustBuild ? built : (!built && (!shape.mustHint || hinted));
      record.at.push({ label: shape.label, built, hinted, pass, echo: text.replace(/\s+/g, ' ').slice(0, 120) });
    }

    // 判据 2：到点投递（事件形状，不看文本命中）
    const nonce = `XK-FIRE-${Date.now().toString(36)}`;
    const exec = await ctx.commands.execute(agent, `/user-schedule-create ${JSON.stringify({ prompt: nonce, after_seconds: 2 })}`, [], new AbortController().signal);
    if (exec?.result?.kind !== 'success') record.notes.push(`投递用例没建起来：${String(exec?.result?.text ?? '').slice(0, 140)}`);
    await new Promise((r) => setTimeout(r, HOLD * 1000));
    const evs = readEvents(home);
    const spliced = evs.filter((e) => e.type === 'agent/inbox/spliced' && e.raw.includes(nonce) && (e.data?.inserted?.length ?? 0) > 0).length;
    const dispatched = evs.some((e) => e.type === 'schedule/change' && e.data?.operation === 'dispatch');
    const admission = evs.find((e) => /producer-owned source kind/.test(e.raw));
    record.delivery = { spliced, dispatched, admissionError: admission ? admission.raw.replace(/\s+/g, ' ').slice(0, 160) : null };
    if (spliced === 0) {
      // 诊断留进产物：投递为 0 时看不到事件直方图，就只能靠猜（这台机器上真猜错过两次）
      const hist = {};
      for (const e of evs) hist[e.type ?? '?'] = (hist[e.type ?? '?'] ?? 0) + 1;
      record.eventHistogram = hist;
      record.notes.push(`未投递：spliced=0 dispatch=${dispatched ? 'Y' : 'N'}${admission ? ' 且有 v4 源校验报错（issue #75 的形状）' : ''}｜事件 ${Object.keys(hist).length} 种 ${JSON.stringify(hist).slice(0, 160)}`);
    }
    else if (!dispatched) record.notes.push('注入了但没有 dispatch 事件，状态账可能对不齐');
    if (admission) record.notes.push(`v4 源校验拒绝：${admission.raw.replace(/\s+/g, ' ').slice(0, 150)}`);
    record.notes.unshift(note ? `内核树：${note}` : '内核树：复用本地');
    try { await ctx.fiber?.dispose?.(); } catch { /* 释放失败不改写结论 */ }
    try { await handle.dispose?.(); } catch { /* 同上 */ }
  } catch (error) {
    record.verdict = 'RED';
    record.notes.push(`装配失败：${String(error?.message ?? error).slice(0, 220)}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  if (drift.drifted.length) {
    record.verdict = 'UNDETERMINED';
    record.notes.push(`组合漂移（结论降级）：${drift.drifted.join(', ')}`);
  }
  const red = record.verdict === 'RED'
    || (record.delivery?.spliced ?? 0) === 0
    || !!record.delivery?.admissionError
    || record.at.some((a) => !a.pass)
    || record.notes.some((n) => n.startsWith('装配失败') || n.startsWith('未投递'));
  if (!record.verdict) record.verdict = red ? 'RED' : 'GREEN';
  return record;
}

/**
 * 类型面（issue #97 #2）：把仓库的 `@deepseek-ai/dsh*` 依赖线整体换成目标代次，跑两个 tsconfig。
 *
 * 为什么要临时 worktree + `pnpm install`：TypeScript 解析的是**插件自己 node_modules 里**那份
 * 宿主类型。只换启动器而不换依赖线，"typecheck 通过"证明的是它兼容当前 devDependency 那一版。
 * 复用 `scripts/typecheck-all.mjs` 的 `runTypecheck`：两个项目都跑完再汇总（`&&` 短路是 #96 的洞）。
 * @param {string} version
 */
function typeFace(version) {
  const swap = mkdtempSync(join(tmpdir(), `xk-type-${version}-`));
  const cleanup = () => {
    spawnSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', swap], { encoding: 'utf8', timeout: 120_000 });
    spawnSync('git', ['-C', ROOT, 'worktree', 'prune'], { encoding: 'utf8', timeout: 120_000 });
    rmSync(swap, { recursive: true, force: true });
  };
  try {
    const add = spawnSync('git', ['-C', ROOT, 'worktree', 'add', '--force', '--detach', swap, 'HEAD'], { encoding: 'utf8', timeout: 180_000 });
    if (add.status !== 0) return { ok: false, note: `git worktree add 失败：${String(add.stderr ?? add.stdout).slice(0, 160)}`, projects: [] };
    const manPath = join(swap, 'package.json');
    const man = JSON.parse(readFileSync(manPath, 'utf8'));
    let changed = 0;
    for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
      for (const name of Object.keys(man[field] ?? {})) {
        // scope 不是一条版本线：cordis / schemastery / cosmokit 各自跟不同次版本，只有 dsh* 与内核同步
        if (!/^@deepseek-ai\/dsh(-|$)/.test(name)) continue;
        man[field][name] = version;
        changed += 1;
      }
    }
    writeFileSync(manPath, `${JSON.stringify(man, null, 2)}\n`);
    const inst = spawnSync('pnpm', ['install', '--no-frozen-lockfile', '--prefer-offline', '--ignore-scripts'],
      { cwd: swap, encoding: 'utf8', timeout: 900_000 });
    if (inst.status !== 0) {
      const lines = String(`${inst.stdout}${inst.stderr}`).split('\n').filter((l) => /ERR_|404|No matching/i.test(l)).slice(0, 2);
      return { ok: false, note: `pnpm install 失败（换线 ${changed} 处）：${lines.join(' / ').slice(0, 200)}`, projects: [] };
    }
    const result = runTypecheck({ cwd: swap });
    return {
      ok: result.ok,
      projects: result.projects.map(({ project, errors, status }) => ({ project, errors, status })),
      note: result.ok ? `换线 ${changed} 处，两个 tsconfig 通过` : `换线 ${changed} 处`,
    };
  } finally {
    cleanup();
  }
}

/**
 * 用指定 app-boot 的 `evaluatePluginCompatibility` 判本仓声明。
 *
 * 走临时子进程 `require`：在同一个进程里 import 另一代的内核会留下模块副本与副作用
 * （这份代码里最贵的一次教训就是"两份内核模块实例"）。
 * @param {string} bootPath - 该代 `dsh-app-boot/lib/index.js`（由调用处按实际落点找到）。
 * @param {string} version - 传给判定的代次串。
 * @returns {{ status: 'pass'|'reject'|'absent'|'unlocated'|'error', detail?: string }}
 *   `absent` = 文件在、但那代内核不导出这个函数（真·该代次没有门禁）；
 *   `unlocated` = 连启动器文件都没找到（脚本没找到，不是内核没有）。两者不许混。
 */
function evaluateGate(bootPath, version) {
  if (!existsSync(bootPath)) return { status: 'unlocated' };
  const script = `
const m = require(${JSON.stringify(bootPath)});
if (typeof m.evaluatePluginCompatibility !== 'function') { console.log(JSON.stringify({ status: 'absent' })); process.exit(0); }
try {
  const r = m.evaluatePluginCompatibility(${JSON.stringify(PKG)}, {}, ${JSON.stringify(version)});
  console.log(JSON.stringify(r ? { status: 'reject', detail: JSON.stringify(r.requirements ?? r).slice(0, 180) } : { status: 'pass' }));
} catch (e) { console.log(JSON.stringify({ status: 'error', detail: String(e.message).slice(0, 160) })); }
`;
  const tmp = join(tmpdir(), `xk-gate-${Math.random().toString(36).slice(2)}.cjs`);
  writeFileSync(tmp, script);
  try {
    const r = spawnSync(process.execPath, [tmp], { encoding: 'utf8', timeout: 120_000 });
    const line = String(r.stdout ?? '').trim().split('\n').pop();
    try { return JSON.parse(line); } catch { return { status: 'error', detail: String(r.stdout ?? r.stderr).slice(0, 160) }; }
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * 门禁面：被测代次自己的判定 + 最新语义的判定，两值都进产物。
 *
 * 为什么双判：≤0.2.0 的内核**不读** `engines.dsh`（只按 `dsh-*` peer 判），0.2.1 起反过来。
 * 只看其中一个会把"声明形同虚设"或"声明过严"当成结论。
 * @param {string} version
 * @param {string | null} treeRoot
 */
function gateFace(version, treeRoot) {
  // 同样按实际落点取启动器：写死顶层时，嵌套树会报成 `absent`（"该代次不导出门禁函数"），
  // 而真相只是"脚本没找到那个文件" —— 两种缺席在产物里长得一模一样，必须分开。
  const ownBoot = treeRoot ? bootEntryOf(treeRoot) : { entry: null };
  const own = ownBoot.entry !== null
    ? evaluateGate(ownBoot.entry, version)
    : { status: 'unlocated', detail: treeRoot ? bootMissingNote(treeRoot, ownBoot) : '无内核树' };
  // 最新语义：取最新一代版本树里的 app-boot；没有就用本仓 node_modules 里那份（若有）。
  const newest = KERNEL_GENERATIONS[KERNEL_GENERATIONS.length - 1];
  const newestId = newest?.id ?? version;
  const refs = [join(KERNEL_ROOT, newestId), ROOT]
    .filter((dir) => existsSync(dir))
    .map((dir) => ({ dir, boot: bootEntryOf(dir) }));
  const hit = refs.find((r) => r.boot.entry !== null);
  const latest = hit ? evaluateGate(hit.boot.entry, version) : { status: 'unlocated' };
  return { own, latest, refFrom: hit ? basename(indexScopedDirs(hit.dir).get(APP_BOOT_PACKAGE) ?? hit.dir) : null,
    // 找过但没找到启动器的位置：缺这条，`absent` 与"脚本没找到"就没法分辨了。
    searched: refs.filter((r) => r.boot.entry === null).map((r) => r.boot.searched.map((p) => p.replace(r.dir, '<root>'))) };
}

/**
 * 跑一个代次。
 * @param {string} version
 */
async function runVersion(version) {
  const record = { version, steps: STEPS };
  let treeRoot = null;
  if (STEPS.includes('mount') || STEPS.includes('function')) {
    const core = await runOne(version);
    Object.assign(record, core);
    const treeDir = version.startsWith('/') ? version : join(KERNEL_ROOT, version);
    treeRoot = existsSync(treeDir) ? treeDir : null;
    if (record.verdict === 'UNDETERMINED' && !record.packages) {
      // 装配都起不来时仍然把树信息带进去，方便判断是"没有树"还是"树漂移"
      record.treeNote = record.notes?.[0] ?? null;
    }
  } else {
    // 只跑 type / gate 时也要先把树准备好（pin 清单与漂移判定都依赖它），但不 boot。
    const tree = kernelTree(version);
    treeRoot = tree.root;
    // 按实际落点读宿主版本（顶层假设见 indexScopedDirs）。读不到就是 null —— 下面按"未判定"走，
    // 不许拿一个猜出来的版本去比漂移。
    const dshDir = tree.root ? indexScopedDirs(tree.root).get('dsh') : undefined;
    const dshMan = dshDir === undefined ? null : join(dshDir, 'package.json');
    record.runtime = dshMan !== null && existsSync(dshMan)
      ? JSON.parse(readFileSync(dshMan, 'utf8')).version
      : null;
    record.notes = [tree.note ?? (tree.root ? '复用本地' : '无内核树')];
    if (tree.root && record.runtime === null && !STEPS.includes('type')) {
      record.verdict = 'UNDETERMINED';
      record.notes.push('树里读不到 @deepseek-ai/dsh 的版本，无法判定请求代次与装出代次是否一致');
    }
    if (tree.root) {
      // 与 runOne 同一口径：绝对路径模式下"请求的代次"就是那棵树自己的 dsh 版本。
      const requested = version.startsWith('/') ? record.runtime : version;
      const drift = driftReport(tree.root, requested);
      record.packages = drift.packages;
      if (drift.drifted.length) {
        record.verdict = 'UNDETERMINED';
        record.notes.push(`组合漂移（结论降级）：${drift.drifted.join(', ')}`);
      }
    } else if (!STEPS.includes('type')) {
      record.verdict = 'UNDETERMINED';
    }
  }

  if (STEPS.includes('gate')) {
    record.gate = gateFace(version, treeRoot);
    if (record.gate.own.status === 'reject') {
      record.verdict = 'RED';
      record.notes.push(`门禁拒绝（该代次自己的判定）：${record.gate.own.detail ?? ''}`);
    }
    if (record.gate.own.status === 'absent') record.notes.push('该代次的 app-boot 不导出 evaluatePluginCompatibility（无法验证声明是否被执行）');
    // 「没找到启动器」与「该代次没有门禁」是两件事，混成一条就会把脚本的失明报成内核的历史。
    if (record.gate.own.status === 'unlocated') {
      record.verdict = 'UNDETERMINED';
      record.notes.push(`门禁面未判定：${record.gate.own.detail ?? '没找到该代次的 app-boot 入口'}`);
    }
    if (record.gate.latest.status === 'unlocated') record.notes.push('门禁面：找不到用来复判"最新语义"的 app-boot，这一路未判定');
  }

  if (STEPS.includes('type')) {
    const t = typeFace(version);
    record.type = t;
    if (!t.ok) {
      record.verdict = 'RED';
      record.notes.push(`类型面红：${t.projects.map((p) => `${p.project} ${p.errors} 条`).join(' / ') || t.note || ''}`);
    } else {
      record.notes.push(`类型面绿：${t.note ?? '两个 tsconfig 通过'}`);
    }
  }

  applyLeakCheck(record);
  if (!record.verdict) record.verdict = 'GREEN';
  return record;
}

/**
 * 越界自检（三类目录 + 根级文件）：任何一条本次前缀出现在真实 `~/.dsh` 里，就说明隔离没生效。
 *
 * 从 `runOne` 里搬出来、对每个代次都跑：它验的是"这次运行有没有在你机器上留东西"，
 * 与跑了哪几步无关 —— 当初只扫 `sessions/` 且只在装配流程里跑，于是 `plugin-state/` 的残留
 * 既没被扫到、`--steps` 精简时更不会查（issue #97 #3）。
 * @param {object} record - 该代次的记录（就地改写 verdict/notes）。
 */
function applyLeakCheck(record) {
  const leaked = scanLeaks(join(homedir(), '.dsh'));
  if (!leaked.length) return;
  record.verdict = 'RED';
  record.notes = record.notes ?? [];
  record.notes.push(`隔离失效：本次运行写进了真实 DSH_HOME（${leaked.length} 个），已删除：${leaked.join(', ').slice(0, 160)}`);
  for (const p of leaked) {
    try {
      rmSync(p, { recursive: true, force: true });
      const parent = dirname(p);
      if (readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true });
    } catch { /* 删不掉就留在报告里 */ }
  }
}

/** 打印一个代次的结论。 */
function report(record) {
  const v = record.version;
  // 同源守卫单独占两行、放在 verdict 之前：它否定的是"这次结论算不算数"，
  // 折进 notes 里就会像上一轮那样被一行 grep 掉（那次 GREEN 里其实带着双实例）。
  const guard = record.sameSource;
  if (guard !== undefined && !guard.ok) {
    console.log(`\n!! ${v} 的结论不作数：插件解析到的内核模块与被测树不一致（${guard.offenders.length}/${guard.checked} 个包）`);
    for (const o of guard.offenders.slice(0, 6)) console.log(`     • ${o.name}：${o.reason}`);
  }
  if (record.verdict === 'UNDETERMINED') {
    console.log(`\n### ${v} … 未判定`);
    for (const n of record.notes ?? []) console.log(`    ${n}`.slice(0, 220));
    return;
  }
  console.log(`\n### ${v} … ${record.verdict}`);
  const bits = [`内核=${record.runtime ?? '?'}`];
  if (guard !== undefined) bits.push(`同源=${guard.ok ? 'same' : 'MISMATCH'}`);
  if (record.delivery) bits.push(`投递 spliced=${record.delivery.spliced} dispatch=${record.delivery.dispatched ? 'Y' : 'N'}`);
  if (record.at?.length) bits.push(`at 形状 ${record.at.filter((a) => a.pass).length}/${record.at.length}`);
  if (record.type) bits.push(`type ${record.type.ok ? '绿' : record.type.projects.map((p) => `${p.project}:${p.errors}`).join(',')}`);
  if (record.gate) bits.push(`gate 本代=${record.gate.own.status} 最新=${record.gate.latest.status}`);
  console.log(`    ${bits.join(' · ')}`);
  for (const a of record.at ?? []) if (!a.pass) console.log(`      ✗ ${a.label}：${a.echo}`);
  for (const n of record.notes ?? []) console.log(`      · ${n}`);
}

// 只在被当作脚本运行时执行；import 时保持纯函数（测试要 import 上面的导出）。
const invoked = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invoked !== undefined && import.meta.url === invoked) {
  console.log(`${NAME}@${PKG.version} · 跨内核回归 · 代次取自 KERNEL_GENERATIONS（${VERSIONS.length} 个）· steps=${STEPS.join(',')}`);
  const results = [];
  for (const v of VERSIONS) {
    const r = await runVersion(v);
    results.push(r);
    report(r);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(OUT_DIR, `across-kernels-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), versions: VERSIONS, steps: STEPS, results }, null, 2)}\n`);
  const red = results.filter((r) => r.verdict === 'RED').length;
  const und = results.filter((r) => r.verdict === 'UNDETERMINED').length;
  // 不作数的运行单独报一行：它说明"这一代的结论根本没产生"，混在绿/红里就没人回去修装配口径。
  const notCountable = results.filter((r) => r.sameSource !== undefined && !r.sameSource.ok);
  if (notCountable.length > 0) {
    console.log(`\n⚠ 因同源守卫不作数：${notCountable.map((r) => r.version).join(', ')} —— 要修的是装配口径，不是插件。`);
  }
  console.log(`\n汇总：绿 ${results.length - red - und} / 红 ${red} / 未判定 ${und}；明细 ${file}`);
  process.exit(red > 0 ? 1 : und > 0 ? 2 : 0);
}
