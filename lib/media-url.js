/**
 * 本地绝对路径 → 媒体 URL 的**纯字符串**实现（跨代兼容用）。
 *
 * 为什么住在 host 侧：它没有任何浏览器依赖（只做 scheme 判断 + URL 拼接），而客户端要用的
 * 那个包（`@deepseek-ai/dsh-util-workspace-path`）在 0.1.5 / 0.1.2 里**没有** `fileMediaUrl`。
 * 放在这里有两个好处：① 客户端 bundle 与宿主共用同一份实现（不必在 client 里复制）；
 * ② 它是纯函数，可以被 `tests/` 直接测（客户端模块被 bundle 进 `lib/client.js`，测不到）。
 *
 * 契约（与宿主 `fileMediaUrl` 一致，取自当前代实现的分支判据）：
 *
 * 1. `base` 必须是 `http(s):` 或 `dsh-app://app/`，否则返回 `undefined`；
 * 2. `path` 必须是绝对路径（POSIX `/…` 或 Windows `X:/…`、`\\…`），否则 `undefined`；
 * 3. `path` 以 UNC 起点 `//`、`\\` 开头 → `undefined`（避免被当成网络路径）；
 * 4. `path` 含控制字符（`\u0000-\u001f`、`\u007f`）→ `undefined`；
 * 5. 合法则返回 `<base>api/file?path=<encodeURIComponent(path)>` 的绝对 URL。
 *
 * 新代次**优先走宿主实现**（见 `src/client/workspace-path-compat.ts`），这份只在宿主缺该导出时启用；
 * 老代次不会再变化，所以这份副本不会持续漂移。
 * @module dsh-later/media-url
 */
/** 路径是否是绝对路径（POSIX 或 Windows 拼写）—— 与宿主 `isAbsoluteWorkspacePath` 同义。 */
export function isAbsoluteWorkspacePath(path) {
    return path.startsWith('/') || /^[A-Za-z]:[/\\]/u.test(path) || path.startsWith('\\\\');
}
/**
 * 本地绝对路径 → 媒体 URL。
 * @param base - 通常传 `document.baseURI`。
 * @param path - 本地绝对路径。
 * @returns 媒体 URL；按上文五条契约判非法时返回 `undefined`（调用方据此降级）。
 */
export function fileMediaUrlFallback(base, path) {
    const okBase = /^https?:/u.test(base) || base.startsWith('dsh-app://app/');
    if (!okBase || !isAbsoluteWorkspacePath(path) || /^[/\\]{2}/u.test(path) || /[\u0000-\u001f\u007f]/u.test(path)) {
        return undefined;
    }
    return new URL(`api/file?path=${encodeURIComponent(path)}`, base).href;
}
