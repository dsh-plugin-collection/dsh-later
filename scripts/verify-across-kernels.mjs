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
 * ## 注意（三条判据纪律，都是踩过的坑）
 *
 * 1. **别用"日志里搜得到文本"当投递判据**：创建事件与命令回执里含同样的正文，
 *    会同时造成假绿和假红。真投递 = 一条 `agent/inbox/spliced` 且其 `inserted[].content`
 *    带 nonce，随后一条 `schedule/change operation:dispatch`。
 * 2. 会话日志是**多帧 zstd 拼接**（每次 flush 追加一帧），`zstdDecompressSync` 只解第一帧；
 *    这里按帧 magic 切分逐帧解。
 * 3. 内核模块必须解析到**被测那一代**：插件目录直接挂载会让它用自己 `node_modules` 里
 *    那份宿主包（版本矩阵当场失真）。所以是把插件实体副本放进 `<临时HOME>/profiles/…/node_modules`，
 *    再把该代版本树软链铺成同一层的 `node_modules`。
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
import { KERNEL_GENERATIONS } from '../lib/upstream-compat.js';
import { runTypecheck } from './typecheck-all.mjs';

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
  const out = {};
  for (const name of packages) {
    const man = join(treeRoot, 'node_modules', '@deepseek-ai', name, 'package.json');
    out[name] = existsSync(man) ? JSON.parse(readFileSync(man, 'utf8')).version : null;
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

/** 该包在该代次有没有发布（决定"pin 清单"里要不要带它）。 */
function published(name, version) {
  const r = spawnSync('npm', ['view', `@deepseek-ai/${name}@${version}`, 'version', '--json'],
    { encoding: 'utf8', timeout: 60_000 });
  return r.status === 0 && String(r.stdout).includes(version);
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
 * mount 成功（0.1.5-rc.1 GREEN，投递 spliced=1 / dispatch=Y / at 5/5）。当时的 RED 有两个是
 * 本脚本自己造成的根因——① 写死顶层 `dsh-app-boot` 路径，而纯 rc.1 安装会把它嵌到
 * `dsh/node_modules` 下（`Cannot find module …/app-boot/lib/index.js`）；② `--legacy-peer-deps`
 * 跳过 peer，而 `ensureBootPeers` 只补 app-boot 一棵线，`dsh-session-persistence-jsonl` 恰是
 * 靠 **peer** 拿 `dsh-session-persistence`（`Cannot find package`）。这两处该修在脚本里；
 * 在修好之前，本脚本对 rc.1 的 RED **不构成**「该代不支持」的证据，别照它下调支持范围。
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
  const scopeDir = join(root, 'node_modules', '@deepseek-ai');
  for (let pass = 0; pass < 3; pass += 1) {
    let entries = [];
    try { entries = readdirSync(scopeDir); } catch { return { pinned, skipped }; }
    const specs = [];
    for (const name of entries) {
      if (!/^dsh(-|$)/.test(name)) continue;
      const man = join(scopeDir, name, 'package.json');
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
 * 补装 `dsh-app-boot` 声明的 peer（最多 3 轮）。
 *
 * 为什么需要：老代次的 app-boot 把一批包声明成 **peer**（0.1.5 的 `cordis-plugin-group@^1.0.2`、
 * `cordis-plugin-loader`、`dsh-launch-environment` 等）。而 pin 安装在上游 peer 范围自相矛盾时
 * 会退回 `--legacy-peer-deps`，那一路**不会自动装 peer** —— 于是装配报
 * `Cannot find package '@deepseek-ai/cordis-plugin-group'`。这不是被测插件的问题，是装配环境缺件。
 *
 * 装法：`@deepseek-ai/dsh*` 系的 peer 跟代次同步（该代次有发布就 pin 到它），其余按声明的范围装。
 * @param {string} root - 内核树根。
 * @param {string} version - 目标代次。
 * @returns {{ installed: string[], missing: string[] }} 本轮补装的包与仍然缺失的包。
 */
function ensureBootPeers(root, version) {
  const installed = [];
  const bootMan = join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json');
  if (!existsSync(bootMan)) return { installed, missing: [] };
  for (let pass = 0; pass < 3; pass += 1) {
    const peers = JSON.parse(readFileSync(bootMan, 'utf8')).peerDependencies ?? {};
    const specs = [];
    for (const [name, range] of Object.entries(peers)) {
      if (existsSync(join(root, 'node_modules', name))) continue;
      const short = name.replace('@deepseek-ai/', '');
      const pinned = name.startsWith('@deepseek-ai/dsh') && published(short, version);
      specs.push(`${name}@${pinned ? version : range}`);
    }
    if (specs.length === 0) break;
    spawnSync('npm', ['i', '--no-audit', '--no-fund', '--save-exact', '--legacy-peer-deps', ...specs],
      { cwd: root, encoding: 'utf8', timeout: 900_000 });
    installed.push(...specs);
    const after = Object.keys(peers).filter((name) => !existsSync(join(root, 'node_modules', name)));
    if (after.length === 0) break;
  }
  const missing = Object.keys(JSON.parse(readFileSync(bootMan, 'utf8')).peerDependencies ?? {})
    .filter((name) => !existsSync(join(root, 'node_modules', name)));
  return { installed, missing };
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
  const hasBoot = () => existsSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot'));
  if (existsSync(marker) && hasBoot()) return { root, note: '复用本地（已按代次 pin）', pinned: true };
  if (argv.includes('--no-install')) {
    return hasBoot()
      ? { root, note: '复用本地（该树未 pin，可能组合漂移）', pinned: false }
      : { root: null, note: `本地树不完整（缺 @deepseek-ai/dsh-app-boot）且 --no-install：${root}`, pinned: false };
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
    r = install(['--legacy-peer-deps']);
  }
  if (!hasBoot()) {
    return { root: null, note: `npm i 后仍没有 @deepseek-ai/dsh-app-boot（该代次可能没有可安装的启动器）`, pinned: false };
  }
  const peers = ensureBootPeers(root, version);
  if (peers.missing.length) {
    return { root: null, note: `app-boot 的 peer 装不齐（${peers.missing.join(', ')}）`, pinned: false };
  }
  // 传递依赖也会 caret 漂移（0.1.5 的插件被带到 rc.3）—— 装配前把整条 dsh-* 线拉回请求代次。
  const driftPins = pinAllDrifted(root, version);
  // 补 pin 后 peer 可能又缺（包版本变了，声明的 peer 也变），再补一轮。
  const peers2 = ensureBootPeers(root, version);
  writeFileSync(marker, `${version}\n${pins.join('\n')}\n`);
  const drift = driftReport(root, version).drifted;
  const peerNote = [
    peers2.installed.length ? `补装 app-boot peer ${peers2.installed.length} 个` : '',
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
  const runtime = JSON.parse(readFileSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version;
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
    const rootConfig = join(profile, 'cordis.yml');
    writeFileSync(rootConfig, '[]\n');
    const off = join(home, 'off.patch.yml');
    // hmr 行要求真实启动器给的 appReady；这里只要干净装配，显式关掉，别把无关警告当故障。
    writeFileSync(off, '- id: hmr\n  disabled: true\n');
    const appBoot = join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js');
    const boot = await import(pathToFileURL(appBoot).href);
    const layers = [join(root, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'), join(copy, 'cordis.patch.yml'), off];
    const patches = layers.flatMap((f) => existsSync(f) ? boot.loadOverlayPatches('dsh-xkernel', f) : []);
    const ctx = await boot.boot('dsh-xkernel', rootConfig, patches, (c) => {
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
 * @param {string} bootPath - 该代 `dsh-app-boot/lib/index.js`。
 * @param {string} version - 传给判定的代次串。
 * @returns {{ status: 'pass'|'reject'|'absent'|'error', detail?: string }}
 */
function evaluateGate(bootPath, version) {
  if (!existsSync(bootPath)) return { status: 'absent' };
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
  const own = treeRoot
    ? evaluateGate(join(treeRoot, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'), version)
    : { status: 'absent' };
  // 最新语义：取最新一代版本树里的 app-boot；没有就用本仓 node_modules 里那份（若有）。
  const newest = KERNEL_GENERATIONS[KERNEL_GENERATIONS.length - 1];
  const newestId = newest?.id ?? version;
  const candidates = [
    join(KERNEL_ROOT, newestId, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
    join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
  ];
  const refPath = candidates.find((p) => existsSync(p));
  const latest = refPath ? evaluateGate(refPath, version) : { status: 'absent' };
  return { own, latest, refFrom: refPath ? basename(dirname(dirname(dirname(refPath)))) : null };
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
    treeRoot = existsSync(join(KERNEL_ROOT, version)) ? join(KERNEL_ROOT, version) : null;
    if (record.verdict === 'UNDETERMINED' && !record.packages) {
      // 装配都起不来时仍然把树信息带进去，方便判断是"没有树"还是"树漂移"
      record.treeNote = record.notes?.[0] ?? null;
    }
  } else {
    // 只跑 type / gate 时也要先把树准备好（pin 清单与漂移判定都依赖它），但不 boot。
    const tree = kernelTree(version);
    treeRoot = tree.root;
    record.runtime = tree.root
      ? JSON.parse(readFileSync(join(tree.root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
      : null;
    record.notes = [tree.note ?? (tree.root ? '复用本地' : '无内核树')];
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
  if (record.verdict === 'UNDETERMINED') {
    console.log(`\n### ${v} … 未判定`);
    for (const n of record.notes ?? []) console.log(`    ${n}`.slice(0, 220));
    return;
  }
  console.log(`\n### ${v} … ${record.verdict}`);
  const bits = [`内核=${record.runtime ?? '?'}`];
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
  console.log(`\n汇总：绿 ${results.length - red - und} / 红 ${red} / 未判定 ${und}；明细 ${file}`);
  process.exit(red > 0 ? 1 : und > 0 ? 2 : 0);
}
