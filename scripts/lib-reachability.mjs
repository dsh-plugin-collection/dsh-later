/**
 * `lib/` 可达性自检：host 产物里每个 `.js` 都必须能从 `lib/index.js` 静态走到。
 *
 * ## 为什么需要它
 *
 * 本仓库把 `lib/` 入库，测试直接 `import '../lib/xxx.js'`。于是 `tsc` 会为
 * `tsconfig.json` 的 `include` 里**每一个**匹配到的源文件各产出一份产物，而宿主
 * 运行时只会加载 `lib/index.js` 及其静态 import 闭包。落在闭包之外的产物有两类：
 *
 *  1. **压根不该编译的**：只被客户端用的模块。它们被 `src/**\/*.ts` 一并收进 host
 *     编译，宿主从不加载，白占发布体积。
 *  2. **本该被用到却断了线的**：某个 host 模块改了导入、或入口漏了一条引用。这类
 *     在门槛上不比第一类更红，但后果重得多——代码进了产物却没人执行。
 *
 * 两类在磁盘上长得一模一样（都是 `lib/xxx.js`），靠肉眼和 code review 分不出来。
 * 这里把判据变成一条可执行的门禁。
 *
 * ## 判据
 *
 * 从 `lib/index.js` 出发做静态 import 图 BFS，解析三种说明符：
 * `from '...'`（import / export ... from / import type）、`import '...'` 副作用导入、
 * 以及 `import('...')` 动态导入的**字符串字面量**形态。三条都在产物里真出现过，
 * 少解析一条就会把可达文件误判成不可达（假红），或把不可达误判成可达（假绿）。
 *
 * 只认相对说明符（`./`、`../`）。`node:` 与包名是外部依赖，不在本文件的判定范围内。
 *
 * 排除项（都在 `DEFAULT_EXCLUDE` 里，理由见常量注释）：`lib/client.js` 是浏览器端
 * esbuild 单文件产物，本来就不由 host 入口加载；`lib/types/**` 是声明文件，不是运行时代码。
 *
 * 另有一条**形状判据**而不是路径判据的例外，见 {@link isEmptyModule}：只含类型声明的
 * 模块（`src/upstream-shims.ts`）编译出来只有 `export {};`，任何 import 都不会指向它。
 * 按内容识别、不按文件名白名单，是为了让这个例外不必再被维护。
 *
 * @module dsh-later/scripts/lib-reachability
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 图遍历的起点（相对 lib 目录）。 */
export const ENTRY = 'index.js';

/**
 * 不参与判定的产物（相对 lib 目录的 posix 路径）。
 *
 * - `client.js`：client 端 esbuild 单文件产物，由浏览器经 `__ModuleLoader__.load`
 *   加载，host 入口从不 import 它。把它算进不可达清单会让门禁恒红。
 * - `types/`：`tsc` 的 `.d.ts` 输出目录，没有运行时代码。
 */
export const DEFAULT_EXCLUDE = ['client.js', 'types/'];

/**
 * 「只有类型声明」的模块编译出来的形态。
 *
 * `tsc` 对只含 `import type` / `export type` / `interface` 的文件产出
 * `export {};`（`verbatimModuleSyntax` 下也不变）。这类文件没有任何可被 import 绑定的
 * 运行时导出，所以不可能出现在静态 import 图里——不是「断线」，是「没有可连的东西」。
 * 允许前面有空白，`removeComments` 开关不影响它。
 */
const REEXPORT_ONLY_JS = /^\s*export\s*\{\s*\}\s*;?\s*$/;


/** 指向字符串字面量的说明符：`from '...'`、`import '...'`、`import('...')`。 */
const SPECIFIER_PATTERNS = [
  // import { a } from './x.js' / export * from './x.js' / import type {...} from './x.js'
  /(?:\bfrom\s*)['"]([^'"]+)['"]/g,
  // import './x.js'（副作用导入）
  /\bimport\s+['"]([^'"]+)['"]/g,
  // import('./x.js')（动态导入的字符串字面量形态）
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * 从一段模块源码里取出全部**静态可判定的**模块说明符。
 *
 * 返回顺序按源码出现顺序，重复项保留（调用方不关心去重，这里不做多余的处理）。
 * 非字符串字面量的动态导入（`import(someVar)`）解析不了，**故意忽略**：本仓库
 * 产物里不存在这种形态，凭空支持它只会让判据看起来比实际更准。
 *
 * @param source 模块源码（`lib/xxx.js` 的内容）。
 * @returns 说明符列表，含 `node:`、包名与相对路径。
 */
export function extractSpecifiers(source) {
  const text = String(source ?? '');
  const found = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/**
 * 判断一个说明符是否指向本包内的相对文件。
 * @param specifier 模块说明符。
 * @returns `./x.js` / `../x.js` 这类相对路径返回 true。
 */
export function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * 在 lib 目录内解析一个相对说明符为「相对 lib 的 posix 路径」。
 *
 * 不做 TypeScript 风格的隐式扩展名补全：`lib/` 是 `tsc` 与 esbuild 的产物，产物里的
 * 相对说明符一律带 `.js`。为一个本仓库不存在的形态增设猜测分支，等于给判据留一条
 * 会猜错的路径。
 *
 * @param fromLibRel 发出该说明符的文件（相对 lib 的 posix 路径）。
 * @param specifier 相对说明符。
 * @returns 目标（相对 lib 的 posix 路径），越出 lib 目录时为 undefined。
 */
export function resolveLibSpecifier(fromLibRel, specifier) {
  // 用一个假的根把「相对路径 + 上跳」整体算出来，再看结果还在不在假根之内。
  // 不能对结果 `slice(1)` 再判断：`/escape.js` 与 `/../escape.js` 归一后都可能是
  // `/escape.js`，那样「越出 lib」会被算成「lib 里有个 escape.js」（假可达）。
  const fakeRoot = '/__lib__';
  const target = resolve(fakeRoot, dirname(fromLibRel), specifier);
  const prefix = `${fakeRoot}/`;
  if (!target.startsWith(prefix) || target === fakeRoot) return undefined;
  return target.slice(prefix.length).split(sep).join('/');
}

/**
 * 判断一份产物是否是「只有类型声明」的空模块（见 {@link REEXPORT_ONLY_JS}）。
 * @param source 模块源码。
 * @returns 只含 `export {};` 时返回 true。
 */
export function isEmptyModule(source) {
  return REEXPORT_ONLY_JS.test(String(source ?? ''));
}

/**
 * 判断一个相对 lib 的路径是否属于排除项。
 * @param libRel 相对 lib 的 posix 路径。
 * @param exclude 排除前缀列表（相对 lib 的 posix 路径）。
 * @returns 命中任一排除项返回 true。
 */
export function isExcluded(libRel, exclude = DEFAULT_EXCLUDE) {
  // 排除项末尾的 `/` 可有可无：`types` 与 `types/` 是同一个意思，不该因为写法差异漏判。
  return exclude.some((prefix) => {
    const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return libRel === normalized || libRel.startsWith(`${normalized}/`);
  });
}

/**
 * 递归列举目录下所有文件的路径（posix 分隔符，相对给定的根）。
 * @param root 绝对路径。
 * @param relDir 当前相对 root 的子目录（根为 ''）。
 * @param acc 收集桶。
 * @returns void
 */
function walkFiles(root, relDir, acc) {
  const dirAbs = relDir === '' ? root : join(root, relDir);
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(root, rel, acc);
    else if (entry.isFile()) acc.push(rel);
  }
}

/**
 * 从一个内存里的文件表算出可达集合、不可达清单与悬空说明符。
 *
 * 纯函数（不碰文件系统），测试可以直接喂一张小表验证 BFS 与解析。
 *
 * @param files `相对 lib 的路径 → 源码` 的映射。
 * @param options.entry 入口文件（相对 lib 的 posix 路径），默认 {@link ENTRY}。
 * @param options.exclude 排除前缀，默认 {@link DEFAULT_EXCLUDE}。
 * @returns `{ reachable, unreachable, typeOnly, dangling, entry }`，`reachable` 与
 *   `unreachable` 已排序；`typeOnly` 是按 {@link isEmptyModule} 放行的空模块清单；
 *   `dangling` 是「相对说明符指向 lib 里不存在的文件」——这类断线的后果是**目标文件
 *   变成孤儿**，光看不可达清单只能看到结果、看不到原因，所以单独列出。
 */
export function findUnreachable(files, options = {}) {
  const entry = options.entry ?? ENTRY;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const reachable = new Set();
  const dangling = [];
  if (!(entry in files)) {
    // 入口不存在时不能返回「全部可达」：那会把「构建没跑过」判成绿。
    return { reachable: [], unreachable: Object.keys(files).sort(), typeOnly: [], dangling: [], entry };
  }
  const queue = [entry];
  reachable.add(entry);
  while (queue.length > 0) {
    const current = queue.pop();
    for (const specifier of extractSpecifiers(files[current])) {
      if (!isRelativeSpecifier(specifier)) continue;
      const target = resolveLibSpecifier(current, specifier);
      if (target === undefined) continue;
      if (!(target in files)) {
        // 相对说明符指向 lib 里没有的文件：构建产物自己断了线。不记下来就只能看到
        // 「某个文件变成孤儿」这个结果，看不到「谁把它弄丢的」这个原因。
        dangling.push(`${current} → ${specifier}`);
        continue;
      }
      if (reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  const candidates = Object.keys(files)
    .filter((libRel) => libRel.endsWith('.js'))
    .filter((libRel) => !isExcluded(libRel, exclude))
    .sort();
  const typeOnly = candidates.filter((libRel) => !reachable.has(libRel) && isEmptyModule(files[libRel]));
  const unreachable = candidates.filter((libRel) => !reachable.has(libRel) && !isEmptyModule(files[libRel]));
  return { reachable: [...reachable].sort(), unreachable, typeOnly, dangling, entry };
}

/**
 * 从磁盘上的 lib 目录读入文件表并算不可达清单。
 * @param libDir lib 目录的绝对路径。
 * @param options 透传给 {@link findUnreachable}。
 * @returns {@link findUnreachable} 的返回值。
 * @throws 当 lib 目录不存在时——「目录不在」不等于「零不可达」。
 */
export function checkLibDirectory(libDir, options = {}) {
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  if (!existsSync(libDir)) {
    throw new Error(`lib 目录不存在：${libDir}。先跑 \`npm run build\`。`);
  }
  const all = [];
  walkFiles(libDir, '', all);
  const files = {};
  for (const libRel of all) {
    if (isExcluded(libRel, exclude)) continue;
    files[libRel] = readFileSync(join(libDir, libRel), 'utf8');
  }
  return findUnreachable(files, { ...options, exclude });
}

/** 本文件所在仓库根的 lib 目录绝对路径。 */
const DEFAULT_LIB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib');

/**
 * CLI：跑一次检查，不可达即非零退出并打印清单。
 * @param argv 不含 node 与脚本名。
 * @returns 退出码：0 全可达；1 有不可达；2 环境问题（lib 不存在）。
 */
export function main(argv = []) {
  const libDirArg = argv[0] !== undefined && !argv[0].startsWith('-') ? resolve(argv[0]) : DEFAULT_LIB_DIR;
  const libLabel = relative(process.cwd(), libDirArg) || libDirArg;
  let report;
  try {
    report = checkLibDirectory(libDirArg);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    console.error('   「lib/ 不存在」不等于「零不可达」，这里按失败处理。');
    return 2;
  }

  if (report.unreachable.length === 0 && report.dangling.length === 0) {
    const typeOnly =
      report.typeOnly.length === 0 ? '' : `；另有 ${report.typeOnly.length} 个纯类型空模块按形状放行`;
    console.log(
      `✓ lib 可达性：${report.reachable.length} 个文件全部可从 ${report.entry} 走到（${libLabel}）${typeOnly}`,
    );
    return 0;
  }

  if (report.unreachable.length > 0) {
    console.error(`❌ lib 可达性：${report.unreachable.length} 个文件从 ${report.entry} 走不到（${libLabel}）`);
    console.error('   宿主只加载 lib/index.js 及其静态 import 闭包，下面这些产物永远不会被执行：');
    for (const libRel of report.unreachable) console.error(`   - ${libRel}`);
    console.error('   两种成因：① 只被客户端用的模块被收进了 host 编译（应移进 src/client/）；');
    console.error('   ② 某个 host 模块的导入断了线（入口漏引用，比体积更重的问题）。');
  }
  if (report.dangling.length > 0) {
    console.error(`❌ lib 可达性：${report.dangling.length} 条相对导入指向 lib 里不存在的文件（${libLabel}）`);
    console.error('   产物自己断线了：被指向的那个模块会变成孤儿，运行时则是 import 失败。');
    for (const item of report.dangling) console.error(`   - ${item}`);
  }
  return 1;
}

// 只在被当作脚本直接运行时执行，import 时保持纯函数（测试要 import 上面几个函数）。
const invoked = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invoked !== undefined && import.meta.url === invoked) {
  process.exitCode = main(process.argv.slice(2));
}
