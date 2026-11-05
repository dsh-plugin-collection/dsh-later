/**
 * 「这条提醒到期了没有」的**唯一**判定口径（issue #11b）。
 *
 * 为什么必须抽成一处：现在有两个读者——会话 runtime（读折叠出来的 `ScheduleRecord`，
 * 事实面）与宿主级扫描器（读 sidecar 里的 `scheduledAt`，索引面）。两边各自写一句
 * `Date.parse(x) <= now` 看起来一样，但边界条件一旦漂移（时区解析、`every` 的语义、
 * 非法时刻、`<=` 还是 `<`），就会出现「扫描器认为到期、runtime 认为没到期」的分叉——
 * 这时扫描器会把会话反复拉起来，而每一次都投不出东西。这种分叉在单侧单测里永远看不见。
 *
 * 这里只定义**一次**判据，两个读者都调它：
 *  - {@link isDue}：单条记录的到期判定（含 `every` 的处理，见下）；
 *  - {@link dueTargetOf}：把一个"时刻"（ISO 字符串或 epoch ms）收窄成合法 epoch ms。
 *
 * ### 各形态的语义（与上游一致，别再解释一遍）
 *
 * - `at` / `after`（一次性）：`scheduledAt <= now` 即到期。
 * - `every`（固定间隔）：上游把它表达成「下一次应该触发的 `scheduledAt`」——到点后由
 *   `resolveEveryOccurrence` 推下一次。所以**到期判定与一次性完全相同**：比 `scheduledAt`
 *   与 `now`。真正"过期多久都只算一次"的语义在上游的 occurrence 解析里，不在判定里。
 *   这里显式统一，是为了让"扫描器看到 every 到点了"与"runtime 认为 every 到点了"必然一致。
 * - 时刻无法解析（`NaN`）：**永远不算到期**。宁可让 runtime 在会话打开时按自己的 fold 处理，
 *   也不让扫描器拿着一个坏时刻去做"立刻唤醒"的决定——那会变成每轮都唤醒、每次都投不出去。
 *
 * @module dsh-later/due
 */

/** 到期判定关心的最小记录面（`ScheduleRecord` 与 sidecar 条目都能收窄到这里）。 */
export interface DueComparable {
  /** 目标时刻（ISO 8601 字符串）。 */
  readonly scheduledAt?: unknown;
}

/**
 * 把一个「时刻」收窄成 epoch ms。
 * @param value - ISO 字符串或数字。
 * @returns 合法（有限且非负）时为 epoch ms，否则 `undefined`。
 */
export function dueTargetOf(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * 这条记录在 `now` 时刻是否**已经到期**。
 * @param record - 只要求 `scheduledAt`（ISO 字符串）；其余字段不参与判定。
 * @param now - 当前时刻（epoch ms）。
 * @returns 到期返回 true；时刻缺失/非法时返回 false（见模块头的理由）。
 */
export function isDue(record: DueComparable | undefined, now: number): boolean {
  const target = dueTargetOf(record?.scheduledAt);
  return target !== undefined && target <= now;
}
