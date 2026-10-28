/**
 * 内核树的**装配口径**（纯函数，全部可注入 fs / npm —— issue #110 的三处修正住在这里）。
 *
 * 为什么把这三件事从 `verify-across-kernels.mjs` 里抽出来：那个脚本要真装内核、真冷启动，
 * 于是它自己的口径以前只有在"这台机器上装齐了 7 代 + 有网络"时才可验证。实测后果是两条
 * **假红**（`src/upstream-compat.ts` 的 0.1.5 条目曾据它们写下「0.1.5-rc.1 装不起来」）：
 *
 *  1. **写死顶层 `dsh-app-boot` 路径**。纯 `npm i @deepseek-ai/dsh@<v>` 会把启动器嵌到
 *     `…/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/`，脚本于是报
 *     `Cannot find module <root>/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` ——
 *     这是脚本的路径假设错了，不是该代次装不起来。`resolveBootEntry()` 按**实际位置**找，
 *     并在找不到时把「找过哪些位置」原样交出去（不许静默换成别的路径继续跑）。
 *  2. **peer 只补 `dsh-app-boot` 一棵线**。上游不少包把内核兄弟声明成 **peer** 而非
 *     dependency（实测 `dsh-session-persistence-jsonl` 的 `@deepseek-ai/dsh-session-persistence`
 *     就在 `peerDependencies` 里），而 `--legacy-peer-deps` 那一路**不装 peer**，装配就报
 *     `Cannot find package`。`scanScopedPackages()` + `planPeerBackfill()` 把口径从"一棵线"
 *     扩到"树里全部 `@deepseek-ai/*`，迭代到收敛"。
 *     ⚠️ 修法**不是**去掉 `--legacy-peer-deps`：那会让 caret 把整条线漂到更晚 rc，
 *     「请求代次 = 装出代次」这条判据当场作废（#97 #1）。跳 peer 的装法保留，缺的 peer 显式补齐。
 *  3. **插件解析到的内核模块必须就是被测那一份**。混装树里插件解析到 rc.3、宿主 `dsh` 是 rc.1
 *     （或插件根本逃到开发仓的 `node_modules`），此时 mount「跑通了」证明的不是该代次。
 *     `auditPluginSources()` 逐包核对解析落点与版本，不一致就交给调用处判红。
 *
 * 约定：这些函数**不碰 npm、不 boot、不写文件**；`io` 只读。装依赖与冷启动留在脚本里，
 * 因为那两步才是真代价；口径本身必须能在假树结构上断言。
 *
 * @module scripts/kernel-assembly
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

/** 启动器包名（不带 scope）——路径推导的目标。 */
export const APP_BOOT_PACKAGE = 'dsh-app-boot';
/** app-boot 的入口文件（相对包目录）。 */
export const APP_BOOT_ENTRY = join('lib', 'index.js');
/** 内核 scope 前缀；peer 回填只管这个 scope，别把 npm 公共包一起改版本。 */
export const SCOPE_PREFIX = '@deepseek-ai/';

/** 只读 fs/解析注入面（测试给假树用）。 */
const defaultIo = {
  exists: (p) => existsSync(p),
  /** 目录条目名（不排序；返回名字数组）。 */
  readdir: (dir) => readdirSync(dir).filter((name) => !name.startsWith('.')),
  isDirectory: (p) => {
    try { return statSync(p).isDirectory(); } catch { return false; }
  },
  readJson: (p) => JSON.parse(readFileSync(p, 'utf8')),
  realpath: (p) => {
    try { return realpathSync(p); } catch { return p; }
  },
  /**
   * bare specifier → 绝对文件路径；解析不到就抛。
   *
   * 只用 CJS 解析，**不**在失败后退回 `import.meta.resolve`：实测 8 个被审包在真树里
   * 都能被 `require.resolve` 解析到，而那条退路会向上穿过解析根找到**别处**那份包
   * （调试时真的落到了开发仓的 `.pnpm` 上），于是一次"该代次没被测到"被伪装成
   * "被测到了但版本不同"。解析不到就让它抛，抛就是要报的 offender。
   */
  resolve: (specifier, fromDir) => createRequire(join(fromDir, '__resolve_anchor__.js')).resolve(specifier),
};

/** 读入口文件所属包的 `{name, version}`（向上找 name 匹配的 package.json）。 */
function packageOfEntry(entryPath, io, maxDepth = 12) {
  let dir = resolvePath(entryPath, '..');
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const manifest = join(dir, 'package.json');
    if (io.exists(manifest)) {
      try {
        const parsed = io.readJson(manifest);
        if (typeof parsed.name === 'string' && typeof parsed.version === 'string') {
          return { name: parsed.name, version: parsed.version, dir };
        }
      } catch { /* 非法 JSON：这一层不算，继续向上 */ }
    }
    const parent = resolvePath(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 一次性给整棵树建 `@deepseek-ai/*` 的落点索引（顶层优先，其次嵌套，短路径优先）。
 *
 * 为什么要索引而不是逐个包各扫一遍：`resolvedVersions()` 一次要问 11 个包，逐包 BFS 会把
 * 一棵 241 包的树扫 11 遍。更要紧的是**正确性**：它以前只读顶层，纯装启动器的树里内核线全
 * 嵌在 `dsh/node_modules/` 下，于是每个包都读成 `null`，而 `null` 按口径是"该代次没有这个包"
 * ——组合漂移检测对整个树集体失明，"pin 后仍漂移"那行永远不出现，混装树反而看起来最干净。
 *
 * @param {string} root - 树根。
 * @param {object} [io]
 * @param {{maxDepth?: number}} [options]
 * @returns {Map<string, string>} 包名（不带 scope）→ 目录（同名取最浅的一处）。
 */
export function indexScopedDirs(root, io = defaultIo, options = {}) {
  const maxDepth = options.maxDepth ?? 3;
  const scopeName = SCOPE_PREFIX.slice(0, -1);
  const hits = [];
  const queue = [{ dir: join(root, 'node_modules'), depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (!io.isDirectory(dir)) continue;
    const scope = join(dir, scopeName);
    if (io.isDirectory(scope)) {
      for (const child of io.readdir(scope)) hits.push({ name: child, dir: join(scope, child), depth });
    }
    if (depth >= maxDepth) continue;
    for (const entry of io.readdir(dir)) {
      const full = join(dir, entry);
      if (!io.isDirectory(full)) continue;
      if (entry.startsWith('@')) {
        for (const child of io.readdir(full)) {
          const nested = join(full, child, 'node_modules');
          if (io.isDirectory(nested)) queue.push({ dir: nested, depth: depth + 1 });
        }
        continue;
      }
      const nested = join(full, 'node_modules');
      if (io.isDirectory(nested)) queue.push({ dir: nested, depth: depth + 1 });
    }
  }
  hits.sort((a, b) => (a.depth - b.depth) || (a.dir.length - b.dir.length) || (a.dir < b.dir ? -1 : 1));
  const map = new Map();
  for (const hit of hits) if (!map.has(hit.name)) map.set(hit.name, hit.dir);
  return map;
}

/**
 * 在树里定位某个 `@deepseek-ai/*` 包的目录：顶层优先，其次按路径深度升序的嵌套位置。
 *
 * 为什么需要它而不是直接 `join(root,'node_modules','@deepseek-ai',name)`：npm 在只装启动器
 * 时会把整棵内核线嵌到 `…/@deepseek-ai/dsh/node_modules/…` 下（实测 0.1.5-rc.1），硬编码顶层
 * 会把"树其实完整"读成"包不存在"。同一个坑打在启动器路径上是一条 `Cannot find module` 红，
 * 打在 `dsh-base/cordis.patch.yml` 上则是**静少一层补丁**——mount 照样"成功"，测的却是少了
 * 半套插件的树。少一层比报个错更难发现。
 *
 * @param {string} root - 树根。
 * @param {string} name - 包名（不带 scope）。
 * @param {object} [io]
 * @param {{maxDepth?: number}} [options]
 * @returns {{dir: string|null, searched: string[], nested: boolean}}
 */
export function findScopedDir(root, name, io = defaultIo, options = {}) {
  const maxDepth = options.maxDepth ?? 3;
  const top = join(root, 'node_modules', SCOPE_PREFIX.slice(0, -1), name);
  if (io.isDirectory(top)) return { dir: top, searched: [top], nested: false };
  const found = [];
  const queue = [{ dir: join(root, 'node_modules'), depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth || !io.isDirectory(dir)) continue;
    for (const entry of io.readdir(dir)) {
      const full = join(dir, entry);
      if (!io.isDirectory(full)) continue;
      if (entry.startsWith('@')) {
        const hit = join(full, name);
        if (io.isDirectory(hit)) found.push(hit);
        for (const child of io.readdir(full)) {
          const nested = join(full, child, 'node_modules');
          if (io.isDirectory(nested)) queue.push({ dir: nested, depth: depth + 1 });
        }
        continue;
      }
      const nested = join(full, 'node_modules');
      if (io.isDirectory(nested)) queue.push({ dir: nested, depth: depth + 1 });
    }
  }
  found.sort((a, b) => (a.length - b.length) || (a < b ? -1 : 1));
  return { dir: found[0] ?? null, searched: [top, ...found], nested: found.length > 0 };
}

/**
 * 找 `dsh-app-boot` 的真实落点。
 *
 * 顺序是刻意的：**顶层优先**（pin 装齐的树），再按路径深度升序看嵌套位置（纯装启动器的树）。
 * 找不到时 `searched` 非空且含两类位置——调用处据此抛可诊断的错误，不许退回顶层硬编码。
 *
 * @param {string} root - 内核树根。
 * @param {object} [io] - 注入的只读 fs。
 * @returns {{dir: string|null, entry: string|null, searched: string[], nested: boolean}}
 */
export function resolveBootEntry(root, io = defaultIo) {
  const located = findScopedDir(root, APP_BOOT_PACKAGE, io);
  if (located.dir === null) return { dir: null, entry: null, searched: located.searched, nested: false };
  const entry = join(located.dir, APP_BOOT_ENTRY);
  const searched = [...located.searched];
  searched.push(entry);
  if (!io.exists(entry)) {
    // 包目录在、入口不在：也是"这一代没有可执行的启动器"，同样要把话说完。
    return { dir: located.dir, entry: null, searched, nested: located.nested };
  }
  return { dir: located.dir, entry, searched, nested: located.nested };
}

/**
 * 扫出树里**全部** `@deepseek-ai/*` 包（顶层 + 任意层嵌套），读出版本与 peer 声明。
 *
 * 落点由 `indexScopedDirs()` 一次 BFS 给出，这里只负责读清单；`options.index` 让调用方
 * （peer 回填每轮都要重扫）能自己控制扫描时机。清单读不出来的目录**仍然算在场**
 * （`version: null, peers: {}`）——否则"包在但清单坏了"会被 peer 回填当成缺失，一路重复
 * 安装同一个包而死循环。
 *
 * @param {string} root - 树根。
 * @param {object} [io]
 * @param {{maxDepth?: number, index?: Map<string,string>}} [options]
 * @returns {Array<{name: string, dir: string, version: string|null, peers: Record<string,string>, optional: Set<string>}>}
 */
export function scanScopedPackages(root, io = defaultIo, options = {}) {
  const index = options.index ?? indexScopedDirs(root, io, { maxDepth: options.maxDepth ?? 4 });
  const out = [];
  for (const [name, dir] of index) {
    const manifest = join(dir, 'package.json');
    let parsed = null;
    if (io.exists(manifest)) {
      try { parsed = io.readJson(manifest); } catch { parsed = null; }
    }
    const meta = parsed?.peerDependenciesMeta ?? {};
    out.push({
      name,
      dir,
      version: typeof parsed?.version === 'string' ? parsed.version : null,
      peers: parsed?.peerDependencies ?? {},
      optional: new Set(Object.keys(meta).filter((k) => meta[k]?.optional === true)),
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 规划 peer 回填：树里被声明成 peer、但**树里没有**的 `@deepseek-ai/*` 包。
 *
 * 取舍：
 *  - `peerDependenciesMeta.optional === true` 的**跳过**——上游真有 26 条是 optional
 *    （实测 0.1.5-rc.1 树），补它们等于给树塞进该代次本来不需要的东西。
 *  - `@deepseek-ai/dsh*` 一律 **pin 到请求代次**（`published()` 说该代次有发布时）；
 *    其余（`cordis` / `cosmokit` / `schemastery` 各有自己的次版本线）按声明的范围装。
 *    这一条与 `pinAllDrifted()` 的边界一致：跟着内核版本改 cordis 会 `ERR_PNPM_NO_MATCHING_VERSION`。
 *  - 同一依赖被多个包声明时只出一条 spec。
 *
 * @param {ReturnType<typeof scanScopedPackages>} scanned
 * @param {{version: string, published?: (name: string, version: string) => boolean}} options
 * @returns {{specs: string[], missing: Array<{dep: string, range: string, from: string}>, skippedOptional: string[]}}
 */
export function planPeerBackfill(scanned, options = {}) {
  const version = options.version ?? '';
  const published = options.published ?? (() => true);
  const present = new Set(scanned.map((entry) => entry.name));
  const byDep = new Map();
  const skippedOptional = new Set();
  for (const entry of scanned) {
    for (const [dep, range] of Object.entries(entry.peers)) {
      if (!dep.startsWith(SCOPE_PREFIX)) continue;
      const short = dep.slice(SCOPE_PREFIX.length);
      if (present.has(short)) continue;
      if (entry.optional.has(dep)) { skippedOptional.add(short); continue; }
      if (!byDep.has(short)) byDep.set(short, { dep, range, from: entry.name });
    }
  }
  const missing = [...byDep.keys()].sort().map((short) => byDep.get(short));
  const specs = missing
    .filter(({ dep }) => !skippedOptional.has(dep.slice(SCOPE_PREFIX.length)))
    .map(({ dep, range }) => {
      const short = dep.slice(SCOPE_PREFIX.length);
      const pin = /^dsh(-|$)/.test(short) && published(short, version);
      return `${dep}@${pin ? version : range}`;
    });
  return { specs, missing, skippedOptional: [...skippedOptional].sort() };
}

/**
 * 包名 → bare specifier。
 *
 * 为什么要吃两种写法：仓里 `KERNEL_SCOPED_PACKAGES` 存的是**全名**（`@deepseek-ai/dsh-agent`），
 * `KEY_PACKAGES` 存的是**短名**（`dsh-agent`）。审计里无脑拼前缀会得到
 * `@deepseek-ai/@deepseek-ai/dsh-agent`，于是每个包都"解析不到"、每次 mount 都判红 ——
 * 真跑一遍 rc.1 树才发现，而假树用例当时喂的是短名，正好没盖住这条。
 */
export function toSpecifier(name) {
  return name.startsWith(SCOPE_PREFIX) ? name : `${SCOPE_PREFIX}${name}`;
}

/** bare specifier → 短名（与 {@link toSpecifier} 成对，用于按目录/清单取名）。 */
export function toShortName(name) {
  return name.startsWith(SCOPE_PREFIX) ? name.slice(SCOPE_PREFIX.length) : name;
}

/**
 * 核对「插件实际解析到的内核模块」就是被测树里那一份、且版本等于宿主 `dsh` 的版本。
 *
 * 为什么这是 mount 结论的前提而不是锦上添花：混装树里插件解析到 rc.3、宿主 `dsh` 是 rc.1，
 * mount「全绿」证明的是 rc.3 的组件 + 插件，跟"rc.1 这一代支持"不是一回事。以前这条只在
 * 插件自己的启动告警里（`kernel-identity.ts`，只 warn 不判红），而那条告警在汇总里被折成
 * 一行「另有 N 个包不同源」——**GREEN 里带着双实例**就是这么溜过去的。
 *
 * @param {object} input
 * @param {string} input.copyDir - 插件实体副本目录（解析根）。
 * @param {string} input.treeRoot - 被测内核树根。
 * @param {string} input.runtime - 宿主 `dsh` 的版本号（比较基准）。
 * @param {readonly string[]} input.packages - 要核对的包，全名或短名都接受。
 * @param {object} [io]
 * @returns {{ok: boolean, checked: number, offenders: Array<{name: string, reason: string, version?: string, path?: string, dir?: string}>}}
 */
export function auditPluginSources(input, io = defaultIo) {
  const treeReal = io.realpath(input.treeRoot);
  const packages = input.packages ?? [];
  const offenders = [];
  for (const entry of packages) {
    const specifier = toSpecifier(entry);
    const name = toShortName(entry);
    let path;
    try {
      path = io.resolve(specifier, input.copyDir);
    } catch (error) {
      offenders.push({ name, reason: `插件解析根解析不到 ${specifier}（${error instanceof Error ? error.message.split('\n')[0] : String(error)}）` });
      continue;
    }
    const info = packageOfEntry(path, io);
    if (info === null) {
      offenders.push({ name, reason: `解析到 ${path}，但向上 12 层没有读到 package.json`, path });
      continue;
    }
    const dirReal = io.realpath(info.dir);
    if (!(dirReal === treeReal || dirReal.startsWith(`${treeReal}/`))) {
      offenders.push({
        name,
        reason: `解析到被测树之外：${dirReal}（宿主树 ${treeReal}）—— 这一代次没被测到，测的是别处那份内核`,
        version: info.version,
        dir: dirReal,
      });
      continue;
    }
    if (info.version !== input.runtime) {
      offenders.push({
        name,
        reason: `插件解析到 ${info.version}，宿主 dsh 是 ${input.runtime}（${dirReal}）`,
        version: info.version,
        dir: dirReal,
      });
    }
  }
  return { ok: offenders.length === 0, checked: packages.length, offenders };
}
