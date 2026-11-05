/**
 * dsh-later 宿主入口。
 *
 * 挂载职责：
 *  1. 注册 `userSchedules` 会话投影（GUI 读取任务列表的权威状态）；
 *  2. 注册 slash 命令（客户端 → host 的创建/删除/列表变更通道）；
 *  3. 为每个 root agent 注册用户工具 `user_schedule_create/list/delete`
 *     （PRD「用户工具（底层暴露）」，模型亦可调用，与 dsh-schedule 双入口互补）。
 *  4. 把随包分发的 `SKILL.md` 注册进 skills 服务（可选面：装配里没有该服务时静默跳过）。
 *
 * 依赖顺序：作为 peer 依赖的 dsh-schedule 需先加载（其 agent-runtime 负责
 * 到期 dispatch + followup 注入；本插件只负责「用户接口层」）。
 * @module dsh-later
 */
import type { Context } from '@deepseek-ai/cordis';
import type z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { name } from './domain.js';
/** 插件配置 schema（0.1.5 的 schemastery 没有 `.volatile()`，见上面的降级说明）。 */
export declare const Config: z;
/**
 * 所需服务（延后激活，缺失时插件不加载）。
 *
 * ⚠️ 这里**只能列 host 平面存在的服务**。`locale` 是 client 侧服务
 * （`@deepseek-ai/dsh-client-locale`），在 agent/host 平面上永远不出现：一旦列进
 * 这份顶层 inject，cordis 的激活门控会让整个入口永久 `pending`，日志表现为
 * `later (dsh-later): pending (waiting for service: locale)`，连带 `/later`、
 * `/schedule`、`/user-schedule-*` 全部消失（b7fc4b7 就这么炸过一次）。
 * 需要语言时走 `ctx.get('locale')?.getSnapshot().active`——那三处消费点本来就是
 * 可选链，拿不到就走默认语言，而不是让整个插件不加载。
 * 同一条纪律在本仓 client 入口的文件头也写着（`src/client/index.tsx`：「**不进**
 * 顶层 `inject`，否则会永久 pending」）。
 */
export declare const inject: string[];
/** 宿主持有的 settings 形状（settings getter 返回值与 register* 接受入参）。 */
export interface SchedulerSettings {
    readonly maxSchedules: number;
    readonly allowLongPrompts: boolean;
    readonly maxPromptChars: number;
    /** 插话投递方式（见 Config.steerDelivery）。 */
    readonly steerDelivery: UserScheduleSteerDelivery;
    /** 是否核对投递是否真正送达。 */
    readonly confirmDelivery: boolean;
    /** 投递未确认时：保留可重试 / 丢弃。 */
    readonly onUnconfirmed: UserScheduleOnUnconfirmed;
    /** 时钟图标风格（auto / modern / classic）。 */
    readonly clockIconStyle: 'auto' | 'modern' | 'classic';
    /** 高级语法（Beta）：多次写法是否可用。默认开。 */
    readonly advancedSyntax: boolean;
}
/** 插话投递方式。 */
export type UserScheduleSteerDelivery = 'followup' | 'steer';
/** 投递未确认时的处理。 */
export type UserScheduleOnUnconfirmed = 'keep' | 'discard';
/**
 * 为单个 root agent 注册 `user_schedule_*` 工具。
 *
 * 导出仅为可测性：注册半途失败必须拆掉已成注册，这条只能直接驱动本函数才验得到
 * （走完整 `apply` 要假的 cordis 上下文全套，成本高到没人写，于是这条纪律历史上
 * 从来没被测过——正是不测的原因）。宿主入口不消费它。
 */
export declare function registerUserScheduleTools(rootCtx: Context, toolCtx: Context, agent: Agent, getSettings: () => SchedulerSettings, getLocale: () => string | undefined, onUserChange: (agent: Agent) => boolean): () => void;
/**
 * Cordis 函数插件主体。
 * @param ctx - 全局服务上下文。
 * @param config - 可选配置（maxSchedules）。
 */
/**
 * 冷唤醒的「用户最近动过这条会话」标记（只在本进程内存里，不落盘）。
 *
 * 为什么要它：宿主级扫描器会在**没人打开会话**时把 agent 拉起来。如果用户刚刚主动把某个
 * 会话的 agent 关掉（或刚打开、正要自己操作），扫描器的"帮忙"就是打扰。这里用「监听会话
 * 生命周期」的口径兜住：本进程里被 dispose 的、或最近被打开过的会话，两个扫描周期内
 * （{@link COLD_WAKE_QUIET_MS}）不主动拉起。跨进程的场景由 diff 口径兜住（见
 * `canWakeColdSession`）。
 */
interface UserWatch {
    /** sessionId → 最近一次「用户动作」的时刻（epoch ms）。 */
    readonly recent: Map<string, number>;
}
/**
 * 判断一个会话是否**允许**被宿主级扫描器冷唤醒（决策 D3 的拒绝面）。
 *
 * 三条拒绝理由，每条都有实证/上下文：
 *  1. **被委托子会话**（`delegationDepth > 0`）：上游对子会话的 reminder 投递一律拒绝
 *     （`session/agent-busy`，见 schedule 的 `reminderTargetRefusal`）。它的提醒本就不该由
 *     本插件投递；拉起来只会白跑一轮 turn 再失败。
 *  2. **非 root**：`ctx.agents.roots()` 里没有它 ⇒ runtime 挂不上 ⇒ 唤醒等于白拉。冷会话在
 *     这里看到的是「此刻没有对应 agent」，属于正常现象，不算拒绝。
 *  3. **用户刚动过**（{@link COLD_WAKE_QUIET_MS} 内）：给"我刚关掉，你别又打开"留出静默期。
 * what 这一段只在**此刻有 agent** 时才有信息；没有 agent 时只看用户动作表。
 * @param ctx - 宿主上下文。
 * @param sessionId - 候选会话。
 * @param watch - 用户动作表。
 * @returns 可唤醒返回 true。
 */
export declare function canWakeColdSession(ctx: Context, sessionId: string, watch?: UserWatch): boolean;
export declare function apply(ctx: Context, config?: {
    maxSchedules?: number;
}): void;
export { name };
