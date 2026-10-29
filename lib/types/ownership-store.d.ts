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
/** 记录（新增或覆盖）一条所有权；幂等。仅显式传入 `uid` 时写入稳定身份。 */
export declare function recordOwnership(sessionId: string, id: string, delivery: UserScheduleDelivery, uid?: string, windowSeconds?: number, attachments?: readonly ScheduledAttachment[]): OwnedEntry;
/** 撤销一条所有权；幂等（不存在时无操作）。 */
export declare function removeOwnership(sessionId: string, id: string): void;
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
