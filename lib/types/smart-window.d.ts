/** 智能时段配置（HH:mm 格式，可配置）。 */
export interface SmartWindowConfig {
    /** 工作时间开始。 */
    readonly workStart: string;
    /** 工作时间结束。 */
    readonly workEnd: string;
    /** 午休开始。 */
    readonly lunchStart: string;
    /** 午休结束。 */
    readonly lunchEnd: string;
    /** 晚间结束（夜间静默起点）。 */
    readonly eveningEnd: string;
}
/** 默认时段。 */
export declare const DEFAULT_SMART_WINDOW: SmartWindowConfig;
/** 校验一个 HH:mm 字符串。 */
export declare function isValidHhmm(value: unknown): value is string;
/**
 * 逐项清洗：非法或缺省的字段回落默认值，**不做跨字段的序关系判定**。
 *
 * 单独导出是给设置卡用的：卡片要在用户按下「保存」之前就说出**哪一对**相邻边界被
 * 写反了，而 {@link sanitizeSmartWindowConfig} 在序关系不成立时已经把五个字段整体
 * 换回默认，那份「用户真正填的组合」就看不到了。
 */
export declare function pickSmartWindowFields(raw: Partial<Record<keyof SmartWindowConfig, unknown>> | undefined | null): SmartWindowConfig;
/**
 * 清洗**设置层**送来的时段字段（host schema 与 client 设置面共用这一个入口）：
 * 逐项回落 + 序关系不成立时整体回落默认。
 *
 * ## 为什么序关系的降级放在这一层（issue #19 的实测结论，改动前请先复现）
 *
 * 设置卡的五个 HH:mm 字段曾经只在卡片里可写、不在宿主 `Config` 里，于是用户的改动
 * 永远进不到快照——面板读不到，恒用默认。把字段补进 schema 只是**让值能落地**；
 * 落地之后这两类脏值会真的流进时段计算，实测行为分别是：
 *
 *  - **格式非法**（`25:00` / `9:00` / 非字符串）：逐项清洗本来就挡得住，`isValidWindow`
 *    随即为 true，时段照算（不会出 NaN）。
 *  - **格式合法但序关系不成立**（例如 `workStart=13:00`，而午休仍从 12:00 起）：
 *    逐项清洗**放行**（它只看单字段格式），于是 `isValidWindow` 为 false →
 *    `nextSmartTarget` 抛 `TypeError` → `nextSmartAt` 把异常吞成 `null` → 面板上
 *    「智能」那一枚芯片**静默消失**，而另两枚芯片照旧显示 `今天 18:00 / 明天 13:00`
 *    这种自相矛盾的时刻。用户看到的现象是「改了设置之后智能排期没了」，没有任何解释。
 *
 * 也就是说不加这道降级，把崩溃点从「改动不生效」挪到「算不出时段」就够了——仍然是静默。
 * 所以序关系的判定必须在**进入计算之前的最后一个共享环节**做一次，且只能做一次：
 * `pickSmartWindowFields` 与 `isValidWindow` 之间不再有别的消费者。
 *
 * ## 为什么是「整体回落」而不是「逐字段凑」
 *
 * 序关系是四条相邻约束，违反时「哪个字段错了」没有唯一答案（改任一侧都能修好）。
 * 逐字段凑会静默造出一份用户从没填过的混合配置，且每改一格都可能换一个组合；
 * 整体回落是一条可解释的规则，并且让下游 `isValidWindow` 的前置守卫**恒成立**——
 * `nextSmartTarget` 永不因脏输入抛错，NaN 也进不了 `nextMinutesAfter`
 * （`resolveWallClock` 收到 NaN 会让 `Intl.formatToParts` 抛 RangeError）。
 *
 * 卡片侧另有一道同规则的输入校验（保存前就报错，不静默），两处共用
 * {@link SMART_WINDOW_ORDER}，所以「被拒的组合」与「被降级的组合」必然是同一个集合。
 */
export declare function sanitizeSmartWindowConfig(raw: Partial<Record<keyof SmartWindowConfig, unknown>> | undefined | null): SmartWindowConfig;
/** 两次提醒之间至少等待的毫秒数（智能模式下）。 */
export declare const SMART_MIN_DELAY_MS: number;
/** 一小时/一天的毫秒数。 */
export declare const MINUTE_MS: number;
export declare const HOUR_MS: number;
export declare const DAY_MS: number;
/** 当日第几分钟（0–1439）。 */
export type DayMinutes = number;
/** 本地日历字段。 */
export interface LocalFields {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
}
/**
 * 把 "HH:mm" 解析为当日第几分钟；非法返回 undefined。
 */
export declare function hhmmToMinutes(value: string): DayMinutes | undefined;
/** 把当日第几分钟格式化为 "HH:mm"。 */
export declare function minutesToHhmm(minutes: DayMinutes): string;
/**
 * 时段序关系：表里每一对相邻边界都必须**严格递增**。
 *
 * 这是这条规则在本仓的**唯一定义处**——`isValidWindow`（计算前置守卫）与设置卡的
 * 跨字段输入校验都读它，所以「卡片会拒绝的组合」与「消费端会整体降级的组合」
 * 必然是同一个集合。改这张表就等于同时改了行为与提示，不存在两处漂移。
 */
export declare const SMART_WINDOW_ORDER: ReadonlyArray<readonly [keyof SmartWindowConfig, keyof SmartWindowConfig]>;
/**
 * 第一对被破坏的相邻边界（全部满足则 `null`）。
 * 格式不合法（`hhmmToMinutes` 落空）也算破坏——序关系没有「未知」这一档。
 * 卡片用它把提示挂到**具体那两格**上，而不是整段糊一句「时间无效」。
 */
export declare function firstOrderViolation(window: SmartWindowConfig): readonly [keyof SmartWindowConfig, keyof SmartWindowConfig] | null;
/**
 * 可配置时段是否有效：所有边界均为合法 HH:mm 且满足
 * workStart < lunchStart < lunchEnd < workEnd < eveningEnd。
 */
export declare function isValidWindow(window: SmartWindowConfig): boolean;
/** 取整到整分钟（秒、毫秒清零）。 */
export declare function floorToMinute(epoch: number): number;
/** 把 epoch 投影到指定时区的本地日历字段。 */
export declare function localFieldsOf(epoch: number, timeZone: string): LocalFields;
/**
 * 解析一个本地墙钟时刻（hour/min 表示，sec=00）在指定时区内对应的 epoch。
 * 采用「偏移校正」法：把墙钟当 UTC 构造候选，再用采样偏移反推真实 epoch，
 * 并验证映射回原墙钟字段；DST 重叠取最早候选，缺口会导致无候选。
 */
export declare function resolveWallClock(epochOnDay: number, timeZone: string, hour: number, minute: number, second?: number): number | undefined;
/**
 * 计算下一个智能时段的本地墙钟目标。
 *
 * 规则：
 *  - 若当前在午休时段（lunchStart ≤ now < lunchEnd）→ 目标为 now + 2 分钟；
 *  - 否则候选为下一个 工作开始 / 午休结束 / 晚间开始（均 > now + 2 分钟），取最早者；
 *  - 夜间静默（≥ eveningEnd 或 < workStart）自然被「下一个工作开始」覆盖。
 *
 * @param now - 当前墙钟 epoch 毫秒。
 * @param timeZone - 用户显式选定的 IANA 时区。
 * @param window - 时段配置（默认 {@link DEFAULT_SMART_WINDOW}）。
 * @returns 目标 epoch 毫秒（严格位于未来，且至少 SMART_MIN_DELAY_MS 之后）。
 */
export declare function nextSmartTarget(now: number, timeZone: string, window?: SmartWindowConfig): number;
/**
 * 把本地墙钟字符串（date YYYY-MM-DD、time HH:mm[:ss]）在指定时区解析为 epoch。
 * 用于自定义时间的预览与合法性校验。解析失败返回 undefined（如 DST 缺口）。
 */
export declare function epochFromLocal(date: string, time: string, timeZone: string): number | undefined;
/**
 * 智能模式的一站式目标构造：返回可直接作为 `at` 对象使用的本地日历字段。
 * @returns null 当配置非法或无法解析时。
 */
export declare function nextSmartAt(now: number, timeZone: string, window?: SmartWindowConfig): {
    date: string;
    time: string;
    time_zone: string;
    epoch: number;
} | null;
