/**
 * 用户工具核心实现：`user_schedule_create` / `user_schedule_list` /
 * `user_schedule_delete`。
 *
 * 复用 dsh-schedule 导出的领域函数（fold / allocate / 各 create 函数 /
 * scheduleView），写入**完全兼容**的 `schedule/change` 事件（不携带 `source`
 * 字段，避免破坏 dsh-schedule 严格解码）。
 *
 * 用户来源（所有权 + 投递形态）记录在**插件自己的 sidecar 文件**里
 * （ownership-store.ts），**不再写入会话日志**——2026-09 根治：伴生事件
 * `session-scheduler/user-schedule` 曾因宿主持久化静默丢行而留下永久 seq
 * 缺口，让整份历史被拒读。日志里若仍残留旧的伴生事件（历史日志），fold
 * 会继续读取（读兼容），但本模块不再产生它们；前提是那份历史日志已按 #58 迁移
 * （`scripts/migrate-owned-events.mjs` 补 `ignorable: true`）——未迁移时宿主持久层
 * 会整份拒读，根本轮不到这里 fold。
 *
 * 所有读改写操作按 agent 串行化（同 dsh-schedule 的 agent-scoped 队列），
 * 保证 id 分配与 fold 不会并发竞争。
 * @module dsh-later/user-tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { ScheduleRecord, ScheduleView } from '@deepseek-ai/dsh-schedule';
import type { UserScheduleDelivery } from './domain.js';
import type { PausedEntry, ScheduledAttachment } from './ownership-store.js';
/** 单 session 用户任务上限（PRD：防滥用）。 */
export declare const DEFAULT_MAX_SCHEDULES = 100;
/**
 * 经过 trim 后允许的默认最大提示字符数（P0：注入防护的保守下限）。
 *
 * 当 settings 中 `allowLongPrompts=false` 时此值始终生效；为 `true` 时
 * 由 `maxPromptChars` 字段接管实际字符上限。用户必须显式 opt-in 才解除
 * 该硬上限——保持默认安全的姿态。
 */
export declare const DEFAULT_MAX_PROMPT_CHARS = 1000;
/** 用户工具的提示字符上限策略（来自插件 settings）。 */
export interface PromptLimits {
    /** 是否解除 `DEFAULT_MAX_PROMPT_CHARS` 硬上限；未开启时 maxChars 始终等于默认值。 */
    readonly allowLong: boolean;
    /** 当前允许的最大字符数（已根据 allowLong 解析过）。 */
    readonly maxChars: number;
}
/**
 * 从 settings 解析出实际生效的 PromptLimits。
 * 容错非法值（NaN / 负数 / 非数）回落 DEFAULT_MAX_PROMPT_CHARS。
 */
export declare function resolvePromptLimits(settings: {
    readonly allowLongPrompts?: boolean;
    readonly maxPromptChars?: number;
} | undefined): PromptLimits;
/** 单条提示的字符校验（纯函数）。返回 trim 后的字符串或闭包错误。 */
export declare function validatePrompt(raw: unknown, limits: PromptLimits): {
    ok: true;
    value: string;
} | UserScheduleError;
/**
 * 用户工具稳定的闭包错误集合（在 dsh-schedule 闭包之上追加本插件专用码）。
 *
 * `subagent_session` 来自 dsh-schedule 0.2.1（实测 0.2.1-rc.2）：上游对
 * 「委派深度 > 0 的子 agent 会话」拒绝武装投递——`ScheduleService.create`
 * 抛 `ScheduleInputError('subagent_session')`，`update` 返回同名非变更结果。
 *
 * 本插件**不在工具层重复这条深度守卫**，因为两边在官方宿主上构造等价：
 *   - 用户工具只在 `agent/created` 且 `ctx.agents.roots()` 命中时注册
 *     （src/index.ts 的 later.userToolsLifecycle()）。`roots()` 只含「没有
 *     owning agent context」的顶层 agent；而子 agent 无论首建还是冷恢复都经
 *     `ownerCtx.agents.create|resume({ parentAgent })` 创建（dsh-subagent 的
 *     child-agent/materialize），必然带 owner，永远进不了 `roots()`，也就
 *     拿不到本工具这条 create 通道。
 *   - 子 agent 的会话头同时被 stamp `origin:'subagent'` 与
 *     `delegationDepth = parent+1`；官方会话控制器对 `origin === 'subagent'`
 *     的普通 resume 直接拒绝（session/agent-busy），因此「深度 > 0 却以 root
 *     身份存活」的会话在官方路径上不可构造。
 *   结论：`delegationDepthOf(agent) > 0` 的 agent 本就不是本插件的注册对象，
 *   再加一次深度判断只会复制上游规则。本码仅作为**类型闭包**的一部分，接住
 *   上游未来可能经 toInputError 透传的同名 code；上游继续增码时由
 *   tests/error-code-superset.test.mjs 从实际类型声明里取联合、断言本类型是
 *   它的超集。
 *
 * 为什么"本插件不产生它"仍必须登记：`toInputError` 是上游闭包的**直通翻译器**
 * （`code: error.code`），本类型少一个成员就不是超集 —— 0.2.1 升级时 tsc 会如实
 * 报 TS2322，而不是在运行期把新码折叠成 `internal_error`。另外本插件的写路径不经过
 * `ScheduleService`（自己 append `schedule/change` 再 fold），所以即便在同代次下，
 * 该码也只能从上游侧透传进来，不能由本插件自己编造。
 */
export type UserScheduleErrorCode = 'invalid_prompt' | 'invalid_selector' | 'invalid_time_zone' | 'not_future' | 'time_out_of_range' | 'frequency_too_high' | 'invalid_rule' | 'subagent_session' | 'schedule_not_found' | 'already_overdue' | 'quota_exceeded' | 'persistence_uncertain' | 'unsupported_kind' | 'not_paused' | 'internal_error';
/** 封闭错误值。 */
export interface UserScheduleError {
    readonly ok: false;
    readonly code: UserScheduleErrorCode;
    readonly message: string;
}
/** 成功值。 */
export type UserScheduleResult<TSuccess> = TSuccess | UserScheduleError;
/** `user_schedule_create` 成功响应。 */
export type UserScheduleCreateResult = UserScheduleResult<ScheduleRecordView & {
    readonly ok: true;
}>;
/** `user_schedule_list` 成功响应。 */
export type UserScheduleListResult = UserScheduleResult<{
    readonly ok: true;
    readonly schedules: readonly ScheduleRecordView[];
}>;
/** `user_schedule_delete` 成功响应。 */
export type UserScheduleDeleteResult = UserScheduleResult<{
    readonly ok: true;
    readonly id: string;
    readonly deleted: true;
} | {
    readonly ok: true;
    readonly id: string;
    readonly deleted: false;
    readonly code: 'schedule_not_found';
}>;
/** `user_schedule_pause` 成功响应（仅 after）。 */
export type UserSchedulePauseResult = UserScheduleResult<{
    readonly ok: true;
    readonly uid: string;
    readonly schedule_id: string;
    readonly remaining_seconds: number;
    readonly scheduled_at: string;
}>;
/** `user_schedule_resume` 成功响应：新 scheduleId + 原 uid。 */
export type UserScheduleResumeResult = UserScheduleResult<{
    readonly ok: true;
    readonly uid: string;
    readonly schedule_id: string;
    readonly remaining_seconds: number;
}>;
/** `user_schedule_create` 的规范化输入。 */
export interface UserScheduleCreateInput {
    readonly prompt: string;
    readonly time_zone: string;
    readonly after_seconds?: number;
    readonly at?: string | {
        readonly date: string;
        readonly time: string;
        readonly time_zone: string;
    };
    readonly every_seconds?: number;
}
/** 校验 `user_schedule_create` 参数（纯函数，含 TRIM 非空、长度、三选一）。
 *
 * `limits` 可选：未传时回落到 `DEFAULT_MAX_PROMPT_CHARS`（保持向后兼容）；
 * 命令与工具的注册路径会按当前 settings 传入实际 limits，校验消息会反映
 * 当前生效的字符上限（与模型可见的 tool description 同步）。
 */
export declare function validateCreateInput(input: unknown, limits?: PromptLimits): {
    ok: true;
    value: UserScheduleCreateInput;
} | UserScheduleError;
/** 校验 IANA 时区（与 dsh-schedule canonicalize 同源，容错）。 */
export declare function isValidIanaZone(value: string): boolean;
/**
 * 从会话日志导出「用户创建过的 schedule id 集合」。
 *
 * 只对**已迁移**的 pre-1.4 历史日志有意义（见 #58 与 `scripts/migrate-owned-events.mjs`）；
 * 新日志不再包含该事件，本函数对它们恒为空集。
 */
export declare function foldOwnedIds(events: readonly SessionEvent[]): Set<string>;
/**
 * 从会话日志导出「schedule id → 到点注入形态」映射（默认 `context`）。
 * 供 runtime 在 dispatch 时按 `/later` 与 `/schedule` 分别注入。
 */
export declare function foldOwnedDelivery(events: readonly SessionEvent[]): ReadonlyMap<string, UserScheduleDelivery>;
/**
 * 会话级 fold 缓存（P1-6）：事件日志只增不改（事件溯源），
 * 按「数组身份 + 长度」判定命中——append 原地 push 使长度变化即失效；
 * 整体换数组则身份不同也失效。两种实现风格下都安全。
 *
 * 消除热路径（每次 drive / 每次工具调用）对全量日志的重复 O(n) 扫描。
 */
export interface UserFoldState {
    /**
     * `foldScheduleEvents` 的结果，按**本插件的读视图**收窄。
     *
     * 0.1.5 返回 `ScheduleRecord`；0.1.7 返回 `LegacyScheduleRecord`
     * （`title` 可选，因为 title 成为必填前写入的历史事件没有该字段），
     * 且 `ScheduleRecord` 联合新增了 daily/weekly/cron 三个本插件不产生的变体。
     *
     * 收窄到 `Legacy*` 视图对读路径是**语义正确**的：本插件只创建
     * after/at/every，title 缺失时投影回退到 prompt（见 projection.ts）。
     * 统一在此收口，避免每个消费点各写一次断言。
     */
    readonly folded: FoldedUserSchedules;
    readonly owned: ReadonlySet<string>;
    readonly delivery: ReadonlyMap<string, UserScheduleDelivery>;
}
/** fold 结果中本插件关心的字段面（`active` 按 Legacy 视图收窄）。 */
export interface FoldedUserSchedules {
    readonly active: readonly ScheduleRecord[];
    readonly seenIds: ReadonlySet<string>;
}
/** fold 当前会话的完整用户调度状态（带缓存；调用方不得变更返回值）。
 *
 * 跨代 Session API 探测已收敛到 `upstream-compat.ts`（readFoldInput /
 * readLogCursor）——新 rc 若再改名只动那一处。
 *
 * 判据为什么从「数组引用 + 长度」换成「游标 + sidecar 代数」：`ownEvents()` 在
 * fork / 子代理会话（`inheritedEventCount > 0`）上每次 `log.slice()` 返回**新数组**，
 * 引用比较恒不命中——缓存对这类会话完全不存在，而且光是判定一次就要先拷一份全量
 * 日志。本函数在一次派发里被调两次（`runtime.driveOnce` 预算一次、维护事务内再算
 * 一次），插话路径同样两次，于是每个 fork 会话上的每一轮都白 fold 两遍。
 * 换成零分配的 `seq` 游标后，命中路径连日志数组都不必读。
 *
 * `generation` 那一维是新加的：结果里的 `owned`/`delivery` 有一部分来自 sidecar，
 * 而 sidecar 不属于会话日志。旧判据在 root 会话上本来就有这个盲区（引用+长度都
 * 不变时 sidecar 改了读不到），只是 fork 会话上缓存从不命中、反而看不见。既然这次
 * 让 fork 会话也开始吃缓存，就把这个盲区一并封掉——代价是任一会话写 sidecar 会让
 * 全部 fold 缓存作废，而写 sidecar 只发生在用户改动提醒时，那一刻本就该重算。
 */
export declare function foldUserState(session: Session): UserFoldState;
/** 稳定内部错误（不透出异常细节）。 */
export declare function internalError(): UserScheduleError;
/** 稳定持久化不确定错误。 */
export declare function persistenceError(): UserScheduleError;
/** 把 dsh-schedule 的 ScheduleInputError 翻译为闭包错误值。 */
export declare function toInputError(error: unknown): UserScheduleError;
/** 记录视图的 snake_case 序列化。 */
export type ScheduleRecordView = {
    readonly id: string;
    readonly kind: ScheduleRecord['kind'];
    readonly prompt: string;
    readonly after_seconds?: number;
    readonly every_seconds?: number;
    readonly scheduled_at: string;
    readonly state: 'scheduled' | 'overdue';
    readonly delivery_mode: 'session-local';
    readonly source: 'user-tool';
};
/** 把 dsh-schedule 的 view 序列化为 snake_case 记录。 */
export declare function serializeScheduleView(view: ScheduleView): ScheduleRecordView;
/** 在当前 agent 的事务尾之后运行操作。 */
export declare function runUserScheduleTransaction<T>(agent: Agent, operation: () => Promise<T>): Promise<T>;
/**
 * `user_schedule_create` 的可信通道选项。
 *
 * 安全边界（P0-1）：`delivery:'user'`（到点以用户身份代发，绕过注入防护）只能
 * 由人类显式输入的 `/later` 命令经 `trustedDelivery` **显式声明**——原始输入里的
 * 同名字段一律被忽略。模型工具与 GUI 面板通道不传该选项，永远得到安全的
 * `context` 注入形态；即使模型在工具参数里夹带 `delivery:'user'` 也无效。
 */
export interface UserScheduleCreateOptions {
    /** 可信通道显式声明的投递形态；未提供或非 'user' 一律按安全默认 'context'。 */
    readonly trustedDelivery?: UserScheduleDelivery;
    /**
     * 可信通道（人类显式输入的 `/later`）随命令提交的附件块。
     *
     * 与 `trustedDelivery` 同一道闸门：**只**接受选项传入，原始输入载荷里的
     * `attachments` 字段不具任何效力——模型工具与 GUI JSON 载荷永远带不进附件，
     * 防止任何通道夹带未准入的对象拼进代发消息。
     */
    readonly attachments?: readonly ScheduledAttachment[];
}
/** `user_schedule_create` 核心实现。 */
export declare function userScheduleCreate(input: unknown, agent: Agent, ctx: Context, maxSchedules?: number, options?: UserScheduleCreateOptions, limits?: PromptLimits): Promise<UserScheduleCreateResult>;
/** `user_schedule_list` 核心实现。 */
export declare function userScheduleList(agent: Agent): Promise<UserScheduleListResult>;
/** `user_schedule_delete` 核心实现。id 可为 scheduleId 或稳定 uid。 */
export declare function userScheduleDelete(id: unknown, agent: Agent, ctx: Context): Promise<UserScheduleDeleteResult>;
/** `user_schedule_edit`（改内容）核心实现：删旧建新，保留原时刻与 delivery。 */
export declare function userScheduleEditPrompt(id: unknown, newPrompt: unknown, agent: Agent, ctx: Context, limits?: PromptLimits): Promise<UserScheduleCreateResult | UserScheduleError>;
/**
 * 暂停一条 **after** 提醒（方案 B）：sidecar 留档 + 日志 delete。
 * 仅 kind==='after' 且未到点；恢复见 {@link userScheduleResume}。
 */
export declare function userSchedulePause(id: unknown, agent: Agent, ctx: Context): Promise<UserSchedulePauseResult>;
/** 恢复一条暂停中的 after 提醒：`after_seconds = remaining` 重建；uid 不变。 */
export declare function userScheduleResume(uid: unknown, agent: Agent, ctx: Context, maxSchedules?: number): Promise<UserScheduleResumeResult>;
/** 测试/投影辅助：某会话全部暂停留档。 */
export declare function listPausedForSession(sessionId: string): Readonly<Record<string, PausedEntry>>;
/** 测试辅助：按 pause 前 schedule id 查留档。 */
export declare function findPausedEntry(sessionId: string, scheduleId: string): PausedEntry | undefined;
