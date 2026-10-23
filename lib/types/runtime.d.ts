/**
 * 用户提醒的独立调度器（per root agent）。
 *
 * 为什么需要它：dsh-schedule 的 runtime 只在三类时机重驱——agent 创建、**其
 * 自身工具**的持久化变更、agent 转 idle。用户经本插件命令/工具创建的提醒不会
 * 触发这三类，导致 timer 不武装、不到期触发（GUI 显示任务但永远不 fire）。
 *
 * 本调度器只处理**用户创建**的提醒，复用 dsh-schedule 导出的领域函数
 * （fold / resolveEveryOccurrence / render*Framing）和 `agent.followup`。
 * 防重复：两套调度器（本插件 + dsh-schedule）都通过**同一份持久化日志**做
 * 「fold → append dispatch」的原子判断（同一 JS 线程内同步完成），先到者写入
 * dispatch 事件后，后者 fold 即见已被派发 → 跳过，不会双触发。
 *
 * 触发点：用户 create/delete 成功后 requestDrive；agent 转 idle 时也
 * requestDrive（自愈）；agent 创建时启动。
 * @module dsh-later/runtime
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ScheduleRecord, OneShotScheduleRecord, EveryScheduleRecord } from '@deepseek-ai/dsh-schedule';
import type { UserScheduleDelivery } from './domain.js';
import type { DeliveryMode } from './delivery.js';
/** runtime 关心的设置子集（插话投递策略）。 */
export interface SteerDeliverySettings {
    readonly steerDelivery: DeliveryMode;
    readonly confirmDelivery: boolean;
    readonly onUnconfirmed: 'keep' | 'discard';
}
/** 一次「用户提醒决策」：一批同形态到期一次性、或一批到期固定间隔、或下一次等待目标。
 *
 * P1-5：one-shot 从单条改为**同投递形态的批次**——网页关闭期间积压的多条
 * 到期提醒合并为一条注入消息，而不是逐条刷屏。批次内投递形态必然一致
 * （`/later` 与 `/schedule` 不同组，各组按时间先后分轮派发）。
 */
type UserDecision = {
    kind: 'one-shot';
    delivery: UserScheduleDelivery;
    records: readonly OneShotScheduleRecord[];
} | {
    kind: 'every';
    acceptedAt: string;
    reminders: readonly {
        record: EveryScheduleRecord;
        occurrenceAt: string;
    }[];
} | {
    kind: 'wait';
    target?: number;
};
export declare function dueUserDecision(active: readonly ScheduleRecord[], now: number, delivery?: ReadonlyMap<string, UserScheduleDelivery>): UserDecision;
/**
 * 多条到期一次性提醒的合并注入 framing（P1-5）。
 * 形状与 dsh-schedule 的固定间隔批次 framing 完全一致：
 * 动态字段全部经 JSON 转义，保持「非信任提醒内容」的防护语义。
 *
 * ⚠️ 这是**上游文案的本地副本**。0.2.0 起 dsh-schedule 把 one-shot 与 recurring
 * 两条 framing 统一收敛为一句 `SCHEDULED_MESSAGE_FRAMING`，取代了此前
 * 「Present all due reminders … not new user instructions.」的长句。
 * 本插件只对**多条合并**这一种上游不提供的形态自渲染（单条走
 * `renderReminderFraming`，自动跟随上游），故此处需手工对齐，否则同一会话里
 * 单条与批次的防护措辞会不一致。
 */
export declare function renderOneShotBatchFraming(records: readonly OneShotScheduleRecord[]): string;
/** 每个 agent 的独立调度器。 */
export declare class UserScheduleRuntime {
    private readonly ctx;
    private readonly agent;
    /**
     * 读取当前生效设置（每次调用按需取值，与工具/命令同源）。
     *
     * 注入而非直接读 ctx.settings：settings 的注册在 index 的 `ctx.inject(['settings'])`
     * 回调里完成，runtime 拿不到那个 scope；把它做成闭包注入，保证「设置 UI 改了立刻生效」
     * 这一既有语义（`applies: 'live'`）在插话路径上同样成立。
     */
    private readonly getSettings;
    private readonly stop;
    private resolveStop;
    private timer;
    private run;
    private requested;
    private stopping;
    /** 连续 run 级失败次数（P0-3：用于指数退避，成功一次即清零）。 */
    private failures;
    private idleWait;
    private disposal;
    constructor(ctx: Context, agent: Agent, getSettings: () => SteerDeliverySettings);
    /** 是否仍为活动 root agent。 */
    private isLive;
    /** 发起一次重算（合并多个触发为一次）。 */
    requestDrive(): void;
    /** 清空已武装的 timer。 */
    private clearTimer;
    /** 武装一次到下次目标的 timer。 */
    private arm;
    /** 串行 drain 合并的触发。 */
    private runRequested;
    /** 等待一次 public 的 idle 边界（供 agent 忙碌时重试）。 */
    private waitForIdle;
    /** 停止调度器、取消 timer、等待在途派发收敛。 */
    dispose(): Promise<void>;
    /**
     * 用户主动插话（QueueDock「插话发送」语义）：把指定 id 的提醒内容**立即**推给 agent。
     * - 仅 one-shot（at / after）支持；every 类型因 batch framing 需要更多 plumbing，留待后续
     * - **不要求已到点**：与 QueueDock 一致，排队中的内容随时可被主动插话提前送达；
     *   成功即出列（写 dispatch），不会到点再 fire 一次
     * - 与 fold/dispatch 共享「单一真相」：steer 成功后立即写 `schedule/change: dispatch`，
     *   否则后续 fold 路径会再 fire 一次（双触发）
     *
     * 为什么不用 `runMaintenance`：插话按钮只在 overdue 时出现，而 overdue 恰恰发生在
     * agent 正在跑（auto-driver 只能 waitForIdle）——`runMaintenance` 在 agent 有活跃工作
     * 时直接 throw（`agent "..." already has active work`），会让插话在唯一可见的场景里
     * 必然失败（曾以 `internal_error: 插话执行失败` 落日志）。`agent.steer` 是为「in-flight
     * 也要在下一个 step boundary 立即消费」设计的原语：空闲则开 turn、忙碌则排到边界，
     * 不需要空闲。dispatch 事件在同一同步块内 append，与 auto-driver 的 fold 无并发窗口
     * （JS 单线程；两者要么整块先执行要么整块后执行，后执行者 fold 即见 dispatch 而跳过）。
     */
    steerById(id: string): Promise<{
        ok: true;
        id: string;
        steered: true;
    } | {
        ok: false;
        code: string;
        message: string;
    }>;
    /**
     * 按配置把消息投进队列。
     *
     * `followup`（默认）入 `next-turn`：与 `next-step` 是两条独立队列，
     * `claim('next-step', …)` 不触碰它，**结构上不存在**与 `turn/start` 竞争的窗口。
     * `steer` 入 `next-step`，更快但会在撞上回合启动时被吞（见 delivery.ts 注释）。
     */
    private deliver;
    /**
     * 核对投递是否真正进入会话日志。
     *
     * 关闭确认时直接返回 true（fire-and-forget，保持旧语义）。
     */
    private verifyDelivery;
    /**
     * 投递未确认时，把「插件当时凭什么决定这个 source kind」写进宿主日志（issue #75 建议 3）。
     *
     * 为什么只能记这个、记不了「真实错误」：`confirmDelivery` 的全部观测面是会话日志里
     * 有没有那条 message id，它回答不了「为什么没有」。rc.1 那类代次的真因是消息被
     * **宿主写入路径的 v4 准入**拒绝（`format v4 message requires a producer-owned source kind`），
     * 实测那句只出现在宿主 stdout，插件侧 `deliver()` 不抛、会话日志里既无 dispatch 也无校验行
     * ——所以插件唯一能补上的信息就是自己的判定依据。把 `kind=` 与内核版本留在线上，
     * 下次这类事不用再跑一遍跨代次实测才能定位。
     */
    private noteUnconfirmed;
    /** 执行一次用户提醒决策与派发。 */
    private driveOnce;
    /**
     * 暂停项的插话投递。
     *
     * 暂停项不在日志里（其日志记录在 pause 时被删），所以从 sidecar 留档取材：
     * `PausedEntry` 已含 `prompt` 与 `delivery`，足以构造消息。呈现方式与
     * {@link buildMessage} 的 one-shot 分支保持一致（`user` 代发 vs `context` 注入），
     * 避免两条路径的语义分叉。
     *
     * 投递成功后清掉留档：提醒已送达，不应再留在待发送列表。这与 dispatch 会把记录
     * 移出 `active` 语义一致。（清留档不写会话事件，故投影不会自动刷新——客户端已用
     * 本地摘除 + 投影对账处理同类情况，与"删除暂停项"同源。）
     *
     * @returns `undefined` 表示该 id 不是暂停项，交由调用方走常规日志路径。
     */
    private steerPausedById;
    /**
     * 构造注入的消息，按投递形态分流：
     *  - `user`（`/later` 显式请求的延迟发送）：原样内容 + `source.kind='user'`，
     *    让 GUI 呈现为「我」发出的普通气泡（产品取舍：用户明确要求以本人身份）。
     *    跳过 framing 防护 —— 这是「代发」语义，不是注入。随命令提交的附件
     *    （图片/文件耐久引用，存于 sidecar）按记录顺序拼在文本块之后，
     *    与用户自己发「文字+图」的消息形状一致。
     *  - `context`（默认）：复用 dsh-schedule 的注入防护 framing + notice 表单，
     *    保持「上下文注入」的可信审计线；多条一次性到期合并为批次 framing（P1-5），
     *    形状与 dsh-schedule 的固定间隔批次一致。
     */
    private buildMessage;
    /**
     * 读某条提醒随命令提交的附件（sidecar 权威；无会话 id / 无条目时为空）。
     *
     * 只在 `user` 代发路径调用——context 注入通道从未声明接受附件（见 commands.ts），
     * 不会把图片拼进防护 framing。sidecar 读路径已做块级收窄（sanitizeAttachments）。
     */
    private attachmentsOf;
}
export {};
