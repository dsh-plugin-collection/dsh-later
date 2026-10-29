/**
 * 本地绝对路径 → 媒体 URL 的**纯字符串**实现（跨代兼容用）。
 *
 * 为什么住在 host 侧：它没有任何浏览器依赖（只做 scheme 判断 + URL 拼接），而宿主那个同名的
 * `fileMediaUrl`（`@deepseek-ai/dsh-util-workspace-path`）**在浏览器里不可解析**——8 个代次都不在
 * 宿主模块表里，外置只会在 factory 求值期抛错。放在这里有两个好处：① 宿主侧与客户端 bundle
 * 共用同一份实现（不必在 client 里复制）；② 它是纯函数，可以被 `tests/` 直接测（客户端模块被
 * bundle 进 `lib/client.js`，测不到）。
 *
 * 契约（与宿主 `fileMediaUrl` 一致，取自当前代实现的分支判据）：
 *
 * 1. `base` 必须是 `http(s):` 或 `dsh-app://app/`，否则返回 `undefined`；
 * 2. `path` 必须是绝对路径（POSIX `/…` 或 Windows `X:/…`、`\\…`），否则 `undefined`；
 * 3. `path` 以 UNC 起点 `//`、`\\` 开头 → `undefined`（避免被当成网络路径）；
 * 4. `path` 含控制字符（`\u0000-\u001f`、`\u007f`）→ `undefined`；
 * 5. 合法则返回 `<base>api/file?path=<encodeURIComponent(path)>` 的绝对 URL。
 *
 * 这份是**唯一**实现，不存在「新代次优先走宿主、缺了才降级」那套（`workspace-path-compat.ts`
 * 里记了为什么）。因此宿主若改变合法路径判定，需要手工同步这里——这条职责以前被那句假承诺
 * 掩盖，现在是显式的。改动前后曾按 42 组 `(base, path)` 与宿主实现差分过，逐位一致。
 * @module dsh-later/media-url
 */
/** 路径是否是绝对路径（POSIX 或 Windows 拼写）—— 与宿主 `isAbsoluteWorkspacePath` 同义。 */
export declare function isAbsoluteWorkspacePath(path: string): boolean;
/**
 * 本地绝对路径 → 媒体 URL。
 * @param base - 通常传 `document.baseURI`。
 * @param path - 本地绝对路径。
 * @returns 媒体 URL；按上文五条契约判非法时返回 `undefined`（调用方据此降级）。
 */
export declare function fileMediaUrlFallback(base: string, path: string): string | undefined;
