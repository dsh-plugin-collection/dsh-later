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
 *   `resolveEveryOccurrence` 推下一次。所以**到期判定与一次性完全相同**：`scheduledAt <= now`
 *   即到期，不看"已经过期多久"。
 *
 *   为什么"过期多久都只算一次"不在判定里：那条语义由上游的 occurrence 解析兜住——runtime
 *   派发 `every` 时带的是 `resolveEveryOccurrence(record, now).occurrenceAt`（本次应算的那一次
 *   的真实时刻），而不是"现在"，所以哪怕会话晚醒两小时，派发的仍是那一次、且只算一次；
 *   下一次的目标时刻再由上游推。判定层只回答"现在到点了没有"，answered 之后怎么折算成
 *   occurrence 是上游的事——两层各管一件事，才不会被两个读者各解释一遍。
 *
 *   这里显式统一，是为了让"扫描器看到 every 到点了"与"runtime 认为 every 到点了"必然一致：
 *   两边共用这一句，分叉（比如一边用 `<`、一边用 `<=`，或一边按 occurrence 比较）就会变成
 *   "扫描器把会话反复叫醒、runtime 每次都说不该派发"。
 *
 *   **反面：不要把 occurrence 解析搬进这里。** 看起来顺手（"判定时顺手算出该派发第几次，
 *   省得下游再算"），实际会造出两条独立的 occurrence 计算路径：扫描器唤醒时会算一次
 *   （决定"这一条该不该派发"），runtime 的 `dueUserDecision` 之后又算一次（决定"派发哪一次"）。
 *   两个读者一旦从**不同的 `now`** 出发（中间隔着一次 `flush`、一次 `await`、一次 resume），
 *   同一条 `every` 就可能被判成"该派发第 N 次"与"该派发第 N+1 次"两种结论——上游的
 *   `schedule/change dispatch` 只认 `id`，不认"第几次"，于是**同一条提醒被派发两遍**，
 *   而且没有哪一侧会报错。判定与解析必须留在各自的层：判定只说"到点没有"（幂等、无状态），
 *   解析只在下游做一次（`resolveEveryOccurrence`，由真正要派发的那一方调用）。
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

/**
 * ## 索引面（sidecar）的到期读数：issue #139 的修法落点
 *
 * `isDue` 读的是**事实面**（runtime 从会话日志折出来的 `ScheduleRecord`）。
 * 宿主级扫描器读的是**索引面**（`ownership-store` 的 `OwnedEntry`），而索引面此前只有
 * 一个静态的 `scheduledAt`：一次性提醒投递完之后，日志里那条记录已经出列，索引里却
 * 仍然写着同一个过去的时刻——扫描器于是把它**永远判成「到期且未消化」**，累计 5 次
 * 假失败后 `gaveUp`（#139 的整条链条）。
 *
 * 修法不是让扫描器去读 fold：`ctx.sessions.get(id)` 按内核定义只返回**已发布（live）**
 * 的会话（`dsh-session` 的 `SessionStore.get`，全类没有 load/restore 入口），而「要不要
 * 叫醒这条冷会话」的判定恰恰发生在会话还冷的时候——那是一条循环依赖。所以真相同源只能
 * 反过来做：**投递路径把 fold 的端态镜像进索引面**，扫描器继续只读索引，但读的是带
 * 消化状态的索引。镜像规则只有两条，都落在这里：
 *  - 日志里该 id 已不在 `active`（一次性投完 / 被删）⇒ 索引标 `dispatchedAt`＝已消化；
 *  - 日志里该 id 还在 `active` 但时刻变了（`every` 的 dispatch 由 fold 推进到
 *    `nextScheduledAt`）⇒ 索引跟着写新的 `scheduledAt`。
 *
 * 这个返回类型被**强制**成三态，而不是 `number | undefined`：两种「没有时刻」必须可区分——
 *  - `consumed`：这条已经投递过，**永远**不算到期；
 *  - `unknown`：v1/v2 老条目缺 `scheduledAt`，要由读侧拿会话日志回算。
 * 合成一个 `undefined` 的话，回算路径会把「已投递的一次性提醒」从 create 事件里重新算出
 * 那个过去的时刻（`resolveScheduledAtFromLog` 只看 create，不看 dispatch——它本来就只
 * 该看 create），条目于是被复活成到期，#139 原地复发。
 *
 * @module dsh-later/due
 */

/** 索引面条目里，本判据关心的字段（`OwnedEntry` 的结构子集）。 */
export interface DueIndexEntry {
  /** 到期时刻（epoch ms）；v1/v2 老条目缺省。 */
  readonly scheduledAt?: unknown;
  /** 消化标记：存在即「这一次已经投递过」，见 `ownership-store` 的 `OwnedEntry`。 */
  readonly dispatchedAt?: unknown;
}

/** 一条索引面条目的到期读数（三态，理由见上）。 */
export type DueIndexReading =
  | { readonly kind: 'due'; readonly target: number }
  | { readonly kind: 'consumed' }
  | { readonly kind: 'unknown' };

/**
 * 读一条 sidecar 条目的到期状态。
 * @param entry - sidecar 条目（或它的结构子集）；`undefined` 按 `unknown` 处理。
 * @returns 三态读数；`consumed` **优先**于时刻缺失，见模块内注释。
 */
export function readDueIndex(entry: DueIndexEntry | undefined): DueIndexReading {
  if (entry === undefined) return { kind: 'unknown' };
  // 消化标记优先：标了 `dispatchedAt` 的条目**绝不**再进回算路径（那会把已投递的一次性
  // 提醒从 create 事件里复活成「到期」）。标记本身用 `dueTargetOf` 收窄——磁盘上的值
  // 不可信，`NaN`/负数/字符串一律当没标过，宁可由读侧回算也别静默丢一条待投的提醒。
  if (dueTargetOf(entry.dispatchedAt) !== undefined) return { kind: 'consumed' };
  const target = dueTargetOf(entry.scheduledAt);
  if (target === undefined) return { kind: 'unknown' };
  return { kind: 'due', target };
}

/**
 * 索引面条目在 `now` 是否**已到期且尚未消化**。
 *
 * `unknown`（缺时刻）返回 false：与 `isDue` 对非法时刻的口径一致——没有可信时刻就不
 * 做「立刻唤醒」的决定（回算与保守跳过在读侧 `resolveScheduledAt` 那一层处理）。
 * @param entry - sidecar 条目。
 * @param now - 当前时刻（epoch ms）。
 */
export function isDueIndex(entry: DueIndexEntry | undefined, now: number): boolean {
  const reading = readDueIndex(entry);
  return reading.kind === 'due' && reading.target <= now;
}
