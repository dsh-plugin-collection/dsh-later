#!/usr/bin/env node
/**
 * UI 面矩阵的**实例引导**：造一个只挂本插件的隔离实例，并把它拉起来。
 *
 * ## 为什么不用 devkit/instance.mjs
 *
 * devkit 是本工作区的工具集，**不随插件发布**（别人 clone 本仓没有它）。而 UI 面证据要能被
 * 任何人一条命令重跑，所以这条链必须是仓内自包含的。这里只实现 UI 矩阵需要的最小集合：
 * 软链版本树的 node_modules → 实体副本装插件 → 写 profile 组合 → 起 `dsh` → 等端口 → 停。
 *
 * ## 两处跨代次差异（都踩过，且都不是插件的问题）
 *
 * 1. **启动器形态**：`.bin/dsh` 可能是**指向 JS 的软链**（npm 装的树），也可能是 **POSIX shell
 *    脚本**（pnpm 装的树，第一行 `#!/bin/sh`）。前者要 `node <realpath>`，后者要**直接执行**；
 *    混着来会得到 `SyntaxError: Invalid or unexpected token`（把 shell 脚本喂给 node 的典型症状）。
 * 2. **模块回退层的清单**：`dsh-app-boot` 的 `healProfilesModuleFallback()` 会逐依赖读
 *    `<包目录>/node_modules/package.json`；某些代次（实测 0.1.5 的 npm 树）在家目录缺失时抛
 *    `ENOENT … /@deepseek-ai/dsh/node_modules/package.json`。补一个 `{}` 的占位清单即可
 *    —— 它是"该目录还没有任何依赖"的合法表达，不改变任何解析结果。
 *
 * ## 隔离边界（别当通用防线）
 *
 * 隔离靠 `DSH_HOME` 指向本目录：会话、storages、plugin-state 都落在这里。**没有** unshare/容器，
 * 所以插件若往 `DSH_HOME` 之外写（外发 HTTP、spawn 子进程改真实仓库）这里挡不住 —— 对
 * dsh-later 已实测确认只写 DSH_HOME，故可信。用完必须 `stop()`。
 * @module scripts/ui-matrix/instance
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** 各代次都要装在 profile 里的基础 bundle（与 dsh 自己的 web profile 同构）。 */
const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];

/**
 * 判定启动器该怎么执行。
 *
 * @param {string} binPath - `node_modules/.bin/dsh`。
 * @returns {'node' | 'exec' | 'missing'} `node` = 喂给 node 的 JS；`exec` = 直接执行的脚本。
 */
export function classifyLauncher(binPath) {
  if (!existsSync(binPath)) return 'missing';
  // 软链 → 目标通常是 lib/bin.js（JS 入口），交给 node；实体文件 → 看首行有没有 shebang。
  if (lstatSync(binPath).isSymbolicLink()) return 'node';
  const head = readFileSync(binPath, 'utf8').slice(0, 120);
  return head.startsWith('#!') && !head.startsWith('#!/usr/bin/env node') ? 'exec' : 'node';
}

/**
 * 补 `<dsh 包>/node_modules/package.json` 占位清单（见文件头第 2 条）。
 *
 * @param {string} versionRoot - 版本树根。
 * @returns {boolean} 是否补了（已有就返回 false）。
 */
export function ensureModuleFallbackManifest(versionRoot) {
  const scope = join(versionRoot, 'node_modules', '@deepseek-ai');
  let entries = [];
  try { entries = readdirSync(scope); } catch { return false; }
  // 找到真正承载 `dsh` 的那个包目录（pnpm 树下可能是 .pnpm/.../@deepseek-ai/dsh）
  const candidates = [];
  for (const name of entries) {
    if (name !== 'dsh') continue;
    try { candidates.push(realpathSync(join(scope, name))); } catch { /* 断链跳过 */ }
  }
  let written = false;
  for (const dir of candidates) {
    const manifest = join(dir, 'node_modules', 'package.json');
    if (existsSync(manifest)) continue;
    mkdirSync(dirname(manifest), { recursive: true });
    writeFileSync(manifest, '{}\n');
    written = true;
  }
  return written;
}

/**
 * 造隔离实例（幂等：已存在则重建 profile 组合，不动树）。
 *
 * @param {object} options
 * @param {string} options.version - 代次名（也是 `~/dsh-versions/<v>` 的目录名）。
 * @param {string} [options.versionsRoot] - 版本树根，默认 `~/dsh-versions`。
 * @param {string} options.pluginDir - 插件仓根（要挂的那个插件）。
 * @param {string} options.home - 实例 DSH_HOME（会重建）。
 * @param {string} [options.profile] - profile 名，默认 `ui`。
 * @returns {{ home: string, profile: string, profileDir: string, versionRoot: string, plugin: string }}
 */
export function createInstance({ version, versionsRoot, pluginDir, home, profile = 'ui' }) {
  const root = join(versionsRoot ?? join(homedir(), 'dsh-versions'), version);
  if (!existsSync(join(root, 'node_modules', '@deepseek-ai', 'dsh'))) {
    throw new Error(`版本树不存在或不完整：${root}（先装 @deepseek-ai/dsh@${version}）`);
  }
  const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
  const profileDir = join(home, 'profiles', profile);
  const nm = join(profileDir, 'node_modules');
  rmSync(home, { recursive: true, force: true });
  mkdirSync(nm, { recursive: true });
  // 凭据用软链共享（**只读**）：web 的浏览器会话 cookie 由这份 secret 签发，
  // 不链过来实例自己的 secret 是另生成的 → 页面壳能开、API 全 401（实测：插件按钮根本不渲染）。
  const credentials = join(homedir(), '.dsh', '.credentials.yaml');
  if (existsSync(credentials)) spawnSync('ln', ['-s', credentials, join(home, '.credentials.yaml')]);

  // ① 软链版本树的整棵 node_modules：解析等价于一次零安装组装，且插件用不到本仓自己的宿主包。
  for (const entry of readdirSync(join(root, 'node_modules'))) {
    if (entry === '.bin' || entry.startsWith('.')) continue;
    const src = join(root, 'node_modules', entry);
    if (entry.startsWith('@')) {
      mkdirSync(join(nm, entry), { recursive: true });
      for (const child of readdirSync(src)) {
        spawnSync('ln', ['-s', join(src, child), join(nm, entry, child)]);
      }
      continue;
    }
    spawnSync('ln', ['-s', src, join(nm, entry)]);
  }

  // ② 插件用**实体副本**：挂仓库目录会让它 import 到自己 node_modules 里那份宿主包，矩阵当场失真。
  //    复制清单**以 package.json 的 `files` 白名单为准**，不再手写第二份。这里原来是手写的
  //    四条，于是往 `files` 里加了 `SKILL.md` / `SKILL.en.md` 之后，副本里根本没有它们：
  //    provider 每次读盘都失败，skill 在所有实例里静默缺席（退化是安全的，但矩阵与任何
  //    隔离实例都测不到这一面）。`files` 之外只补两个非发布、运行期要用的目录。
  const copy = join(nm, pkg.name);
  mkdirSync(copy, { recursive: true });
  const RUNTIME_ONLY_DIRS = ['locale', 'assets'];
  for (const entry of [...(Array.isArray(pkg.files) ? pkg.files : []), ...RUNTIME_ONLY_DIRS]) {
    const src = join(pluginDir, entry);
    if (!existsSync(src)) continue;
    cpSync(src, join(copy, entry), lstatSync(src).isDirectory() ? { recursive: true } : undefined);
  }

  // ③ profile 组合：与宿主自带 web profile 同构（base + web-app + 被测插件）。
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${profile}`,
    private: true,
    dependencies: { [pkg.name]: `link:${copy}` },
    dsh: { profile: { bundles: [...BASE_BUNDLES, pkg.name] } },
  }, null, 2)}\n`);
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n');
  // hmr 必须**显式开启**：0.1.2 的 `watchUserPatches()` 在没有 hmr 服务时直接抛
  // "user patch-layer watching requires the Cordis HMR service"（实测两次，第一次是把它 disable 了）。
  // 不写配置、只写 enabled，六代同样的语义；矩阵要的是"这一版长什么样"，不靠热重载。
  writeFileSync(
    join(profileDir, 'cordis.patch.yml'),
    `# 由 scripts/ui-matrix/instance.mjs 生成（DSH ${version}）\n- id: hmr\n  disabled: false\n`,
  );
  return { home, profile, profileDir, versionRoot: root, plugin: pkg.name };
}

/**
 * 起 GUI，等它接受连接。
 *
 * @param {object} options
 * @param {string} options.versionRoot - 版本树根（含 `node_modules/.bin/dsh`）。
 * @param {string} options.home - 实例 DSH_HOME。
 * @param {string} options.profile - profile 名。
 * @param {number} options.port - 端口。
 * @param {string} [options.logFile] - 日志（追加写，失败痕迹不被覆盖）。
 * @returns {Promise<{ pid: number, http: number, logFile: string }>}
 */
export async function startWeb({ versionRoot, home, profile, port, logFile }) {
  const bin = join(versionRoot, 'node_modules', '.bin', 'dsh');
  const flavor = classifyLauncher(bin);
  if (flavor === 'missing') throw new Error(`找不到启动器：${bin}`);
  ensureModuleFallbackManifest(versionRoot);
  const log = logFile ?? join(home, 'logs', 'ui-matrix.log');
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  const args = ['--profile', profile, '--port', String(port), '--no-open'];
  const spec = flavor === 'node'
    ? { cmd: process.execPath, args: [realpathSync(bin), ...args] }
    : { cmd: bin, args };
  const child = spawn(spec.cmd, spec.args, {
    env: { ...process.env, DSH_HOME: home },
    cwd: home,
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  mkdirSync(join(home, 'logs'), { recursive: true });
  writeFileSync(join(home, 'ui-matrix.pid'), `${child.pid}\n`);
  const http = await waitForHttp(port, 60_000);
  if (http === 0) {
    stopInstance(home);
    throw new Error(`实例没起来（port=${port}，日志见 ${log}）`);
  }
  return { pid: child.pid, http, logFile: log };
}

/**
 * 轮询直到端口有响应（200/401 都算"服务在"）。
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<number>} 最后一次 HTTP 状态码；0 = 没起来。
 */
export async function waitForHttp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${port}/`], { encoding: 'utf8' });
    last = Number(String(r.stdout ?? '0').trim() || 0);
    if (last === 200 || last === 401) return last;
    await new Promise((done) => setTimeout(done, 1500));
  }
  return 0;
}

/**
 * 停实例（杀进程组；pidfile 在 home 根）。
 * @param {string} home - 实例 DSH_HOME。
 * @returns {boolean} 是否发出了停止信号。
 */
export function stopInstance(home) {
  const pidFile = join(home, 'ui-matrix.pid');
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* 已经没了 */ } }
  rmSync(pidFile, { force: true });
  return true;
}

/**
 * 给实例铺一份**工作区清单**，否则 composer 是禁用态、插件按钮根本不渲染。
 *
 * 为什么直接复制 live 的那份：工作区记录要过宿主 schema 校验（`path/title/sessionIds/
 * createdAt/updatedAt` 缺一个就报 `does not match its schema`，整条 `workspaceRegistry` 起不来，
 * 于是 `sessionController` 永久 pending —— 实测踩过）。复制现成的永远合 schema。
 * 这只是**读**用户那份 store，写的是实例自己的 DSH_HOME。
 * @param {string} home - 实例 DSH_HOME。
 * @param {string} [liveHome] - 真实 ~/.dsh。
 * @returns {boolean} 是否铺上了。
 */
export function seedWorkspaceStore(home, liveHome = join(homedir(), '.dsh')) {
  const src = join(liveHome, 'storages', 'workspace.json');
  if (!existsSync(src)) return false;
  const dst = join(home, 'storages');
  mkdirSync(dst, { recursive: true });
  cpSync(src, join(dst, 'workspace.json'));
  return true;
}

/** 版本树名清单（`~/dsh-versions` 下看起来像代次的目录）。 */
export function listVersionTrees(versionsRoot = join(homedir(), 'dsh-versions')) {
  try {
    return readdirSync(versionsRoot).filter((name) => /^\d+\.\d+\.\d+/.test(name)).sort();
  } catch {
    return [];
  }
}

/** 供测试/诊断：实例目录结构是否符合预期。 */
export function instanceSummary(home) {
  const profileDir = join(home, 'profiles', 'ui');
  const man = join(profileDir, 'package.json');
  return {
    home: resolve(home),
    hasProfile: existsSync(man),
    bundles: existsSync(man) ? JSON.parse(readFileSync(man, 'utf8')).dsh?.profile?.bundles ?? [] : [],
    pluginCopy: existsSync(join(profileDir, 'node_modules')) ? readdirSync(join(profileDir, 'node_modules')).length : 0,
    logName: basename(join(home, 'logs', 'ui-matrix.log')),
  };
}
