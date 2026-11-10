import type { ImageBlock } from '@deepseek-ai/dsh-llm';
import type { UserScheduleDelivery } from './domain.js';
import type { FileBlockShim } from './upstream-shims.js';
/**
 * 随提醒一起延迟发送的附件块（宿主命令准入后的耐久引用，JSON 可序列化）。
 *
 * `/later` 声明 `input.attachments` 后，命令框架把 composer 附件做耐久化准入
 * （图片→内容寻址存储，文件→staged receipt 解析），以这两种块交给 handler。
 * 块内只持有不透明 `attachmentId` 引用（非路径、非字节），因此可以安全地
 * 落进 sidecar JSON，到点投递时再拼回 user message 的 content。
 *
 * file 一侧用 `FileBlockShim` 而不是宿主的 `FileBlock`：`dsh-llm` 从 **0.1.5-rc.1**
 * 起才导出 `FileBlock`（见 `upstream-shims.ts`）。shim 在有该类型的代次上直接就是宿主
 * 自己的 `FileBlock`、在没有的代次上按当前代形状逐字段声明（含 branded `attachmentId`），
 * 所以新代上这个联合类型仍可直接塞进 `ContentBlock[]`。
 *
 * 注意**存储与投递是两件事**：sidecar 里两代都按块原样存 file 块；而 0.1.2 的
 * `ContentBlock` 联合没有 file 变体，代发时必须降级成 `[附件] <name>` 文本块——
 * 该判定与降级在 `attachment-blocks.ts`。
 */
export type ScheduledAttachment = ImageBlock | FileBlockShim;
/**
 * 校验并收窄任意来源（含磁盘 JSON）的附件块数组。
 *
 * sidecar 是本地文件，可能被外部改写或被旧版本写入半成品；而附件块最终会
 * 拼进**以用户身份代发**的消息 content，故读路径必须视为不可信输入：
 * 只放行 `{type:'image'|'file', attachment:{attachmentId: string}}` 形状的块，
 * 其余一律丢弃（不抛错——单块损坏不应让整份 sidecar 不可读）。
 */
export declare function sanitizeAttachments(value: unknown): readonly ScheduledAttachment[] | undefined;
/** 单条所有权记录。 */
export interface OwnedEntry {
    /** 到点注入形态（/later 为 'user'，其余 'context'）。 */
    readonly delivery: UserScheduleDelivery;
    /** 创建时刻（epoch ms，诊断用）。 */
    readonly createdAt: number;
    /**
     * 稳定插件身份（跨 pause/resume/日志 id 变更）。创建时生成；
     * 旧条目可缺省（wire 回退用 scheduleId）。
     */
    readonly uid?: string;
    /**
     * 进度条总窗口（秒）。resume 后日志里的 `afterSeconds` 只是剩余时长，
     * 若直接当窗口会从 0 重跑；此处保留原 after 间隔供 wire/进度条使用。
     */
    readonly windowSeconds?: number;
    /**
     * `/later` 随命令提交的附件（到点代发时拼进消息 content）。
     *
     * 为什么不进会话日志：`schedule/change` 荷载被 dsh-schedule 严格解码
     * （hasExactKeys），追加字段会让整份历史拒读（见 domain.ts 的兼容性说明）；
     * sidecar 是本插件私有存储，加字段天然向后兼容。
     */
    readonly attachments?: readonly ScheduledAttachment[];
    /**
     * 本条提醒的**到期时刻**（epoch ms；issue #11b）。
     *
     * 为什么必须进 sidecar：宿主级扫描器（`src/expiry-sweeper.ts`）要在**任何会话都没被
     * 打开**时判断「哪条到期了」，而它拿不到 runtime 的内存 timer、也不该为了读一个时刻
     * 把每个会话日志都解一遍。sidecar 是进程外唯一能让「一个都没 live」也看得到的索引。
     *
     * v3 起新写入必带；v1/v2 老条目缺这个字段，读路径按日志回算（见 {@link resolveScheduledAt}），
     * 回算不出来的条目**保守跳过**并告警——既不静默丢任务，也绝不把它当成永久逾期去唤醒会话。
     */
    readonly scheduledAt?: number;
    /**
     * **消化标记**：这条条目所代表的那一次投递已经发生（issue #139）。
     *
     * 为什么必须有它：宿主级扫描器的到期视图只能读 sidecar（冷会话的日志读不到，
     * `ctx.sessions.get` 按内核定义只返回 live 会话），而一次性提醒投递完之后日志里那条
     * 记录已经出列、sidecar 里却仍留着同一个过去的时刻。扫描器于是把它永远判成
     * 「到期且未消化」，5 次假失败之后 `gaveUp`，该会话此后不再被冷唤醒。
     *
     * 语义边界（三条都是承重的，改之前读 `src/due.ts` 的 `readDueIndex`）：
     *  - 它**只**由 `mirrorDueIndex` 写入，值 = 镜像那一刻 fold 的端态，不是「投递时刻」的
     *    精确记录（诊断用，不参与判定；判定只看「有没有标」）；
     *  - 它**不**删除条目：`uid` / `attachments` / `windowSeconds` 必须留着——补偿重挂
     *    （`runtime.ts` 的 `rearmOneShot`）在 dispatch **之后**才回读旧条目取这三样，
     *    先摘条目就等于丢稳定身份（面板换 id、按 uid 的 pause/delete 失效、附件消失）；
     *  - 任何**显式写入新到期时刻**的覆盖写（create / edit / resume / 补偿重挂）都会清掉它：
     *    用户动了这条提醒，它就是待投递状态，见 {@link recordOwnership}。
     */
    readonly dispatchedAt?: number;
}
/** 暂停留档（仅 kind==='after'；不进会话日志）。 */
export interface PausedEntry {
    /** 稳定身份；resume 后仍用此 uid。 */
    readonly uid: string;
    readonly prompt: string;
    readonly delivery: UserScheduleDelivery;
    readonly kind: 'after';
    /** 暂停瞬间的剩余秒数（resume 时 after_seconds）。 */
    readonly remainingSeconds: number;
    /** 原目标时刻（仅展示「原点 HH:MM」）。 */
    readonly originalScheduledAt: string;
    readonly originalAfterSeconds?: number;
    /** 暂停前的日志 schedule id（审计/关联）。 */
    readonly lastScheduleId: string;
    readonly pausedAt: number;
    /** 暂停时随条目冻结的附件（resume/插话投递时原样带回）。 */
    readonly attachments?: readonly ScheduledAttachment[];
}
/** 当前 sidecar 变更代数；与上一次读取不同，说明所有权/留档可能已变。 */
export declare function ownershipGeneration(): number;
/** 读取某会话的全部所有权记录（缓存优先；返回副本语义，调用方不得变更）。 */
export declare function allOwnership(sessionId: string): Readonly<Record<string, OwnedEntry>>;
/** 某 schedule id 是否由用户工具创建。 */
export declare function hasOwnership(sessionId: string, id: string): boolean;
/** 某条所有权记录（缺失返回 undefined）。 */
export declare function getOwnership(sessionId: string, id: string): OwnedEntry | undefined;
/** 生成稳定插件 uid（pause/resume 跨日志 id 变更）。 */
export declare function newTaskUid(): string;
/**
 * 记录（新增或覆盖）一条所有权；幂等。仅显式传入 `uid` 时写入稳定身份。
 *
 * `scheduledAt` 与 `uid`/`windowSeconds`/`attachments` **同一条保留语义**：不传就沿用旧条目
 * 里的值。这不是省事，是正确性——`pause` 回填 uid、`flush` 失败回滚这类「覆盖写」只关心
 * 一个字段，若把其余字段当 `undefined` 抹掉，宿主级扫描器（`src/expiry-sweeper.ts`）就会
 * 突然看不见这条提醒的到期时刻，而那正是「到点了却没人叫醒会话」的静默失败。
 */
export declare function recordOwnership(sessionId: string, id: string, delivery: UserScheduleDelivery, uid?: string, windowSeconds?: number, attachments?: readonly ScheduledAttachment[], scheduledAt?: number): OwnedEntry;
/** 一条 sidecar 文件里挂着的全部所有权条目（扫描器用；只读）。 */
export interface SidecarSnapshot {
    /** 会话 id（文件名去 `.json`，可能已被清洗过）。 */
    readonly sessionId: string;
    readonly entries: Readonly<Record<string, OwnedEntry>>;
}
/**
 * 枚举**全部**会话的 sidecar 条目（宿主级到期扫描的数据源，issue #11b）。
 *
 * 这是本层唯一的「跨会话」读接口：扫描器不知道有哪些会话（冷启动时一个 agent 都没有，
 * `ctx.agents.roots()` 是空数组），只能从持久化面自己枚举。两个失败面都**不抛**：
 *  - 目录读不了 → 返回空数组（首启/临时目录被删属正常）；
 *  - 单个文件读不了 / 坏了 → 跳过该文件并 `warn`，绝不让一个坏文件吃掉整轮扫描
 *    （「整轮失败」等于所有会话的提醒一起停摆，那正是要消灭的失败形态）。
 *
 * 返回值是快照：调用方可以边扫描边改，不会看到半更新。
 * @param warn - 告警出口（插件侧是 `ctx.logger.warn`；缺省走 console）。
 * @returns 每个可读 sidecar 的会话 id 与条目快照。
 */
export declare function listOwnershipSnapshots(warn?: (message: string) => void): readonly SidecarSnapshot[];
/** 撤销一条所有权；幂等（不存在时无操作）。 */
export declare function removeOwnership(sessionId: string, id: string): void;
/**
 * 把 fold 的端态镜像进索引面（issue #139 的唯一写入口）。
 *
 * ## 为什么需要一个专门的镜像函数
 *
 * 扫描器的到期视图只能读 sidecar（冷会话的日志读不到：`ctx.sessions.get` 按内核定义只
 * 返回 live 会话，而「要不要叫醒」的判定恰好发生在会话还冷的时候）。所以「投递真相同源」
 * 只能反过来落地：**由能读日志的那一方（runtime）在 dispatch 之后，把日志端态写回索引**。
 * 本函数就是那一处写回，它自己**不折日志、不推 occurrence**——端态由调用方从已有的 fold
 * 结果里取（本仓两条 fold 通道口径一致，见 `user-tools.ts` 的 `foldScheduleEventsCompat`
 * 与 `projection.ts`；再算第三遍就是这两个月最贵的那类错误）。
 *
 * 每个 id 只有两种端态：
 *  - `number` —— 日志里这条仍 active，它的下一次到期时刻（`every` 的 dispatch 已经把
 *    日志记录推到下一次，所以这个值天然是「下一次」）；
 *  - `undefined` —— 日志里已经没有它（一次性投完出列 / 被删除）⇒ 打消化标记。
 *
 * **只在真的不同时才落盘**：`driveOnce` 每轮都会调这里，无条件写会把 sidecar 变成
 * 每次投递一次的固定磁盘写，并且——更要紧的——每次 `writeThrough` 都拨一代
 * `sidecarGeneration`，而那是 fold 缓存的失效键，无条件写等于让 fold 缓存每轮自毁。
 * 未出现在 `targets` 里的条目**一律不动**：那是别的读者的条目，或本方无法判定的条目，
 * 保守跳过与 `resolveScheduledAt` 那一侧的「绝不猜」是同一条纪律。
 *
 * @param sessionId - 目标会话。
 * @param targets - 日志 id → 端态（见上）。
 * @returns 实际改动的条目数（`0` 表示没碰磁盘）。
 */
export declare function mirrorDueIndex(sessionId: string, targets: ReadonlyMap<string, number | undefined>): number;
/** 按 uid 找当前仍 active 的 schedule id（缺失 undefined）。 */
export declare function findScheduleIdByUid(sessionId: string, uid: string): string | undefined;
/** 全部暂停留档（uid → entry）。 */
export declare function allPaused(sessionId: string): Readonly<Record<string, PausedEntry>>;
/** 一条暂停留档。 */
export declare function getPaused(sessionId: string, uid: string): PausedEntry | undefined;
/** 按暂停前 schedule id 找留档（pause 刚写完、投影 fold 见 delete 时用）。 */
export declare function findPausedByScheduleId(sessionId: string, scheduleId: string): PausedEntry | undefined;
/** 写入/覆盖一条暂停留档。 */
export declare function recordPaused(sessionId: string, entry: PausedEntry): void;
/** 移除一条暂停留档；幂等。 */
export declare function removePaused(sessionId: string, uid: string): void;
/** 测试辅助：清空进程内缓存（不删文件）。 */
export declare function resetCacheForTests(): void;
