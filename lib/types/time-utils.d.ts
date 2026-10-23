/**
 * 时间格式化与通用工具（纯函数，host 与 client 共享）。
 * 文案遵循 docs/ui/08-microcopy.md 的微文案规范。
 * @module dsh-later/time-utils
 */
/** 校验一个字符串是否为合法 IANA 时区（或 UTC）。 */
export declare function isValidTimeZone(value: string): boolean;
/** 浏览器默认时区（客户端）；host 侧无合理默认则退回 UTC。 */
export declare function detectTimeZone(): string;
/** 常见时区候选（面板下拉用）。 */
export declare const COMMON_TIME_ZONES: readonly string[];
/** 文案语言 id（zh 中文；en 英文；其余回退中文）。 */
export type TextLocale = 'zh' | 'en';
/**
 * 相对时间文案：zh "约 X 分钟后"；en "in ~X minutes" 等。
 * @param epoch - 目标 epoch 毫秒。
 * @param now - 当前 epoch 毫秒（默认 Date.now()）。
 * @param locale - 文案语言（默认 zh，host 侧无浏览器语境保持中文）。
 */
export declare function formatRelative(epoch: number, now?: number, locale?: TextLocale): string;
/** 毫秒常量（避免依赖 smart-window 再复制）。 */
export declare const MINUTE_MS: number;
export declare const HOUR_MS: number;
export declare const DAY_MS: number;
/**
 * 完整时间文案：zh "{M}月{d}日 {周X} HH:mm"、en "Wed, Aug 26, 14:45"（按指定时区）。
 */
export declare function formatAbsolute(epoch: number, timeZone: string, locale?: TextLocale): string;
/** 仅时间部分 "HH:mm"（按指定时区）。 */
export declare function formatHhmm(epoch: number, timeZone: string): string;
/** 周期几第几天（与 formatAbsolute 里的 wkday 词对齐）。 */
export declare function weekdayLabel(epoch: number, timeZone: string): string;
/**
 * 倒计时 "HH:MM:SS"（或剩余不足 1 小时时 "MM:SS"）。
 */
export declare function formatCountdown(epoch: number, now?: number): string;
/** 未来距离（毫秒）；用于紧急度判断。 */
export declare function remainingMs(epoch: number, now?: number): number;
/**
 * 构造 `at` 对象：{date, time, time_zone}。
 * @param epoch - 目标 epoch 毫秒。
 * @param timeZone - IANA 时区。
 */
export declare function atObjectOf(epoch: number, timeZone: string): {
    date: string;
    time: string;
    time_zone: string;
};
/** 解析出来的一段本地墙钟。 */
export interface LocalClockParts {
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
    readonly millisecond: number;
}
/**
 * 解析本地墙钟；形状或范围不对（`24:00`、`09:60`、`9:0`）时 `undefined`。
 *
 * 范围检查放这里而不是留给上游：上游那句 `The local at value must be a real ISO calendar
 * date and time...` 对用户是不可读的，守门人应当在边界就给中文结论。
 */
export declare function parseLocalClock(raw: unknown): LocalClockParts | undefined;
/**
 * 把本地墙钟改写成上游必收的形式：`HH:mm:ss`，仅当原文真的写了毫秒才带 `.mmm`。
 *
 * 为什么只在有毫秒时输出 `.mmm`：`09:00:00` 与 `09:00:00.000` 是同一时刻，但把没写毫秒的
 * 输入补成 `.000` 会让「用户/模型到底写没写」这件事在日志里消失。省秒则必须补——上游不收。
 */
export declare function canonicalLocalClock(raw: unknown): string | undefined;
/** 解析本地日历日期，并校验它是**真实存在**的一天（拒 `2026-02-30`）。 */
export declare function parseLocalDate(raw: unknown): {
    year: number;
    month: number;
    day: number;
} | undefined;
/** 把本地日历日期补零成 `YYYY-MM-DD`（上游要求两位月/日）。 */
export declare function canonicalLocalDate(raw: unknown): string | undefined;
/**
 * 把绝对时刻字符串改写成上游必收的形式（`T` 分隔 + 大写 `Z`/带冒号偏移 + 必带秒）。
 *
 * **只做不改变所指时刻的改写**：补秒（`:00`）、`T`/`t`/空格统一、`+0800` → `+08:00`、
 * 毫秒补零。反过来，**没有偏移也没有 `Z` 的串一律拒绝**——`2026-10-26 09:00` 该按哪个时区
 * 解释，插件猜不出来；替用户猜一个时区得到的是「静默错值」，比一次可读的拒绝坏得多
 * （issue #76 的评论里同一条判断）。缺的时区信息必须由调用方给，出路写在报错文案里。
 */
export declare function canonicalInstantString(raw: unknown): string | undefined;
