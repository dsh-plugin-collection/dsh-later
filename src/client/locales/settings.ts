/**
 * 设置卡（`settings.plugin.item` / `plugins.bundle.config`）微文案字典（8 语言）。
 *
 * 作用域与 `./ui.ts` **分开**，不并成一个平面命名空间：设置卡的词条只经
 * `src/client/index.tsx` 的 `locale.register(NS, …)` 交进宿主，dock / 面板不读它们；
 * 反过来，dock 的本地兜底只读 `schedDicts`，不背这 63 条。两者唯一的交叉点在注册处—
 * 那里必须是**一个对象、一次注册**（同 NS 二次 `register` 宿主直接抛
 * `locale namespace "…" already has locale "zh"`），所以合并发生在 `mergedFor()`，
 * 不是在各语言文件里互抄一遍。
 *
 * 语言状态与 `./ui.ts` 相同：`zh` 定义键集，`en` 是历史英文措辞，其余 6 种**机器初翻、
 * 未经母语审校**。
 * @module dsh-later/locales/settings
 */
import type { LocaleId } from '../../locales/locale-id.js';
import type { SchedStrings } from './ui.js';
import { schedDicts } from './ui.js';
import jaDict from './settings.ja.js';
import esDict from './settings.es.js';
import frDict from './settings.fr.js';
import deDict from './settings.de.js';
import ruDict from './settings.ru.js';
import ptDict from './settings.pt.js';

/**
 * 中文 —— 键的**定义来源**。
 *
 * 导出它，只为让 6 个机器初翻文件能写 `import type { zh }` 并用
 * `{ [K in keyof typeof zh]: string }` 在**编译期**锁住键集（漏键 / 多键都是 tsc 报错）。
 * 运行期没人 import 这个值：各语言文件的 `import type` 会被完全擦除。
 */
export const zh = {
  title: '定时提醒',
  description: '配置会话内定时提醒的参数。',
  pendingBadge: '未保存',
  expand: '展开设置',
  collapse: '收起设置',
  readOnly: '本部署的设置为只读。',
  sectionDisplay: '显示设置',
  sectionTime: '时间设置',
  sectionDelivery: '投递设置',
  sectionAdvanced: '高级语法',
  betaBadge: '实验性',
  betaBadgeAria: '实验性功能，行为可能随版本调整',
  advancedSyntaxLabel: '启用多次写法（+1h*3 / 15:32+16:32）',
  advancedSyntaxHint: '让 /later 与 /schedule 支持一次写多条：+1h*3（等间隔 3 次）、+1h+1h+0.5h（相对序列）、15:32+16:32 与 9:00+1d（锚点序列，按墙钟推进，跨夏令时不漂）。每条都是独立任务，可单独取消或编辑；单次最多 10 条。标记为实验性：展开后的观感与条数上限仍需观察。',
  showButtonLabel: '显示定时按钮',
  showButtonHint: '关闭后输入框右侧不再显示时钟按钮；已创建的提醒仍会照常触发，并在输入框下方的待发送列表中显示。',
  showInGroupBadgeLabel: '在分组徽标中显示定时任务',
  showInGroupBadgeHint: '关闭后不再向 dsh-group-status 的折叠分组徽标登记「定时任务」这一格，徽标上不再出现定时任务计数。提醒本身照常触发，输入框下方的待发送列表与侧栏状态不受影响；未安装 dsh-group-status 时这一项没有可见效果。',
  maxSchedulesLabel: '单会话任务上限',
  maxSchedulesHint: '单个会话内允许创建的最大定时任务数量。',
  allowLongPromptsLabel: '允许长文本提醒',
  allowLongPromptsHint: '解除默认 1000 字符的上限。开启后可用「提示字符上限」自定义最大长度；关闭时该上限不生效，恒为 1000。',
  maxPromptCharsLabel: '提示字符上限',
  maxPromptCharsHint: '提醒内容最大字符数（仅在「允许长文本提醒」开启时生效）。',
  maxPromptCharsLockedHint: '开启「允许长文本提醒」后可调。',
  smartWindowHint: '用于「工作时间」芯片与智能模式自动排期。',
  smartWindowOrderHint: '五个时段需依次递增：工作时间开始 < 午休开始 < 午休结束 < 工作时间结束 < 夜间静默起点。',
  workStartLabel: '工作时间开始',
  workEndLabel: '工作时间结束（晚间开始）',
  lunchStartLabel: '午休开始',
  lunchEndLabel: '午休结束',
  eveningEndLabel: '夜间静默起点',
  steerDeliveryLabel: '插话投递方式',
  steerDeliveryHint: '「插话发送」把提醒内容推给会话时进入的队列。',
  steerDeliveryOption_followup: '独立成一轮（推荐）',
  steerDeliveryOption_steer: '插入当前回合（更快）',
  confirmDeliveryLabel: '投递确认',
  confirmDeliveryHint: '投递后核对会话日志，确认消息真正进入请求。关闭则不再核对，也不保证送达。',
  onUnconfirmedLabel: '未确认时',
  onUnconfirmedHint: '投递未能确认时的处理方式。',
  onUnconfirmedOption_keep: '保留条目可重试（推荐）',
  onUnconfirmedOption_discard: '丢弃',
  clockIconStyleLabel: '时钟图标风格',
  clockIconStyleHint: '侧栏会话行定时状态图标的显示风格。',
  clockIconStyleOption_auto: '自动（推荐）',
  clockIconStyleOption_modern: '新版描边风格',
  clockIconStyleOption_classic: '旧版点阵风格',
  steerRiskGuarded: '⚠ 撞上回合启动时可能被吞掉；已开启投递确认，未送达会保留条目并可重试。',
  steerRiskUnguarded: '⚠ 撞上回合启动时可能被吞掉，且不会保留条目（投递确认已关闭）。',
  discardRisk: '⚠ 未确认的提醒会被移出列表 —— 静默丢失将重新变得可能。',
  overriddenLabel: '已覆盖',
  resetLabel: '重置',
  invalidLabel: '请输入有效的数字。',
  invalidTimeLabel: '请使用 HH:mm 24 小时制时间。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '保存失败，请重试。',
  loading: '加载中…',
  unavailable: '设置暂不可用。',
  sectionDisplayToggle: '设置入口',
  showInSettings: '在设置中显示',
  showInSettingsHint: '在设置对话框中显示本插件的设置页（刷新页面后生效）',
} as const;

/**
 * 英文。逐字保留历史措辞：`tests/group-badge-visibility.test.mjs` 与
 * `tests/settings-section-headings.test.mjs` 按字面量读这一段。
 */
const en: { [K in keyof typeof zh]: string } = {
  title: 'Session Scheduler',
  description: 'Configure in-session scheduled reminders.',
  pendingBadge: 'Unsaved',
  expand: 'Show settings',
  collapse: 'Hide settings',
  readOnly: 'Settings for this deployment are read-only.',
  sectionDisplay: 'Display',
  sectionTime: 'Time windows',
  sectionDelivery: 'Delivery',
  sectionAdvanced: 'Advanced syntax',
  betaBadge: 'Beta',
  betaBadgeAria: 'Beta feature; behaviour may change between versions',
  advancedSyntaxLabel: 'Multi-shot syntax (+1h*3 / 15:32+16:32)',
  advancedSyntaxHint: 'Let /later and /schedule create several tasks at once: +1h*3 (same interval N times), +1h+1h+0.5h (relative chain), 15:32+16:32 and 9:00+1d (anchored on a wall clock — it keeps the clock time across DST). Each occurrence is an independent task you can cancel or edit on its own; up to 10 per command. Marked Beta: the expanded result and the 10-task cap still need real-world observation.',
  showButtonLabel: 'Show schedule button',
  showButtonHint: 'Hide the clock button on the input bar. Existing reminders keep firing and stay visible in the dock below the composer.',
  showInGroupBadgeLabel: 'Show scheduled in group badge',
  showInGroupBadgeHint: 'Stop registering the "Scheduled" cell on dsh-group-status\'s folded-group badge, so its count disappears. Reminders keep firing and stay visible in the dock below the composer and in the sidebar; this row has no visible effect when dsh-group-status is not installed.',
  maxSchedulesLabel: 'Max schedules per session',
  maxSchedulesHint: 'Maximum number of scheduled reminders allowed per session.',
  allowLongPromptsLabel: 'Allow long reminder prompts',
  allowLongPromptsHint: 'Lift the default 1000-character cap. Once enabled, "Max prompt characters" lets you set a custom ceiling; while disabled that ceiling has no effect and stays at 1000.',
  maxPromptCharsLabel: 'Max prompt characters',
  maxPromptCharsHint: 'Maximum characters per reminder (takes effect only when "Allow long reminder prompts" is on).',
  maxPromptCharsLockedHint: 'Adjustable after enabling "Allow long reminder prompts".',
  smartWindowHint: 'Used by the Work-hours chip and smart auto-scheduling.',
  smartWindowOrderHint: 'The five windows must increase in order: work start < lunch start < lunch end < work end < night quiet.',
  workStartLabel: 'Work day start',
  workEndLabel: 'Work day end (evening start)',
  lunchStartLabel: 'Lunch break start',
  lunchEndLabel: 'Lunch break end',
  eveningEndLabel: 'Night quiet starts at',
  steerDeliveryLabel: 'Interject delivery',
  steerDeliveryHint: 'Which queue the reminder content enters when you press "Send interjection".',
  steerDeliveryOption_followup: 'Own turn (recommended)',
  steerDeliveryOption_steer: 'Current turn (faster)',
  confirmDeliveryLabel: 'Confirm delivery',
  confirmDeliveryHint: 'After sending, check the session log to confirm the message actually entered a request. Turning this off skips the check and no longer guarantees delivery.',
  onUnconfirmedLabel: 'When unconfirmed',
  onUnconfirmedHint: 'What to do when delivery cannot be confirmed.',
  onUnconfirmedOption_keep: 'Keep for retry (recommended)',
  onUnconfirmedOption_discard: 'Discard',
  clockIconStyleLabel: 'Clock icon style',
  clockIconStyleHint: 'Display style of the schedule status icon in the sidebar.',
  clockIconStyleOption_auto: 'Auto (recommended)',
  clockIconStyleOption_modern: 'Modern stroke style',
  clockIconStyleOption_classic: 'Classic dot-matrix style',
  steerRiskGuarded: '⚠ May be swallowed when it collides with turn start; delivery confirmation is on, so an undelivered reminder is kept and can be retried.',
  steerRiskUnguarded: '⚠ May be swallowed when it collides with turn start, and the reminder will NOT be kept (delivery confirmation is off).',
  discardRisk: '⚠ Unconfirmed reminders are removed from the list — silent loss becomes possible again.',
  overriddenLabel: 'Overridden',
  resetLabel: 'Reset',
  invalidLabel: 'Please enter a valid number.',
  invalidTimeLabel: 'Use 24-hour HH:mm format.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'Save failed, please try again.',
  loading: 'Loading…',
  unavailable: 'Settings unavailable.',
  sectionDisplayToggle: 'Settings entry',
  showInSettings: 'Show in settings',
  showInSettingsHint: 'Show this plugin\'s settings page in the settings dialog (refresh to take effect)',
};

/** 设置卡词条的键联合。 */
export type SettingsUIKey = keyof typeof zh;

/** 单语言设置卡字典类型（宽化为 string）。 */
export type SettingsStrings = { [K in keyof typeof zh]: string };

/**
 * 8 门设置卡字典。每门就地标注映射类型，理由同 `ui.ts` 的 `schedDicts`：
 * 复用 `SettingsStrings` 别名会让「整块串门」这种错失去编译期报错。
 */
export const settingsDicts: Record<LocaleId, SettingsStrings> = {
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
 * 注册进宿主 locale 服务的那一份：UI 词条 + 设置卡词条。
 *
 * ⚠️ 这个合并**只能在这里发生一次**。两个作用域的键集必须不交叠，否则后写入的会静默
 * 覆盖先写入的——`tests/locales-8-langs.test.mjs` 把这条钉成断言。
 * @param localeId - 语言 id。
 * @returns 该语言的合并字典。
 */
export function mergedFor(localeId: LocaleId): SchedStrings & SettingsStrings {
  return { ...schedDicts[localeId], ...settingsDicts[localeId] } as SchedStrings & SettingsStrings;
}
