/**
 * 附件块 → 消息 content 的**能力自适应**拼接。
 *
 * 为什么需要这一层（issue #95 的「旧内核没有该能力」那一类，与命名差异是两回事）：
 * `@deepseek-ai/dsh-llm` 的 `ContentBlockMap` 直到 **0.1.5-rc.1** 才有 `'file'` 键，
 * 0.1.2-rc.1 的 `ContentBlock` 联合里**根本没有 `type:'file'` 变体**。把这代宿主不认的
 * 块塞进 `createUserMessage({ content })`，结果只有两种，且都是坏结果：
 *   · 被宿主的消息校验直接拒（用户到点什么也收不到）；
 *   · 或在请求装配期被静默丢弃（只认已知变体 → 用户收到一条「没有附件」的消息，无报错）。
 * 两条都属于「静默丢失」，这正是 issue #95 要根治的那类错。所以这一代**只能降级**：
 *
 *   · 内核认 file 块（≥ {@link FILE_BLOCK_SINCE}）→ **原样透传**，行为与今天逐字一致；
 *   · 内核不认（0.1.2-rc.1）→ file 块降级成一条**文本块** `[附件] <name>`：
 *     内容不丢、消息仍能发出，且用户能看出这里原本有个附件；
 *   · **图片块两代都认**（`ImageBlock` 自 0.1.2 起就在）→ 永远原样透传，不降级。
 *
 * 判定用**版本号**而不是符号探测：能力本身是随版本落地的因果（0.1.2 的 `dsh-llm`
 * 没有 `FileBlock` 导出，正是它没有 file 变体的表现），而符号探测只在符号改名时才「有用」
 * ——那正是 issue #75 踩过的坑。所以这里复用 `upstream-compat.ts` 的
 * `readKernelVersion()` + `versionAtLeast()`，与 `schedule-compat.ts` 同一套判定纪律。
 *
 * 读不到内核版本时**保守降级**（按不支持处理）并警告一次：降级的代价是「文件变成一行
 * 文本」，硬塞的代价是「附件静默消失」，宁可选前者。
 *
 * @module dsh-later/attachment-blocks
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { KernelVersion } from './upstream-compat.js';
import type { ScheduledAttachment } from './ownership-store.js';
/**
 * 宿主从这一代起认 file 块（`ContentBlockMap` 有 `'file'` 键、`dsh-llm` 导出 `FileBlock`）。
 *
 * 实测两棵树：`0.1.2-rc.1` 无（`ContentBlock` 里没有 file 变体），`0.1.5-rc.1` 有。
 */
export declare const FILE_BLOCK_SINCE = "0.1.5-rc.1";
/** file 块降级成文本时的前缀；保留文件名，用户能看出这里原本是个附件。 */
export declare const FILE_ATTACHMENT_PREFIX = "[\u9644\u4EF6]";
/** {@link kernelSupportsFileBlocks} 的可注入面（测试不依赖真实内核安装）。 */
export interface FileBlockProbeOptions {
    /** 读内核版本；默认真去解析宿主包。读不到时返回 `undefined`。 */
    readKernel?: () => KernelVersion | undefined;
    /** 降级警告出口（默认 `console.warn`，每进程一次）。 */
    warn?: (message: string) => void;
}
/** 清掉判定缓存与「已警告」状态。只给测试用——生产路径上缓存就该活到进程结束。 */
export declare function resetFileBlockSupport(): void;
/**
 * 当前内核是否认 file 内容块。
 *
 * @param options 可注入面（测试用）
 * @returns `true` = 原样透传 file 块；`false` = 必须降级成文本块
 */
export declare function kernelSupportsFileBlocks(options?: FileBlockProbeOptions): boolean;
/**
 * 就地把附件块追加进 `content`。
 *
 * 图片块直接透传；file 块按内核能力决定「透传」还是「降级成文本块」。
 *
 * @param content 目标 content 数组（就地追加）
 * @param blocks 已收窄的附件块（sidecar 读路径做过块级校验）
 * @param options 能力探测的可注入面（生产不传；测试用它伪造内核版本）
 */
export declare function appendAttachmentBlocks(content: ContentBlock[], blocks: readonly ScheduledAttachment[], options?: FileBlockProbeOptions): void;
/**
 * 一条文本块 + 附件块 → 可直接交给 `createUserMessage({ content })` 的 content。
 *
 * @param lead 正文块
 * @param blocks 已收窄的附件块
 * @param options 能力探测的可注入面（同 {@link appendAttachmentBlocks}）
 * @returns 新的 content 数组
 */
export declare function contentWithAttachmentBlocks(lead: ContentBlock, blocks: readonly ScheduledAttachment[], options?: FileBlockProbeOptions): ContentBlock[];
