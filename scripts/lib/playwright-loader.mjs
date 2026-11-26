/**
 * playwright 的统一加载器（issue #208 卫生第 4 条）。
 *
 * ## 为什么必须有这一处
 *
 * playwright **不是**本仓的依赖（`package.json` 里没有它，CI 也不装）：采集件只在
 * 「有窗口的机器、手工复核」时跑，运行时零依赖是既有约定。于是每个采集脚本各自
 * 写一遍「先试裸包名、再用 `PLAYWRIGHT_MODULE` 指一份现成的、都不通就报错」：
 *
 *  - `scripts/seam-check/capture-demo.mjs`
 *  - `scripts/seam-check/capture-b3-scenes.mjs`
 *  - `scripts/ui-matrix/capture.mjs`
 *  - `scripts/verify-cold-attribution.mjs`（复用 ui-matrix 那一份）
 *
 * 四份手抄的解析顺序**已经漂了**：`scripts/seam-check/capture.mjs` 那份连
 * `PLAYWRIGHT_MODULE` 兜底都没有，只 `await import('playwright')` —— 在本机
 * （playwright 装在 `@playwright/mcp` 下面）它必然失败，而它在别的机器上「能跑」
 * 只是因为碰巧装了全局包。这类分叉的代价不是多写几行，而是**同一条排障提示在不同
 * 脚本里给出不同结论**，下一个人按 A 脚本的提示修好、跑 B 脚本照样失败。
 *
 * ## 解析顺序（四份合一后唯一的口径）
 *
 *  1. `PLAYWRIGHT_MODULE` 指向的目录（**最优先**）：本机就是靠它指
 *     `@playwright/mcp/node_modules/playwright`。显式给了就**只认它**——指错了立刻报错，
 *     不许悄悄退回裸解析。理由：`require('playwright')` 会从那个目录**向上**走
 *     node_modules 链，指到一个兄弟目录时可能解析到**另一份** playwright（实测：在
 *     `/tmp` 下指一个假包，向上撞到 `/tmp/node_modules/playwright` 真包），于是
 *     「我明明指了 A」与「实际跑的是 B」两件事都不可见。现在用 `require(包目录绝对路径)`
 *     直接锁定那一份。
 *  2. 裸包名 `playwright`：`PLAYWRIGHT_MODULE` 没给时走这条（`npm i -D playwright` 的
 *     常规路径）。
 *  3. 两条都不通 → 统一提示（下面 {@link PLAYWRIGHT_HINT}），**由调用方决定退出**。
 *
 * 这里**不**自己 `process.exit()`：四个调用方里三个是 CLI（该退 1），但
 * `ui-matrix/capture.mjs` 的 `loadPlaywright` 是被 `run.mjs` 与
 * `verify-cold-attribution.mjs` import 的模块函数，替它退出会把这个库变成
 * 「只能当脚本用」。所以抛 {@link PlaywrightNotInstalledError}，CLI 在自己那层转成退出码。
 *
 * ## 为什么要新增这条结构断言
 *
 * `tests/ui-matrix-harness.test.mjs` 里加了一条「这几个 .mjs 不得再出现
 * `process.env.PLAYWRIGHT_MODULE` 字面量」的断言：环境变量的读取只允许发生在本模块，
 * 这样「解析顺序」这类口径只有一处可改。`scripts/capture/capture-all.cjs` 是 CJS、
 * 且在文件头把路径写死成某台机器的绝对路径（那份是「一次性脚本」，不在这条断言的面内，
 * 见该文件头的说明）。
 *
 * @module scripts/lib/playwright-loader
 */
import { createRequire } from 'node:module';

/** 环境变量名。**只在本模块里出现**（结构断言以此为界）。 */
const MODULE_ENV = 'PLAYWRIGHT_MODULE';

/**
 * 统一提示：三条都不通时给的话。
 *
 * 写成常量而不是就地拼字符串，是为了让「提示只在一处」这件事可测（`tests` 里断言
 * 四个脚本都引它，而不是各写一份文案）。
 */
export const PLAYWRIGHT_HINT =
  '✗ 找不到 playwright。二选一：\n' +
  '  1) 装一份：npm i -D playwright && npx playwright install chromium\n' +
  `  2) 指一份现成的：${MODULE_ENV}=/绝对路径/playwright <脚本名>\n` +
  '（playwright 不是本仓依赖：采集件只服务于手工复核，不参与 CI，运行时保持零依赖。）';

/** 装不上时抛的错误类型（CLI 用 `instanceof` 区分「环境没配」与「脚本真出错」）。 */
export class PlaywrightNotInstalledError extends Error {
  /**
   * @param {string} [scriptName] - 调用方脚本名，进提示里让人知道该改哪条命令。
   * @param {string} [detail] - 两条解析路径各自的失败原因（排障时先看这个）。
   */
  constructor(scriptName = 'node scripts/…', detail = '') {
    super(`${PLAYWRIGHT_HINT.replace('<脚本名>', scriptName)}${detail === '' ? '' : `\n（解析失败原因：${detail}）`}`);
    this.name = 'PlaywrightNotInstalledError';
  }
}

/**
 * 加载 playwright 模块本体（返回整个模块，不是 `chromium`）。
 *
 * 返回整个模块而不是只给 `chromium`：`verify-cold-attribution.mjs` 与
 * `ui-matrix/run.mjs` 只需要 `chromium`，但采集件里还有别处要 `devices`/`errors` 的
 * 可能性；交出模块本身，调用方各自取字段，这个库不必跟着增删导出面。
 *
 * @param {object} [options]
 * @param {string} [options.envValue] - `PLAYWRIGHT_MODULE` 的值（已读出来的），默认读 `process.env`。
 * @param {string} [options.scriptName] - 出错提示里用的脚本名（相对仓库根）。
 * @returns {Promise<any>} playwright 模块。
 * @throws {PlaywrightNotInstalledError} 两条解析路径都不通时。
 */
export async function loadPlaywrightModule(options = {}) {
  const scriptName = options.scriptName ?? 'node scripts/…';
  const envValue = options.envValue ?? process.env[MODULE_ENV];

  // ① 显式指认：**只认这一份**（见文件头第 1 条）。直接 require 包目录的绝对路径，
  //    不走 `require('playwright')` 的向上查找 —— 那条链会悄悄换成另一份。
  //    （`createRequire` 只是为了让同步 `require` 在这个 ESM 文件里可用。）
  if (typeof envValue === 'string' && envValue.trim().length > 0) {
    const dir = envValue.trim().replace(/\/+$/, '');
    try {
      const require = createRequire(import.meta.url);
      return require(dir);
    } catch (error) {
      throw new PlaywrightNotInstalledError(
        scriptName,
        `${MODULE_ENV}=${dir} 加载失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ② 裸包名 `import` 按**本文件**所在目录解析，不从 cwd 出发 ——
  //    后者在 `cd docs && node ../scripts/…` 时会假阴。
  try {
    // eslint-disable-next-line import/no-unresolved
    return await import('playwright');
  } catch (error) {
    throw new PlaywrightNotInstalledError(
      scriptName,
      `裸包名解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 只要 `chromium` 的便捷入口（三个采集脚本的常见需求）。
 *
 * @param {object} [options] - 同 {@link loadPlaywrightModule}。
 * @returns {Promise<any>} `chromium`。
 * @throws {PlaywrightNotInstalledError} 两条解析路径都不通时。
 */
export async function loadChromium(options = {}) {
  const module = await loadPlaywrightModule(options);
  return module.chromium;
}
