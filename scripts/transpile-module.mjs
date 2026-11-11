/**
 * 把 `src/` 里的 TypeScript 模块**即时**转成 ESM，交给 `tests/` 直接 import。
 *
 * ## 为什么需要它
 *
 * 有 10 个模块没有可被测试 `import '../lib/x.js'` 的产物：
 *
 *  - 9 个只被客户端用的模块（`src/client/presence.ts` 等）。它们由
 *    `tsconfig.client.json` 编译，而那个项目是 `"noEmit": true`，`tsconfig.json` 又
 *    `exclude` 了 `src/client`——所以它们**没有任何项目 emit**，`lib/` 下没有对应文件。
 *  - `src/upstream-shims.ts`：全是 `type` / `interface`，emit 出来只有 `export {};`，
 *    没有任何可 import 的运行时导出。
 *
 * ## 为什么不「让 client 也 emit 一份」
 *
 * 那 9 个文件的唯一消费者就是测试本身：host 从不 import 它们，浏览器端用的是 esbuild
 * 从**同一份源码**内联进 `lib/client.js` 的那一份。为了让测试继续读 `lib/` 而专门 emit
 * 一份没人用的产物，是拿构建复杂度换回一坨本该删掉的文件。
 *
 * ## 为什么不直接 `import '../src/x.ts'`
 *
 * CI 跑在 `container: node:22`，node22 不做 type stripping，`import` 一个 `.ts` 直接红。
 * 本机 node24 能跑只是假绿，不能当依据。
 *
 * ## 做法
 *
 * 用本仓已装的 `esbuild`（`devDependencies` 里的，`build.mjs` 的出活全靠它）把单个文件
 * 转成 ESM 文本，包成 `data:text/javascript;base64,…` URL。同一路径的转换结果按绝对路径
 * 缓存：`data:` URL 每次构造都是新的模块身份，不缓存会让跨文件的 `===` 断言失效。
 *
 * 测试要的是**源码**的行为，不是滞后产物——与 `tests/error-code-superset.test.mjs` 读
 * `src/` 的既有口径一致。产物可能落后于源码（本仓集成时由 Lead 统一重建），拿滞后产物做
 * 行为断言，会在最该报警的时候静默通过。
 *
 * esbuild 缺失时**不静默通过**：`loadTranspiled` 抛错，由调用方决定 skip 还是判红。
 * 转不动就是转不动，不能当成「测试通过」。
 *
 * 用法：
 *
 *     import { loadTranspiled } from '../scripts/transpile-module.mjs';
 *     const { classifyAttachmentFailure } = await loadTranspiled('src/client/attachment-failure.ts');
 *
 * @module dsh-later/scripts/transpile-module
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本文件所在仓库根（绝对路径）。 */
export const REPO_ROOT = resolvePath(fileURLToPath(new URL('..', import.meta.url)));

/** esbuild 模块的一次性句柄。 */
let esbuildModule;

/** 绝对源码路径 → `data:` URL 的缓存（同一路径结果稳定，模块身份稳定）。 */
const urlCache = new Map();

/**
 * 动态加载本仓的 esbuild（按仓库根解析，不受调用方 cwd 影响）。
 * @returns esbuild 模块。
 * @throws 未安装时给出可读的错误——不返回空壳冒充成功。
 */
export async function importEsbuild() {
  if (esbuildModule !== undefined) return esbuildModule;
  try {
    esbuildModule = await import(import.meta.resolve('esbuild'));
  } catch (error) {
    throw new Error(
      `transpile-module: 读不到 esbuild（${error instanceof Error ? error.message : String(error)}）。` +
        '它是 devDependencies 里的依赖，先 `pnpm install`。不要把这个错误当成测试通过。',
    );
  }
  return esbuildModule;
}

/**
 * 判断本环境能否转译。测试用它决定 skip 还是照常跑。
 * @returns esbuild 可用时返回 true。
 */
export async function canTranspile() {
  try {
    await importEsbuild();
    return true;
  } catch {
    return false;
  }
}

/**
 * 把单个 TS/TSX 文件转成可直接 `import()` 的 URL。
 * @param relPath 相对仓库根的路径，例如 `src/client/presence.ts`。
 * @returns `data:text/javascript;base64,…` URL（同一路径结果稳定）。
 * @throws 当 esbuild 不可用或文件转不出来时。
 */
export async function transpileToDataUrl(relPath) {
  const abs = resolvePath(REPO_ROOT, relPath);
  const hit = urlCache.get(abs);
  if (hit !== undefined) return hit;

  const esbuild = await importEsbuild();
  const source = readFileSync(abs, 'utf8');
  const { code } = esbuild.transformSync(source, {
    loader: relPath.endsWith('.tsx') ? 'tsx' : 'ts',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    sourcefile: abs,
    logLevel: 'silent',
  });
  const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  urlCache.set(abs, url);
  return url;
}

/**
 * 转译并 `import()` 一个源码模块。
 *
 * 只做**单文件**转译：模块内部的相对 import 会按 `data:` URL 的规则解析，因此本函数
 * 适用于**没有相对依赖**的叶子模块（本文件服务的 10 个模块都是）。有相对依赖的模块
 * 请搭 `transpileTree`。
 *
 * @param relPath 相对仓库根的路径，例如 `src/client/schedule-facet.ts`。
 * @returns 该模块的命名空间对象。
 * @throws 当 esbuild 不可用或模块转不出来时。
 */
export async function loadTranspiled(relPath) {
  return import(await transpileToDataUrl(relPath));
}

/**
 * 转译一棵**互相 import 的**源码模块并加载根模块。
 *
 * 相对依赖的处理：把每个文件转成 ESM 后，把其中指向同目录/上级的 `./x.js` / `../x.js`
 * 说明符改写成对应源码文件（`.ts`）的 `data:` URL，再让根模块 import 这棵树。这条路径
 * 仅供 `presence → schedule-summary → schedule-facet` 这类闭合子图使用。
 *
 * @param relPath 根模块，相对仓库根。
 * @returns 根模块的命名空间对象。
 * @throws esbuild 不可用、或说明符解析不到源码文件时。
 */
export async function loadTranspiledTree(relPath) {
  const esbuild = await importEsbuild();
  const { dirname, resolve } = await import('node:path');

  /** 源码绝对路径 → 已转译的 ESM 文本。 */
  const translated = new Map();

  /**
   * 转译一个文件，并把它的相对说明符接到源码文件的 data URL 上。
   * @param abs 源文件绝对路径。
   * @returns 该文件的 ESM 文本。
   */
  const translate = (abs) => {
    const hitUrl = urlCache.get(abs);
    if (hitUrl !== undefined) return hitUrl;
    if (translated.has(abs)) return translated.get(abs);

    // 先放占位，避免环状依赖无限递归
    translated.set(abs, '');
    const source = readFileSync(abs, 'utf8');
    const { code } = esbuild.transformSync(source, {
      loader: abs.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      target: 'es2022',
      jsx: 'automatic',
      sourcefile: abs,
      logLevel: 'silent',
    });

    const patched = code.replace(
      /(\bfrom\s*)['"](\.{1,2}\/[^'"]+)['"]|(\bimport\s*)['"](\.{1,2}\/[^'"]+)['"]/g,
      (whole, fromKw, fromSpec, importKw, importSpec) => {
        const spec = fromSpec ?? importSpec;
        const kw = fromKw ?? importKw;
        const target = resolve(dirname(abs), spec);
        const srcTarget = target.endsWith('.js') ? `${target.slice(0, -3)}.ts` : target;
        const inner = translate(srcTarget);
        return `${kw}'${inner}'`;
      },
    );

    const url = `data:text/javascript;base64,${Buffer.from(patched, 'utf8').toString('base64')}`;
    translated.set(abs, url);
    urlCache.set(abs, url);
    return url;
  };

  return import(translate(resolvePath(REPO_ROOT, relPath)));
}
