/**
 * dsh-later 宿主入口。
 *
 * 挂载职责：
 *  1. 注册 `userSchedules` 会话投影（GUI 读取任务列表的权威状态）；
 *  2. 注册 slash 命令（客户端 → host 的创建/删除/列表变更通道）；
 *  3. 为每个 root agent 注册用户工具 `user_schedule_create/list/delete`
 *     （PRD「用户工具（底层暴露）」，模型亦可调用，与 dsh-schedule 双入口互补）。
 *
 * 依赖顺序：作为 peer 依赖的 dsh-schedule 需先加载（其 agent-runtime 负责
 * 到期 dispatch + followup 注入；本插件只负责「用户接口层」）。
 * @module dsh-later
 */
import type { Context } from '@deepseek-ai/cordis';
import type z from '@deepseek-ai/schemastery';
import { name } from './domain.js';
/** 插件配置 schema（全可选，默认开箱即用；经 cordis config 覆盖）。 */
/**
 * 插件配置 schema（**单一事实来源**）。
 *
 * 0.2.0 起 `ctx.settings.describe()` 直接读 `entry.fiber.runtime.Config`
 * （见 dsh-settings `schema(entry)`：「`entry.fiber?.runtime?.Config`，且需有
 * `toJSON`」），据此生成该插件设置页的表单。因此**可编辑字段必须全部声明在
 * `Config` 上**——只放在 `SchedulerSettingsSchema` 里的字段在 0.2.0 下不会
 * 出现在设置 UI 中。
 *
 * 历史：0.1.5 用 `settingsProvider.register(ns, schema, …)` 注册一个**独立于
 * Config 的** schema（即 `SchedulerSettingsSchema`），0.1.7 删除了该 API。
 * 两代并存期间两份 schema 内容一致，现统一为 `Config` 一份，`SchedulerSettingsSchema`
 * 保留为别名以免大范围改动调用点。
 */
export declare const Config: z;
/** 所需服务（延后激活，缺失时插件不加载）。 */
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
