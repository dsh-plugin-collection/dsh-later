/**
 * 宿主侧微文案字典（双语：跟随宿主 DSH 的 locale 设置）。
 *
 * 与客户端 strings.ts 对称，但宿主侧文案在工具注册时一次性确定（模型 system-prompt
 * 工具清单 + GUI 工具调用行标题 + slash 命令描述），不随 locale 实时切换。
 *
 * 语言解析：工具注册时从 locale 服务读取当前 active id（zh/en），据此选择字典。
 * locale 服务缺失或 id 未收录时回退中文（v1 默认语言）。
 * @module dsh-later/strings
 */
export type HostLocaleId = 'zh' | 'en';
declare const zh: {
    readonly toolCreateDesc: string;
    readonly toolListDesc: "列出当前会话内用户创建的活动定时提醒（含 id、UTC 目标、scheduled/overdue 状态、投递模式）。";
    readonly toolDeleteDesc: "按 user_schedule_create / user_schedule_list 返回的精确 id 删除一条活动提醒；未知或已结束返回 deleted:false。";
    readonly paramPromptDesc: "提醒内容（trim 后非空，≤{maxChars} 字符；超过会返回 invalid_prompt）。";
    readonly paramAfterSecondsDesc: "正整数延时秒数。";
    readonly paramEverySecondsDesc: "固定间隔秒数，至少 300；无结束条件（有次数上限请改为逐条创建 at）。";
    readonly paramAtDesc: "绝对目标：显式偏移的 RFC 3339 字符串，或 {date, time, time_zone} 本地日历对象。";
    readonly paramTimeZoneDesc: "IANA 时区（如 Asia/Shanghai）；可选，缺省用会话检测时区。";
    readonly paramIdDesc: "精确会话内 schedule id。";
    readonly presentCreate: "创建定时提醒";
    readonly presentList: "列出定时提醒";
    readonly presentDelete: "删除定时提醒";
    readonly cmdLaterDesc: "创建一条会话内定时提醒（GUI 内部通道）。";
    readonly cmdScheduleDesc: "创建一条会话内定时提醒（GUI 内部通道）。";
    readonly cmdListDesc: "列出当前会话用户创建的定时提醒（GUI 内部通道）。";
    readonly cmdDeleteDesc: "删除一条会话内定时提醒（GUI 内部通道）。";
    readonly cmdEditDesc: "修改一条会话内定时提醒的内容（保留原时刻；GUI 内部通道）。";
    readonly cmdPauseDesc: "暂停一条 after 类定时提醒（仅 GUI 内部通道；已到点不可暂停）。";
    readonly cmdResumeDesc: "恢复一条已暂停的 after 提醒（仅 GUI 内部通道）。";
    readonly cmdSteerDesc: "插话发送：把指定 id 的提醒立即推给 agent（仅 one-shot；GUI 内部通道）。";
    readonly errEmptyPrompt: "提醒内容不能为空。";
    readonly errPromptTooLong: "提醒内容不能超过 {maxChars} 字符。";
    readonly errInvalidSelector: "必须提供 after_seconds、at 或 every_seconds 之一。";
    readonly errMultipleSelectors: "after_seconds、at、every_seconds 只能提供一个。";
    readonly errNotFuture: "时间必须是未来。";
    readonly errTimeOutOfRange: "时间超出允许范围。";
    readonly errFrequencyTooHigh: "频率过高。";
    readonly errInvalidRule: "规则无效。";
    readonly errSubagentSession: "该会话属于子 agent 委派，永远不会收到提醒投递。";
    readonly errScheduleNotFound: "提醒不存在。";
    readonly errAlreadyOverdue: "提醒已到期。";
    readonly errQuotaExceeded: "已达任务上限（{max} 条）。";
    readonly errPersistenceUncertain: "持久化不确定。";
    readonly errUnsupportedKind: "不支持的操作类型。";
    readonly errNotPaused: "提醒未暂停。";
    readonly errInternalError: "操作失败。";
    readonly warnSchedulerNotArmed: "注意：本会话的调度器未挂载，这条提醒到点不会触发。请重启宿主进程或新开一个会话后重建（插件热重载后，重载前就已存在的会话可能挂不回来）。";
};
/** 单语言文案字典类型（宽化为 string，zh/en 通用）。 */
export type HostStrings = {
    [K in keyof typeof zh]: string;
};
/** 全部 locale 字典（键集一致，由 en 的映射类型保证）。 */
export declare const hostDicts: Record<HostLocaleId, HostStrings>;
/** 按 locale id 取字典；未收录 id 回退中文。 */
export declare function hostDictFor(localeId: string | undefined): HostStrings;
/** 把 {maxChars} / {max} 类占位符替换为参数。 */
export declare function hostFormat(template: string, params: Record<string, string | number>): string;
export {};
