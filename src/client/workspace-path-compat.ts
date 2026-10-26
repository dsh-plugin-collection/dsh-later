/**
 * `@deepseek-ai/dsh-util-workspace-path` 的跨代兼容层（issue #95 方案 B）。
 *
 * 只为一件事存在：`fileMediaUrl`（本地绝对路径 → 媒体 URL）在 **0.1.5 / 0.1.2 的
 * 那个包里没有导出**，而 0.1.7+ 有。本插件 `src/client/index.tsx` 需要它来把附件路径
 * 变成可渲染的图片地址。
 *
 * ## 为什么能本地实现
 *
 * 它是**纯字符串函数**：没有服务、没有插槽身份，也不会因模块实例不同而漂移主题
 * （上游自己的 client bundle 同样把它内联进 bundle）。所以老代次上按它公开的契约做一份
 * 等价实现是安全的 —— 契约（取自当前代实现与它会返回 `undefined` 的分支）：
 *
 * 1. `base` 必须是 `http(s):` 或 `dsh-app://app/`，否则返回 `undefined`；
 * 2. `path` 必须是绝对路径（POSIX `/…` 或 Windows `X:/…`、`\\…`），否则 `undefined`；
 * 3. `path` 以 UNC 起点 `//`、`\\` 开头 → `undefined`（避免被当成网络路径）；
 * 4. `path` 含控制字符（`\u0000-\u001f`、`\u007f`）→ `undefined`；
 * 5. 合法则返回 `<base>api/file?path=<encodeURIComponent(path)>` 的绝对 URL。
 *
 * 新代次**仍然走宿主实现**（`pickFileMediaUrl()` 优先），所以宿主将来收紧规则时我们自动跟上；
 * 这份副本只服务于不会再变化的老代次，因此不会持续漂移。
 * @module dsh-later/client/workspace-path-compat
 */
import * as workspacePath from '@deepseek-ai/dsh-util-workspace-path';
import { fileMediaUrlFallback } from '../media-url.js';

/**
 * 读取一个**可能不存在**的导出。
 *
 * 与 `primitives-compat.ts` 的 `pick()` 同一个理由：ESM 具名 import 在目标导出缺失时是
 * **链接期硬失败**（`SyntaxError: does not provide an export named …`），会让插件在旧代次
 * 宿主上直接加载不了；老代次的这个包没有 `fileMediaUrl`，所以只能走 namespace + 属性访问。
 */
function pick<T>(name: string): T | undefined {
  return (workspacePath as unknown as Record<string, unknown>)[name] as T | undefined;
}

/** 宿主提供的 `fileMediaUrl`；老代次为 undefined。 */
const hostFileMediaUrl = pick<(base: string, path: string) => string | undefined>('fileMediaUrl');

/** 是否由宿主提供（诊断/测试用：老代次应为 false）。 */
export const hasHostFileMediaUrl = hostFileMediaUrl !== undefined;

/**
 * 本地绝对路径 → 媒体 URL。
 *
 * @param base - 通常传 `document.baseURI`（在**调用时**读：客户端 bundle 可能在文档定稿前求值，
 *   且桌面载体走 `dsh-app://app/` 基址 —— 两种形态由本函数判别）。
 * @param path - 本地绝对路径。
 * @returns 媒体 URL；非法基址或路径返回 `undefined`，调用方据此降级（不渲染图片）。
 */
export function fileMediaUrlCompat(base: string, path: string): string | undefined {
  if (hostFileMediaUrl !== undefined) return hostFileMediaUrl(base, path);
  return fileMediaUrlFallback(base, path);
}

/**
 * 兜底实现从 `src/media-url.ts` 来（纯字符串、可被 tests 直接测）。
 *
 * 为什么不在本文件里写：客户端模块会被 bundle 进 `lib/client.js`，`tests/` 只能对着
 * 源码文本断言，跑不了行为；而这段逻辑恰恰是"只有老代次才跑"的分支，最需要行为测试。
 * 放在宿主侧既能共用，又能被 `lib/media-url.js` 直接测。
 */
export { fileMediaUrlFallback } from '../media-url.js';
