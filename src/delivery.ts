/**
 * 插话投递的「投递 + 送达确认」原语。
 *
 * 为什么需要：`agent.steer()` 把消息放进 `next-step`，语义是「下一个 step 边界
 * 消费」。若插话恰好撞上 `turn/start`，核心的 `inbox.claim('next-step', …)` 会把
 * **整批** `next-step` 取走交给一个**请求上下文已定**的 step —— 消息落进 surface
 * （日志里确有一条 `user/message`）却不进实际请求，即**静默丢失**。实测时序：
 *
 *   t+0ms   agent/inbox/spliced  → 插入 next-step
 *   t+1ms   turn/start           → turn 17 开始（同一毫秒）
 *   t+1ms   agent/inbox/spliced  → removedCount:1, inserted:[]  ← 被 claim 吞掉
 *   t+17ms  request/header       → 请求已按旧上下文构造
 *
 * `agent.followup()` 入 `next-turn`，与 `next-step` 是两条独立队列，
 * `claim('next-step', …)` 不触碰它，**结构上不存在**这个竞态 —— 故默认用它。
 *
 * 送达确认**只读会话日志**，不监听 `inbox/claimed` / `request/header` 等运行时
 * 事件：那些事件的顺序是核心内部实现细节，监听它们等于把插件耦合到核心时序上，
 * 核心一改就静默失效。日志格式是插件已经在依赖的稳定面（`foldUserState` 同源）。
 * @module dsh-later/delivery
 */
import type { Session } from '@deepseek-ai/dsh-session';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import { readOwnEvents } from './upstream-compat.js';

/** 投递方式（与 settings 的 steerDelivery 同源，避免循环依赖故在此重述）。 */
export type DeliveryMode = 'followup' | 'steer';

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
export function hasMessageInLog(session: Session, messageId: string): boolean {
  try {
    for (const event of readOwnEvents(session)) {
      const data = (event as { data?: unknown }).data;
      if (data === null || typeof data !== 'object') continue;
      const record = data as { content?: unknown; id?: unknown; message?: unknown };
      // user/message 形态：{ content, source, role, id }
      if (record.id === messageId) return true;
      // assistant/step 等包裹形态：{ message: { id, ... } }
      const nested = record.message;
      if (nested !== null && typeof nested === 'object' && (nested as { id?: unknown }).id === messageId) {
        return true;
      }
    }
  } catch {
    // 读日志失败一律按「未确认」处理：不确认就不敢写 dispatch。
    return false;
  }
  return false;
}

/** 等待投递被日志确认；超时返回 false。 */
export async function confirmDelivery(
  session: Session,
  messageId: string,
  timeoutMs = DELIVERY_CONFIRM_TIMEOUT_MS,
): Promise<boolean> {
  if (hasMessageInLog(session, messageId)) return true;
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CONFIRM_POLL_INTERVAL_MS);
    });
    if (hasMessageInLog(session, messageId)) return true;
  }
  return false;
}

/**
 * 取消息 id（`createUserMessage` 会生成 uuid）。
 *
 * `UserMessage.id` 在类型上是必填，但运行时若某代内核未填则这里回落空串，
 * 调用方的确认逻辑对空 id 一律判「无法确认」。
 */
export function messageIdOf(message: UserMessage): string {
  const id = (message as { id?: unknown }).id;
  return typeof id === 'string' ? id : '';
}
