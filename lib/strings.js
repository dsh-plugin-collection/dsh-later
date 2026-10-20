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
const zh = {
    // 工具描述（模型 system-prompt）
    toolCreateDesc: '为用户创建一条当前会话内的定时提醒。必须提供非空提示与恰好一个选择器：after_seconds（正整数延时秒）、at（显式偏移时间或 {date,time,time_zone} 本地时间）、every_seconds（≥300 的固定间隔秒）。time_zone 可选，缺省用会话检测时区。创建来源被标记为用户工具，GUI 面板会展示。' +
        'every_seconds 是**无结束条件**的固定间隔（会一直发下去，直到用户删除）；用户说了次数上限（如「每小时提醒我一次，持续 3 次」）时不要用 every_seconds，改为**逐条调用本工具 N 次**、每次用 at 给出对应的绝对时刻（t+1h、t+2h、t+3h）。',
    toolListDesc: '列出当前会话内用户创建的活动定时提醒（含 id、UTC 目标、scheduled/overdue 状态、投递模式）。',
    toolDeleteDesc: '按 user_schedule_create / user_schedule_list 返回的精确 id 删除一条活动提醒；未知或已结束返回 deleted:false。',
    // 工具参数描述
    paramPromptDesc: '提醒内容（trim 后非空，≤{maxChars} 字符；超过会返回 invalid_prompt）。',
    paramAfterSecondsDesc: '正整数延时秒数。',
    paramEverySecondsDesc: '固定间隔秒数，至少 300；无结束条件（有次数上限请改为逐条创建 at）。',
    paramAtDesc: '绝对目标：显式偏移的 RFC 3339 字符串，或 {date, time, time_zone} 本地日历对象。',
    paramTimeZoneDesc: 'IANA 时区（如 Asia/Shanghai）；可选，缺省用会话检测时区。',
    paramIdDesc: '精确会话内 schedule id。',
    // 工具调用行标题（present()）
    presentCreate: '创建定时提醒',
    presentList: '列出定时提醒',
    presentDelete: '删除定时提醒',
    // Slash 命令描述
    cmdLaterDesc: '创建一条会话内定时提醒（GUI 内部通道）。',
    cmdScheduleDesc: '创建一条会话内定时提醒（GUI 内部通道）。',
    cmdListDesc: '列出当前会话用户创建的定时提醒（GUI 内部通道）。',
    cmdDeleteDesc: '删除一条会话内定时提醒（GUI 内部通道）。',
    cmdEditDesc: '修改一条会话内定时提醒的内容（保留原时刻；GUI 内部通道）。',
    cmdPauseDesc: '暂停一条 after 类定时提醒（仅 GUI 内部通道；已到点不可暂停）。',
    cmdResumeDesc: '恢复一条已暂停的 after 提醒（仅 GUI 内部通道）。',
    cmdSteerDesc: '插话发送：把指定 id 的提醒立即推给 agent（仅 one-shot；GUI 内部通道）。',
    // 运行时错误消息
    errEmptyPrompt: '提醒内容不能为空。',
    errPromptTooLong: '提醒内容不能超过 {maxChars} 字符。',
    errInvalidSelector: '必须提供 after_seconds、at 或 every_seconds 之一。',
    errMultipleSelectors: 'after_seconds、at、every_seconds 只能提供一个。',
    errNotFuture: '时间必须是未来。',
    errTimeOutOfRange: '时间超出允许范围。',
    errFrequencyTooHigh: '频率过高。',
    errInvalidRule: '规则无效。',
    errSubagentSession: '该会话属于子 agent 委派，永远不会收到提醒投递。',
    errScheduleNotFound: '提醒不存在。',
    errAlreadyOverdue: '提醒已到期。',
    errQuotaExceeded: '已达任务上限（{max} 条）。',
    errPersistenceUncertain: '持久化不确定。',
    errUnsupportedKind: '不支持的操作类型。',
    errNotPaused: '提醒未暂停。',
    errInternalError: '操作失败。',
};
const en = {
    // Tool descriptions (model system-prompt)
    toolCreateDesc: 'Create a scheduled reminder for the current session. Must provide a non-empty prompt and exactly one selector: after_seconds (positive integer delay), at (explicit offset time or {date,time,time_zone} local time), or every_seconds (≥300 fixed interval). time_zone is optional; defaults to session-detected timezone. Source is marked as user tool; GUI panel will display it.' +
        'every_seconds is a **non-terminating** fixed interval (runs forever until deleted); when the user specifies a count limit (e.g., "remind me every hour for 3 times"), do NOT use every_seconds — instead **call this tool N times separately**, each with at giving the corresponding absolute time (t+1h, t+2h, t+3h).',
    toolListDesc: 'List active scheduled reminders created by the user in the current session (includes id, UTC target, scheduled/overdue status, delivery mode).',
    toolDeleteDesc: 'Delete an active reminder by the exact id returned from user_schedule_create / user_schedule_list; unknown or expired ids return deleted:false.',
    // Tool parameter descriptions
    paramPromptDesc: 'Reminder content (non-empty after trim, ≤{maxChars} characters; exceeds returns invalid_prompt).',
    paramAfterSecondsDesc: 'Positive integer delay in seconds.',
    paramEverySecondsDesc: 'Fixed interval in seconds, at least 300; non-terminating (for count limits, create multiple items with at instead).',
    paramAtDesc: 'Absolute target: explicit offset RFC 3339 string, or {date, time, time_zone} local calendar object.',
    paramTimeZoneDesc: 'IANA timezone (e.g., Asia/Shanghai); optional, defaults to session-detected timezone.',
    paramIdDesc: 'Exact session-internal schedule id.',
    // Tool call line titles (present())
    presentCreate: 'Create scheduled reminder',
    presentList: 'List scheduled reminders',
    presentDelete: 'Delete scheduled reminder',
    // Slash command descriptions
    cmdLaterDesc: 'Create a session-internal scheduled reminder (GUI internal channel).',
    cmdScheduleDesc: 'Create a session-internal scheduled reminder (GUI internal channel).',
    cmdListDesc: 'List scheduled reminders created by the user in the current session (GUI internal channel).',
    cmdDeleteDesc: 'Delete a session-internal scheduled reminder (GUI internal channel).',
    cmdEditDesc: 'Edit the content of a session-internal scheduled reminder (keeps original time; GUI internal channel).',
    cmdPauseDesc: 'Pause an after-type scheduled reminder (GUI internal channel only; cannot pause if already due).',
    cmdResumeDesc: 'Resume a paused after-type reminder (GUI internal channel only).',
    cmdSteerDesc: 'Steer now: immediately push the specified reminder to the agent (one-shot only; GUI internal channel).',
    // Runtime error messages
    errEmptyPrompt: 'Reminder content cannot be empty.',
    errPromptTooLong: 'Reminder content cannot exceed {maxChars} characters.',
    errInvalidSelector: 'Must provide one of after_seconds, at, or every_seconds.',
    errMultipleSelectors: 'Can only provide one of after_seconds, at, or every_seconds.',
    errNotFuture: 'Time must be in the future.',
    errTimeOutOfRange: 'Time is out of allowed range.',
    errFrequencyTooHigh: 'Frequency is too high.',
    errInvalidRule: 'Rule is invalid.',
    errSubagentSession: 'This session belongs to subagent routing, which never receives reminder delivery.',
    errScheduleNotFound: 'Reminder does not exist.',
    errAlreadyOverdue: 'Reminder is already due.',
    errQuotaExceeded: 'Reached task limit ({max} items).',
    errPersistenceUncertain: 'Persistence uncertain.',
    errUnsupportedKind: 'Unsupported operation type.',
    errNotPaused: 'Reminder is not paused.',
    errInternalError: 'Operation failed.',
};
/** 全部 locale 字典（键集一致，由 en 的映射类型保证）。 */
export const hostDicts = { zh, en };
/** 按 locale id 取字典；未收录 id 回退中文。 */
export function hostDictFor(localeId) {
    return localeId === 'en' ? hostDicts.en : hostDicts.zh;
}
/** 把 {maxChars} / {max} 类占位符替换为参数。 */
export function hostFormat(template, params) {
    return template.replace(/\{(\w+)\}/g, (_, key) => key in params ? String(params[key]) : `{${key}}`);
}
