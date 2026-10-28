/**
 * 本地绝对路径 → 媒体 URL：**本插件自己的实现**，不探测宿主。
 *
 * ## 这里为什么不再有「跨代兼容层」
 *
 * 本文件原名 `@deepseek-ai/dsh-util-workspace-path` 的跨代兼容层（issue #95 方案 B），并声称
 * 「新代次走宿主实现、宿主将来收紧规则我们自动跟上」。那句话在产品里从不成立：
 *
 * 1. 该包**在全部 8 个代次都无法被宿主解析**：没有 `lib/client.js`、`package.json` 无 `dsh`
 *    字段 ⇒ 永远不是 graph row；也不在 shell 的 seed 词表里（seed 只有 react / react-dom /
 *    cordis / zod / react-virtual / dsh-client-store / ui-slots / ui-primitives / ui-dockkit）；
 *    `__ModuleLoader__.load` 注册的 id（0.1.2 计 47 个、0.2.1-rc.4 计 80 个）里也没有它。
 *    `dsh.client.inject` 对查不到 row 的项是**静默跳过**，不会替它注册。
 * 2. 因此「加进 client external」不是老代次才炸，而是**每一代都炸**：宿主 require 的三条路
 *    （seed / loadCache / factories）全落空即抛 `client-modules: require("…") missed the
 *    module table`，且该 require 落在产物顶部、factory 求值期 ⇒ 插件 client 整条不渲染。
 *    上游自己也是把它内联进各宿主 bundle（命中 6~11 个），不是运行时解析。
 * 3. 所以原先那份 `import * as workspacePath` 的真实效果是：esbuild 把 **devDependencies
 *    钉住的那一份**内联进我们的产物（`lib/client.js` 里留着它的 inlined-from 标记与绝对路径），
 *    `pick('fileMediaUrl')` 读的是这份构建期副本、恒为「有」⇒ `hostFileMediaUrl !== undefined`
 *    恒真 ⇒ 下面的 fallback 分支与 `hasHostFileMediaUrl` 在产品里**永不可达**。我们跟着的从来
 *    不是运行中的宿主，而是一个被冻进发布产物的版本。
 *
 * ## 现在为什么敢只用自己这份
 *
 * 动手前跑过差分：宿主那份（0.2.1-rc.2）与 `src/media-url.ts` 的实现，在 42 组
 * `(base, path)` 上**逐位一致**——覆盖 `http://` / `https://` / `dsh-app://app/` / `file://`
 * 四类基址，以及空格、`%` 编码、相对路径、盘符、UNC 样式等路径形态。所以这次切换不是「换个
 * 算法」，是拆掉一条永远走不到的探测。
 *
 * ## 代价（如实写明）
 *
 * 不再有「宿主收紧规则我们自动跟上」这回事。宿主将来改变合法路径判定时，需要**手工**同步
 * `src/media-url.ts`。这条职责原先被那句假承诺掩盖，现在是显式的。
 *
 * 契约与 `src/media-url.ts` 的行为测试同源：base 必须是 `http(s):` 或 `dsh-app://`；path 必须
 * 绝对（POSIX `/…` 或 `X:/…`）；UNC 起点 `//`、`\\` 与控制字符一律 `undefined`；合法则返回
 * `<base>api/file?path=<encodeURIComponent(path)>`。
 * @module dsh-later/client/workspace-path-compat
 */
import { fileMediaUrlFallback } from '../media-url.js';

/**
 * 本地绝对路径 → 媒体 URL。
 *
 * @param base - 通常传 `document.baseURI`（在**调用时**读：客户端 bundle 可能在文档定稿前求值，
 *   且桌面载体走 `dsh-app://app/` 基址 —— 两种形态由本函数判别）。
 * @param path - 本地绝对路径。
 * @returns 媒体 URL；非法基址或路径返回 `undefined`，调用方据此降级（不渲染图片）。
 */
export function fileMediaUrlCompat(base: string, path: string): string | undefined {
  return fileMediaUrlFallback(base, path);
}

/**
 * 实现住在 `src/media-url.ts`，这里只转发。
 *
 * 为什么不在本文件里写：客户端模块会被 bundle 进 `lib/client.js`，`tests/` 只能对着源码文本
 * 断言、跑不了行为；放在宿主侧既能共用，又能被 `lib/media-url.js` 直接测——现在它是**唯一**
 * 实现，那几条行为测试也从「装饰」变成了真正的守护。
 */
export { fileMediaUrlFallback } from '../media-url.js';
