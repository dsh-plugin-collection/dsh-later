import { readKernelVersion, versionAtLeast } from './upstream-compat.js';
/**
 * 宿主从这一代起认 file 块（`ContentBlockMap` 有 `'file'` 键、`dsh-llm` 导出 `FileBlock`）。
 *
 * 实测两棵树：`0.1.2-rc.1` 无（`ContentBlock` 里没有 file 变体），`0.1.5-rc.1` 有。
 */
export const FILE_BLOCK_SINCE = '0.1.5-rc.1';
/** file 块降级成文本时的前缀；保留文件名，用户能看出这里原本是个附件。 */
export const FILE_ATTACHMENT_PREFIX = '[附件]';
/** 判定缓存：本进程内内核版本不会变，而每次代发都要用这个结论。 */
let supportedCache;
/** 降级警告只刷一次（每次都刷会淹掉真问题，同 `schedule-compat.ts` 的克制法）。 */
let warnedFallback = false;
/** 清掉判定缓存与「已警告」状态。只给测试用——生产路径上缓存就该活到进程结束。 */
export function resetFileBlockSupport() {
    supportedCache = undefined;
    warnedFallback = false;
}
/**
 * 当前内核是否认 file 内容块。
 *
 * @param options 可注入面（测试用）
 * @returns `true` = 原样透传 file 块；`false` = 必须降级成文本块
 */
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
    // 读不到版本（或版本号读不懂）：保守按「不支持」处理，让内容以文本活下来。
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
/**
 * 降级文案里的文件名：正常情况就是 `attachment.name`；sidecar 被改坏或旧版本只写了
 * 少数字段时，退回一个不会误导的占位词（而不是让 `undefined` 出现在用户气泡里）。
 */
function fileNameOf(attachment) {
    const name = attachment.name;
    return typeof name === 'string' && name.length > 0 ? name : '未命名附件';
}
/**
 * 就地把附件块追加进 `content`。
 *
 * 图片块直接透传；file 块按内核能力决定「透传」还是「降级成文本块」。
 *
 * @param content 目标 content 数组（就地追加）
 * @param blocks 已收窄的附件块（sidecar 读路径做过块级校验）
 * @param options 能力探测的可注入面（生产不传；测试用它伪造内核版本）
 */
export function appendAttachmentBlocks(content, blocks, options = {}) {
    for (const block of blocks) {
        // 图片块两代都认：不需要任何转换，也不需要断言。
        if (block.type === 'image') {
            content.push(block);
            continue;
        }
        if (kernelSupportsFileBlocks(options)) {
            // 全文件里**唯一**一处类型断言，且只在新内核这条分支上执行：`ContentBlock` 的
            // file 变体在 0.1.2 里不存在（那里 `HostFileBlock` = `never`），只有到支持它的
            // 代次才谈得上「宿主认这个块」。断言指向宿主**自己的**类型而不是 `any`：
            // 块是宿主准入时交给我们的对象（本插件只存储/透传），形状由宿主定义。
            content.push(block);
            continue;
        }
        // sidecar 是不可信输入（见 `sanitizeAttachments`：只保证 `attachmentId` 是字符串），
        // 所以文件名要按「可能缺失/为空」渲染，别让用户在代发消息里看到 `undefined`。
        content.push({ type: 'text', text: `${FILE_ATTACHMENT_PREFIX} ${fileNameOf(block.attachment)}` });
    }
}
/**
 * 一条文本块 + 附件块 → 可直接交给 `createUserMessage({ content })` 的 content。
 *
 * @param lead 正文块
 * @param blocks 已收窄的附件块
 * @param options 能力探测的可注入面（同 {@link appendAttachmentBlocks}）
 * @returns 新的 content 数组
 */
export function contentWithAttachmentBlocks(lead, blocks, options = {}) {
    const content = [lead];
    appendAttachmentBlocks(content, blocks, options);
    return content;
}
