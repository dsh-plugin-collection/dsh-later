const zh = {
    toolCreateDesc: '为用户创建一条当前会话内的定时提醒。必须提供非空提示与恰好一个选择器：after_seconds（正整数延时秒）、at（显式偏移时间或 {date,time,time_zone} 本地时间）、every_seconds（≥300 的固定间隔秒）。time_zone 可选，缺省用会话检测时区。创建来源被标记为用户工具，GUI 面板会展示。' +
        'every_seconds 是**无结束条件**的固定间隔（会一直发下去，直到用户删除）；用户说了次数上限（如「每小时提醒我一次，持续 3 次」）时不要用 every_seconds，改为**逐条调用本工具 N 次**、每次用 at 给出对应的绝对时刻（t+1h、t+2h、t+3h）。',
    toolListDesc: '列出当前会话内用户创建的活动定时提醒（含 id、UTC 目标、scheduled/overdue 状态、投递模式）。',
    toolDeleteDesc: '按 user_schedule_create / user_schedule_list 返回的精确 id 删除一条活动提醒；未知或已结束返回 deleted:false。',
    paramPromptDesc: '提醒内容（trim 后非空）。长度上限由插件设置的「允许长文本」决定：默认 1000 字符，可在设置里放开；超长会返回 invalid_prompt，错误文案里给出当前实际允许的字符数。',
    paramAfterSecondsDesc: '正整数延时秒数。',
    paramEverySecondsDesc: '固定间隔秒数，至少 300；无结束条件（有次数上限请改为逐条创建 at）。',
    paramAtDesc: '绝对目标：带显式时区的 RFC 3339 字符串（以 Z 或 ±HH:mm 结尾），或 {date, time, time_zone} 本地日历对象。'
        + '本地 time 接受 HH:mm 与 HH:mm:ss（可带 1–3 位毫秒），本插件会补齐成上游要求的 HH:mm:ss；'
        + '不带任何时区信息的字符串会被拒绝——不替用户猜时区。',
    paramTimeZoneDesc: 'IANA 时区（如 Asia/Shanghai）；可选，缺省用会话检测时区。',
    paramIdDesc: '精确会话内 schedule id。',
    presentCreate: '创建定时提醒',
    presentList: '列出定时提醒',
    presentDelete: '删除定时提醒',
    cmdLaterDesc: '创建一条会话内定时提醒（GUI 内部通道）。',
    cmdScheduleDesc: '创建一条会话内定时提醒（GUI 内部通道）。',
    cmdListDesc: '列出当前会话用户创建的定时提醒（GUI 内部通道）。',
    cmdDeleteDesc: '删除一条会话内定时提醒（GUI 内部通道）。',
    cmdEditDesc: '修改一条会话内定时提醒的内容（保留原时刻；GUI 内部通道）。',
    cmdPauseDesc: '暂停一条 after 类定时提醒（仅 GUI 内部通道；已到点不可暂停）。',
    cmdResumeDesc: '恢复一条已暂停的 after 提醒（仅 GUI 内部通道）。',
    cmdSteerDesc: '插话发送：把指定 id 的提醒立即推给 agent（仅 one-shot；GUI 内部通道）。',
    errEmptyPrompt: '提醒内容不能为空。',
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
    warnSchedulerNotArmed: '注意：本会话的调度器未挂载，这条提醒到点不会触发。请重启宿主进程或新开一个会话后重建（插件热重载后，重载前就已存在的会话可能挂不回来）。',
};
const en = {
    toolCreateDesc: 'Create a scheduled reminder for the current session. Must provide a non-empty prompt and exactly one selector: after_seconds (positive integer delay), at (explicit offset time or {date,time,time_zone} local time), or every_seconds (≥300 fixed interval). time_zone is optional; defaults to session-detected timezone. Source is marked as user tool; GUI panel will display it.' +
        'every_seconds is a **non-terminating** fixed interval (runs forever until deleted); when the user specifies a count limit (e.g., "remind me every hour for 3 times"), do NOT use every_seconds — instead **call this tool N times separately**, each with at giving the corresponding absolute time (t+1h, t+2h, t+3h).',
    toolListDesc: 'List active scheduled reminders created by the user in the current session (includes id, UTC target, scheduled/overdue status, delivery mode).',
    toolDeleteDesc: 'Delete an active reminder by the exact id returned from user_schedule_create / user_schedule_list; unknown or expired ids return deleted:false.',
    paramPromptDesc: 'Reminder content (non-empty after trim). The limit follows the plugin setting "allow long prompts": 1000 characters by default, raisable in settings; an over-limit call returns invalid_prompt whose message states the currently allowed length.',
    paramAfterSecondsDesc: 'Positive integer delay in seconds.',
    paramEverySecondsDesc: 'Fixed interval in seconds, at least 300; non-terminating (for count limits, create multiple items with at instead).',
    paramAtDesc: 'Absolute target: an RFC 3339 string with an explicit zone (ending in Z or ±HH:mm), or a {date, time, time_zone} local calendar object. '
        + 'Local time accepts HH:mm and HH:mm:ss (1-3 digit ms allowed); the plugin pads it to the HH:mm:ss the upstream requires. '
        + 'A string without any zone is rejected rather than guessed at.',
    paramTimeZoneDesc: 'IANA timezone (e.g., Asia/Shanghai); optional, defaults to session-detected timezone.',
    paramIdDesc: 'Exact session-internal schedule id.',
    presentCreate: 'Create scheduled reminder',
    presentList: 'List scheduled reminders',
    presentDelete: 'Delete scheduled reminder',
    cmdLaterDesc: 'Create a session-internal scheduled reminder (GUI internal channel).',
    cmdScheduleDesc: 'Create a session-internal scheduled reminder (GUI internal channel).',
    cmdListDesc: 'List scheduled reminders created by the user in the current session (GUI internal channel).',
    cmdDeleteDesc: 'Delete a session-internal scheduled reminder (GUI internal channel).',
    cmdEditDesc: 'Edit the content of a session-internal scheduled reminder (keeps original time; GUI internal channel).',
    cmdPauseDesc: 'Pause an after-type scheduled reminder (GUI internal channel only; cannot pause if already due).',
    cmdResumeDesc: 'Resume a paused after-type reminder (GUI internal channel only).',
    cmdSteerDesc: 'Steer now: immediately push the specified reminder to the agent (one-shot only; GUI internal channel).',
    errEmptyPrompt: 'Reminder content cannot be empty.',
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
    warnSchedulerNotArmed: 'Warning: this session has no scheduler mounted, so this reminder will NOT fire. Restart the host process or open a new session and recreate it (sessions that existed before a plugin hot-reload may fail to remount).',
};
export const hostDicts = { zh, en };
export function hostDictFor(localeId) {
    return localeId === 'en' ? hostDicts.en : hostDicts.zh;
}
export function hostFormat(template, params) {
    return template.replace(/\{(\w+)\}/g, (_, key) => key in params ? String(params[key]) : `{${key}}`);
}
