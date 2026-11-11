import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { KernelVersion } from './upstream-compat.js';
import type { ScheduledAttachment } from './ownership-store.js';
export declare const FILE_BLOCK_SINCE = "0.1.5-rc.1";
export declare const FILE_ATTACHMENT_PREFIX = "[\u9644\u4EF6]";
export interface FileBlockProbeOptions {
    readKernel?: () => KernelVersion | undefined;
    warn?: (message: string) => void;
}
export declare function resetFileBlockSupport(): void;
export declare function kernelSupportsFileBlocks(options?: FileBlockProbeOptions): boolean;
export declare function appendAttachmentBlocks(content: ContentBlock[], blocks: readonly ScheduledAttachment[], options?: FileBlockProbeOptions): void;
export declare function contentWithAttachmentBlocks(lead: ContentBlock, blocks: readonly ScheduledAttachment[], options?: FileBlockProbeOptions): ContentBlock[];
