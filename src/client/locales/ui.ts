/**
 * 客户端微文案字典（8 语言）。
 *
 * 这是本插件**客户端 UI 词条**的唯一事实源。两个出口，都从这里取：
 *  1. `src/client/index.tsx` 的 `locale.register(NS, …)`：在这个 NS 上叠一层设置卡词条
 *     （`./settings.ts`）后整份交给宿主 locale 服务，组件再用插槽给的 `t('key')` 取值
 *     ——active locale 的选择与 `{param}` 插值都由宿主负责；
 *  2. `src/client/strings.ts` 的本地兜底：宿主 `translate` 对未注册的 key 是**返回 key
 *     本身**（不抛错，dsh-client-locale `translate` 的链尾 `?? key`），旧宿主组合还可能
 *     根本不给 `t`。两种情况都回落到这里，见 `useSchedT.ts` 的 {@link schedTranslate}。
 *
 * ## 语言集与 state 声明
 *
 * DSH 的 `LOCALE_IDS` 只强制 `zh` / `en` 两个基线，其余 6 种由 `addLanguage` 注册；
 * 官方第一方包 `dsh-client-ui-schedule` 注册了全 8 种，本模块对齐它。
 *
 * ⚠️ **`zh` 是键的定义来源，`en` 与其余 6 种是机器初翻、未经母语审校**（`en` 由本仓
 * 长期使用，可信度高于另外 6 种，但同样不承诺是地道表达）。翻译只保证：占位符名逐字
 * 保留、专有名词不译、不含零宽字符。语感问题请按语言的母语者 email/PR 修正，不要据此
 * 认为英文文案有问题——`en` 的措辞在大量测试里被逐字钉住（见 `tests/*`）。
 *
 * ## 回退链
 *
 * 宿主对缺失语言回退到 `en`，再找不到才显示 key 本身。所以本仓用映射类型
 * （`{ [K in keyof typeof zh]: string }`）把每一门的键集**编译期**锁死到 `zh`：漏一个键
 * 是 tsc 报错，而不是上线后掉进回退链。
 *
 * @module dsh-later/locales/ui
 */
import { LOCALE_IDS, isLocaleId, type LocaleId } from '../../locales/locale-id.js';
import jaDict from './ui.ja.js';
import esDict from './ui.es.js';
import frDict from './ui.fr.js';
import deDict from './ui.de.js';
import ruDict from './ui.ru.js';
import ptDict from './ui.pt.js';

export { LOCALE_IDS, isLocaleId, type LocaleId };

/**
 * 中文 —— 键的**定义来源**。
 *
 * 导出它，只为让 6 个机器初翻文件能写 `import type { zh }` 并用
 * `{ [K in keyof typeof zh]: string }` 在**编译期**锁住键集（漏键 / 多键都是 tsc 报错）。
 * 运行期没人 import 这个值：各语言文件的 `import type` 会被完全擦除。
 */
export const zh = {
  /** 输入框按钮 tooltip */
  buttonSchedule: '定时发送',
  /** 面板标题 */
  panelTitle: '定时提醒',
  /** 关闭面板 */
  close: '关闭',
  /** 快捷选项 */
  quick10m: '10分钟后',
  quick1h: '1小时后',
  quickSmart: '工作时间',
  quickCustom: '自定义…',
  /** 自定义输入 */
  dateLabel: '日期',
  timeLabel: '时间',
  today: '今天',
  tomorrow: '明天',
  /** 任务列表 */
  taskListTitle: '已设定',
  emptyTasks: '暂无定时任务',
  deleteTask: '删除提醒',
  /** 编辑提醒内容（dock 行内） */
  editTask: '编辑提醒',
  editSave: '保存',
  editCancel: '取消',
  editErrEmpty: '内容不能为空',
  editErrFailed: '修改失败：{message}',
  editErrNotAccepted: '命令未被受理',
  editErrCommandFailed: '命令失败',
  /** 主动插话发送：立即把提醒内容推给 agent（QueueDock「插话发送」语义） */
  steerTask: '插话发送',
  steerAlreadySent: '已插话',
  steerFailed: '插话失败：{message}',
  steerUnsupportedKind: '周期提醒暂不支持插话',
  /** 投递未确认（宿主保留条目，可重试） */
  steerUnconfirmed: '投递未确认，提醒已保留，可重试',
  steerRetry: '重试',
  /** 暂停 / 恢复（仅 after；原地冻结进度条） */
  pauseTask: '暂停提醒',
  resumeTask: '恢复提醒',
  pausedLabel: '已暂停',
  pauseFailed: '暂停失败：{message}',
  resumeFailed: '恢复失败：{message}',
  pauseUnsupportedKind: '仅支持暂停「再等 N 分钟」类提醒',
  /** dock 折叠头计数（QueueDock「N 条排队消息」样式） */
  panelCount: '{n} 条定时提醒',
  /** 精准倒计时（dock 行 + 折叠头） */
  countdownLeft: '剩',
  dueAnyMoment: '即将发送',
  /** 状态 */
  sending: '正在发送…',
  /** dock 折叠头的状态摘要（issue #31：收起时也要播报「未确认」） */
  statusUnconfirmed: '{n} 条未确认',
  /** 确认按钮 */
  confirmAdd: '加入 · {time} 发送',
  confirmAddNoTime: '选择发送时间',
  /** 提示 */
  promptFromDraft: '将以输入框内容作为提醒内容',
  /** 错误提示 */
  errPromptEmpty: '请先在输入框输入内容',
  /**
   * issue #141：上限数字必须是**校验当场**的 `promptLimits.maxChars`，不是写死的
   * 「1000」——旧文案写死默认值，把上限放开到 10000 后，12000 字的内容被告知
   * 「不能超过 1000 字符」，与实际执行的限制自相矛盾。
   *
   * 与 #125（`5d147c6`）的取舍关系——那条给宿主工具描述 `paramPromptDesc`
   * （宿主 `src/locales/host.ts`）选了「说明式、不插值」，这里选**插值**，两处不同是
   * 因为数字的取值时机不同：
   *  - 工具描述在**插件注册时**生成。hydrate 会话在设置注入回调之前就注册，
   *    插值会把注册瞬间的旧值冻进描述里——#125 修的正就是这个；
   *  - 本条是**运行时**文案：`SchedPanel.handleConfirm` 点击当次读出的 `maxChars`
   *    同时喂给 `text.length > maxChars` 校验与这里的 `{maxChars}` 插值，
   *    同源同瞬间，不可能漂移。宿主 `user-tools.ts` 的 `validatePrompt` 运行时
   *    错误同样插真实上限值，本条与之对齐。
   *
   * 所以 #125 定下的规则是「静态说明不写死上限数字；运行时错误文案给出实际值」，
   * 不是「任何文案都不许出现数字」。⚠️ 别据此把数字插回 `paramPromptDesc`。
   */
  errPromptTooLong: '提醒内容不能超过 {maxChars} 字符',
  errTimePast: '请选择未来的时间',
  errCreateFailed: '创建失败：{message}',
  errDeleteFailed: '删除失败：{message}',
  /** 客户端本地错误（hook 抛令牌，UI 按当前语言翻译） */
  errNoSession: '当前无会话',
  errNotAcceptedStashed: '命令未被受理，已暂存本地',
  /** 侧栏会话行「定时状态」badge（docs/ui/09） */
  presenceBadgeAria: '有 {n} 条定时提醒，下次 {time}',
  presenceOverdueAria: '有 {n} 条定时提醒已到期，等待发送',
  presenceTooltip: '下次 {time} · {n} 条任务',
  presenceOverdueTooltip: '已到期 · {n} 条任务（等待会话空闲发送）',
  /** 全部任务都处于暂停：没有排定的触发时刻，故不显示"下次"或"已到期"。 */
  presencePausedAria: '有 {n} 条定时提醒已暂停',
  presencePausedTooltip: '已暂停 · {n} 条任务',
  /** 悬浮卡片状态区追加行（与宿主 hoverStatus 同构，纯追加不改写既有状态） */
  hoverScheduleStatus: '有 {n} 条定时提醒，下次 {time}',
  hoverScheduleOverdue: '有 {n} 条定时提醒已到期，等待发送',
  hoverSchedulePaused: '有 {n} 条定时提醒已暂停',
  /**
   * 折叠分组徽标（facet）里「定时任务」这个词（issue #36）。
   *
   * 措辞与 dsh-group-status 过渡基线（其 `status.scheduled`）**逐字一致**：迁移的验收
   * 标准是注册前后徽标文案不变，这里换措辞就等于单方面改基线。
   * 完整句子由 `laterScheduleFacetLabel` 拼：`${count} ${facetScheduled}`。
   */
  facetScheduled: '定时任务',
  relMinutes: '{m} 分后',
  relHours: '{h} 小时后',
  relTomorrow: '明天 {time}',
  relDate: '{date} {time}',
  relClock: '{time}',
  /** 附件带 a11y（#38）：措辞结构对齐宿主 `queue.image` / `queue.file`，但把「排队」换成「提醒」。 */
  attachmentImage: '提醒图片',
  attachmentFile: '提醒文件 {name}',
  attachmentPendingSend: '发送后可见',
  attachmentUnavailable: '图片不可用',
  attachmentMore: '另有 {n} 个附件未列出',
  /** 定时消息气泡标记（issue #112）：设置项与四种档位。 */
  bubbleMarkerLabel: '定时消息标记',
  bubbleMarkerHint:
      '在 /later 到点送出的消息上加一个时钟标记。left 在气泡左侧常显，meta 在气泡上方加一行小字，'
      + 'hover 只在悬停消息行时出现；关闭后不接管渲染，与官方原样一致。标记只在 0.2.1 及以上的内核生效。',
  bubbleMarkerOption_off: '关闭',
  bubbleMarkerOption_left: '气泡左侧',
  bubbleMarkerOption_meta: '气泡上方',
  bubbleMarkerOption_hover: '悬停显示',
  /** 标记的 a11y 文案与 tooltip（{time} 是送达时刻）。 */
  laterMarkerAria: '定时发送的消息，{time} 送达',
  laterMarkerTooltip: '定时发送 · {time} 送达',
  laterMarkerTooltipBatch: '定时发送 · {time} 送达 · {count} 条合并',
  laterMarkerMeta: '定时发送 · {time}',
  /** 复刻操作行的文案（与官方 chat 的 copy/copied 同义）。 */
  actionCopy: '复制',
  actionCopied: '已复制',
  /** 复刻官方 formatMessageClock 的两段格式（仅同年/跨年用得到）。 */
  clockMd: '{m}月{d}日',
  clockYmd: '{y}年{m}月{d}日',
  /** 相对时间措辞：`formatRelative` 从这里取（client 侧独立于宿主字典）。 */
  relPhraseOverdue: '已到期',
  relPhraseSoon: '即将发送',
  relPhraseMinutes: '约 {m} 分钟后',
  relPhraseHours: '约 {h} 小时后',
  relPhraseHoursMinutes: '约 {h} 小时 {m} 分后',
  relPhraseDays: '约 {d} 天后',
} as const;

/**
 * 英文。
 *
 * 历史与其余语言不同：`en` 在本仓从 1.x 起就是「第二母语」，这里保持它既有的逐字措辞
 * ——多个测试按字面量断言（`tests/dock-*.test.mjs`、`tests/bubble-marker-wiring.test.mjs`、
 * `tests/panel-prompt-limit-copy.test.mjs` 等），改写会连带改断言并引入无价值的 diff。
 */
const en: { [K in keyof typeof zh]: string } = {
  buttonSchedule: 'Schedule send',
  panelTitle: 'Scheduled reminders',
  close: 'Close',
  quick10m: 'In 10 minutes',
  quick1h: 'In 1 hour',
  quickSmart: 'Work hours',
  quickCustom: 'Custom…',
  dateLabel: 'Date',
  timeLabel: 'Time',
  today: 'Today',
  tomorrow: 'Tomorrow',
  taskListTitle: 'Scheduled',
  emptyTasks: 'No scheduled reminders',
  deleteTask: 'Delete reminder',
  editTask: 'Edit reminder',
  editSave: 'Save',
  editCancel: 'Cancel',
  editErrEmpty: 'Reminder content cannot be empty',
  editErrFailed: 'Edit failed: {message}',
  editErrNotAccepted: 'Command was not accepted',
  editErrCommandFailed: 'Command failed',
  steerTask: 'Send now',
  steerAlreadySent: 'Steered',
  steerFailed: 'Steer failed: {message}',
  steerUnsupportedKind: 'Recurring reminders can\'t be steered',
  /** Delivery unconfirmed (host kept the item; retryable) */
  steerUnconfirmed: 'Delivery unconfirmed — reminder kept, you can retry',
  steerRetry: 'Retry',
  pauseTask: 'Pause reminder',
  resumeTask: 'Resume reminder',
  pausedLabel: 'Paused',
  pauseFailed: 'Pause failed: {message}',
  resumeFailed: 'Resume failed: {message}',
  pauseUnsupportedKind: 'Only "wait N minutes" (after) reminders can be paused',
  panelCount: '{n} scheduled reminders',
  countdownLeft: 'in',
  dueAnyMoment: 'Sending soon',
  sending: 'Sending…',
  /** dock collapsed-header status summary (issue #31) */
  statusUnconfirmed: '{n} unconfirmed',
  confirmAdd: 'Add · send at {time}',
  confirmAddNoTime: 'Pick a send time',
  promptFromDraft: 'The composer draft will be used as the reminder content',
  errPromptEmpty: 'Type something in the composer first',
  // {maxChars} 由面板在校验当场插值，取舍与防回退说明见 zh 段同名键上方注释（issue #141）。
  errPromptTooLong: 'Reminder content cannot exceed {maxChars} characters',
  errTimePast: 'Pick a future time',
  errCreateFailed: 'Create failed: {message}',
  errDeleteFailed: 'Delete failed: {message}',
  errNoSession: 'No active session',
  errNotAcceptedStashed: 'Command was not accepted; saved locally',
  presenceBadgeAria: '{n} scheduled reminder(s), next at {time}',
  presenceOverdueAria: '{n} scheduled reminder(s) due, waiting to send',
  presenceTooltip: 'Next at {time} · {n} task(s)',
  presenceOverdueTooltip: 'Due · {n} task(s) (sends when the session is idle)',
  presencePausedAria: '{n} paused reminder(s)',
  presencePausedTooltip: 'Paused · {n} task(s)',
  hoverScheduleStatus: '{n} scheduled reminder(s), next {time}',
  hoverScheduleOverdue: '{n} scheduled reminder(s) due, waiting to send',
  hoverSchedulePaused: '{n} paused reminder(s)',
  /** 与 zh 侧同键：措辞与 group-status 的 `status.scheduled` 逐字一致（见 zh 段注释）。 */
  facetScheduled: 'Scheduled',
  relMinutes: 'in {m} min',
  relHours: 'in {h} h',
  relTomorrow: 'Tomorrow {time}',
  relDate: '{date} {time}',
  relClock: '{time}',
  attachmentImage: 'Reminder image',
  attachmentFile: 'Reminder file {name}',
  attachmentPendingSend: 'Available after send',
  attachmentUnavailable: 'Image unavailable',
  attachmentMore: '{n} more attachment(s)',
  bubbleMarkerLabel: 'Scheduled message marker',
  bubbleMarkerHint:
      'Add a clock marker to messages delivered by /later. left shows it beside the bubble, '
      + 'meta adds a small line above, hover reveals it when the row is hovered; off leaves the '
      + 'official renderer untouched. Only available on kernel 0.2.1 and later.',
  bubbleMarkerOption_off: 'Off',
  bubbleMarkerOption_left: 'Beside bubble',
  bubbleMarkerOption_meta: 'Above bubble',
  bubbleMarkerOption_hover: 'On hover',
  laterMarkerAria: 'Scheduled message, delivered {time}',
  laterMarkerTooltip: 'Scheduled · delivered {time}',
  laterMarkerTooltipBatch: 'Scheduled · delivered {time} · {count} merged',
  laterMarkerMeta: 'Scheduled · {time}',
  actionCopy: 'Copy',
  actionCopied: 'Copied',
  clockMd: '{m}/{d}',
  clockYmd: '{y}-{m}-{d}',
  relPhraseOverdue: 'overdue',
  relPhraseSoon: 'sending soon',
  relPhraseMinutes: 'in ~{m} min',
  relPhraseHours: 'in ~{h} h',
  relPhraseHoursMinutes: 'in ~{h} h {m} min',
  relPhraseDays: 'in ~{d} days',
};

/** 单语言文案字典类型（宽化为 string）。 */
export type SchedStrings = { [K in keyof typeof zh]: string };

/**
 * 本插件 UI 词条的键联合（与官方 `ConversationKey = keyof typeof …` 同形）。
 *
 * 用途有两个，都不是装饰：
 *  - 合进宿主 `LocaleNamespaceMap`，让插槽的 `PropsLocale<NS>` 真的给出 `t`
 *    （写成对象/字典形状会直接塌成 `object`，`t` 压根不进 props 类型，见
 *    dsh-client-ui-slots `LocaleKeysOf` / `PropsLocale`）；
 *  - 约束兜底取值函数的 key，拼错 key 在 typecheck 就失败，而不是静默显示原文。
 */
export type SchedUIKey = keyof SchedStrings;

/**
 * 全部 8 门字典。
 *
 * 每门都写成 `{ [K in keyof typeof zh]: string }` 标注的常量（不复用 `SchedStrings`
 * 别名）：别名求值后就宽化成 `string`，漏键仍是错误，但把 `ja` 换成 `es` 这种**整块串门**
 * 不会报错——这是这台机器上最可能发生的一类错。就地标注时每门外形不同，逐块看才看得出来。
 */
export const schedDicts: Record<LocaleId, SchedStrings> = {
  zh,
  en,
  ja: jaDict,
  es: esDict,
  fr: frDict,
  de: deDict,
  ru: ruDict,
  pt: ptDict,
};

/**
 * 按 locale id 取客户端 UI 字典。
 *
 * 未收录 id 回退中文——这是**本地兜底路径**的既有语义，与 `hostDictFor` 同规则，不要改。
 * 走宿主 seat 的时候回退链归宿主管（`ja → en → key 本身`），本函数压根不参与。
 * @param localeId - 宿主 active locale id（可为 undefined）。
 * @returns 该语言字典；未收录回退 `zh`。
 */
export function dictFor(localeId: string | undefined): SchedStrings {
  return schedDicts[isLocaleId(localeId) ? localeId : 'zh'];
}

/** 把 {time} / {message} 类占位符替换为参数。 */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}
