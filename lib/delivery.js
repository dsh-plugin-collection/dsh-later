import { readEventAt, readLogCursor, readOwnEvents } from './upstream-compat.js';
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
/** 单条事件里是否带着这个 message id（判据与旧实现逐字一致，只是不再一次读全表）。 */
function eventCarriesMessage(event, messageId) {
    const data = event.data;
    if (data === null || typeof data !== 'object')
        return false;
    const record = data;
    // user/message 形态：{ content, source, role, id }
    if (record.id === messageId)
        return true;
    // assistant/step 等包裹形态：{ message: { id, ... } }
    const nested = record.message;
    return nested !== null && typeof nested === 'object' && nested.id === messageId;
}
export function hasMessageInLog(session, messageId) {
    try {
        for (const event of readOwnEvents(session)) {
            if (eventCarriesMessage(event, messageId))
                return true;
        }
    }
    catch {
        // 读日志失败一律按「未确认」处理：不确认就不敢写 dispatch。
        return false;
    }
    return false;
}
/**
 * 从 `fromSeq`（绝对 seq）扫到当前尾号。
 *
 * @returns `found` 命中与否；`next` 是下次该从哪继续扫（命中时是命中位的下一格）。
 */
function scanFrom(session, messageId, fromSeq) {
    const cursor = readLogCursor(session);
    let seq = Math.max(fromSeq, cursor.offset);
    if (cursor.tail < seq) {
        // 日志比扫描位点还短：会话被替换/重建过（例如换了个 Session 实例传进来）。
        // 这时增量扫会漏掉整段，退回全量扫一次——宁可多花一次，不要静默漏判。
        return { found: hasMessageInLog(session, messageId), next: cursor.tail };
    }
    while (seq < cursor.tail) {
        const at = seq;
        seq += 1;
        let event;
        try {
            event = readEventAt(session, at);
        }
        catch {
            // 读失败按「未确认」收敛，并停在已扫位点：下一轮从这儿接着试。
            return { found: false, next: seq };
        }
        // 位点是空洞（内核契约上不该出现：`seq === log.length` 保证连续）就跳过继续扫，
        // 绝不能在这里 return——那会让位点永远卡在同一格，轮询到超时也追不上后续事件。
        if (event !== undefined && eventCarriesMessage(event, messageId)) {
            return { found: true, next: seq };
        }
    }
    return { found: false, next: seq };
}
/** 等待投递被日志确认；超时返回 false。 */
export async function confirmDelivery(session, messageId, timeoutMs = DELIVERY_CONFIRM_TIMEOUT_MS) {
    /**
     * 第一枪必须是**全量**扫。
     *
     * `deliver()` 之后消息往往在同一个宏任务里就落盘了（正常路径毫秒级），它就躺在
     * 已存在的日志尾部之前；若一上来就按「本次调用时抓的尾号」往前扫，反而会把它跳过。
     */
    if (hasMessageInLog(session, messageId))
        return true;
    /**
     * 之后每轮只扫**新增段**。
     *
     * 旧实现在 2s 预算里每 25ms 重跑一遍 `hasMessageInLog`，即最多 80 次全量遍历；
     * 叠上 fork 会话 `ownEvents()` 每次返回新拷贝，一次插话最坏要拷 80 份全量日志。
     * 日志 append-only，未确认期间新增的事件必然落在上次扫到的位置之后，用游标扫尾部
     * 是等价的，且每轮成本从 O(全日志) 降到 O(新增)。
     */
    let cursorSeq = readLogCursor(session).tail;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
        await new Promise((resolve) => {
            setTimeout(resolve, CONFIRM_POLL_INTERVAL_MS);
        });
        const scanned = scanFrom(session, messageId, cursorSeq);
        cursorSeq = scanned.next;
        if (scanned.found)
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
