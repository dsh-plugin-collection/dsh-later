import { readOwnEvents } from './upstream-compat.js';
/**
 * 投递确认的超时预算。
 *
 * 正常核对在**毫秒级**完成（消息 append 后同一次宏任务内即可读到）；2s 是留给
 * 极端调度延迟的宽裕上限，超时即判「未确认」——宁可让用户看到可重试的提示，
 * 也不要静默当成成功。
 */
export const DELIVERY_CONFIRM_TIMEOUT_MS = 2000;
/** 投递确认轮询间隔（远小于超时预算，保证正常情况一两轮即命中）。 */
const CONFIRM_POLL_INTERVAL_MS = 25;
/**
 * 日志中是否出现该 message id。
 *
 * 判据是消息**真的进了会话日志**。这里刻意不进一步区分「进了 surface」与
 * 「进了实际请求」：`agent.followup` 路径下二者由核心保证一致（消息成为独立一轮
 * 的唯一条消息）；而 `steer` 路径的丢失发生在**插入后同毫秒被 claim 移除**，
 * 那种情况下连 `user/message` 都不会留下，本判据足以识别。
 */
export function hasMessageInLog(session, messageId) {
    try {
        for (const event of readOwnEvents(session)) {
            const data = event.data;
            if (data === null || typeof data !== 'object')
                continue;
            const record = data;
            // user/message 形态：{ content, source, role, id }
            if (record.id === messageId)
                return true;
            // assistant/step 等包裹形态：{ message: { id, ... } }
            const nested = record.message;
            if (nested !== null && typeof nested === 'object' && nested.id === messageId) {
                return true;
            }
        }
    }
    catch {
        // 读日志失败一律按「未确认」处理：不确认就不敢写 dispatch。
        return false;
    }
    return false;
}
/** 等待投递被日志确认；超时返回 false。 */
export async function confirmDelivery(session, messageId, timeoutMs = DELIVERY_CONFIRM_TIMEOUT_MS) {
    if (hasMessageInLog(session, messageId))
        return true;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
        await new Promise((resolve) => {
            setTimeout(resolve, CONFIRM_POLL_INTERVAL_MS);
        });
        if (hasMessageInLog(session, messageId))
            return true;
    }
    return false;
}
/**
 * 取消息 id（`createUserMessage` 会生成 uuid）。
 *
 * `UserMessage.id` 在类型上是必填，但运行时若某代内核未填则这里回落空串，
 * 调用方的确认逻辑对空 id 一律判「无法确认」。
 */
export function messageIdOf(message) {
    const id = message.id;
    return typeof id === 'string' ? id : '';
}
