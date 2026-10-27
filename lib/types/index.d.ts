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
export declare function apply(ctx: Context, config?: {
    maxSchedules?: number;
}): void;
export { name };
