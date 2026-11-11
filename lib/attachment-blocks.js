import { readKernelVersion, versionAtLeast } from './upstream-compat.js';
export const FILE_BLOCK_SINCE = '0.1.5-rc.1';
export const FILE_ATTACHMENT_PREFIX = '[附件]';
let supportedCache;
let warnedFallback = false;
export function resetFileBlockSupport() {
    supportedCache = undefined;
    warnedFallback = false;
}
export function kernelSupportsFileBlocks(options = {}) {
    if (supportedCache !== undefined)
        return supportedCache;
    const readKernel = options.readKernel ?? readKernelVersion;
    const kernel = readKernel();
    if (kernel !== undefined) {
        const supported = versionAtLeast(kernel.version, FILE_BLOCK_SINCE);
        if (supported !== undefined) {
            supportedCache = supported;
            return supported;
        }
    }
    if (!warnedFallback) {
        warnedFallback = true;
        const warn = options.warn ?? ((message) => console.warn(message));
        warn('dsh-later: 读不到内核版本，附件拼接按「不认 file 块」保守降级（文件会渲染成 '
            + `"${FILE_ATTACHMENT_PREFIX} <文件名>" 文本）。在 ≥${FILE_BLOCK_SINCE} 的内核上这会`
            + '让本该原样发出的文件变成文本。排查：确认插件的解析根能解析到 @deepseek-ai/dsh '
            + '或 dsh-schedule 的 package.json。');
    }
    supportedCache = false;
    return false;
}
function fileNameOf(attachment) {
    const name = attachment.name;
    return typeof name === 'string' && name.length > 0 ? name : '未命名附件';
}
export function appendAttachmentBlocks(content, blocks, options = {}) {
    for (const block of blocks) {
        if (block.type === 'image') {
            content.push(block);
            continue;
        }
        if (kernelSupportsFileBlocks(options)) {
            content.push(block);
            continue;
        }
        content.push({ type: 'text', text: `${FILE_ATTACHMENT_PREFIX} ${fileNameOf(block.attachment)}` });
    }
}
export function contentWithAttachmentBlocks(lead, blocks, options = {}) {
    const content = [lead];
    appendAttachmentBlocks(content, blocks, options);
    return content;
}
