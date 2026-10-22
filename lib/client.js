window.__ModuleLoader__.load({
	id: "dsh-later",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  buildScheduleSummary: () => buildScheduleSummary,
  createScheduleSummaryStore: () => createScheduleSummaryStore,
  getScheduleSummaryStore: () => getScheduleSummaryStore,
  inject: () => inject,
  name: () => name,
  schedulesOfProjection: () => schedulesOfProjection,
  subscribeScheduleSummaryStore: () => subscribeScheduleSummaryStore,
  summarizeScheduleGroup: () => summarizeScheduleGroup,
  useScheduleSummary: () => useScheduleSummary
});
module.exports = __toCommonJS(index_exports);

// node_modules/.pnpm/@deepseek-ai+dsh-util-workspace-path@0.2.1-rc.2_@deepseek-ai+cordis@4.0.2/node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js
function isWindowsStylePath(value) {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
}
function isAbsoluteWorkspacePath(path) {
  return path.startsWith("/") || isWindowsStylePath(path);
}
function fileMediaUrl(base, path) {
  if (!/^https?:/u.test(base) && !base.startsWith("dsh-app://app/") || !isAbsoluteWorkspacePath(path) || /^[/\\]{2}/u.test(path) || /[\u0000-\u001f\u007f]/u.test(path)) return void 0;
  return new URL(`api/file?path=${encodeURIComponent(path)}`, base).href;
}

// src/domain.ts
var name = "dsh-later";

// src/client/strings.ts
var zh = {
  /** 输入框按钮 tooltip */
  buttonSchedule: "\u5B9A\u65F6\u53D1\u9001",
  /** 面板标题 */
  panelTitle: "\u5B9A\u65F6\u63D0\u9192",
  /** 关闭面板 */
  close: "\u5173\u95ED",
  /** 快捷选项 */
  quick10m: "10\u5206\u949F\u540E",
  quick1h: "1\u5C0F\u65F6\u540E",
  quickSmart: "\u5DE5\u4F5C\u65F6\u95F4",
  quickCustom: "\u81EA\u5B9A\u4E49\u2026",
  /** 自定义输入 */
  dateLabel: "\u65E5\u671F",
  timeLabel: "\u65F6\u95F4",
  today: "\u4ECA\u5929",
  tomorrow: "\u660E\u5929",
  /** 任务列表 */
  taskListTitle: "\u5DF2\u8BBE\u5B9A",
  emptyTasks: "\u6682\u65E0\u5B9A\u65F6\u4EFB\u52A1",
  deleteTask: "\u5220\u9664\u63D0\u9192",
  /** 编辑提醒内容（dock 行内） */
  editTask: "\u7F16\u8F91\u63D0\u9192",
  editSave: "\u4FDD\u5B58",
  editCancel: "\u53D6\u6D88",
  editErrEmpty: "\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A",
  editErrFailed: "\u4FEE\u6539\u5931\u8D25\uFF1A{message}",
  editErrNotAccepted: "\u547D\u4EE4\u672A\u88AB\u53D7\u7406",
  editErrCommandFailed: "\u547D\u4EE4\u5931\u8D25",
  /** 主动插话发送：立即把提醒内容推给 agent（QueueDock「插话发送」语义） */
  steerTask: "\u63D2\u8BDD\u53D1\u9001",
  steerAlreadySent: "\u5DF2\u63D2\u8BDD",
  steerFailed: "\u63D2\u8BDD\u5931\u8D25\uFF1A{message}",
  steerUnsupportedKind: "\u5468\u671F\u63D0\u9192\u6682\u4E0D\u652F\u6301\u63D2\u8BDD",
  /** 投递未确认（宿主保留条目，可重试） */
  steerUnconfirmed: "\u6295\u9012\u672A\u786E\u8BA4\uFF0C\u63D0\u9192\u5DF2\u4FDD\u7559\uFF0C\u53EF\u91CD\u8BD5",
  steerRetry: "\u91CD\u8BD5",
  /** 暂停 / 恢复（仅 after；原地冻结进度条） */
  pauseTask: "\u6682\u505C\u63D0\u9192",
  resumeTask: "\u6062\u590D\u63D0\u9192",
  pausedLabel: "\u5DF2\u6682\u505C",
  pauseFailed: "\u6682\u505C\u5931\u8D25\uFF1A{message}",
  resumeFailed: "\u6062\u590D\u5931\u8D25\uFF1A{message}",
  pauseUnsupportedKind: "\u4EC5\u652F\u6301\u6682\u505C\u300C\u518D\u7B49 N \u5206\u949F\u300D\u7C7B\u63D0\u9192",
  /** dock 折叠头计数（QueueDock「N 条排队消息」样式） */
  panelCount: "{n} \u6761\u5B9A\u65F6\u63D0\u9192",
  /** 精准倒计时（dock 行 + 折叠头） */
  countdownLeft: "\u5269",
  dueAnyMoment: "\u5373\u5C06\u53D1\u9001",
  /** 状态 */
  sending: "\u6B63\u5728\u53D1\u9001\u2026",
  /** dock 折叠头的状态摘要（issue #31：收起时也要播报「未确认」） */
  statusUnconfirmed: "{n} \u6761\u672A\u786E\u8BA4",
  /** 确认按钮 */
  confirmAdd: "\u52A0\u5165 \xB7 {time} \u53D1\u9001",
  confirmAddNoTime: "\u9009\u62E9\u53D1\u9001\u65F6\u95F4",
  /** 提示 */
  promptFromDraft: "\u5C06\u4EE5\u8F93\u5165\u6846\u5185\u5BB9\u4F5C\u4E3A\u63D0\u9192\u5185\u5BB9",
  /** 错误提示 */
  errPromptEmpty: "\u8BF7\u5148\u5728\u8F93\u5165\u6846\u8F93\u5165\u5185\u5BB9",
  errPromptTooLong: "\u63D0\u9192\u5185\u5BB9\u4E0D\u80FD\u8D85\u8FC7 1000 \u5B57\u7B26",
  errTimePast: "\u8BF7\u9009\u62E9\u672A\u6765\u7684\u65F6\u95F4",
  errCreateFailed: "\u521B\u5EFA\u5931\u8D25\uFF1A{message}",
  errDeleteFailed: "\u5220\u9664\u5931\u8D25\uFF1A{message}",
  /** 客户端本地错误（hook 抛令牌，UI 按当前语言翻译） */
  errNoSession: "\u5F53\u524D\u65E0\u4F1A\u8BDD",
  errNotAcceptedStashed: "\u547D\u4EE4\u672A\u88AB\u53D7\u7406\uFF0C\u5DF2\u6682\u5B58\u672C\u5730",
  /** 侧栏会话行「定时状态」badge（docs/ui/09） */
  presenceBadgeAria: "\u6709 {n} \u6761\u5B9A\u65F6\u63D0\u9192\uFF0C\u4E0B\u6B21 {time}",
  presenceOverdueAria: "\u6709 {n} \u6761\u5B9A\u65F6\u63D0\u9192\u5DF2\u5230\u671F\uFF0C\u7B49\u5F85\u53D1\u9001",
  presenceTooltip: "\u4E0B\u6B21 {time} \xB7 {n} \u6761\u4EFB\u52A1",
  presenceOverdueTooltip: "\u5DF2\u5230\u671F \xB7 {n} \u6761\u4EFB\u52A1\uFF08\u7B49\u5F85\u4F1A\u8BDD\u7A7A\u95F2\u53D1\u9001\uFF09",
  /** 全部任务都处于暂停：没有排定的触发时刻，故不显示"下次"或"已到期"。 */
  presencePausedAria: "\u6709 {n} \u6761\u5B9A\u65F6\u63D0\u9192\u5DF2\u6682\u505C",
  presencePausedTooltip: "\u5DF2\u6682\u505C \xB7 {n} \u6761\u4EFB\u52A1",
  /** 悬浮卡片状态区追加行（与宿主 hoverStatus 同构，纯追加不改写既有状态） */
  hoverScheduleStatus: "\u6709 {n} \u6761\u5B9A\u65F6\u63D0\u9192\uFF0C\u4E0B\u6B21 {time}",
  hoverScheduleOverdue: "\u6709 {n} \u6761\u5B9A\u65F6\u63D0\u9192\u5DF2\u5230\u671F\uFF0C\u7B49\u5F85\u53D1\u9001",
  hoverSchedulePaused: "\u6709 {n} \u6761\u5B9A\u65F6\u63D0\u9192\u5DF2\u6682\u505C",
  /**
   * 折叠分组徽标（facet）里「定时任务」这个词（issue #36）。
   *
   * 措辞与 dsh-group-status 过渡基线（其 `status.scheduled`）**逐字一致**：迁移的验收
   * 标准是注册前后徽标文案不变，这里换措辞就等于单方面改基线。
   * 完整句子由 `laterScheduleFacetLabel` 拼：`${count} ${facetScheduled}`。
   */
  facetScheduled: "\u5B9A\u65F6\u4EFB\u52A1",
  relMinutes: "{m} \u5206\u540E",
  relHours: "{h} \u5C0F\u65F6\u540E",
  relTomorrow: "\u660E\u5929 {time}",
  relDate: "{date} {time}",
  relClock: "{time}",
  /** 附件带 a11y（#38）：措辞结构对齐宿主 `queue.image` / `queue.file`，但把「排队」换成「提醒」。 */
  attachmentImage: "\u63D0\u9192\u56FE\u7247",
  attachmentFile: "\u63D0\u9192\u6587\u4EF6 {name}",
  attachmentPendingSend: "\u53D1\u9001\u540E\u53EF\u89C1",
  attachmentUnavailable: "\u56FE\u7247\u4E0D\u53EF\u7528",
  attachmentMore: "\u53E6\u6709 {n} \u4E2A\u9644\u4EF6\u672A\u5217\u51FA"
};
var CLIENT_ERR = {
  NO_SESSION: "SS_ERR_NO_SESSION",
  NOT_ACCEPTED: "SS_ERR_NOT_ACCEPTED"
};
var en = {
  buttonSchedule: "Schedule send",
  panelTitle: "Scheduled reminders",
  close: "Close",
  quick10m: "In 10 minutes",
  quick1h: "In 1 hour",
  quickSmart: "Work hours",
  quickCustom: "Custom\u2026",
  dateLabel: "Date",
  timeLabel: "Time",
  today: "Today",
  tomorrow: "Tomorrow",
  taskListTitle: "Scheduled",
  emptyTasks: "No scheduled reminders",
  deleteTask: "Delete reminder",
  editTask: "Edit reminder",
  editSave: "Save",
  editCancel: "Cancel",
  editErrEmpty: "Reminder content cannot be empty",
  editErrFailed: "Edit failed: {message}",
  editErrNotAccepted: "Command was not accepted",
  editErrCommandFailed: "Command failed",
  steerTask: "Send now",
  steerAlreadySent: "Steered",
  steerFailed: "Steer failed: {message}",
  steerUnsupportedKind: "Recurring reminders can't be steered",
  /** Delivery unconfirmed (host kept the item; retryable) */
  steerUnconfirmed: "Delivery unconfirmed \u2014 reminder kept, you can retry",
  steerRetry: "Retry",
  pauseTask: "Pause reminder",
  resumeTask: "Resume reminder",
  pausedLabel: "Paused",
  pauseFailed: "Pause failed: {message}",
  resumeFailed: "Resume failed: {message}",
  pauseUnsupportedKind: 'Only "wait N minutes" (after) reminders can be paused',
  panelCount: "{n} scheduled reminders",
  countdownLeft: "in",
  dueAnyMoment: "Sending soon",
  sending: "Sending\u2026",
  /** dock collapsed-header status summary (issue #31) */
  statusUnconfirmed: "{n} unconfirmed",
  confirmAdd: "Add \xB7 send at {time}",
  confirmAddNoTime: "Pick a send time",
  promptFromDraft: "The composer draft will be used as the reminder content",
  errPromptEmpty: "Type something in the composer first",
  errPromptTooLong: "Reminder content cannot exceed 1000 characters",
  errTimePast: "Pick a future time",
  errCreateFailed: "Create failed: {message}",
  errDeleteFailed: "Delete failed: {message}",
  errNoSession: "No active session",
  errNotAcceptedStashed: "Command was not accepted; saved locally",
  presenceBadgeAria: "{n} scheduled reminder(s), next at {time}",
  presenceOverdueAria: "{n} scheduled reminder(s) due, waiting to send",
  presenceTooltip: "Next at {time} \xB7 {n} task(s)",
  presenceOverdueTooltip: "Due \xB7 {n} task(s) (sends when the session is idle)",
  presencePausedAria: "{n} paused reminder(s)",
  presencePausedTooltip: "Paused \xB7 {n} task(s)",
  hoverScheduleStatus: "{n} scheduled reminder(s), next {time}",
  hoverScheduleOverdue: "{n} scheduled reminder(s) due, waiting to send",
  hoverSchedulePaused: "{n} paused reminder(s)",
  /** 与 zh 侧同键：措辞与 group-status 的 `status.scheduled` 逐字一致（见 zh 段注释）。 */
  facetScheduled: "Scheduled",
  relMinutes: "in {m} min",
  relHours: "in {h} h",
  relTomorrow: "Tomorrow {time}",
  relDate: "{date} {time}",
  relClock: "{time}",
  attachmentImage: "Reminder image",
  attachmentFile: "Reminder file {name}",
  attachmentPendingSend: "Available after send",
  attachmentUnavailable: "Image unavailable",
  attachmentMore: "{n} more attachment(s)"
};
var schedDicts = { zh, en };
function dictFor(localeId) {
  return localeId === "en" ? schedDicts.en : schedDicts.zh;
}
function format(template, params) {
  return template.replace(
    /\{(\w+)\}/g,
    (_, key) => key in params ? String(params[key]) : `{${key}}`
  );
}

// src/client/styles.ts
var STYLE_ID = "dsh-later-styles";
var COMPONENTS = [
  "/* ==================== \u8F93\u5165\u884C\u5BB9\u5668 ==================== */",
  ".ss-sched-row { display: inline-flex; align-items: center; gap: 4px; flex: none; }",
  "",
  "/* ==================== \u23F0 \u6309\u94AE\uFF08\u8F93\u5165\u6846\u53F3\u4FA7\u5DE5\u5177\u6309\u94AE\uFF09 ==================== */",
  "/* \u5BF9\u9F50\u5B98\u65B9 ui-conversation trigger\uFF1A28\xD728\u3001secondary \u8272\u3001hover interactive-bg-hover */",
  ".ss-sched-btn {",
  "  display: inline-grid; place-items: center; width: 28px; height: 28px;",
  "  border: none; border-radius: 999px; cursor: pointer; padding: 0;",
  "  color: var(--dsw-alias-label-secondary); background: transparent;",
  "  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);",
  "}",
  ".ss-sched-btn:hover:not(:disabled) {",
  "  background: var(--dsw-alias-interactive-bg-hover);",
  "}",
  ".ss-sched-btn:focus-visible {",
  "  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px;",
  "}",
  ".ss-sched-btn:disabled {",
  "  cursor: default; color: var(--dsw-alias-label-dimmed); opacity: 0.4;",
  "}",
  ".ss-sched-btn.ss-active {",
  "  background: var(--dsw-alias-interactive-bg-active);",
  "}",
  "",
  "/* ==================== \u5F85\u53D1\u9001\u63D0\u9192 dock\uFF08\u50CF\u7D20\u7EA7\u5BF9\u9F50 QueueDock\uFF1B\u884C\u5185\u4FDD\u7559 boss \u8FDB\u5EA6\u6761\uFF09 ==================== */",
  "/* \u5916\u58F3\u51E0\u4F55\u4E0E QueueDock .dock \u4E00\u81F4\uFF08\u542B\u8D1F\u4E0B\u8FB9\u8DDD\u8D34\u4F4F composer \u6808\uFF09\u3002 */",
  ".ss-dock-root {",
  "  box-sizing: border-box; flex: none;",
  "  width: calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance)",
  "    - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));",
  "  max-width: calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));",
  "  margin: 0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);",
  "  padding: 0 var(--dsh-composer-dock-inset);",
  "}",
  "/* \u9762\u677F\u4E0E QueueDock .panel \u4E00\u81F4\uFF1A\u9876\u90E8\u5706\u89D2 + \u4E24\u5C42\u4F2A\u5143\u7D20\u2014\u2014::before \u94FA menu \u5E95\uFF08\u542B\u6BDB\u73BB\u7483\uFF09\uFF0C",
  "   ::after \u753B\u63CF\u8FB9\u5E76\u7559\u5E95\u8FB9\u5F00\u53E3\uFF0C\u4E0E\u5BBF\u4E3B panel:before / panel:after \u4E00\u4E00\u5BF9\u5E94\uFF08issue #32\uFF09\u3002 */",
  ".ss-dock-body {",
  "  position: relative; overflow: hidden; width: 100%; padding: 2px 0;",
  "  isolation: isolate;",
  "  border-radius: var(--dsw-radius-lg) var(--dsw-radius-lg) 0 0;",
  "  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);",
  "  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);",
  "}",
  ".ss-dock-body::before {",
  "  z-index: -1; border-radius: inherit; background: var(--dsw-specific-menu);",
  "  backdrop-filter: var(--dsw-menu-backdrop-filter); content: '';",
  "  position: absolute; inset: 0; pointer-events: none;",
  "}",
  "/* \u63CF\u8FB9\u72EC\u7ACB\u4E00\u5C42\uFF08\u5BBF\u4E3B\u540C\u6B3E\u62C6\u6CD5\uFF09\uFF1A\u7C97\u7EC6\u7528 .5px\uFF0C\u4E0E\u5BBF\u4E3B\u7684 alias-border-l1 hairline \u5BF9\u9F50\uFF1B",
  "   \u7559\u5E95\u8FB9\u5F00\u53E3\uFF0C\u8BA9\u9762\u677F\u4E0E composer \u5361\u7247\u89C6\u89C9\u4E0A\u63A5\u6210\u4E00\u4F53\u3002 */",
  ".ss-dock-body::after {",
  "  border: .5px solid var(--dsw-alias-border-l1); border-bottom: none;",
  "  border-radius: inherit; content: '';",
  "  pointer-events: none;",
  "  position: absolute; inset: 0;",
  "}",
  "/* \u7BA1\u5B50\u63A5\u7F1D\uFF08#41 \xB7 B2\uFF09\uFF1A\u4E0A\u65B9\u7D27\u90BB\u5BBF\u4E3B\u961F\u5217\u6761\u65F6\uFF0C\u672C dock \u662F\u7BA1\u5B50\u7684\u4E0B\u6BB5 \u2014\u2014 \u9876\u8FB9\u76F4\u89D2 +",
  "   \u65E0\u9876\u63CF\u8FB9\u3002\u961F\u5217\u6761\u5E95\u8FB9\u672C\u5C31\u662F\u300C\u76F4\u89D2 + \u5F00\u53E3\u300D\uFF08:after \u65E0 bottom \u8FB9\uFF09\uFF0C\u4E24\u6BB5\u7684\u4FA7\u63CF\u8FB9\u5728\u540C\u4E00 x",
  "   \u4E0A\u9996\u5C3E\u76F8\u63A5\u3001\u5E95\u8272\u540C\u4E3A --dsw-specific-menu\uFF0C\u63A5\u7F1D\u5904\u4E0D\u5B58\u5728\u4EFB\u4F55\u4E00\u6761\u7EBF\u3002-9px \u91CD\u53E0\u4FDD\u7559",
  '   \uFF08\u4E0E\u63A5 composer \u540C\u6B3E\u6D88\u7F1D\u624B\u6CD5\uFF0C\u52FF"\u4FEE\u5E73"\uFF09\u3002\u6CA1\u6709\u961F\u5217\u6761\u65F6\u4E24\u6761\u89C4\u5219\u90FD\u4E0D\u547D\u4E2D\uFF0C\u5355\u6761 dock',
  "   \u89C2\u611F\u96F6\u53D8\u5316\u3002\u26A0 [data-queue-dock] \u662F\u5BBF\u4E3B QueueDock \u7684\u79C1\u6709\u5C5E\u6027\uFF08\u5176\u552F\u4E00\u7A33\u5B9A hook\uFF09\uFF0C",
  "   \u5BBF\u4E3B rc \u5347\u7EA7\u9700\u590D\u67E5\u5B83\u4ECD\u5728 dock \u6839\u4E0A\uFF1B\u5931\u914D\u5219\u9759\u9ED8\u9000\u5316\u4E3A\u4FEE\u590D\u524D\u89C2\u611F\uFF08\u4E0D\u4F1A\u66F4\u7CDF\uFF09\u3002",
  "   \u957F\u671F\u89E3\u6CD5\uFF08\u5BBF\u4E3B dock \u6808\u5951\u7EA6\uFF09\u89C1 #43\u3002 */",
  "[data-queue-dock] + .ss-dock-root .ss-dock-body { border-radius: 0; }",
  "[data-queue-dock] + .ss-dock-root .ss-dock-body::after { border-top: none; }",
  ".ss-dock-header {",
  "  box-sizing: border-box; display: flex; align-items: center; gap: 10px;",
  "  width: 100%; height: 36px; padding: 4px 12px;",
  "  background: none; border: none; border-radius: var(--dsw-radius-md); cursor: pointer; text-align: left;",
  "  color: var(--dsw-alias-label-primary);",
  "}",
  ".ss-dock-header:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }",
  ".ss-dock-lead { display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); flex: none; }",
  ".ss-dock-count {",
  "  flex: auto; min-width: 0;",
  "  font-family: Inter, var(--dsw-font-family);",
  "  font-size: 13px; font-weight: 500; line-height: 24px;",
  "}",
  ".ss-dock-chevron { display: grid; place-items: center; width: 14px; height: 14px; color: var(--dsw-alias-label-tertiary); flex: none; }",
  "/* \u6298\u53E0\u6001\u72B6\u6001\u6458\u8981\uFF08#31\uFF09\uFF1A\u9010\u503C\u5BF9\u9F50\u5BBF\u4E3B QueueDock \u7684 .status \u2014\u2014",
  "   color/tertiary + --dsw-font-xs-13 + nowrap + flex:none\u3002\u7F3A\u4E86\u5B83\uFF0C\u6458\u8981\u4F1A\u6309\u7EE7\u627F\u6837\u5F0F\u6E32\u67D3\uFF0C",
  "   \u5E76\u5728\u7A84\u8F93\u5165\u6846\u4E0B\u6362\u884C\u628A 36px \u7684 header \u9876\u9AD8\u3002 */",
  ".ss-dock-status {",
  "  color: var(--dsw-alias-label-tertiary);",
  "  font: var(--dsw-font-xs-13);",
  "  white-space: nowrap; flex: none;",
  "}",
  "/* P5 \u7ED3\u8BBA\uFF08\u96C6\u6210\u6838\u5BF9\u8868 \xA71 \u8981\u6C42\u767B\u8BB0\uFF09\uFF1A**\u6709\u610F\u4FDD\u7559 rotate\uFF0C\u4E0D\u8FFD\u5E73\u5BBF\u4E3B\u7684\u6362\u56FE\u6807**\u3002",
  "   \u5BBF\u4E3B\u6309\u5C55\u5F00\u6001\u5728 IconChevronUp/DownOutlineRegular \u4E4B\u95F4\u5207\u6362\uFF1B\u672C\u7EC4\u4EF6\u6052\u7528 Down +",
  "   rotate(180deg)\u3002chevron \u4E0A\u4E0B\u5BF9\u79F0\uFF0C\u4E24\u79CD\u505A\u6CD5\u5728\u5C55\u5F00\u6001\u7684\u89C6\u89C9\u7ED3\u679C\u4E00\u81F4\uFF0C\u6545\u5C5E\u5B9E\u73B0\u5DEE\u5F02",
  "   \u800C\u975E\u89C6\u89C9\u6F02\u79FB\u3002\u4FDD\u7559 rotate \u7684\u7406\u7531\uFF1A\u4E0D\u5F15\u5165\u6761\u4EF6\u56FE\u6807\u5206\u652F\u4E0E\u7B2C\u4E8C\u4E2A\u56FE\u6807\u4F9D\u8D56\uFF0C\u4E14\u65E5\u540E\u82E5\u8981",
  "   \u7ED9\u6298\u53E0\u52A0\u8FC7\u6E21\uFF0Crotate \u662F\u8FDE\u7EED\u91CF\u3001\u6362\u56FE\u6807\u662F\u79BB\u6563\u8DF3\u53D8\u3002\u767B\u8BB0\u4E8E\u6B64\uFF0C\u514D\u5F97\u4E0B\u8F6E\u8D70\u67E5\u91CD\u590D\u62A5\u3002 */",
  ".ss-dock-chevron.ss-open { transform: rotate(180deg); }",
  ".ss-dock-list {",
  "  margin: 0; padding: 0; list-style: none;",
  "  max-height: 180px; overflow-y: auto;",
  "}",
  ".ss-dock-row {",
  "  box-sizing: border-box; display: flex; align-items: center; gap: 10px;",
  "  width: 100%; min-height: 36px; padding: 4px 5px 4px 12px; border-radius: var(--dsw-radius-md);",
  "}",
  ".ss-dock-row + .ss-dock-row { box-shadow: inset 0 1px 0 var(--dsw-alias-border-l1); }",
  "/* QueueDock \u7684 preview \u662F\u5355\u884C\u6587\u672C\uFF1B\u540C\u4F4D\u653E\u300C\u65F6\u95F4 \xB7 \u5012\u8BA1\u65F6 \xB7 \u5185\u5BB9\u300D+ boss \u8FDB\u5EA6\u6761\uFF08\u4FDD\u7559\u63D2\u4EF6\u7279\u6027\uFF09\u3002 */",
  ".ss-dock-preview {",
  "  flex: auto; min-width: 0; display: flex; flex-direction: column; gap: 4px;",
  "  font: var(--dsw-font-xs-13); font-family: Inter, var(--dsw-font-family);",
  "}",
  ".ss-dock-row-line { display: flex; align-items: center; gap: 8px; min-width: 0; }",
  ".ss-dock-row-time { flex: none; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }",
  ".ss-dock-row-countdown { flex: none; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }",
  ".ss-dock-row-countdown.ss-due { color: var(--dsw-alias-state-warn-secondary); }",
  ".ss-dock-row-prompt {",
  "  flex: 1; min-width: 0; color: var(--dsw-alias-label-primary-dimmed);",
  "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
  "}",
  "/* ==================== \u884C\u9996\u9644\u4EF6\u5E26\uFF08issue #38\uFF09====================",
  "   \u53D6\u503C\u9010\u6761\u7167\u6284\u5BBF\u4E3B QueueDock.module.css \u7684 .attachments / .thumb / .file /",
  "   .fileIcon / .fileName / .fileSize\u3002**\u4F4D\u7F6E\u4E5F\u4E0E\u5BBF\u4E3B\u4E00\u81F4**\uFF1A\u9644\u4EF6\u5E26\u662F .ss-dock-row",
  "   \u7684\u7B2C\u4E00\u4E2A\u5B50\u5143\u7D20\uFF0C\u5728\u6B63\u6587\u5DE6\u4FA7\u540C\u4E00\u884C\uFF08\u539F\u5148\u72EC\u5360\u6B63\u6587\u4E0B\u65B9\u4E00\u5E26\uFF0C\u4E0E\u5934\u9876\u4E0A\u7684\u539F\u751F\u961F\u5217",
  "   \u53E0\u5728\u4E00\u8D77\u65F6\u89C2\u611F\u660E\u663E\u4E0D\u662F\u4E00\u65CF\uFF0C\u6545\u6539\u56DE\u884C\u9996\uFF09\u3002",
  "   \u552F\u4E00\u4FDD\u7559\u7684\u6709\u610F\u504F\u79BB\uFF1A\u4E0D\u6284\u5BBF\u4E3B\u7684 max-width:55% + overflow:hidden \u2014\u2014 \u90A3\u662F\u7ED9\u5B83",
  "   \u5355\u884C\u6B63\u6587\u8BA9\u8DEF\u7684\u6298\u4E2D\uFF0C\u4EE3\u4EF7\u662F\u8D85\u51FA\u5C31**\u9759\u9ED8\u88C1\u5207**\uFF1B\u6211\u4EEC\u6539\u6210\u53EF\u6536\u7F29 + \u6A2A\u5411\u6EDA\u52A8\uFF0C",
  "   \u6324\u4E0D\u4E0B\u65F6\u7528\u6237\u80FD\u6EDA\u7740\u770B\u5B8C\uFF0C\u800C\u4E0D\u662F\u6C38\u8FDC\u770B\u4E0D\u89C1\u7B2C N \u5F20\u3002",
  "   \u6EDA\u52A8\u6761\u5916\u89C2\u4E0D\u7528\u989D\u5916\u58F0\u660E\uFF1A.ss-dock-body \u4E0A\u5DF2\u8BBE --dsh-scrollbar-thumb\uFF0C\u5B50\u7EA7\u7EE7\u627F\u3002 */",
  ".ss-dock-attachments {",
  "  display: flex; gap: 4px; min-width: 0; flex: 0 1 auto; flex-wrap: nowrap; overflow-x: auto;",
  "}",
  ".ss-dock-thumb {",
  "  flex: none; width: 24px; height: 24px; object-fit: cover;",
  "  border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-xs);",
  "  background: var(--dsw-alias-bg-base);",
  "}",
  ".ss-dock-file {",
  "  box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px;",
  "  flex: 0 180px; min-width: 74px; height: 24px; padding: 0 6px; overflow: hidden;",
  "  border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm);",
  "  background: var(--dsw-alias-bg-base);",
  "}",
  ".ss-dock-file-icon { flex: none; width: 16px; height: 16px; display: inline-flex; }",
  ".ss-dock-file-name {",
  "  min-width: 0; color: var(--dsw-alias-label-primary-dimmed); font: var(--dsw-font-xs-13);",
  "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
  "}",
  ".ss-dock-file-size { flex: none; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 10px; }",
  "/* \u56FE\u7247\u5B57\u8282\u4E0D\u53EF\u7528\u65F6\u7684\u9000\u5316 chip\uFF1A\u4E0E .ss-dock-file \u540C\u5F62\uFF0C\u53EA\u6362\u4E2A\u8272\u6863\u8868\u660E\u662F\u5F02\u5E38\u3002 */",
  ".ss-dock-thumb-fallback { flex: 0 auto; max-width: 180px; }",
  ".ss-dock-thumb-fallback .ss-dock-file-name { color: var(--dsw-alias-label-tertiary); }",
  "/* \u8D85\u51FA #37 \u6BCF\u4EFB\u52A1\u4E0A\u9650\u65F6\u7684\u300C+N\u300D\u5C3E\u5DF4\u3002 */",
  ".ss-dock-more {",
  "  box-sizing: border-box; flex: none; display: inline-flex; align-items: center;",
  "  height: 24px; padding: 0 6px; font-size: 10px; color: var(--dsw-alias-label-tertiary);",
  "  border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm);",
  "  background: var(--dsw-alias-bg-base);",
  "}",
  "/* boss \u8840\u6761\uFF08\u4FDD\u7559\uFF09\uFF1A\u5355\u6839\u957F\u7BA1 + \u7B49\u6BD4\u5206\u9694\u7EBF\uFF08\u6BCF\u6BB5 1h\uFF09\u3002 */",
  ".ss-dock-bars { display: block; }",
  ".ss-dock-bar {",
  "  position: relative; height: 6px; border-radius: 999px; overflow: hidden;",
  "  background: var(--dsw-alias-line-secondary);",
  "  --ss-bar-divider: color-mix(in srgb, var(--dsw-alias-label-primary) 35%, transparent);",
  "}",
  ".ss-dock-bars-compact .ss-dock-bar { height: 4px; }",
  ".ss-dock-bar-fill {",
  "  position: relative; z-index: 1;",
  "  height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary);",
  /* 活动期的推进由 CSS 动画驱动（见 ScheduleDock 的 fillStyle）：
     旧实现是「每秒 tick 改一次宽度 + transition 补间」，1 分钟任务每秒跳约 8px，
     肉眼可见锯齿。改为动画后由合成器逐帧插值，真 60fps 且零重渲染。
     这里**不保留** transition: width —— 它与动画叠加会造成双重补间、反而更抖。 */
  "  /* \u6781\u77ED\u4EFB\u52A1/\u65E9\u671F\u6682\u505C\u65F6\u8FDB\u5EA6\u6BD4\u63A5\u8FD1 0\uFF1A\u7ED9\u6700\u5C0F\u53EF\u89C1\u5BBD\u5EA6\uFF0C\u4E14 active \u4E0E paused \u540C\u4E00\u89C4\u5219\uFF0C",
  "     \u907F\u514D\u6682\u505C\u524D\u540E\u4FDD\u5E95\u9608\u503C\u4E0D\u4E00\u81F4\u5BFC\u81F4\u6761\u957F\u8DF3\u53D8\u3002 */",
  "  min-width: 10px;",
  "}",
  "/* \u8FDB\u5EA6\u63A8\u8FDB\uFF1ACSS \u52A8\u753B\u7EBF\u6027\u63A8\u8FDB\uFF08\u66FF\u4EE3\u300C\u6BCF\u79D2 tick \u6539\u5BBD\u5EA6 + transition \u8865\u95F4\u300D\uFF09\u3002",
  "   \u53C2\u6570\u7531 JS \u6CE8\u5165 --ss-bar-duration / --ss-bar-delay\uFF1A",
  "   duration \u56FA\u5B9A\u4E3A\u5B8C\u6574\u7A97\u53E3\uFF08\u5426\u5219\u6BCF\u6B21 tick \u90FD\u6539\u53D8\u53C2\u6570\u3001\u6D4F\u89C8\u5668\u4F1A\u91CD\u542F\u52A8\u753B\uFF09\uFF1B",
  "   delay \u4E3A -(\u5DF2\u8FC7\u53BB) \u7684\u8D1F\u503C\uFF08\u628A\u64AD\u653E\u5934\u5B9A\u4F4D\u5230\u7EDD\u5BF9\u76F8\u4F4D\uFF0C\u91CD\u6302\u8F7D\u540E\u4E0D\u5F52\u96F6\uFF09\u3002",
  "   JS \u4FA7\u53EA\u4F20\u53D8\u91CF\u3001\u4E0D\u5199 animationName \u7B80\u5199\uFF0C\u907F\u514D\u8986\u76D6\u8FD9\u91CC\u7684\u58F0\u660E\u3002",
  "   \u6CE8\u610F\u6B64\u5904**\u4E0D\u5E26** :not(.ss-paused)\uFF1A\u6682\u505C\u6001\u53E6\u6709 animation: none \u8986\u76D6\u3002 */",
  ".ss-dock-bar-fill {",
  "  animation-name: ss-dock-bar-progress;",
  "  animation-duration: var(--ss-bar-duration, 3600s);",
  "  animation-delay: var(--ss-bar-delay, 0ms);",
  "  animation-timing-function: linear;",
  "  animation-fill-mode: forwards;",
  "  animation-iteration-count: 1;",
  "}",
  "@keyframes ss-dock-bar-progress { from { width: 0%; } to { width: 100%; } }",
  "@media (prefers-reduced-motion: reduce) {",
  "  /* \u65E0\u969C\u788D\uFF1A\u5173\u6389\u9010\u5E27\u63A8\u8FDB\u3002\u6B64\u65F6 animation-fill-mode \u4F1A\u8BA9\u5BBD\u5EA6\u505C\u5728\u8D77\u59CB\u503C(0)\uFF0C",
  "     \u6545\u7531 JS \u4FA7\u6539\u8D70\u9759\u6001 width \u8DEF\u5F84\uFF08\u89C1 ScheduleDock \u7684 prefersReducedMotion\uFF09\u3002 */",
  "  .ss-dock-bar-fill { animation: none !important; }",
  "}",
  "/* \u6682\u505C\u6001\uFF08P1\uFF1A\u4E0D\u989D\u5916\u52A0\u6837\u5F0F\uFF09\u3002",
  "   \u6682\u505C = \u539F\u6761 + \u5B8C\u5168\u9759\u6B62\uFF1A\u4E0D\u53E0\u52A0\u659C\u7EB9/\u51B0\u5C01/\u963B\u585E\u5934\uFF0C\u4E5F\u4E0D\u6539\u5E95\u8272\u3001\u4E0D\u53D8\u8272\u3002",
  "   \u72B6\u6001\u7531\u300C\u52A8 / \u9759\u300D\u5BF9\u6BD4\u8868\u8FBE\u2014\u2014\u8FDB\u884C\u4E2D\u8FDB\u5EA6\u6761\u5728\u63A8\u8FDB\uFF0C\u6682\u505C\u65F6\u505C\u4F4F\u3002",
  '   \u6CE8\u610F\uFF1A**\u4E0D\u989D\u5916\u53E0\u6D41\u52A8\u7EB9\u7406**\u3002\u5148\u524D\u8BEF\u628A"\u8FDB\u884C\u4E2D\u52A0\u6D41\u5149"\u5F53\u4F5C P1 \u7684\u4E00\u90E8\u5206\u5B9E\u73B0\uFF0C',
  "   \u4F46\u90A3\u4E0D\u5728 P1 \u5B9A\u4E49\u5185\uFF08P1 \u539F\u6587\uFF1A\u6682\u505C = \u539F\u6761 + \u9759\u6B62\uFF0C\u4E0D\u52A0\u4EFB\u4F55\u7EB9\u7406\uFF09\uFF0C\u5DF2\u79FB\u9664\u3002",
  "   \u53EA\u4FDD\u7559\u4E0B\u9762\u8FD9\u884C\u9632\u5FA1\uFF1A\u4E07\u4E00\u52A8\u753B\u56E0\u6545\u6B8B\u7559\uFF0C\u6682\u505C\u65F6\u5FC5\u987B\u505C\u4F4F\u3002",
  "   \uFF08\u51E0\u4F55\u4E0E\u4FDD\u5E95\u5BBD\u5EA6\u6CBF\u7528 .ss-dock-bar-fill \u7684\u516C\u5171\u89C4\u5219\uFF0C\u6545\u6682\u505C\u524D\u540E\u957F\u5EA6\u4E00\u81F4\u3002\uFF09 */",
  ".ss-dock-row.ss-paused .ss-dock-bar-fill {",
  "  animation: none;",
  "}",
  "@media (prefers-reduced-motion: reduce) {",
  "  .ss-dock-row:not(.ss-paused) .ss-dock-bar-fill { animation: none; background: var(--dsw-alias-brand-primary); }",
  "}",
  ".ss-dock-row.ss-paused .ss-dock-row-countdown { color: var(--dsw-alias-label-tertiary); }",
  ".ss-dock-row.ss-paused .ss-dock-row-time,",
  ".ss-dock-row.ss-paused .ss-dock-row-prompt { color: var(--dsw-alias-label-secondary); }",
  "/* \u5206\u9694\u7EBF\uFF1Aabsolute \u8DE8\u6574\u4E2A bar \u753B N-1 \u6761\u7B49\u6BD4\u7AD6\u7EBF\uFF0C\u6E32\u67D3\u5728 fill \u4E4B\u524D\uFF08fill \u7528 z-index:1 \u76D6\u4F4F\u300C\u5DF2\u586B\u5145\u6BB5\u300D\u4E0A\u7684\u523B\u5EA6\uFF09\u3002 */",
  ".ss-dock-bar-divider {",
  "  position: absolute; inset: 0; pointer-events: none;",
  "  background-repeat: no-repeat;",
  "}",
  ".ss-dock-actions { display: flex; align-items: center; gap: 10px; flex: none; }",
  "/* \u52A8\u4F5C\u6309\u94AE\u7684 tooltip \u7528 primitives \u7684 Tooltip\uFF08issue #29\uFF09\uFF1A\u6C14\u6CE1\u6837\u5F0F\u4E0E\u5C42\u7EA7\u7531\u5B83\u81EA\u5E26\uFF0C",
  "   \u8FD9\u91CC\u4E0D\u518D\u5B9A\u4E49\u2014\u2014\u539F\u5148\u81EA\u7814\u6C14\u6CE1\u7684\u7C7B\u540D\u3001\u5305\u88C5\u5C42\u4E0E\u6DE1\u5165 keyframes \u4E00\u5E76\u5220\u9664\u3002 */",
  ".ss-dock-action {",
  "  corner-shape: round; /* \u5BBF\u4E3B .action \u663E\u5F0F\u58F0\u660E\u4E86\u8FD9\u6761\u3002\u6CE8\u610F round \u672C\u5C31\u662F\u8BE5\u5C5E\u6027\u7684\u521D\u59CB\u503C\uFF0C",
  "   \u6240\u4EE5\u8FD9\u662F\u9010\u5B57\u5BF9\u9F50\u800C\u975E\u89C6\u89C9\u4FEE\u590D\uFF1A\u4E0D\u652F\u6301\u7684\u5F15\u64CE\u5FFD\u7565\u5B83\uFF0C\u652F\u6301\u7684\u5F15\u64CE\u7ED3\u679C\u4E0D\u53D8\u3002 */",
  "  display: grid; place-items: center; width: 28px; height: 28px; padding: 0; flex: none;",
  "  border: none; border-radius: 999px; background: none; cursor: pointer;",
  "  color: var(--dsw-alias-label-tertiary);",
  "}",
  ".ss-dock-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }",
  ".ss-dock-action:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }",
  ".ss-dock-action:disabled { cursor: default; opacity: 0.45; }",
  "/* \u63D2\u8BDD\u5B8C\u6210\u6001\uFF1AQueueDock \u65E0\u6B64\u6001\uFF0C\u7528\u6210\u529F\u8272\u505A\u8F7B\u63D0\u793A\uFF08\u53E0\u52A0 disabled \u534A\u900F\u660E\uFF09\u3002 */",
  ".ss-dock-action-steer.ss-done { color: var(--dsw-alias-state-success-primary); }",
  ".ss-dock-steer-err {",
  "  color: var(--dsw-alias-state-warn-secondary); font-size: 12px; line-height: 16px;",
  "}",
  "/*",
  " * \u6295\u9012\u672A\u786E\u8BA4\u63D0\u793A\uFF1A\u6761\u76EE\u88AB\u5BBF\u4E3B\u4FDD\u7559\uFF08\u672A\u5199 dispatch\uFF09\uFF0C\u884C\u4ECD\u5728\u53F0\u4E0A\u3002",
  ' * \u4E0E\u666E\u901A\u9519\u8BEF\uFF08\u7EAF\u6587\u5B57\uFF09\u533A\u5206\uFF1A\u5B83\u4E0D\u662F\u4E00\u4E2A"\u5931\u8D25"\uFF0C\u800C\u662F"\u7ED3\u679C\u672A\u77E5\u4E14\u53EF\u633D\u56DE"\uFF0C',
  " * \u8BED\u6C14\u5E94\u662F\u63D0\u793A\u800C\u975E\u62A5\u9519\uFF0C\u6545\u7ED9\u6D45\u5E95 + \u8FB9\u6846 + \u53EF\u70B9\u7684\u91CD\u8BD5\u3002",
  " */",
  ".ss-dock-steer-warn {",
  "  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;",
  "  margin-top: 4px; padding: 4px 8px; border-radius: 6px;",
  "  font-size: 12px; line-height: 16px;",
  "  color: var(--dsw-alias-state-warn-secondary);",
  "  background: color-mix(in srgb, var(--dsw-alias-state-warn-secondary) 12%, transparent);",
  "  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-secondary) 32%, transparent);",
  "}",
  ".ss-dock-steer-retry {",
  "  margin-left: auto; padding: 1px 8px; border-radius: 5px; cursor: pointer;",
  "  font: inherit; font-size: 12px;",
  "  color: var(--dsw-alias-state-warn-secondary);",
  "  background: color-mix(in srgb, var(--dsw-alias-state-warn-secondary) 18%, transparent);",
  "  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-secondary) 38%, transparent);",
  "}",
  ".ss-dock-steer-retry:hover {",
  "  background: color-mix(in srgb, var(--dsw-alias-state-warn-secondary) 28%, transparent);",
  "}",
  "/* \u884C\u5185\u7F16\u8F91\uFF08\u5BBF\u4E3B QueueDock `.editor` \u9010\u6761\u5BF9\u9F50\uFF1Atextarea + \u81EA\u9002\u5E94\u9AD8\u5EA6\uFF0C\u4E0A\u9650\u4EA4 CSS\uFF09\u3002",
  "   \u63CF\u8FB9/\u5706\u89D2\u8D70 .5px + border-l4 + radius-sm\uFF0C\u4E0D\u518D\u5199 1px / 6px \u5B57\u9762\u91CF\u2014\u2014\u53EA\u6709\u7528 token",
  "   \u624D\u4F1A\u8DDF\u7740\u4E3B\u9898\u4EE3\u6B21\u53D8\uFF1Bheight \u4E5F\u5FC5\u987B\u8BA9\u4F4D\u7ED9 min/max-height\uFF0C\u5426\u5219 JS \u56DE\u586B\u7684\u81EA\u9002\u5E94\u9AD8\u5EA6",
  "   \u4F1A\u88AB\u56FA\u5B9A 28px \u9876\u6B7B\uFF08\u5BBF\u4E3B\u7684 clamp \u5C31\u5728 max-height\uFF0C\u5230\u9876\u540E textarea \u81EA\u5DF1\u6EDA\u52A8\uFF09\u3002 */",
  ".ss-dock-edit-input {",
  "  box-sizing: border-box; flex: auto; min-width: 0;",
  "  min-height: 28px; max-height: 127px; padding: 3px 8px; overflow-y: auto;",
  "  font: var(--dsw-font-xs-13); font-family: Inter, var(--dsw-font-family);",
  "  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);",
  "  border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-sm);",
  "  outline: none; resize: none;",
  "}",
  ".ss-dock-edit-input:focus { border-color: var(--dsw-alias-state-business-primary); }",
  "/* \u63D0\u4EA4\u5728\u9014\uFF1A\u4E0E .ss-dock-row-save:disabled \u540C\u6863\uFF0C\u8BA9\u300C\u6309\u4E86\u4F46\u8FD8\u6CA1\u56DE\u6765\u300D\u770B\u5F97\u51FA\u72B6\u6001\u3002 */",
  ".ss-dock-edit-input:disabled { opacity: 0.45; cursor: default; }",
  ".ss-dock-row-save {",
  "  flex: none; font-size: 12px; line-height: 20px; padding: 0 8px; border-radius: 6px;",
  "  border: 1px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary);",
  "  background: transparent; cursor: pointer;",
  "}",
  ".ss-dock-row-save:disabled { opacity: 0.45; cursor: default; }",
  ".ss-dock-edit-err {",
  "  flex-basis: 100%; color: var(--dsw-alias-state-error-secondary); font-size: 12px; line-height: 16px;",
  "}",
  ".ss-dock-editing { flex-wrap: wrap; }",
  "",
  "/* ==================== \u9762\u677F ==================== */",
  "/*",
  " * \u62AC\u5347\u9762\u9010\u9879\u5BF9\u9F50\u5B98\u65B9 PickerPopover\uFF08@deepseek-ai/dsh-client-ui-schedule \u7684",
  " * PickerPopover.module.css + primitives MenuSurface.module.css\uFF09\uFF1A",
  " *   \u80CC\u666F --dsw-menu-surface-fill\uFF08\u5E26\u900F\u660E\u5EA6\u7684\u83DC\u5355\u9762\uFF09+ blur(40px) \u6BDB\u73BB\u7483",
  " *   \u63CF\u8FB9\u8D70\u4E3B\u9898\u7684 --dsw-elevation-stroke\uFF080 0 0 .5px\uFF09\uFF0C\u800C\u4E0D\u662F\u624B\u5199 1px \u2014\u2014",
  " *     0.5px \u63CF\u8FB9\u662F\u9AD8\u5206\u5C4F\u4E0B\u7684\u6B63\u786E\u7EC6\u7EBF\uFF0C1px \u5728 1x \u4E0A\u8FC7\u91CD\u3001\u5728 2x \u4E0A\u53C8\u53D1\u865A\u3002",
  " *   \u9634\u5F71 --dsw-elevation-prominent\uFF08\u542B\u63CF\u8FB9\u5C42\uFF0C\u4E0D\u662F\u7B2C\u4E8C\u5957\u9634\u5F71\uFF09\u3002",
  " *   \u5706\u89D2 16px = --dsw-radius-lg\uFF08\u5B98\u65B9\u9762\u677F\u540C\u4E00\u6863\uFF1B\u65E7\u7684 12px \u662F --dsw-radius-md\uFF09\u3002",
  " *   z-index 1100 = \u5B98\u65B9\u6D6E\u5C42\u6863\uFF08\u65E7\u7684 101 \u662F\u81EA\u9020\u503C\uFF0C\u6392\u5728 dock \u4E4B\u4E0B\uFF09\u3002",
  " *",
  " * \u26A0\uFE0F \u52FF\u518D\u5F15\u5165 --dsw-shadow-lv3 / --dsw-alias-border-inverted\uFF1A\u90A3\u662F\u66F4\u65E9\u8BBE\u8BA1\u4EE3\u6B21\u7684",
  " *    token\uFF0C\u6DF7\u7528\u4F1A\u8BA9\u9762\u677F\u5728\u6D45\u8272/\u6DF1\u8272\u4E0B\u90FD\u504F\u79BB\u5B98\u65B9\u89C2\u611F\uFF08issue #24\uFF09\u3002",
  " */",
  ".ss-backdrop {",
  "  position: fixed; inset: 0; z-index: 1099; background: transparent;",
  "}",
  ".ss-panel {",
  "  position: fixed; top: auto; left: auto; z-index: 1100;",
  "  box-sizing: border-box; display: flex; flex-direction: column;",
  "  width: min(340px, calc(100vw - 24px));",
  "  padding: 12px;",
  "  background: var(--dsw-menu-surface-fill);",
  "  backdrop-filter: var(--dsw-menu-backdrop-filter);",
  "  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter);",
  "  border: 0; border-radius: var(--dsw-radius-lg);",
  "  box-shadow: var(--dsw-elevation-prominent);",
  "  /* \u63CF\u8FB9\u4E0E\u9634\u5F71\u540C\u53D8\u91CF\uFF1A--dsw-elevation-prominent \u81EA\u8EAB\u542B --dsw-elevation-stroke\uFF0C",
  "     \u8FD9\u91CC\u53EA\u9700\u7ED9 stroke \u989C\u8272\u3002\u5B98\u65B9 schedule/input-trigger/subagent \u4E09\u4E2A\u5305\u4E00\u81F4\u53D6 l1\u3002 */",
  "  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);",
  "  color: var(--dsw-alias-label-secondary);",
  "  font-size: 12px; line-height: 20px; font-family: var(--dsw-font-family);",
  "}",
  /* 兜底定位分支（无官方 useAnchoredPosition 的旧代次宿主）才用 bottom，
     有官方锚定时 left/top 由 hook 注入，这里只兜住首帧测量前的 top:auto。 */
  ".ss-panel-header {",
  "  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;",
  "}",
  ".ss-panel-title {",
  "  font-weight: 500; font-size: 13px;",
  "  display: inline-flex; align-items: center; gap: 6px;",
  "  color: var(--dsw-alias-label-primary);",
  "}",
  ".ss-panel-close {",
  "  width: 24px; height: 24px; border: none; background: transparent;",
  "  cursor: pointer; color: var(--dsw-alias-label-tertiary);",
  "  border-radius: 999px; display: grid; place-items: center; padding: 0;",
  "}",
  ".ss-panel-close:hover {",
  "  background: var(--dsw-alias-interactive-bg-hover);",
  "  color: var(--dsw-alias-label-secondary);",
  "}",
  ".ss-panel-close:focus-visible {",
  "  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px;",
  "}",
  "",
  "/* ==================== \u5FEB\u6377\u82AF\u7247\uFF08\u5355\u89C6\u56FE\uFF0C\u65E0 tab\uFF09 ==================== */",
  ".ss-quick-grid {",
  "  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;",
  "}",
  ".ss-quick-chip {",
  "  height: 30px; padding: 0 10px;",
  "  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;",
  "  background: transparent; color: var(--dsw-alias-label-secondary);",
  "  cursor: pointer; font-size: 12px; line-height: 1.5; font-family: var(--dsw-font-family);",
  "  transition: color var(--ds-transition-duration-fast) var(--ds-ease-in-out),",
  "              border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),",
  "              background var(--ds-transition-duration-fast) var(--ds-ease-in-out);",
  "}",
  ".ss-quick-chip:hover {",
  "  color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed);",
  "}",
  ".ss-quick-chip.ss-active {",
  "  background: var(--dsw-alias-interactive-bg-active);",
  "  color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary);",
  "}",
  ".ss-quick-chip:focus-visible {",
  "  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px;",
  "}",
  ".ss-custom-row {",
  "  display: flex; gap: 6px; margin-top: 8px;",
  "}",
  ".ss-custom-row .ss-input { flex: 1; min-width: 0; }",
  ".ss-tasklist-head { margin-top: 10px; }",
  "",
  "/* ==================== \u8868\u5355\u5B57\u6BB5 ==================== */",
  "/* \u5BF9\u9F50\u5B98\u65B9 fields.module.css\uFF1Acolumn \u5E03\u5C40\u3001label \u5728\u4E0A 13px/500\uFF0C\u5B57\u6BB5\u95F4\u65E0\u5206\u9694\u7EBF */",
  ".ss-field {",
  "  display: flex; flex-direction: column; gap: 6px; padding: 12px 0;",
  "}",
  ".ss-input {",
  "  min-height: 36px; padding: 0 12px;",
  "  border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md);",
  "  background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary);",
  "  font: inherit; font-size: 13px; line-height: 1.5;",
  "  flex: 1; min-width: 0; width: 100%; box-sizing: border-box;",
  "}",
  ".ss-input:focus-visible {",
  "  outline: none; border-color: var(--dsw-alias-state-business-primary);",
  "}",
  ".ss-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }",
  ".ss-input.ss-inputInvalid { border-color: var(--dsw-alias-state-error-primary); }",
  "",
  "/* ==================== \u4EFB\u52A1\u5217\u8868 ==================== */",
  ".ss-tasks { max-height: 160px; overflow-y: auto; margin-bottom: 8px; }",
  ".ss-task {",
  "  display: flex; align-items: center; gap: 8px; padding: 5px 6px;",
  "  border-radius: 4px; font-size: 12px;",
  "  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);",
  "}",
  ".ss-task:hover { background: var(--dsw-alias-interactive-bg-hover); }",
  ".ss-dot { width: 6px; height: 6px; border-radius: 999px; flex: none; }",
  ".ss-dot.scheduled { background: var(--dsw-alias-brand-primary); }",
  ".ss-dot.overdue { background: var(--dsw-alias-state-warn-secondary); }",
  ".ss-dot.delivered { background: var(--dsw-alias-state-success-primary); }",
  ".ss-dot.cancelled { background: var(--dsw-alias-label-dimmed); }",
  ".ss-task-status {",
  "  display: inline-block; margin-left: 4px; padding: 0 5px;",
  "  border-radius: 999px; font-size: 10px; font-weight: 500;",
  "  color: var(--dsw-alias-state-warn-label);",
  "  background: var(--dsw-alias-state-warn-tertiary);",
  "}",
  ".ss-task-main { flex: 1; min-width: 0; }",
  ".ss-task-time { color: var(--dsw-alias-label-tertiary); font-size: 11px; }",
  ".ss-task-prompt {",
  "  color: var(--dsw-alias-label-primary);",
  "  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
  "}",
  ".ss-task.cancelled .ss-task-prompt,",
  ".ss-task.cancelled .ss-task-time {",
  "  text-decoration: line-through; color: var(--dsw-alias-label-dimmed);",
  "}",
  ".ss-task-del {",
  "  flex: none; width: 20px; height: 20px; border: none; background: transparent;",
  "  cursor: pointer; color: var(--dsw-alias-label-tertiary);",
  "  border-radius: 999px; display: grid; place-items: center; padding: 0;",
  "  opacity: 0;",
  "  transition: opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out),",
  "              background var(--ds-transition-duration-fast) var(--ds-ease-in-out),",
  "              color var(--ds-transition-duration-fast) var(--ds-ease-in-out);",
  "}",
  ".ss-task:hover .ss-task-del { opacity: 1; }",
  ".ss-task-del:hover {",
  "  background: var(--dsw-alias-interactive-bg-hover-danger);",
  "  color: var(--dsw-alias-state-error-secondary);",
  "}",
  ".ss-task-del:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); opacity: 1; }",
  ".ss-empty {",
  "  color: var(--dsw-alias-label-tertiary); text-align: center;",
  "  padding: 10px 0; font-size: 12px;",
  "}",
  "",
  "/* ==================== \u5E95\u90E8\u64CD\u4F5C\u680F ==================== */",
  "/* \u5BF9\u9F50\u5B98\u65B9\u6309\u94AE\u89C4\u683C\uFF1Aradius 8\u3001padding 5px 14px\u300113px\u3001disabled opacity .4 */",
  ".ss-footer { display: flex; gap: 8px; align-items: center; }",
  ".ss-confirm {",
  "  flex: 1; appearance: none; border: 1px solid transparent; border-radius: 8px;",
  "  padding: 5px 14px; cursor: pointer;",
  "  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);",
  "  font-size: 13px; line-height: 1.5; font-weight: 500;",
  "  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);",
  "  font-family: var(--dsw-font-family);",
  "}",
  ".ss-confirm:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }",
  ".ss-confirm:disabled { opacity: 0.4; cursor: default; }",
  ".ss-confirm:focus-visible {",
  "  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px;",
  "}",
  ".ss-clear {",
  "  flex: none; appearance: none; border: 1px solid var(--dsw-alias-border-l2);",
  "  border-radius: 8px; padding: 5px 14px; background: none;",
  "  color: var(--dsw-alias-label-secondary); cursor: pointer;",
  "  font-size: 13px; line-height: 1.5; font-family: var(--dsw-font-family);",
  "}",
  ".ss-clear:hover:not(:disabled) {",
  "  color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed);",
  "}",
  ".ss-clear:disabled { opacity: 0.4; cursor: default; }",
  ".ss-clear:focus-visible {",
  "  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px;",
  "}",
  "",
  "/* ==================== \u9519\u8BEF\u63D0\u793A ==================== */",
  "/* \u5BF9\u9F50\u5B98\u65B9\uFF1A\u7EAF\u6587\u5B57\u8272\u3001\u65E0\u80CC\u666F\u8272\u5757\uFF1Bhint 12px */",
  ".ss-error {",
  "  color: var(--dsw-alias-state-error-primary); font-size: 12px;",
  "  line-height: 1.5; margin: 0;",
  "}",
  ".ss-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; margin: 0; }",
  "",
  "/* ==================== \u4FA7\u680F\u4F1A\u8BDD\u884C\u300C\u5B9A\u65F6\u72B6\u6001\u300Dbadge\uFF08docs/ui/09 \u8DEF\u7EBF B\uFF09 ==================== */",
  "/* \u7D2B\u4E3A\u5B9A\u65F6\u4E13\u5C5E\uFF08\u6D45\u6DF1\u901A\u7528\uFF0C\u5BF9\u767D/\u6DF1\u5E95\u5BF9\u6BD4\u5747 \u22653:1\uFF09\uFF1Burgent/overdue \u590D\u7528\u5BBF\u4E3B warn/error \u522B\u540D\u3002 */",
  ".ss-presence { display: inline-flex; flex: none; color: #8b5cf6; }",
  ".ss-presence-beside { margin-left: 4px; }",
  "",
  "/* \u2500\u2500 \u65E7\u7248\u70B9\u9635\u65F6\u949F\uFF08classic\uFF09 \u2500\u2500 */",
  ".ss-presence rect { fill: currentColor; }",
  ".ss-presence .ss-presence-ring { opacity: 0.8; animation: ss-presence-breathe 2.4s var(--ds-ease-in-out, ease-in-out) infinite; }",
  ".ss-presence .ss-presence-hand { opacity: 1; }",
  '.ss-presence[data-state="urgent"] .ss-presence-ring { animation-name: ss-presence-pulse; animation-duration: 0.9s; }',
  '.ss-presence[data-state="overdue"] .ss-presence-ring { animation: none; }',
  "",
  "/*  \u65B0\u7248\u63CF\u8FB9\u65F6\u949F\uFF08modern\uFF09\u2014 \u5BF9\u9F50 DSH \u5B98\u65B9 spinner \u6837\u5F0F \u2500\u2500 */",
  "/* \u53CC\u73AF\uFF1Atrack \u6052\u5B9A\u4E3A\u5E95\uFF08\u7ED9\u51FA\u300C\u603B\u7A97\u53E3\u300D\u7684\u89C6\u89C9\u53C2\u7167\uFF09\uFF0Cprog \u662F\u4ECE 12 \u70B9\u8D77\u7684\u8FDB\u5EA6\u5F27\u3002",
  "   \u65E0\u4ECE\u7B97\u8FDB\u5EA6\u65F6 JS \u628A prog \u7F6E\u4E3A display:none \u2014\u2014 \u6B64\u65F6\u89C6\u89C9\u4E0E\u6539\u9020\u524D\u7684\u5355\u73AF\u5B8C\u5168\u4E00\u81F4\u3002 */",
  ".ss-presence .ss-clock-track {",
  "  fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round;",
  "  opacity: 0.25; animation: ss-clock-breathe 2.4s var(--ds-ease-in-out, ease-in-out) infinite;",
  "}",
  ".ss-presence .ss-clock-prog {",
  "  fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round;",
  "  opacity: 1; transition: stroke-dashoffset 0.5s var(--ds-ease-in-out, ease-in-out);",
  "}",
  ".ss-presence .ss-clock-hand { stroke: currentColor; stroke-width: 2; stroke-linecap: round; }",
  ".ss-presence .ss-clock-hand-h { opacity: 1; }",
  ".ss-presence .ss-clock-hand-m { opacity: 0.85; }",
  "/* urgent \u53EA\u8109\u51B2\u5E95\u73AF\uFF1A\u8FDB\u5EA6\u5F27\u627F\u8F7D\u786E\u5B9A\u4FE1\u606F\uFF0C\u8DDF\u7740\u95EA\u4F1A\u8BA9\u6BD4\u4F8B\u4E0D\u53EF\u8BFB\u3002 */",
  '.ss-presence[data-state="urgent"] .ss-clock-track { animation-name: ss-clock-pulse; animation-duration: 0.9s; }',
  '.ss-presence[data-state="overdue"] .ss-clock-track { animation: none; opacity: 1; }',
  "",
  "/* \u2500\u2500 \u4E09\u6001\u989C\u8272 \u2500\u2500 */",
  '.ss-presence[data-state="urgent"] { color: var(--dsw-alias-state-warn-secondary); }',
  '.ss-presence[data-state="overdue"] { color: var(--dsw-alias-state-error-primary); }',
  "",
  "/* \u2500\u2500 \u52A8\u753B\u5173\u952E\u5E27 \u2500\u2500 */",
  "@keyframes ss-presence-breathe { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }",
  "@keyframes ss-presence-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }",
  "@keyframes ss-clock-breathe { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }",
  "@keyframes ss-clock-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }",
  "@media (prefers-reduced-motion: reduce) {",
  "  .ss-presence .ss-presence-ring { animation: none; }",
  "  .ss-presence .ss-clock-track { animation: none; }",
  '  /* \u51CF\u5C11\u52A8\u6548\uFF1A\u8FDB\u5EA6\u5F27\u7684\u4F4D\u79FB\u8FC7\u6E21\u4E5F\u4E00\u5E76\u505C\uFF0C\u907F\u514D"\u8FDB\u5EA6\u81EA\u5DF1\u5728\u722C"\u7684\u89C2\u611F\u3002 */',
  "  .ss-presence .ss-clock-prog { transition: none; }",
  "}",
  "",
  "/* ==================== \u60AC\u6D6E\u5361\u7247\u72B6\u6001\u884C\u589E\u8865\uFF08issue #4\uFF09 ==================== */",
  "/* \u4E0E\u5BBF\u4E3B .hoverStatus \u884C\u4E25\u683C\u540C\u6784\u3002\u5BBF\u4E3B StateDot \u5B9E\u6D4B\u7ED3\u6784\uFF08dsh-client-ui-primitives",
  "   \u7684 ._dot_* \u8FD0\u884C\u65F6\u6837\u5F0F\uFF0C10\xD710 relative + ::before 10px/inset:0 + ::after 6px/inset:2px\uFF0C",
  "   \u4E24\u5C42\u540C\u8272 \u2192 \u89C6\u89C9\u76F4\u5F84\u7EA6 8px\uFF09\uFF1A\u672C\u63D2\u4EF6\u6309\u4E0B\u8FF0\u540C\u6837\u7684\u53CC\u5C42\u5199\u6CD5\u81EA\u7ED8\uFF0C\u907F\u514D\u590D\u7528\u5176\u6784\u5EFA\u671F hash",
  "   \u7C7B\u540D\uFF08_dot_xxxxxx_n \u4E0D\u7A33\u5B9A\uFF0C\u5BBF\u4E3B\u5347\u7EA7\u4F1A\u9759\u9ED8\u5931\u6548\uFF09\u3002",
  "   \u989C\u8272\u8DDF\u968F\u5BBF\u4E3B\u8BED\u4E49\u8272\u677F\uFF0C\u4E0D\u5F15\u5165\u63D2\u4EF6\u4E13\u5C5E\u8272\u2014\u2014\u6587\u6848\u5DF2\u8BF4\u660E\u662F\u5B9A\u65F6\u63D0\u9192\uFF0C\u70B9\u4E0D\u5FC5\u518D\u627F\u62C5",
  "   \u300C\u533A\u5206\u6765\u6E90\u300D\u7684\u804C\u8D23\uFF1B\u6DF7\u5165\u7B2C\u4E94\u79CD\u989C\u8272\u53CD\u800C\u4E0E\u5BBF\u4E3B warning \u8BED\u4E49\u649E\u8F66\u3002",
  "",
  "   \u26A0\uFE0F \u5DF2\u77E5\u9650\u5236\uFF08\u6D45\u8272\u9002\u914D\u5C1A\u672A\u5904\u7406\uFF09\uFF1A\u4EE5\u4E0B\u8272\u503C\u662F\u5728**\u5F53\u524D\u6DF1\u8272\u4E3B\u9898**\u4E0B\u4ECE\u5BBF\u4E3B",
  "   \u5B9E\u6D4B\u5F97\u5230\u7684\u8FD0\u884C\u65F6\u503C\uFF0C\u5BBF\u4E3B\u81EA\u8EAB\u5F15\u7528 --dsw-alias-* token\uFF0C\u4F1A\u968F\u4E3B\u9898\u53D8\u5316\uFF0C",
  "   \u800C\u6B64\u5904\u662F\u786C\u7F16\u7801\u5E38\u91CF\u3002\u56E0\u6B64\u5F53\u524D\u4EC5\u5728\u6DF1\u8272\u4E3B\u9898\u4E0B\u4E0E\u5BBF\u4E3B\u4E00\u81F4\uFF1B\u5207\u6362\u5230\u6D45\u8272\u4E3B\u9898/",
  "   \u5176\u4ED6\u914D\u8272\u65B9\u6848\u65F6\uFF0C\u672C\u884C\u4E0D\u4F1A\u8DDF\u968F\uFF0C\u53EF\u80FD\u4E0E\u8BE5\u5361\u7247\u5176\u4F59\u5185\u5BB9\u4E0D\u540C\u6B65\u3002",
  "   \u4FEE\u6CD5\uFF1A\u5B9E\u6D4B\u6D45\u8272\u4E3B\u9898\u4E0B\u8BE5\u5361\u7247\u7684\u5B9E\u9645\u5E95\u8272\u540E\uFF0C\u6539\u7528\u5BF9\u5E94 token\uFF08\u5F85\u529E\uFF09\u3002 */",
  ".ss-hover-status {",
  "  display: flex; align-items: center; gap: 8px;",
  "  color: #adb2b8; font-size: 12px; line-height: 20px;",
  "}",
  "/* \u72B6\u6001\u70B9\uFF1A\u5BBF\u4E3B\u540C\u6B3E\u53CC\u5C42\u7ED3\u6784\u3002\u5173\u952E\u2014\u2014::before \u662F 10% \u900F\u660E\u5EA6\u7684**\u5149\u6655**\uFF0C",
  "   \u4E0D\u662F\u5B9E\u5FC3\u5916\u73AF\uFF1B::after \u624D\u662F 6px \u5B9E\u5FC3\u6838\u5FC3\u3002\u82E5 ::before \u4E0D\u8BBE opacity\uFF0C",
  "   \u5B83\u4F1A\u76D6\u4F4F\u6838\u5FC3\u5E76\u6E32\u67D3\u6210 10px \u5B9E\u5FC3\u5706\uFF08\u6BD4\u5BBF\u4E3B\u660E\u663E\u504F\u5927\u504F\u5B9E\uFF09\u3002 */",
  ".ss-hover-status-dot {",
  "  position: relative; display: block; flex: none;",
  "  width: 10px; height: 10px;",
  "  color: #adb2b8;",
  "}",
  ".ss-hover-status-dot::before,",
  ".ss-hover-status-dot::after {",
  '  content: ""; position: absolute; border-radius: 50%; background: currentColor;',
  "}",
  ".ss-hover-status-dot::before { inset: 0; opacity: 0.1; }",
  ".ss-hover-status-dot::after { inset: 2px; }",
  "/* \u8BED\u4E49\u6620\u5C04\uFF08\u5BF9\u9F50\u5BBF\u4E3B done/ongoing/warning/error \u56DB\u6001\u8272\u503C\uFF09\uFF1A",
  "   scheduled \u2192 ongoing \u7070\uFF08\u4E2D\u6027\uFF1A\u5DF2\u6392\u671F\uFF0C\u65E0\u7D27\u8FEB\u6027\uFF09",
  "   urgent    \u2192 warning \u7425\u73C0\uFF08\u22645min \u5373\u5C06\u89E6\u53D1\uFF09",
  "   overdue   \u2192 error \u7EA2\uFF08\u5DF2\u5230\u671F\uFF0C\u7B49\u5F85\u4F1A\u8BDD\u7A7A\u95F2\u53D1\u9001\uFF09 */",
  '.ss-hover-status[data-state="urgent"] .ss-hover-status-dot { color: #f59e0b; }',
  '.ss-hover-status[data-state="overdue"] .ss-hover-status-dot { color: #f25a5a; }',
  "",
  "/* ==================== \u8BBE\u7F6E\u9875\uFF08\u5B9A\u65F6\u63D0\u9192\u8868\u5355\uFF09 ==================== */",
  "/* \u89C6\u89C9\u5BF9\u9F50\u5B98\u65B9 SettingsForm\uFF08dsh-client-ui-primitives\uFF09\uFF1A\u88F8\u8868\u5355\uFF0C\u65E0\u5361\u7247\u5BB9\u5668\uFF0C",
  "   \u5B57\u6BB5\u6309 section \u5206\u7EC4\uFF0C\u6BCF\u7EC4\u6709\u6807\u9898\uFF0C\u5E95\u90E8\u4FDD\u5B58\u6309\u94AE\u3002\u7C7B\u540D\u7EDF\u4E00 ss- \u524D\u7F00\u3002 */",
  ".ss-settings-form {",
  "  display: flex; flex-direction: column;",
  "}",
  "/* Section \u5206\u7EC4\uFF08\u5BF9\u9F50\u5B98\u65B9 AZSXYW_section \u7ED3\u6784\uFF09 */",
  ".ss-section {",
  "  padding: 16px 0;",
  "}",
  ".ss-section-heading {",
  "  margin: 0; font-size: 13px; font-weight: 600; line-height: 1.5;",
  "  color: var(--dsw-alias-label-primary);",
  "}",
  ".ss-section-fields {",
  "  display: flex; flex-direction: column;",
  "}",
  /* 紧凑字段并排（对齐官方 hF0LTq_limits 网格：两等宽列、间距 16px） */
  ".ss-section-fieldsGrid {",
  "  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;",
  "}",
  /* 帮助按钮（对齐官方 _helpButton_：24×24、radius 8px、12px 圆圈问号图标） */
  ".ss-help-btn {",
  "  width: 24px; height: 24px; padding: 0; flex: none;",
  "  display: inline-flex; align-items: center; justify-content: center;",
  "  background: none; border: none; border-radius: 8px; cursor: pointer;",
  "  color: var(--dsw-alias-label-tertiary);",
  "}",
  ".ss-help-btn:hover, .ss-help-btnOpen { color: var(--dsw-alias-label-secondary); }",
  ".ss-help-btn:focus-visible {",
  "  outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -1px;",
  "}",
  /* 展开后的说明区（对齐官方 _help_：12px / 1.6 行高、顶部 10px、次级文字色） */
  ".ss-help {",
  "  margin: 0; padding: 10px 0 0; font-size: 12px; line-height: 1.6;",
  "  color: var(--dsw-alias-label-secondary);",
  "}",
  ".ss-help p { margin: 0; }",
  /* Toggle 行（对齐官方子智能体插件的开关行：label 左 + switch 右） */
  ".ss-toggle-row {",
  "  display: flex; align-items: center; justify-content: space-between;",
  "  gap: 16px;",
  "}",
  ".ss-toggle-label {",
  "  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;",
  "  color: var(--dsw-alias-label-primary);",
  "}",
  ".ss-toggle-switch {",
  "  position: relative; width: 36px; height: 20px; flex: none;",
  "  background: var(--dsw-alias-bg-module-platform); border-radius: 999px;",
  "  cursor: pointer; transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);",
  "  border: none; padding: 0;",
  "}",
  '.ss-toggle-switch[aria-checked="true"] { background: var(--dsw-alias-state-business-primary); }',
  ".ss-toggle-switch::after {",
  '  content: ""; position: absolute; top: 2px; left: 2px;',
  "  width: 16px; height: 16px; border-radius: 999px;",
  "  background: #fff; transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);",
  "}",
  '.ss-toggle-switch[aria-checked="true"]::after { transform: translateX(16px); }',
  ".ss-toggle-switch:disabled { opacity: 0.4; cursor: default; }",
  ".ss-toggle-switch:focus-visible {",
  "  outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px;",
  "}",
  ".ss-toggle-description {",
  "  margin: 0; padding: 0 0 12px; font-size: 12px; line-height: 1.6;",
  "  color: var(--dsw-alias-label-secondary);",
  "}",
  ".ss-label-group {",
  "  display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0;",
  "}",
  ".ss-card-fieldHead { align-items: center; gap: 8px; display: flex; }",
  ".ss-card-label {",
  "  min-width: 0; color: var(--dsw-alias-label-primary); flex: 1;",
  "  font-size: 13px; font-weight: 500; line-height: 1.5;",
  "}",
  ".ss-card-badges { align-items: center; gap: 8px; display: inline-flex; }",
  ".ss-card-badge {",
  "  white-space: nowrap; background: var(--dsw-alias-bg-module-platform);",
  "  color: var(--dsw-alias-label-secondary); border-radius: 999px;",
  "  padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px;",
  "}",
  ".ss-card-reset {",
  "  font: inherit; color: var(--dsw-alias-label-secondary); cursor: pointer;",
  "  background: none; border: none; padding: 0; font-size: 12px; line-height: 1.5;",
  "}",
  ".ss-card-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }",
  ".ss-card-reset:disabled { cursor: default; }",
  ".ss-card-invalid { color: var(--dsw-alias-state-error-primary); margin: 0; font-size: 12px; line-height: 1.5; }",
  "/*",
  " * \u9009\u9879\u98CE\u9669\u63D0\u793A\uFF08steer \u53EF\u80FD\u88AB\u56DE\u5408\u542F\u52A8\u541E\u6389 / discard \u4F1A\u8BA9\u9759\u9ED8\u4E22\u5931\u590D\u6D3B\uFF09\u3002",
  ' * \u5E38\u9A7B\u663E\u793A\u800C\u975E tooltip\uFF1A\u8FD9\u51E0\u9879\u914D\u7F6E\u7684\u540E\u679C\u662F"\u9759\u9ED8\u5931\u8D25"\uFF0C\u85CF\u5728\u60AC\u6D6E\u63D0\u793A\u91CC\u7B49\u4E8E\u6CA1\u6709\u3002',
  " */",
  ".ss-card-risk {",
  "  margin: 6px 0 0; padding: 6px 9px; border-radius: 6px;",
  "  font-size: 12px; line-height: 1.55;",
  "  color: var(--dsw-alias-state-warn-secondary);",
  "  background: color-mix(in srgb, var(--dsw-alias-state-warn-secondary) 12%, transparent);",
  "  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-secondary) 30%, transparent);",
  "}",
  "/*",
  " * \u8054\u52A8\u9501\u8BF4\u660E\uFF08\xA76.3\uFF1AmaxPromptChars \u56E0\u300C\u5141\u8BB8\u957F\u6587\u672C\u300D\u5173\u95ED\u800C\u4E0D\u53EF\u7F16\u8F91\uFF09\u3002",
  " * \u4E0E .ss-card-risk \u533A\u5206\uFF1A\u90A3\u662F**\u540E\u679C\u8B66\u544A**\uFF08\u4F1A\u9759\u9ED8\u4E22\u6570\u636E\uFF09\uFF0C\u6545\u7528 warn \u8272 + \u5E95\u8272\u6846\uFF1B",
  " * \u8FD9\u91CC\u53EA\u662F\u300C\u4E3A\u4EC0\u4E48\u73B0\u5728\u4E0D\u80FD\u6539\u300D\u7684\u4E2D\u6027\u8BF4\u660E\uFF0C\u7528\u6B21\u7EA7\u6587\u5B57\u8272\u3001\u65E0\u5E95\u8272\uFF0C\u907F\u514D\u628A",
  " * \u4E00\u4E2A\u6B63\u5E38\u72B6\u6001\u6E32\u67D3\u6210\u50CF\u662F\u51FA\u9519\u4E86\u3002\u5E38\u9A7B\u800C\u975E tooltip\uFF1Adisabled \u63A7\u4EF6\u4E0A\u7684 title",
  " * \u5728\u591A\u6570\u6D4F\u89C8\u5668\u91CC\u4E0D\u89E6\u53D1\uFF0C\u7B49\u4E8E\u6CA1\u6709\u63D0\u793A\u3002",
  " */",
  ".ss-card-gate {",
  "  margin: 0; font-size: 12px; line-height: 1.5;",
  "  color: var(--dsw-alias-label-tertiary);",
  "}",
  ".ss-card-footer {",
  "  justify-content: flex-end; align-items: center; gap: 8px;",
  "  padding-top: 16px; display: flex;",
  "}",
  ".ss-card-failed {",
  "  min-width: 0; color: var(--dsw-alias-label-error); flex: 1; margin: 0;",
  "  font-size: 12px; line-height: 1.5;",
  "}",
  ".ss-card-discard, .ss-card-save {",
  "  appearance: none; font: inherit; cursor: pointer;",
  "  border: 1px solid transparent; border-radius: var(--dsw-radius-md);",
  "  padding: 5px 14px; font-size: 13px; line-height: 1.5;",
  "}",
  ".ss-card-discard { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: none; }",
  ".ss-card-discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }",
  ".ss-card-save { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }",
  ".ss-card-save:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }",
  ".ss-card-discard:disabled, .ss-card-save:disabled { opacity: 0.4; cursor: default; }",
  ".ss-card-discard:focus-visible, .ss-card-save:focus-visible {",
  "  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px;",
  "}"
].join("\n");
function injectStyles() {
  if (typeof document === "undefined") return () => void 0;
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) {
    return () => void 0;
  }
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-later";
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = COMPONENTS;
  document.head.appendChild(tag);
  return () => {
    tag.remove();
  };
}

// src/client/group-status-facet.ts
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/presence.ts
var PRESENCE_URGENT_WINDOW_MS = 5 * 6e4;
function summarizeSchedules(schedules) {
  let nextAt;
  let progressFrom;
  let count = 0;
  let pausedCount = 0;
  for (const item of schedules ?? []) {
    const raw = item.scheduled_at ?? item.scheduledAt;
    if (raw === void 0) continue;
    const epoch = Date.parse(raw);
    if (!Number.isFinite(epoch)) continue;
    count += 1;
    if (item.status === "paused") {
      pausedCount += 1;
      continue;
    }
    if (nextAt === void 0 || epoch < nextAt) {
      nextAt = epoch;
      progressFrom = windowStartOf(item, epoch);
    }
  }
  if (count === 0) return { count: 0, pausedCount: 0 };
  return nextAt === void 0 ? { count, pausedCount } : { count, nextAt, pausedCount, ...progressFrom !== void 0 ? { progressFrom } : {} };
}
function windowStartOf(item, scheduledEpoch) {
  const explicit = toFiniteSeconds(item.window_seconds ?? item.windowSeconds);
  if (explicit !== void 0) return scheduledEpoch - explicit * 1e3;
  const afterSec = toFiniteSeconds(item.after_seconds ?? item.afterSeconds);
  const everySec = toFiniteSeconds(item.every_seconds ?? item.everySeconds);
  const span = item.kind === "every" ? everySec : afterSec ?? everySec;
  if (span !== void 0) return scheduledEpoch - span * 1e3;
  const created = toEpochMs(item.created_at) ?? toEpochMs(item.createdAt);
  if (created !== null) return created;
  return void 0;
}
function toFiniteSeconds(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
function toEpochMs(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function progressOf(entry, now) {
  const { nextAt, progressFrom } = entry;
  if (nextAt === void 0 || progressFrom === void 0) return void 0;
  const span = nextAt - progressFrom;
  if (!(span > 0)) return void 0;
  const ratio = (now - progressFrom) / span;
  if (!Number.isFinite(ratio)) return void 0;
  return ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
}
function badgeStateFor(nextAt, now) {
  if (nextAt === void 0) return "scheduled";
  const diff = nextAt - now;
  if (diff <= 0) return "overdue";
  if (diff <= PRESENCE_URGENT_WINDOW_MS) return "urgent";
  return "scheduled";
}
function hoverScheduleStatus(entry, now, labels, strings, formatHhmm3, formatDate2) {
  const tone = badgeStateFor(entry.nextAt, now);
  if (entry.nextAt === void 0 && entry.pausedCount > 0) {
    const paused = strings.hoverSchedulePaused ?? strings.hoverScheduleOverdue;
    return { label: formatTemplate(paused, { n: entry.count }), tone };
  }
  if (tone === "overdue" || entry.nextAt === void 0) {
    return { label: formatTemplate(strings.hoverScheduleOverdue, { n: entry.count }), tone };
  }
  const time = relativeFireLabel(entry.nextAt, now, labels, formatHhmm3, formatDate2);
  return { label: formatTemplate(strings.hoverScheduleStatus, { n: entry.count, time }), tone };
}
function formatTemplate(template, params) {
  return template.replace(
    /\{(\w+)\}/g,
    (match, key) => key in params ? String(params[key]) : match
  );
}
function startOfDay(epoch) {
  const d = new Date(epoch);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function relativeFireLabel(nextAt, now, labels, formatHhmm3, formatDate2) {
  const diff = nextAt - now;
  if (diff <= 0) return labels.clock(formatHhmm3(nextAt));
  if (diff <= 6e4) return labels.imminent;
  if (diff < 36e5) return labels.minutes(Math.max(1, Math.round(diff / 6e4)));
  const dayDiff = Math.round((startOfDay(nextAt) - startOfDay(now)) / 864e5);
  const time = formatHhmm3(nextAt);
  if (dayDiff <= 0) return labels.hours(Math.max(1, Math.round(diff / 36e5)));
  if (dayDiff === 1) return labels.tomorrow(time);
  return labels.date(formatDate2(nextAt), time);
}

// src/schedule-summary.ts
var SCHEDULE_PROJECTION_KEY = "userSchedules";
function schedulesOfProjection(projectionValues) {
  const value = projectionValues?.[SCHEDULE_PROJECTION_KEY];
  if (typeof value !== "object" || value === null) return void 0;
  const schedules = value.schedules;
  return Array.isArray(schedules) ? schedules : void 0;
}
function buildScheduleSummary(source, now) {
  const summary = /* @__PURE__ */ new Map();
  for (const [sessionId, row] of Object.entries(source.byId)) {
    if (row === void 0) continue;
    const entry = summarizeSchedules(schedulesOfProjection(row.projectionValues));
    if (entry.count === 0) continue;
    summary.set(sessionId, { ...entry, state: badgeStateFor(entry.nextAt, now) });
  }
  return summary;
}
function sameScheduleSummary(a, b) {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [sessionId, left] of a) {
    const right = b.get(sessionId);
    if (right === void 0) return false;
    if (left.count !== right.count || left.pausedCount !== right.pausedCount || left.nextAt !== right.nextAt || left.progressFrom !== right.progressFrom || left.state !== right.state) {
      return false;
    }
  }
  return true;
}
var STATE_RANK = { scheduled: 0, urgent: 1, overdue: 2 };
function summarizeScheduleGroup(summary, sessionIds) {
  let sessions = 0;
  let count = 0;
  let pausedCount = 0;
  let nextAt;
  let state;
  for (const sessionId of sessionIds) {
    const entry = summary.get(sessionId);
    if (entry === void 0) continue;
    sessions += 1;
    count += entry.count;
    pausedCount += entry.pausedCount;
    if (entry.nextAt !== void 0 && (nextAt === void 0 || entry.nextAt < nextAt)) nextAt = entry.nextAt;
    if (state === void 0 || STATE_RANK[entry.state] > STATE_RANK[state]) state = entry.state;
  }
  return nextAt === void 0 ? { sessions, count, pausedCount, state } : { sessions, count, pausedCount, nextAt, state };
}

// src/schedule-facet.ts
var LATER_SCHEDULE_FACET_ID = "dsh-later.schedule";
var LATER_SCHEDULE_FACET_PROTOCOL = 1;
var LATER_SCHEDULE_FACET_SETTING_KEY = "showScheduledInBadge";
var LATER_SCHEDULE_FACET_ORDER = 10;
var FACET_TONE_COLOR = {
  info: "#8b5cf6",
  warn: "var(--dsw-alias-state-warn-secondary)",
  error: "var(--dsw-alias-state-error-primary)"
};
function facetIconColor(tone) {
  return tone === "warn" ? FACET_TONE_COLOR.warn : tone === "error" ? FACET_TONE_COLOR.error : FACET_TONE_COLOR.info;
}
var NO_SCHEDULES = /* @__PURE__ */ new Map();
function toneOfState(state) {
  return state === "overdue" ? "error" : state === "urgent" ? "warn" : "info";
}
function pulseOfState(state) {
  return state === "overdue" || state === "urgent";
}
function foldLaterSchedule(snapshot, sessionIds) {
  const group = summarizeScheduleGroup(snapshot ?? NO_SCHEDULES, sessionIds);
  return {
    count: group.sessions,
    tone: toneOfState(group.state),
    pulse: pulseOfState(group.state),
    data: group
  };
}
function mergeLaterSchedule(a, b) {
  const state = moreUrgent(a.data.state, b.data.state);
  const nextAt = earliestNextAt(a.data.nextAt, b.data.nextAt);
  const group = nextAt === void 0 ? {
    sessions: a.data.sessions + b.data.sessions,
    count: a.data.count + b.data.count,
    pausedCount: a.data.pausedCount + b.data.pausedCount,
    ...state === void 0 ? {} : { state }
  } : {
    sessions: a.data.sessions + b.data.sessions,
    count: a.data.count + b.data.count,
    pausedCount: a.data.pausedCount + b.data.pausedCount,
    nextAt,
    ...state === void 0 ? {} : { state }
  };
  return { count: group.sessions, tone: toneOfState(state), pulse: pulseOfState(state), data: group };
}
function moreUrgent(a, b) {
  if (a === void 0) return b;
  if (b === void 0) return a;
  return STATE_RANK[b] > STATE_RANK[a] ? b : a;
}
function earliestNextAt(a, b) {
  if (a === void 0) return b;
  if (b === void 0) return a;
  return b < a ? b : a;
}
function laterScheduleFacetLabel(fold, word) {
  return word === "" ? "" : `${fold.count} ${word}`;
}

// src/client/group-status-facet.ts
var GROUP_STATUS_CLIENT = "dsh-group-status/client";
var FACET_ICON_SIZE = 14;
function groupStatusClient() {
  try {
    const mod = require(GROUP_STATUS_CLIENT);
    return typeof mod === "object" && mod !== null ? mod : void 0;
  } catch {
    return void 0;
  }
}
var NOOP_UNREGISTER = () => {
};
function registerLaterScheduleFacet(input) {
  const client = groupStatusClient();
  if (client === void 0 || typeof client.registerGroupStatusFacet !== "function") {
    return NOOP_UNREGISTER;
  }
  const peerProtocol = client.GROUP_STATUS_FACET_PROTOCOL_VERSION;
  if (peerProtocol !== LATER_SCHEDULE_FACET_PROTOCOL) {
    console.warn(
      `dsh-later: \u8DF3\u8FC7\u5206\u7EC4\u72B6\u6001 facet \u767B\u8BB0\u2014\u2014\u5BF9\u7AEF\u534F\u8BAE\u7248\u672C ${String(peerProtocol)} \u4E0E\u672C\u63D2\u4EF6\u5B9E\u73B0\u7684 v${LATER_SCHEDULE_FACET_PROTOCOL} \u4E0D\u4E00\u81F4`
    );
    return NOOP_UNREGISTER;
  }
  const facet = {
    protocol: LATER_SCHEDULE_FACET_PROTOCOL,
    id: LATER_SCHEDULE_FACET_ID,
    // 直接复用 store 的订阅面：本插件的 store 与 apply 同批创建，不存在「store 迟到」
    // 那条路径（对方代管时才需要包一层登记面订阅）。
    subscribe: (listener) => input.store.subscribe(listener),
    getSnapshot: () => input.store.getSnapshot(),
    fold: (snapshot, sessionIds) => foldLaterSchedule(snapshot, sessionIds),
    merge: mergeLaterSchedule,
    label: (fold) => laterScheduleFacetLabel(fold, input.scheduledWord()),
    // 图标自带配色（协议要求）：group-status 只管把元素放进徽标排格，不再反推颜色。
    renderIcon: (fold) => (0, import_react.createElement)(
      "span",
      { style: { color: facetIconColor(fold.tone), display: "inline-flex", alignItems: "center" } },
      (0, import_react.createElement)(import_dsh_client_ui_primitives.IconClockOutlineRegular, { size: FACET_ICON_SIZE })
    ),
    settingKey: LATER_SCHEDULE_FACET_SETTING_KEY,
    order: LATER_SCHEDULE_FACET_ORDER
  };
  const unregister = client.registerGroupStatusFacet(facet);
  return typeof unregister === "function" ? unregister : NOOP_UNREGISTER;
}

// src/client/components/SchedButton.tsx
var import_react8 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/time-utils.ts
function detectTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz?.length ? tz : "UTC";
  } catch {
    return "UTC";
  }
}
function formatRelative(epoch, now = Date.now(), locale = "zh") {
  const diff = epoch - now;
  if (locale === "en") {
    if (diff < 0) return "overdue";
    if (diff < MINUTE_MS) return "sending soon";
    const minutes2 = Math.round(diff / MINUTE_MS);
    if (minutes2 < 60) return `in ~${minutes2} min`;
    const hours2 = Math.floor(minutes2 / 60);
    const restMinutes2 = minutes2 % 60;
    if (hours2 < 24) {
      return restMinutes2 === 0 ? `in ~${hours2} h` : `in ~${hours2} h ${restMinutes2} min`;
    }
    const days2 = Math.floor(hours2 / 24);
    return `in ~${days2} days`;
  }
  if (diff < 0) return "\u5DF2\u5230\u671F";
  if (diff < MINUTE_MS) return "\u5373\u5C06\u53D1\u9001";
  const minutes = Math.round(diff / MINUTE_MS);
  if (minutes < 60) return `\u7EA6 ${minutes} \u5206\u949F\u540E`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes === 0 ? `\u7EA6 ${hours} \u5C0F\u65F6\u540E` : `\u7EA6 ${hours} \u5C0F\u65F6 ${restMinutes} \u5206\u540E`;
  }
  const days = Math.floor(hours / 24);
  return `\u7EA6 ${days} \u5929\u540E`;
}
var MINUTE_MS = 60 * 1e3;
var HOUR_MS = 60 * MINUTE_MS;
var DAY_MS = 24 * HOUR_MS;
function formatAbsolute(epoch, timeZone, locale = "zh") {
  const formatter = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  return formatter.format(epoch).replace(/\s+/g, " ");
}
function formatHhmm(epoch, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB-u-ca-iso8601-nu-latn", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  return formatter.format(epoch);
}

// src/client/useSchedT.ts
var import_react2 = require("react");
var noopSubscribe = () => () => {
};
function useSchedT(locale, seatT) {
  const subscribe = (0, import_react2.useCallback)(
    (onStoreChange) => locale === void 0 ? noopSubscribe() : locale.subscribe(onStoreChange),
    [locale]
  );
  const getActive = (0, import_react2.useCallback)(() => locale === void 0 ? "zh" : locale.getSnapshot().active, [locale]);
  const active = (0, import_react2.useSyncExternalStore)(subscribe, getActive);
  const lang = active === "en" ? "en" : "zh";
  const t = dictFor(active);
  return { lang, t, tr: schedTranslate(seatT, active) };
}
function schedTranslate(seatT, localeId) {
  const fallback = dictFor(localeId);
  if (seatT === void 0) {
    return (key, params) => params === void 0 ? fallback[key] : format(fallback[key], params);
  }
  return (key, params) => {
    const raw = params === void 0 ? seatT(key) : seatT(key, params);
    if (raw !== key) return raw;
    const template = fallback[key];
    return params === void 0 ? template : format(template, params);
  };
}

// src/client/components/SchedPanel.tsx
var import_react5 = require("react");
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/smart-window.ts
var DEFAULT_SMART_WINDOW = Object.freeze({
  workStart: "09:00",
  workEnd: "18:00",
  lunchStart: "12:00",
  lunchEnd: "14:00",
  eveningEnd: "22:00"
});
var HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function isValidHhmm(value) {
  return typeof value === "string" && HHMM_RE.test(value);
}
function sanitizeSmartWindowConfig(raw) {
  const pick2 = (key, fallback) => isValidHhmm(raw?.[key]) ? raw[key] : fallback;
  return {
    workStart: pick2("workStart", DEFAULT_SMART_WINDOW.workStart),
    workEnd: pick2("workEnd", DEFAULT_SMART_WINDOW.workEnd),
    lunchStart: pick2("lunchStart", DEFAULT_SMART_WINDOW.lunchStart),
    lunchEnd: pick2("lunchEnd", DEFAULT_SMART_WINDOW.lunchEnd),
    eveningEnd: pick2("eveningEnd", DEFAULT_SMART_WINDOW.eveningEnd)
  };
}
var SMART_MIN_DELAY_MS = 2 * 60 * 1e3;
var MINUTE_MS2 = 60 * 1e3;
var HOUR_MS2 = 60 * MINUTE_MS2;
var DAY_MS2 = 24 * HOUR_MS2;
function hhmmToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (match === null) return void 0;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return void 0;
  return hour * 60 + minute;
}
function isValidWindow(window2) {
  const order = [
    hhmmToMinutes(window2.workStart),
    hhmmToMinutes(window2.lunchStart),
    hhmmToMinutes(window2.lunchEnd),
    hhmmToMinutes(window2.workEnd),
    hhmmToMinutes(window2.eveningEnd)
  ];
  if (order.some((value) => value === void 0)) return false;
  return order[0] < order[1] && order[1] < order[2] && order[2] < order[3] && order[3] < order[4];
}
function formatterFor(timeZone) {
  return new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
}
function localFieldsOf(epoch, timeZone) {
  const formatter = formatterFor(timeZone);
  const parts = Object.fromEntries(
    formatter.formatToParts(epoch).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: Number(parts["hour"]),
    minute: Number(parts["minute"]),
    second: Number(parts["second"])
  };
}
function offsetOf(epoch, timeZone) {
  const f = localFieldsOf(epoch, timeZone);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second, 0) - epoch;
}
function resolveWallClock(epochOnDay, timeZone, hour, minute, second = 0) {
  const base = localFieldsOf(epochOnDay, timeZone);
  const localEpoch = Date.UTC(base.year, base.month - 1, base.day, hour, minute, second, 0);
  const offsets = /* @__PURE__ */ new Set();
  for (let delta = -2; delta <= 2; delta += 1) {
    offsets.add(offsetOf(localEpoch + delta * DAY_MS2, timeZone));
  }
  const candidates = [];
  for (const offset of offsets) {
    const candidate = localEpoch - offset;
    const f = localFieldsOf(candidate, timeZone);
    if (f.year === base.year && f.month === base.month && f.day === base.day && f.hour === hour && f.minute === minute && f.second === second) {
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => a - b);
  return candidates[0];
}
function nextMinutesAfter(now, timeZone, minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  let probe = resolveWallClock(now, timeZone, hour, minute);
  if (probe === void 0) {
    probe = resolveWallClock(now + DAY_MS2, timeZone, hour, minute);
  }
  if (probe === void 0) {
    return Date.UTC(
      localFieldsOf(now, timeZone).year,
      localFieldsOf(now, timeZone).month - 1,
      localFieldsOf(now, timeZone).day,
      hour,
      minute,
      0,
      0
    );
  }
  if (probe > now) return probe;
  const nextDay = resolveWallClock(probe + DAY_MS2, timeZone, hour, minute) ?? probe + DAY_MS2;
  return nextDay > now ? nextDay : nextDay + DAY_MS2;
}
function nextSmartTarget(now, timeZone, window2 = DEFAULT_SMART_WINDOW) {
  if (!isValidWindow(window2)) throw new TypeError("smart window configuration is invalid");
  const fields = localFieldsOf(now, timeZone);
  const minutes = fields.hour * 60 + fields.minute;
  const lunchStart = hhmmToMinutes(window2.lunchStart);
  const lunchEnd = hhmmToMinutes(window2.lunchEnd);
  if (minutes >= lunchStart && minutes < lunchEnd) {
    return now + SMART_MIN_DELAY_MS;
  }
  const workStart = hhmmToMinutes(window2.workStart);
  const eveningStart = hhmmToMinutes(window2.workEnd);
  const candidates = [
    nextMinutesAfter(now, timeZone, workStart),
    nextMinutesAfter(now, timeZone, lunchEnd),
    nextMinutesAfter(now, timeZone, eveningStart)
  ].filter((target) => target > now + SMART_MIN_DELAY_MS);
  if (candidates.length === 0) {
    const earliest = Math.min(
      nextMinutesAfter(now, timeZone, workStart),
      nextMinutesAfter(now, timeZone, lunchEnd),
      nextMinutesAfter(now, timeZone, eveningStart)
    );
    return Math.max(earliest, now + SMART_MIN_DELAY_MS);
  }
  return Math.min(...candidates);
}
function epochFromLocal(date, time, timeZone) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (dateMatch === null || timeMatch === null) return void 0;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59 || month < 1 || month > 12 || day < 1 || day > 31) {
    return void 0;
  }
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const offsets = /* @__PURE__ */ new Set();
  for (let delta = -2; delta <= 2; delta += 1) {
    offsets.add(offsetOf(localEpoch + delta * DAY_MS2, timeZone));
  }
  const candidates = [];
  for (const offset of offsets) {
    const candidate = localEpoch - offset;
    const f = localFieldsOf(candidate, timeZone);
    if (f.year === year && f.month === month && f.day === day && f.hour === hour && f.minute === minute && f.second === second) {
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => a - b);
  return candidates[0];
}
function nextSmartAt(now, timeZone, window2 = DEFAULT_SMART_WINDOW) {
  let target;
  try {
    target = nextSmartTarget(now, timeZone, window2);
  } catch {
    return null;
  }
  let parts;
  try {
    parts = localFieldsOf(target, timeZone);
  } catch {
    return null;
  }
  const date = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
  return {
    date,
    time,
    time_zone: timeZone,
    epoch: target
  };
}

// src/client/components/TaskList.tsx
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
function scheduleStateOf(item, now) {
  return Date.parse(item.scheduled_at) <= now ? "overdue" : "scheduled";
}
function TaskList({ items, now, deliveredIds, cancellingIds, onDelete, timeZone, t, lang }) {
  if (items.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ss-empty", "data-ss-empty": "", children: t.emptyTasks });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "ss-tasks", "data-ss-tasks": "", children: items.map((item) => {
    const dotState = deliveredIds?.has(item.id) ? "delivered" : cancellingIds?.has(item.id) ? "cancelled" : scheduleStateOf(item, now);
    const isCancelled = dotState === "cancelled";
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: isCancelled ? "ss-task cancelled" : "ss-task", "data-ss-task": item.id, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `ss-dot ${dotState}`, "aria-hidden": "true" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ss-task-main", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ss-task-time", children: [
          formatAbsolute(Date.parse(item.scheduled_at), timeZone, lang),
          " \xB7 ",
          formatRelative(Date.parse(item.scheduled_at), now, lang)
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ss-task-prompt", children: item.prompt })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "ss-task-del",
          title: t.deleteTask,
          "aria-label": `${t.deleteTask}: ${item.prompt}`,
          onClick: (event) => {
            event.stopPropagation();
            onDelete(item.id);
          },
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconCloseOutlineRegular, { size: 14 })
        }
      )
    ] }, item.id);
  }) });
}

// src/client/useCountdown.ts
var import_react3 = require("react");
function useNow(intervalMs = 1e3) {
  const [now, setNow] = (0, import_react3.useState)(() => Date.now());
  (0, import_react3.useEffect)(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// src/client/primitives-compat.ts
var import_react4 = require("react");
var primitives = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
function pick(name2) {
  return primitives[name2];
}
var hostUseAnchoredPosition = pick("useAnchoredPosition");
var hostUseDismissOnOutsidePointer = pick("useDismissOnOutsidePointer");
function useLegacyAnchoredPosition({
  open,
  anchorRef,
  panelRef,
  side = "bottom",
  align = "start",
  gap,
  margin
}) {
  const [position, setPosition] = (0, import_react4.useState)(null);
  (0, import_react4.useLayoutEffect)(() => {
    if (!open) {
      setPosition(null);
      return void 0;
    }
    const measure = () => {
      const anchor = anchorRef.current;
      const panel2 = panelRef.current;
      if (anchor === null || panel2 === null) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = panel2.offsetWidth;
      const panelHeight = panel2.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const left = align === "end" ? rect.right - panelWidth : rect.left;
      const rawTop = side === "top" ? rect.top - panelHeight - gap : rect.bottom + gap;
      const clampedLeft = Math.min(
        Math.max(margin, left),
        Math.max(margin, viewportWidth - panelWidth - margin)
      );
      const overflowsTop = rawTop < margin;
      const overflowsBottom = rawTop + panelHeight > viewportHeight - margin;
      const top = overflowsTop && !overflowsBottom ? rect.bottom + gap : overflowsBottom && !overflowsTop ? rect.top - panelHeight - gap : rawTop;
      setPosition({
        left: `${Math.round(clampedLeft)}px`,
        top: `${Math.round(Math.max(margin, Math.min(top, viewportHeight - panelHeight - margin)))}px`
      });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const panel = panelRef.current;
    const observer = typeof ResizeObserver === "undefined" || panel === null ? void 0 : new ResizeObserver(measure);
    if (observer !== void 0 && panel !== null) observer.observe(panel);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [open, anchorRef, panelRef, side, align, gap, margin]);
  return position;
}
function noopDismiss() {
}
var anchorImpl = hostUseAnchoredPosition ?? useLegacyAnchoredPosition;
var dismissImpl = hostUseDismissOnOutsidePointer ?? noopDismiss;
var hasOfficialOutsideDismiss = hostUseDismissOnOutsidePointer !== void 0;
var hasOfficialAnchoredPosition = hostUseAnchoredPosition !== void 0;
function usePanelAnchorPosition(options) {
  return anchorImpl(options);
}
function usePanelOutsideDismiss(root, open, setOpen, portal) {
  return dismissImpl(root, open, setOpen, portal);
}
var PANEL_MEASURE_STYLE = {
  visibility: "hidden",
  left: 0,
  top: 0
};
function useEscapeToClose(open, setOpen) {
  const setOpenRef = (0, import_react4.useRef)(setOpen);
  setOpenRef.current = setOpen;
  (0, import_react4.useEffect)(() => {
    if (!open) return void 0;
    const onKey = (event) => {
      if (event.key === "Escape") setOpenRef.current(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
}

// src/client/components/SchedPanel.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function atOnDay(dayOffset, hhmm, timeZone, now) {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (match === null) return null;
  const fields = localFieldsOf(now + dayOffset * 24 * 3600 * 1e3, timeZone);
  const date = `${String(fields.year).padStart(4, "0")}-${String(fields.month).padStart(2, "0")}-${String(fields.day).padStart(2, "0")}`;
  const epoch = epochFromLocal(date, `${hhmm}:00`, timeZone);
  if (epoch === void 0 || Number.isNaN(epoch)) return null;
  return { at: { date, time: `${hhmm}:00`, time_zone: timeZone }, epoch };
}
function SchedPanel({
  defaultPrompt,
  schedules,
  timeZone,
  busy,
  t,
  lang,
  onClose,
  onCreate,
  onDelete,
  bottom,
  anchorRef,
  panelRef: externalPanelRef,
  smartWindow = DEFAULT_SMART_WINDOW,
  promptLimits
}) {
  const now = useNow(1e3);
  const localPanelRef = (0, import_react5.useRef)(null);
  const panelRef = externalPanelRef ?? localPanelRef;
  const anchored = usePanelAnchorPosition({
    open: true,
    anchorRef: anchorRef ?? { current: null },
    panelRef,
    side: "top",
    align: "start",
    gap: 4,
    margin: 12
  });
  const panelStyle = hasOfficialAnchoredPosition ? anchored ?? PANEL_MEASURE_STYLE : { bottom };
  const [selected, setSelected] = (0, import_react5.useState)("after-600");
  const [customDate, setCustomDate] = (0, import_react5.useState)(() => {
    const f = localFieldsOf(Date.now(), timeZone);
    return `${String(f.year).padStart(4, "0")}-${String(f.month).padStart(2, "0")}-${String(f.day).padStart(2, "0")}`;
  });
  const [customTime, setCustomTime] = (0, import_react5.useState)("18:00");
  const [error, setError] = (0, import_react5.useState)(null);
  const [cancelling, setCancelling] = (0, import_react5.useState)(/* @__PURE__ */ new Set());
  const [delivered, setDelivered] = (0, import_react5.useState)(/* @__PURE__ */ new Set());
  const deliveredTimers = (0, import_react5.useRef)([]);
  const prevIds = (0, import_react5.useRef)(null);
  (0, import_react5.useEffect)(() => {
    const currentIds = new Set(schedules.map((item) => item.id));
    const previous = prevIds.current;
    prevIds.current = currentIds;
    if (previous === null) return;
    const gone = [...previous].filter((id) => !currentIds.has(id) && !cancelling.has(id));
    if (gone.length === 0) return;
    setDelivered((existing) => /* @__PURE__ */ new Set([...existing, ...gone]));
    for (const id of gone) {
      const timer = window.setTimeout(() => {
        setDelivered((existing) => {
          const next = new Set(existing);
          next.delete(id);
          return next;
        });
      }, 3e3);
      deliveredTimers.current.push(timer);
    }
  }, [schedules, cancelling]);
  (0, import_react5.useEffect)(
    () => () => {
      for (const timer of deliveredTimers.current) window.clearTimeout(timer);
    },
    []
  );
  const quickOptions = (0, import_react5.useMemo)(() => {
    const options = [
      { kind: "after", seconds: 600, label: t.quick10m },
      { kind: "after", seconds: 3600, label: t.quick1h }
    ];
    const todayEvening = atOnDay(0, smartWindow.workEnd, timeZone, now);
    if (todayEvening !== null && todayEvening.epoch > now) {
      options.push({ kind: "at", ...todayEvening, label: `${t.today} ${smartWindow.workEnd}` });
    }
    const tomorrowMorning = atOnDay(1, smartWindow.workStart, timeZone, now);
    if (tomorrowMorning !== null && tomorrowMorning.epoch > now) {
      options.push({ kind: "at", ...tomorrowMorning, label: `${t.tomorrow} ${smartWindow.workStart}` });
    }
    const smart = nextSmartAt(now, timeZone, smartWindow);
    if (smart !== null) {
      options.push({
        kind: "smart",
        at: { date: smart.date, time: smart.time, time_zone: smart.time_zone },
        epoch: smart.epoch,
        label: t.quickSmart
      });
    }
    options.push({ kind: "custom", label: t.quickCustom });
    return options;
  }, [timeZone, now, t, smartWindow]);
  const target = (0, import_react5.useMemo)(() => {
    if (selected === "custom") {
      const match = /^(\d{2}):(\d{2})$/.exec(customTime);
      if (match === null) return null;
      const epoch = epochFromLocal(customDate, `${customTime}:00`, timeZone);
      if (epoch === void 0 || Number.isNaN(epoch) || epoch <= now) return null;
      return { at: { date: customDate, time: `${customTime}:00`, time_zone: timeZone }, epoch };
    }
    const option = quickOptions.find((item) => keyOf(item) === selected);
    if (option === void 0 || option.kind === "custom") return null;
    if (option.kind === "after") return { after_seconds: option.seconds, epoch: now + option.seconds * 1e3 };
    return { at: option.at, epoch: option.epoch };
  }, [selected, customDate, customTime, timeZone, now, quickOptions]);
  const targetLabel = (0, import_react5.useMemo)(() => {
    if (target === void 0 || target === null) return null;
    return `${formatAbsolute(target.epoch, timeZone, lang)} \xB7 ${formatRelative(target.epoch, now, lang)}`;
  }, [target, timeZone, now]);
  const handleConfirm = async () => {
    const text = defaultPrompt.trim();
    if (text.length === 0) {
      setError(t.errPromptEmpty);
      return;
    }
    const maxChars = promptLimits?.maxChars ?? 1e3;
    if (text.length > maxChars) {
      setError(t.errPromptTooLong);
      return;
    }
    if (target === null) {
      setError(t.errTimePast);
      return;
    }
    setError(null);
    try {
      await onCreate(
        target.at !== void 0 ? { prompt: text, at: target.at } : { prompt: text, after_seconds: target.after_seconds }
      );
      onClose();
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      const message = raw === CLIENT_ERR.NO_SESSION ? t.errNoSession : raw === CLIENT_ERR.NOT_ACCEPTED ? t.errNotAcceptedStashed : raw;
      setError(format(t.errCreateFailed, { message }));
    }
  };
  const handleDelete = (id) => {
    setCancelling((current) => new Set(current).add(id));
    try {
      onDelete(id);
    } catch (cause) {
      setError(format(t.errDeleteFailed, { message: cause instanceof Error ? cause.message : String(cause) }));
    }
    window.setTimeout(() => {
      setCancelling((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, 2500);
  };
  const promptEmpty = defaultPrompt.trim().length === 0;
  const canConfirm = !busy && !promptEmpty && target !== null;
  const panel = /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      ref: panelRef,
      className: "ss-panel",
      "data-ss-panel": "",
      role: "dialog",
      "aria-label": t.panelTitle,
      style: panelStyle,
      onClick: (event) => event.stopPropagation(),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ss-panel-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ss-panel-title", children: t.panelTitle }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "ss-panel-close", "aria-label": t.close, onClick: onClose, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives3.IconCloseOutlineRegular, { size: 14 }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ss-quick-grid", role: "radiogroup", "aria-label": t.panelTitle, children: quickOptions.map((option) => {
          const key = keyOf(option);
          const active = selected === key || option.kind === "custom" && selected === "custom";
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              role: "radio",
              "aria-checked": active,
              className: active ? "ss-quick-chip ss-active" : "ss-quick-chip",
              onClick: () => {
                setSelected(key);
                setError(null);
              },
              children: option.label
            },
            key
          );
        }) }),
        selected === "custom" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ss-custom-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              type: "date",
              className: "ss-input",
              "aria-label": t.dateLabel,
              value: customDate,
              onChange: (event) => {
                if (event.target.value) setCustomDate(event.target.value);
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              type: "time",
              className: "ss-input",
              "aria-label": t.timeLabel,
              value: customTime,
              onChange: (event) => {
                if (event.target.value) setCustomTime(event.target.value);
              }
            }
          )
        ] }),
        target !== null && targetLabel !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ss-hint", style: { margin: "6px 0 0" }, children: targetLabel }),
        error !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ss-error", role: "alert", style: { marginTop: 6 }, children: error }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ss-tasklist-head", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "ss-hint", children: [
          t.taskListTitle,
          schedules.length > 0 ? ` (${schedules.length})` : ""
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          TaskList,
          {
            items: schedules,
            now,
            deliveredIds: delivered,
            cancellingIds: cancelling,
            onDelete: handleDelete,
            timeZone,
            t,
            lang
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ss-footer", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            className: "ss-confirm",
            disabled: !canConfirm,
            onClick: () => void handleConfirm(),
            children: busy ? t.sending : target !== null ? format(t.confirmAdd, { time: formatAbsolute(target.epoch, timeZone, lang) }) : t.confirmAddNoTime
          }
        ) }),
        promptEmpty && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ss-hint", style: { marginTop: 6 }, children: t.promptFromDraft })
      ]
    }
  );
  if (typeof document === "undefined") return panel;
  return (0, import_react_dom.createPortal)(panel, document.body);
}
function keyOf(option) {
  switch (option.kind) {
    case "after":
      return `after-${option.seconds}`;
    case "at":
      return `at-${option.at.date}-${option.at.time}`;
    case "smart":
      return "smart";
    case "custom":
      return "custom";
  }
}

// src/client/hooks/useSchedules.ts
var import_react6 = require("react");

// src/client/local-store.ts
var STORAGE_KEY = "dsh-later:pending";
function readPending() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingSchedule);
  } catch {
    return [];
  }
}
function writePending(pending) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
  }
}
function appendPending(payload) {
  const pending = readPending();
  const clientSeq = pending.reduce((max, item2) => Math.max(max, item2.clientSeq), 0) + 1;
  const item = { clientSeq, createdAt: Date.now(), payload };
  writePending([...pending, item]);
  return item;
}
function removePending(clientSeq) {
  const pending = readPending().filter((item) => item.clientSeq !== clientSeq);
  writePending(pending);
}
function isPendingSchedule(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v["clientSeq"] === "number" && typeof v["createdAt"] === "number" && typeof v["payload"] === "object" && v["payload"] !== null;
}

// src/client/hooks/useSchedules.ts
function schedulesOf(projection) {
  return projection?.schedules ?? [];
}
var createLine = (input) => {
  const body = { prompt: input.prompt, time_zone: detectTimeZone() };
  if (input.at !== void 0) body["at"] = input.at;
  if (input.after_seconds !== void 0) body["after_seconds"] = input.after_seconds;
  return `/user-schedule-create ${JSON.stringify(body)}`;
};
var deleteLine = (id) => `/user-schedule-delete ${JSON.stringify({ id })}`;
function useSchedules(inject2) {
  const { callCommand, sessionId, inputActions, input, useProjection, useInput } = inject2;
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [anchorBottom, setAnchorBottom] = (0, import_react6.useState)(80);
  const [pendingSync, setPendingSync] = (0, import_react6.useState)(() => readPending());
  const rowRef = (0, import_react6.useRef)(null);
  useNow(1e3);
  const draft = input?.draft ?? (typeof useInput === "function" ? useInput((s) => s.draft) : "") ?? "";
  const projection = typeof useProjection === "function" ? useProjection("userSchedules") : void 0;
  const schedules = (0, import_react6.useMemo)(() => schedulesOf(projection), [projection]);
  const nextEpoch = (0, import_react6.useMemo)(() => {
    return schedules.map((item) => Date.parse(item.scheduled_at)).filter((value) => !Number.isNaN(value)).sort((a, b) => a - b)[0];
  }, [schedules]);
  const enabled = draft.trim().length > 0 || schedules.length > 0;
  const reposition = (0, import_react6.useCallback)(() => {
    const el = rowRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    setAnchorBottom(Math.max(12, window.innerHeight - rect.top + 10));
  }, []);
  const syncedPrompts = (0, import_react6.useMemo)(() => {
    return new Set(schedules.map((item) => item.prompt));
  }, [schedules]);
  (0, import_react6.useEffect)(() => {
    if (pendingSync.length === 0) return;
    const remaining = pendingSync.filter((item) => !syncedPrompts.has(item.payload.prompt));
    if (remaining.length !== pendingSync.length) {
      setPendingSync(remaining);
      writePendingLocal(remaining);
    }
  }, [syncedPrompts, pendingSync]);
  (0, import_react6.useEffect)(() => {
    if (pendingSync.length === 0 || !sessionId) return;
    let cancelled = false;
    const syncAll = async () => {
      const items = [...pendingSync];
      for (const item of items) {
        if (cancelled) return;
        try {
          const accepted = await callCommand(sessionId, createLine(item.payload));
          if (accepted.matched && !cancelled) {
            removePending(item.clientSeq);
            setPendingSync((prev) => prev.filter((p) => p.clientSeq !== item.clientSeq));
          }
        } catch {
          return;
        }
      }
    };
    void syncAll();
    const onOnline = () => {
      if (!cancelled) void syncAll();
    };
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [pendingSync, sessionId, callCommand]);
  const handleCreate = (0, import_react6.useCallback)(async (inputPayload) => {
    if (!sessionId) {
      throw new Error(CLIENT_ERR.NO_SESSION);
    }
    setBusy(true);
    try {
      const accepted = await callCommand(sessionId, createLine(inputPayload));
      if (!accepted.matched) {
        appendPending(inputPayload);
        setPendingSync((prev) => [...prev, { clientSeq: Date.now(), createdAt: Date.now(), payload: inputPayload }]);
        throw new Error(CLIENT_ERR.NOT_ACCEPTED);
      }
    } finally {
      setBusy(false);
    }
  }, [sessionId, callCommand]);
  const handleDelete = (0, import_react6.useCallback)(async (id) => {
    if (!sessionId) return;
    await callCommand(sessionId, deleteLine(id));
  }, [sessionId, callCommand]);
  const handleCancelAll = (0, import_react6.useCallback)(async () => {
    if (!sessionId) return;
    await Promise.all(schedules.map((item) => callCommand(sessionId, deleteLine(item.id))));
  }, [sessionId, schedules, callCommand]);
  const handleClearDraft = (0, import_react6.useCallback)(() => {
    inputActions?.setDraft("");
  }, [inputActions]);
  return {
    draft,
    schedules,
    nextEpoch,
    enabled,
    busy,
    anchorBottom,
    reposition,
    handleCreate,
    handleDelete,
    handleCancelAll,
    handleClearDraft,
    rowRef
  };
}
function writePendingLocal(pending) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("dsh-later:pending", JSON.stringify(pending));
    }
  } catch {
  }
}

// src/client/hooks/useSchedulerSettings.ts
var import_react7 = require("react");
var CLIENT_DEFAULT_MAX_PROMPT_CHARS = 1e3;
var FALLBACK_PROMPT = {
  allowLong: false,
  maxChars: CLIENT_DEFAULT_MAX_PROMPT_CHARS
};
var FALLBACK = {
  ready: false,
  showButton: true,
  smartWindow: sanitizeSmartWindowConfig(void 0),
  promptLimits: FALLBACK_PROMPT
};
function resolvePromptLimitsFromSnapshot(snap) {
  if (snap.status !== "ready") return FALLBACK_PROMPT;
  const value = snap.value ?? {};
  const allowLong = value["allowLongPrompts"] === true;
  const raw = value["maxPromptChars"];
  const valid = typeof raw === "number" && Number.isFinite(raw) && raw >= 1 && Math.floor(raw) === raw;
  if (allowLong && valid) return { allowLong: true, maxChars: raw };
  return FALLBACK_PROMPT;
}
function resolveFromSnapshot(snap) {
  if (snap.status !== "ready") {
    return {
      ready: false,
      showButton: true,
      smartWindow: FALLBACK.smartWindow,
      promptLimits: FALLBACK_PROMPT
    };
  }
  const value = snap.value ?? {};
  return {
    ready: true,
    // 仅显式 false 隐藏；缺失/非法一律回退显示（与 schema 默认 true 同源）。
    showButton: value["showButton"] !== false,
    smartWindow: sanitizeSmartWindowConfig(
      value
    ),
    promptLimits: resolvePromptLimitsFromSnapshot(snap)
  };
}
var NOOP_SUBSCRIBE = () => () => void 0;
var EMPTY_SNAPSHOT = { status: "unavailable" };
function useSchedulerSettings(scope) {
  const getSnapshot = (0, import_react7.useCallback)(
    () => scope === void 0 ? EMPTY_SNAPSHOT : scope.getSnapshot(),
    [scope]
  );
  const subscribe = (0, import_react7.useCallback)(
    (onStoreChange) => scope === void 0 ? NOOP_SUBSCRIBE() : scope.subscribe(onStoreChange),
    [scope]
  );
  const raw = (0, import_react7.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
  return (0, import_react7.useMemo)(() => resolveFromSnapshot(raw), [raw]);
}

// src/client/components/SchedButton.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function SchedButton(props) {
  const { callCommand, sessionId, inputActions, input, useProjection, useInput, locale, schedulerScope } = props;
  const { lang, t } = useSchedT(locale);
  const { smartWindow, promptLimits, showButton } = useSchedulerSettings(schedulerScope);
  const [open, setOpen] = (0, import_react8.useState)(false);
  const {
    draft,
    schedules,
    enabled,
    busy,
    anchorBottom,
    reposition,
    handleCreate,
    handleDelete,
    rowRef
  } = useSchedules({
    callCommand,
    sessionId,
    inputActions,
    input,
    useProjection,
    useInput
  });
  useEscapeToClose(open, setOpen);
  (0, import_react8.useEffect)(() => {
    if (!open) return void 0;
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open, reposition]);
  const panelRef = (0, import_react8.useRef)(null);
  usePanelOutsideDismiss(rowRef, open, setOpen, panelRef);
  if (!showButton) return null;
  const handleCreateWithErrorBoundary = async (inputPayload) => {
    try {
      await handleCreate(inputPayload);
    } catch {
      setOpen(false);
      throw new Error(t.editErrNotAccepted);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { ref: rowRef, className: "ss-sched-row", "data-ss-sched-row": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "button",
      {
        type: "button",
        className: open ? "ss-sched-btn ss-active" : "ss-sched-btn",
        title: t.buttonSchedule,
        "aria-label": t.buttonSchedule,
        "aria-expanded": open,
        disabled: !enabled,
        onClick: () => setOpen((value) => !value),
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives4.IconClockOutlineRegular, { size: 16 })
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      !hasOfficialOutsideDismiss && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ss-backdrop", onClick: () => setOpen(false), "aria-hidden": "true" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        SchedPanel,
        {
          defaultPrompt: draft,
          schedules,
          timeZone: detectTimeZone(),
          busy,
          t,
          lang,
          onClose: () => setOpen(false),
          onCreate: handleCreateWithErrorBoundary,
          onDelete: (id) => void handleDelete(id),
          bottom: anchorBottom,
          anchorRef: rowRef,
          panelRef,
          smartWindow,
          promptLimits
        }
      )
    ] })
  ] });
}

// src/client/components/ScheduleDock.tsx
var import_react9 = require("react");
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/attachment-failure.ts
function classifyAttachmentFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /session\/attachment-invalid|not referenced by this session/i.test(message) ? "pending-send" : "unavailable";
}

// src/bar-geometry.ts
var BAR_UNIT_MS = 36e5;
function barWindow(item, end, now, firstSeen) {
  let start;
  if (item.kind === "after") {
    const windowSec = item.window_seconds ?? item.after_seconds;
    if (windowSec !== void 0) {
      start = end - windowSec * 1e3;
    } else if (item.created_at !== void 0) {
      const parsed = Date.parse(item.created_at);
      start = Number.isNaN(parsed) ? firstSeen.get(item.id) ?? now : parsed;
    } else {
      start = firstSeen.get(item.id) ?? now;
    }
  } else if (item.kind === "every" && item.every_seconds !== void 0) {
    start = end - item.every_seconds * 1e3;
  } else if (item.created_at !== void 0) {
    const parsed = Date.parse(item.created_at);
    start = Number.isNaN(parsed) ? firstSeen.get(item.id) ?? now : parsed;
  } else {
    start = firstSeen.get(item.id) ?? now;
  }
  return { start, totalMs: Math.max(1e3, end - start) };
}
function ratioAt(item, at, firstSeen) {
  const end = Date.parse(item.scheduled_at);
  const { start, totalMs } = barWindow(item, end, at, firstSeen);
  const elapsedMs = Math.min(Math.max(at - start, 0), totalMs);
  return {
    totalRatio: elapsedMs / totalMs,
    count: Math.max(1, Math.ceil(totalMs / BAR_UNIT_MS))
  };
}
function barSegments(item, now, firstSeen) {
  return ratioAt(item, now, firstSeen);
}
function frozenBarSegments(item, frozenLeftMs, firstSeen, renderedAt) {
  const windowSec = item.window_seconds ?? item.after_seconds;
  if (windowSec === void 0 || windowSec <= 0) {
    const end = Date.parse(item.scheduled_at);
    const pausedAt2 = Date.parse(item.paused_at ?? "");
    const exact = Number.isNaN(pausedAt2) ? end - Math.floor(frozenLeftMs / 1e3) * 1e3 : pausedAt2;
    return ratioAt(item, Number.isNaN(exact) ? end : exact, firstSeen);
  }
  const totalMs = Math.max(1e3, windowSec * 1e3);
  let leftMs = Math.min(Math.max(frozenLeftMs, 0), totalMs);
  const pausedAt = Date.parse(item.paused_at ?? "");
  if (renderedAt !== void 0 && !Number.isNaN(pausedAt) && pausedAt > renderedAt) {
    leftMs = Math.min(leftMs + (pausedAt - renderedAt), totalMs);
  }
  const elapsedMs = Math.min(Math.max(totalMs - leftMs, 0), totalMs);
  return {
    totalRatio: elapsedMs / totalMs,
    count: Math.max(1, Math.ceil(totalMs / BAR_UNIT_MS))
  };
}
function planBarAnimation(totalMs, elapsedMs) {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return void 0;
  const raw = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const clamped = Math.min(Math.max(raw, 0), totalMs);
  const elapsed = clamped === 0 ? 0 : clamped;
  if (elapsed >= totalMs) return void 0;
  return {
    durationMs: totalMs,
    // -0 会在 CSS 里序列化成难看的 "-0ms"，故显式归零
    delayMs: elapsed === 0 ? 0 : -elapsed
  };
}

// src/client/components/ScheduleDock.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function formatCountdown(ms) {
  const total = Math.max(0, Math.round(ms / 1e3));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}
function planBarAnimationFor(item, now, firstSeen) {
  const end = Date.parse(item.scheduled_at);
  if (!Number.isFinite(end)) return void 0;
  const { start, totalMs } = barWindow(item, end, now, firstSeen);
  return planBarAnimation(totalMs, now - start);
}
var deleteLine2 = (id) => `/user-schedule-delete ${JSON.stringify({ id })}`;
var editLine = (id, prompt) => `/user-schedule-edit ${JSON.stringify({ id, prompt })}`;
var steerLine = (id) => `/user-schedule-steer-now ${JSON.stringify({ id })}`;
var STEER_CONFIRM_WINDOW_MS = 2600;
var pauseLine = (id) => `/user-schedule-pause ${JSON.stringify({ id })}`;
var resumeLine = (uid) => `/user-schedule-resume ${JSON.stringify({ uid })}`;
function canPause(item, now) {
  if (item.status === "paused") return false;
  if (item.kind !== "after") return false;
  const epoch = Date.parse(item.scheduled_at);
  return Number.isFinite(epoch) && epoch > now;
}
function ScheduleDock({ callCommand, loadImage, peekImage, localMediaUrl, sessionId, useProjection, renderFactorySlot, t: seatT }) {
  const now = useNow(1e3);
  const { tr: t } = useSchedT(void 0, seatT);
  const projection = typeof useProjection === "function" ? useProjection("userSchedules") : void 0;
  const [dismissedPaused, setDismissedPaused] = (0, import_react9.useState)(/* @__PURE__ */ new Set());
  (0, import_react9.useEffect)(() => {
    const live = projection?.schedules;
    if (live === void 0) return;
    setDismissedPaused((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const nextSet = new Set(current);
      for (const item of live) {
        if (item.status !== "paused" && nextSet.delete(item.id)) changed = true;
      }
      return changed ? nextSet : current;
    });
  }, [projection]);
  const [promptOverrides, setPromptOverrides] = (0, import_react9.useState)(/* @__PURE__ */ new Map());
  (0, import_react9.useEffect)(() => {
    const live = projection?.schedules;
    if (live === void 0 || promptOverrides.size === 0) return;
    setPromptOverrides((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const nextMap = new Map(current);
      for (const [id, text] of current) {
        const item = live.find((s) => s.id === id);
        if (item === void 0 || item.prompt === text) {
          nextMap.delete(id);
          changed = true;
        }
      }
      return changed ? nextMap : current;
    });
  }, [projection, promptOverrides]);
  const schedules = (0, import_react9.useMemo)(
    () => (projection?.schedules ?? []).filter((item) => !(item.status === "paused" && dismissedPaused.has(item.id))).map((item) => {
      const override = promptOverrides.get(item.id);
      return override === void 0 ? item : { ...item, prompt: override };
    }).sort(
      (a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)
    ),
    [projection, dismissedPaused, promptOverrides]
  );
  const [collapsed, setCollapsed] = (0, import_react9.useState)(true);
  const listId = (0, import_react9.useId)();
  const [busyId, setBusyId] = (0, import_react9.useState)(null);
  const [editingId, setEditingId] = (0, import_react9.useState)(null);
  const [editingText, setEditingText] = (0, import_react9.useState)("");
  const [editErr, setEditErr] = (0, import_react9.useState)(null);
  const [saving, setSaving] = (0, import_react9.useState)(false);
  const [steerDone, setSteerDone] = (0, import_react9.useState)(/* @__PURE__ */ new Set());
  const [steerErr, setSteerErr] = (0, import_react9.useState)(/* @__PURE__ */ new Map());
  const [steerUnconfirmed, setSteerUnconfirmed] = (0, import_react9.useState)(/* @__PURE__ */ new Set());
  (0, import_react9.useEffect)(() => {
    const live = projection?.schedules;
    if (live === void 0) return;
    const present = new Set(live.filter((item) => item.status !== "paused").map((item) => item.id));
    setSteerDone((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const next2 = new Set(current);
      for (const id of current) {
        if (!present.has(id)) {
          next2.delete(id);
          changed = true;
        }
      }
      return changed ? next2 : current;
    });
  }, [projection]);
  (0, import_react9.useEffect)(() => {
    if (steerDone.size === 0) return void 0;
    const timer = window.setTimeout(() => {
      const live = projection?.schedules;
      if (live === void 0) return;
      const present = new Set(live.filter((item) => item.status !== "paused").map((item) => item.id));
      setSteerUnconfirmed((current) => {
        let changed = false;
        const next2 = new Set(current);
        for (const id of steerDone) {
          if (present.has(id) && !next2.has(id)) {
            next2.add(id);
            changed = true;
          }
          if (!present.has(id) && next2.delete(id)) changed = true;
        }
        return changed ? next2 : current;
      });
    }, STEER_CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [steerDone, projection]);
  const [pauseErr, setPauseErr] = (0, import_react9.useState)(/* @__PURE__ */ new Map());
  const firstSeenRef = (0, import_react9.useRef)(/* @__PURE__ */ new Map());
  const lastActiveAtRef = (0, import_react9.useRef)(/* @__PURE__ */ new Map());
  const wallClock = Date.now();
  {
    const next2 = new Map(lastActiveAtRef.current);
    let changed = false;
    for (const item of schedules) {
      if (item.status === "paused") continue;
      const prev = next2.get(item.id);
      if (prev === void 0 || wallClock > prev) {
        next2.set(item.id, wallClock);
        changed = true;
      }
    }
    for (const id of [...next2.keys()]) {
      if (!schedules.some((item) => item.id === id)) {
        next2.delete(id);
        changed = true;
      }
    }
    if (changed) lastActiveAtRef.current = next2;
  }
  const byId = (0, import_react9.useMemo)(() => new Map(schedules.map((item) => [item.id, item])), [schedules]);
  (0, import_react9.useEffect)(() => {
    let changed = false;
    const next2 = new Map(firstSeenRef.current);
    for (const [id] of byId) {
      if (!next2.has(id)) {
        next2.set(id, Date.now());
        changed = true;
      }
    }
    for (const id of [...next2.keys()]) {
      if (!byId.has(id)) {
        next2.delete(id);
        changed = true;
      }
    }
    if (changed) firstSeenRef.current = next2;
  }, [byId]);
  (0, import_react9.useEffect)(() => {
    if (editingId === null) return;
    if (schedules.some((item) => item.id === editingId)) return;
    setEditingId(null);
    setEditingText("");
    setEditErr(null);
    setSaving(false);
  }, [editingId, schedules]);
  (0, import_react9.useEffect)(() => {
    setEditingId(null);
    setEditingText("");
    setEditErr(null);
    setSaving(false);
  }, [sessionId]);
  if (schedules.length === 0 || sessionId === void 0) return null;
  const next = schedules[0];
  if (next === void 0) return null;
  const busy = busyId !== null || saving;
  const releaseBusy = (id) => {
    setBusyId((current) => current === id ? null : current);
  };
  const interactionActive = editingId !== null || busy;
  const expanded = schedules.length === 1 || !collapsed || interactionActive;
  const handleCancel = (id, status) => {
    setBusyId(id);
    const restore = () => {
      setDismissedPaused((current) => {
        if (!current.has(id)) return current;
        const nextSet = new Set(current);
        nextSet.delete(id);
        return nextSet;
      });
    };
    if (status === "paused") {
      setDismissedPaused((current) => new Set(current).add(id));
    }
    void callCommand(sessionId, deleteLine2(id)).then((outcome) => {
      if (!outcome.matched) restore();
    }).catch(restore).finally(() => releaseBusy(id));
  };
  const handleSteer = (item) => {
    const id = item.id;
    const wasPaused = item.status === "paused";
    setBusyId(id);
    setSteerErr((current) => {
      const next2 = new Map(current);
      next2.delete(id);
      return next2;
    });
    void callCommand(sessionId, steerLine(id)).then((outcome) => {
      if (outcome.matched) {
        setSteerDone((current) => new Set(current).add(id));
        if (wasPaused) {
          setDismissedPaused((current) => new Set(current).add(id));
        }
      } else {
        setSteerErr((current) => new Map(current).set(id, t("editErrNotAccepted")));
      }
    }).catch(() => {
      setSteerErr((current) => new Map(current).set(id, t("editErrCommandFailed")));
    }).finally(() => releaseBusy(id));
  };
  const handleSteerRetry = (item) => {
    const id = item.id;
    setSteerUnconfirmed((current) => {
      if (!current.has(id)) return current;
      const next2 = new Set(current);
      next2.delete(id);
      return next2;
    });
    setSteerDone((current) => {
      if (!current.has(id)) return current;
      const next2 = new Set(current);
      next2.delete(id);
      return next2;
    });
    handleSteer(item);
  };
  const handlePause = (item) => {
    const id = item.id;
    if (!canPause(item, now)) return;
    setBusyId(id);
    setPauseErr((current) => {
      const next2 = new Map(current);
      next2.delete(id);
      return next2;
    });
    void callCommand(sessionId, pauseLine(id)).then((outcome) => {
      if (!outcome.matched) {
        setPauseErr((current) => new Map(current).set(id, t("editErrNotAccepted")));
      }
    }).catch(() => {
      setPauseErr((current) => new Map(current).set(id, t("editErrCommandFailed")));
    }).finally(() => releaseBusy(id));
  };
  const handleResume = (item) => {
    const uid = item.id;
    setBusyId(uid);
    setPauseErr((current) => {
      const next2 = new Map(current);
      next2.delete(uid);
      return next2;
    });
    void callCommand(sessionId, resumeLine(uid)).then((outcome) => {
      if (!outcome.matched) {
        setPauseErr((current) => new Map(current).set(uid, t("editErrNotAccepted")));
      }
    }).catch(() => {
      setPauseErr((current) => new Map(current).set(uid, t("editErrCommandFailed")));
    }).finally(() => releaseBusy(uid));
  };
  const startEdit = (item) => {
    setEditingId(item.id);
    setEditingText(item.prompt);
    setEditErr(null);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditErr(null);
    setSaving(false);
  };
  const submitEdit = (item) => {
    const trimmed = editingText.trim();
    if (trimmed.length === 0) {
      setEditErr(t("editErrEmpty"));
      return;
    }
    setSaving(true);
    setEditErr(null);
    void callCommand(sessionId, editLine(item.id, trimmed)).then((outcome) => {
      if (!outcome.matched) {
        setEditErr(t("editErrFailed", { message: t("editErrNotAccepted") }));
        return;
      }
      if (item.status === "paused") {
        setPromptOverrides((current) => new Map(current).set(item.id, trimmed));
      }
      cancelEdit();
    }).catch(() => {
      setEditErr(t("editErrFailed", { message: t("editErrCommandFailed") }));
    }).finally(() => setSaving(false));
  };
  const renderRow = (item) => {
    const epoch = Date.parse(item.scheduled_at);
    const state = epoch <= now ? "overdue" : "scheduled";
    if (editingId === item.id) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "ss-dock-row ss-editing", "data-ss-dock-row": item.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          DockEditor,
          {
            text: editingText,
            label: t("editTask"),
            disabled: saving,
            onChange: setEditingText,
            onSave: () => submitEdit(item),
            onCancel: cancelEdit
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            type: "button",
            className: "ss-dock-row-save",
            disabled: saving || editingText.trim().length === 0,
            onClick: () => submitEdit(item),
            children: saving ? "\u2026" : t("editSave")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ss-dock-action", onClick: cancelEdit, "aria-label": t("editCancel"), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.IconCloseOutlineRegular, { size: 14 }) }),
        editErr !== null && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-edit-err", children: editErr })
      ] }, item.id);
    }
    const isPaused = item.status === "paused";
    const frozenLeft = isPaused ? (item.remaining_seconds ?? 0) * 1e3 : epoch - now;
    const countdownText = isPaused ? t("pausedLabel") : state === "overdue" ? t("dueAnyMoment") : `${t("countdownLeft")} ${formatCountdown(Math.max(0, frozenLeft))}`;
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "li",
      {
        className: `ss-dock-row${isPaused ? " ss-paused" : ""}`,
        "data-ss-dock-row": item.id,
        children: [
          schedules.length === 1 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-lead", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.IconClockOutlineRegular, { size: 16 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DockAttachments, { item, t, sessionId, loadImage, peekImage, localMediaUrl }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ss-dock-preview", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ss-dock-row-line", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-row-time", children: formatHhmm(epoch, detectTimeZone()) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `ss-dock-row-countdown${!isPaused && state === "overdue" ? " ss-due" : ""}${isPaused ? " ss-paused-label" : ""}`, children: countdownText }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DockPrompt, { text: item.prompt, renderFactorySlot })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(MultiBar, { item, now: wallClock, firstSeen: firstSeenRef.current, t, frozen: isPaused, frozenLeftMs: frozenLeft, renderedAt: lastActiveAtRef.current.get(item.id) ?? wallClock }),
            (steerErr.get(item.id) ?? pauseErr.get(item.id)) !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-steer-err", children: steerErr.get(item.id) ?? pauseErr.get(item.id) }),
            steerUnconfirmed.has(item.id) && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "ss-dock-steer-warn", role: "status", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("steerUnconfirmed") }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ss-dock-steer-retry", onClick: () => handleSteerRetry(item), children: t("steerRetry") })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            DockActions,
            {
              item,
              t,
              paused: isPaused,
              canPauseNow: canPause(item, now),
              busy,
              steerDone: steerDone.has(item.id),
              onEdit: () => startEdit(item),
              onPause: () => handlePause(item),
              onResume: () => handleResume(item),
              onDelete: () => handleCancel(item.id, isPaused ? "paused" : "active"),
              onSteer: () => handleSteer(item)
            }
          )
        ]
      },
      item.id
    );
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ss-dock-root", "data-ss-dock": "", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ss-dock-body", children: [
    schedules.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "button",
      {
        type: "button",
        className: "ss-dock-header",
        "aria-expanded": expanded,
        "aria-controls": listId,
        disabled: interactionActive,
        onClick: () => setCollapsed((value) => !value),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-lead", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.IconClockOutlineRegular, { size: 16 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-count", children: t("panelCount", { n: schedules.length }) }),
          !expanded && steerUnconfirmed.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-status", role: "status", children: t("statusUnconfirmed", { n: steerUnconfirmed.size }) }),
          !expanded && steerUnconfirmed.size === 0 && busy && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-status", role: "status", children: t("sending") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: expanded ? "ss-dock-chevron ss-open" : "ss-dock-chevron", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.IconChevronDownOutlineRegular, { size: 14 }) })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "ul",
      {
        id: listId,
        className: "ss-dock-list",
        hidden: !expanded,
        children: schedules.map(renderRow)
      },
      expanded ? "open" : "closed"
    )
  ] }) });
}
function MultiBar({
  item,
  now,
  firstSeen,
  t,
  frozen = false,
  frozenLeftMs,
  renderedAt
}) {
  const frozenSeg = frozen ? frozenBarSegments(item, frozenLeftMs ?? 0, firstSeen, renderedAt) : void 0;
  const activeSeg = frozen ? void 0 : barSegments(item, now, firstSeen);
  const { totalRatio, count } = frozenSeg ?? activeSeg ?? { totalRatio: 0, count: 1 };
  const phaseAtRef = (0, import_react9.useRef)(null);
  if (frozen || prefersReducedMotion()) {
    phaseAtRef.current = null;
  } else if (phaseAtRef.current === null) {
    phaseAtRef.current = now;
  }
  const anim = frozen || prefersReducedMotion() ? void 0 : planBarAnimationFor(item, phaseAtRef.current ?? now, firstSeen);
  const fillStyle = anim === void 0 ? { width: `${totalRatio * 100}%` } : {
    /**
     * 只注入**参数**（CSS 变量），动画的组装交给 CSS（见 styles.ts）。
     *
     * 这样做的原因：动画声明留在 CSS 里，JS 不碰 `animationName` 等简写属性
     * ——否则会整条覆盖 CSS 的声明。当前只有进度推进一个动画，但保持这个
     * 分工，将来若再加纹理/状态动效不必回头改 JS。
     */
    ["--ss-bar-duration"]: `${anim.durationMs}ms`,
    // 负 delay 把播放头定位到挂载时刻的绝对相位；此后恒定不变
    // （重算会让动画多跳——见上方 phaseAtRef 注释）。
    ["--ss-bar-delay"]: `${anim.delayMs}ms`
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    "div",
    {
      className: `ss-dock-bars${count > 4 ? " ss-dock-bars-compact" : ""}`,
      role: "progressbar",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": Math.round(totalRatio * 100),
      "aria-label": t("panelTitle"),
      children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ss-dock-bar", children: [
        count > 1 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "div",
          {
            className: "ss-dock-bar-divider",
            style: {
              backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent calc((100% - 1px) / ${count}), var(--ss-bar-divider, rgba(0,0,0,0.45)) calc((100% - 1px) / ${count}), var(--ss-bar-divider, rgba(0,0,0,0.45)) calc(100% / ${count}))`
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ss-dock-bar-fill", style: fillStyle })
      ] })
    }
  );
}
function DockActions({
  item,
  t,
  paused,
  canPauseNow,
  busy,
  steerDone,
  onEdit,
  onPause,
  onResume,
  onDelete,
  onSteer
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ss-dock-actions", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.Tooltip, { label: t("editTask"), side: "bottom", delayMs: 500, portal: true, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        type: "button",
        className: "ss-dock-action",
        "aria-label": t("editTask"),
        disabled: busy,
        onClick: onEdit,
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.IconEditOutlineRegular, { size: 14 })
      }
    ) }),
    paused ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.Tooltip, { label: t("resumeTask"), side: "bottom", delayMs: 500, portal: true, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        type: "button",
        className: "ss-dock-action",
        "aria-label": t("resumeTask"),
        disabled: busy,
        onClick: onResume,
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.IconPlayOutlineRegular, { size: 16 })
      }
    ) }) : (
      /* 不可用的原因走宿主那套分工：Tooltip `disabled` 抑制气泡，原生 `title` 承载原因，
       * `aria-label` 只留动作名——避免同一句话在气泡与读屏里各念一遍。 */
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.Tooltip, { label: t("pauseTask"), side: "bottom", delayMs: 500, portal: true, disabled: !canPauseNow, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "button",
        {
          type: "button",
          className: "ss-dock-action",
          "aria-label": t("pauseTask"),
          title: canPauseNow ? void 0 : t("pauseUnsupportedKind"),
          disabled: !canPauseNow || busy,
          onClick: onPause,
          children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.IconPauseOutlineRegular, { size: 16 })
        }
      ) })
    ),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.Tooltip, { label: t("deleteTask"), side: "bottom", delayMs: 500, portal: true, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        type: "button",
        className: "ss-dock-action",
        "aria-label": t("deleteTask"),
        disabled: busy,
        onClick: onDelete,
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.IconTrashOutlineRegular, { size: 14 })
      }
    ) }),
    item.kind !== "every" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.Tooltip, { label: steerDone ? t("steerAlreadySent") : t("steerTask"), side: "bottom", delayMs: 500, portal: true, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        type: "button",
        className: `ss-dock-action ss-dock-action-steer${steerDone ? " ss-done" : ""}`,
        "aria-label": steerDone ? t("steerAlreadySent") : t("steerTask"),
        disabled: busy || steerDone,
        onClick: onSteer,
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.IconSendOutlineRegular, { size: 16 })
      }
    ) })
  ] });
}
function DockEditor({
  text,
  label,
  disabled,
  onChange,
  onSave,
  onCancel
}) {
  const ref = (0, import_react9.useRef)(null);
  (0, import_react9.useLayoutEffect)(() => {
    const node = ref.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
  }, [text]);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    "textarea",
    {
      ref,
      autoFocus: true,
      rows: 1,
      className: "ss-dock-edit-input",
      "aria-label": label,
      value: text,
      disabled,
      onChange: (event) => onChange(event.currentTarget.value),
      onKeyDown: (event) => {
        if (event.key === "Escape") {
          onCancel();
          return;
        }
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        onSave();
      }
    }
  );
}
var DOCK_TEXT_FACTS = { collapseWhitespace: true, trimWhitespace: true };
function DockPrompt({
  text,
  renderFactorySlot
}) {
  const projected = (0, import_react9.useMemo)(() => {
    if (renderFactorySlot === void 0) return text;
    try {
      return renderFactorySlot("conversation.user.text", {
        text,
        facts: DOCK_TEXT_FACTS,
        interactive: false,
        ellipsis: true
      }, { fallback: text }) ?? text;
    } catch {
      return text;
    }
  }, [text, renderFactorySlot]);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-row-prompt", title: text, children: projected });
}
function DockAttachments({
  item,
  t,
  sessionId,
  loadImage,
  peekImage,
  localMediaUrl
}) {
  const blocks = item.attachments;
  if (blocks === void 0 || blocks.length === 0) return null;
  const canResolve = loadImage !== void 0 && sessionId !== void 0;
  const imageRenderable = (block) => canResolve || block.host_path !== void 0 && localMediaUrl?.(block.host_path) !== void 0;
  const shown = blocks.filter((block) => block.kind === "file" || imageRenderable(block));
  if (shown.length === 0) return null;
  const total = item.attachments_total ?? blocks.length;
  const extra = total - blocks.length;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ss-dock-attachments", "data-ss-dock-attachments": item.id, children: [
    shown.map((block, index) => (
      // 同一附件可能被多次写法逐条复用，key 用「引用 + 序号」保证同带内唯一。
      // ⚠️ 这里不能用 `ref` 当 prop 名——React 会把它当 callback ref 吃掉。
      block.kind === "image" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DockThumb, { block, t, sessionId, loadImage, peekImage, localMediaUrl }, `${block.attachment_id}:${index}`) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DockFileChip, { block, t }, `${block.attachment_id}:${index}`)
    )),
    extra > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-more", "data-ss-attach": "more", "aria-label": t("attachmentMore", { n: extra }), children: `+${extra}` })
  ] });
}
function DockThumb({
  block,
  t,
  sessionId,
  loadImage,
  peekImage,
  localMediaUrl
}) {
  const [url, setUrl] = (0, import_react9.useState)(null);
  const [failure, setFailure] = (0, import_react9.useState)(null);
  const blockRef = (0, import_react9.useRef)(block);
  blockRef.current = block;
  const attachmentId = block.attachment_id;
  const hostPath = block.host_path;
  const localUrl = hostPath === void 0 ? void 0 : localMediaUrl?.(hostPath);
  (0, import_react9.useEffect)(() => {
    if (localUrl !== void 0) return void 0;
    if (loadImage === void 0 || sessionId === void 0) return void 0;
    const cached = peekImage?.(sessionId, blockRef.current);
    if (cached !== void 0) {
      setUrl(cached);
      return void 0;
    }
    let alive = true;
    loadImage(sessionId, blockRef.current).then(
      (resolved) => {
        if (alive) setUrl(resolved);
      },
      (error) => {
        if (alive) setFailure(classifyAttachmentFailure(error));
      }
    );
    return () => {
      alive = false;
    };
  }, [attachmentId, sessionId, loadImage, localUrl]);
  if (localUrl !== void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("img", { className: "ss-dock-thumb", "data-ss-attach": "image", src: localUrl, alt: t("attachmentImage") });
  }
  if (loadImage === void 0 || sessionId === void 0) return null;
  if (url !== null) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("img", { className: "ss-dock-thumb", "data-ss-attach": "image", src: url, alt: t("attachmentImage") });
  }
  if (failure !== null) {
    const pending = failure === "pending-send";
    const label = pending ? t("attachmentPendingSend") : t("attachmentUnavailable");
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "span",
      {
        className: "ss-dock-file ss-dock-thumb-fallback",
        "data-ss-attach": pending ? "image-pending-send" : "image-unavailable",
        "aria-label": label,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-file-name", children: label }),
          block.bytes !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-file-size", children: (0, import_dsh_client_ui_primitives5.fileSizeText)(block.bytes) })
        ]
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-thumb", "data-ss-attach": "pending", "aria-hidden": "true" });
}
function DockFileChip({
  block,
  t
}) {
  const name2 = block.name ?? "";
  const label = name2.length > 0 ? t("attachmentFile", { name: name2 }) : t("attachmentFile", { name: "" }).trim();
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "ss-dock-file", "data-ss-attach": "file", "aria-label": label, title: name2.length > 0 ? name2 : void 0, children: [
    name2.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-file-icon", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives5.FileTypeIcon, { path: name2, size: 16 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-file-name", children: name2 }),
    block.bytes !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-file-size", children: (0, import_dsh_client_ui_primitives5.fileSizeText)(block.bytes) })
  ] });
}

// src/client/components/SchedulerSettingsCard.tsx
var import_react10 = require("react");
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime5 = require("react/jsx-runtime");
var SECTIONS = [
  {
    id: "display",
    titleKey: "sectionDisplay",
    layout: "stack",
    fields: [
      {
        kind: "boolean",
        key: "showButton",
        labelKey: "showButtonLabel",
        hintKey: "showButtonHint",
        defaultValue: true
      },
      {
        kind: "enum",
        key: "clockIconStyle",
        labelKey: "clockIconStyleLabel",
        hintKey: "clockIconStyleHint",
        options: ["auto", "modern", "classic"],
        defaultValue: "auto"
      },
      { kind: "number", key: "maxSchedules", labelKey: "maxSchedulesLabel", hintKey: "maxSchedulesHint", defaultValue: 100 },
      {
        kind: "boolean",
        key: "allowLongPrompts",
        labelKey: "allowLongPromptsLabel",
        hintKey: "allowLongPromptsHint",
        // 与 host schema 的 default(false) 一致：默认**关**，上限恒为 1000。
        defaultValue: false
      },
      {
        kind: "number",
        key: "maxPromptChars",
        labelKey: "maxPromptCharsLabel",
        hintKey: "maxPromptCharsHint",
        // 与 host schema 的 DEFAULT_MAX_PROMPT_CHARS 一致。
        defaultValue: 1e3,
        requiresEnabled: "allowLongPrompts"
      }
    ]
  },
  {
    id: "time",
    titleKey: "sectionTime",
    layout: "grid",
    fields: [
      { kind: "time", key: "workStart", labelKey: "workStartLabel", hintKey: "smartWindowHint" },
      { kind: "time", key: "workEnd", labelKey: "workEndLabel" },
      { kind: "time", key: "lunchStart", labelKey: "lunchStartLabel" },
      { kind: "time", key: "lunchEnd", labelKey: "lunchEndLabel" },
      { kind: "time", key: "eveningEnd", labelKey: "eveningEndLabel" }
    ]
  },
  {
    id: "delivery",
    titleKey: "sectionDelivery",
    layout: "stack",
    fields: [
      {
        kind: "enum",
        key: "steerDelivery",
        labelKey: "steerDeliveryLabel",
        hintKey: "steerDeliveryHint",
        options: ["followup", "steer"],
        defaultValue: "followup"
      },
      {
        kind: "boolean",
        key: "confirmDelivery",
        labelKey: "confirmDeliveryLabel",
        hintKey: "confirmDeliveryHint",
        defaultValue: true
      },
      {
        kind: "enum",
        key: "onUnconfirmed",
        labelKey: "onUnconfirmedLabel",
        hintKey: "onUnconfirmedHint",
        options: ["keep", "discard"],
        defaultValue: "keep"
      }
    ]
  },
  {
    id: "advanced",
    titleKey: "sectionAdvanced",
    layout: "stack",
    beta: true,
    fields: [
      {
        kind: "boolean",
        key: "advancedSyntax",
        labelKey: "advancedSyntaxLabel",
        hintKey: "advancedSyntaxHint",
        defaultValue: true
      }
    ]
  }
];
var FIELDS = SECTIONS.flatMap((s) => s.fields);
function SchedulerSettingsCard({ scope, t, surface }) {
  const [snapshot, setSnapshot] = (0, import_react10.useState)(() => scope.getSnapshot());
  const [pending, setPending] = (0, import_react10.useState)({});
  const [saving, setSaving] = (0, import_react10.useState)(false);
  const [failed, setFailed] = (0, import_react10.useState)(false);
  const [helpOpen, setHelpOpen] = (0, import_react10.useState)({});
  const SHOW_SETTINGS_KEY = "dsh-later:show-settings-section";
  const [showSettings, setShowSettings] = (0, import_react10.useState)(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(SHOW_SETTINGS_KEY) === "true";
  });
  const toggleShowSettings = () => {
    const next = !showSettings;
    setShowSettings(next);
    if (typeof localStorage !== "undefined") {
      if (next) localStorage.setItem(SHOW_SETTINGS_KEY, "true");
      else localStorage.removeItem(SHOW_SETTINGS_KEY);
    }
  };
  (0, import_react10.useEffect)(() => {
    const initial = scope.getSnapshot();
    setSnapshot(initial);
    setPending({});
    if (initial.status === "ready") setFailed(false);
  }, [scope]);
  (0, import_react10.useEffect)(() => {
    return scope.subscribe(() => {
      const snap = scope.getSnapshot();
      setSnapshot(snap);
      if (snap.status === "ready") {
        setFailed(false);
      }
    });
  }, [scope]);
  if (snapshot.status === "unavailable") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_jsx_runtime5.Fragment, {});
  if (snapshot.status !== "ready") {
    if (snapshot.status === "loading") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ss-hint", children: t("loading") });
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ss-hint", children: t("unavailable") });
  }
  const value = snapshot.value ?? {};
  const base = snapshot.base ?? {};
  const user = snapshot.user;
  const writable = snapshot.writable === true;
  const isUserOverridden = (key) => user !== void 0 && typeof user === "object" && Object.prototype.hasOwnProperty.call(user, key);
  const displayValue = (field) => {
    const p = pending[field.key];
    if (p !== void 0) return p.value;
    if (field.kind === "number") {
      const v2 = value[field.key];
      return v2 === void 0 ? "" : String(v2);
    }
    if (field.kind === "boolean") {
      const v2 = value[field.key];
      return v2 ?? field.defaultValue ? "true" : "false";
    }
    if (field.kind === "enum") {
      const v2 = value[field.key];
      return typeof v2 === "string" ? v2 : field.defaultValue;
    }
    const v = value[field.key];
    return v ?? "";
  };
  const baselineValue = (field) => {
    if (field.kind === "number") {
      const v2 = base[field.key];
      return String(v2 ?? field.defaultValue);
    }
    if (field.kind === "boolean") {
      const v2 = base[field.key];
      return v2 ?? field.defaultValue ? "true" : "false";
    }
    if (field.kind === "enum") {
      const v2 = base[field.key];
      return typeof v2 === "string" ? v2 : field.defaultValue;
    }
    const v = base[field.key];
    return v ?? "";
  };
  const dirty = Object.keys(pending).length > 0 && Object.values(pending).some((p) => p !== void 0);
  const validate = (field, raw) => {
    if (field.kind === "number") {
      if (raw.trim().length === 0) return t("invalidLabel");
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 1 || !Number.isInteger(num)) return t("invalidLabel");
      return null;
    }
    if (field.kind === "boolean") return null;
    if (field.kind === "enum") return field.options.includes(raw) ? null : t("invalidLabel");
    if (raw.trim().length === 0) return null;
    if (!isValidHhmm(raw)) return t("invalidTimeLabel");
    return null;
  };
  const setFieldPending = (key, value2, reset) => {
    setPending((current) => ({ ...current, [key]: { value: value2, reset } }));
  };
  const handleFieldEdit = (field, raw) => {
    setFieldPending(field.key, raw, false);
    setFailed(false);
  };
  const handleResetField = (field) => {
    setFieldPending(field.key, baselineValue(field), true);
    setFailed(false);
  };
  const handleDiscard = (0, import_react10.useCallback)(() => {
    setPending({});
    setFailed(false);
  }, []);
  const effectiveOf = (key) => {
    const field = FIELDS.find((entry) => entry.key === key);
    return field === void 0 ? "" : displayValue(field);
  };
  const confirmEnabled = effectiveOf("confirmDelivery") !== "false";
  const allowLongEnabled = effectiveOf("allowLongPrompts") === "true";
  const isGateLocked = (field) => "requiresEnabled" in field && field.requiresEnabled === "allowLongPrompts" && !allowLongEnabled;
  const handleSave = (0, import_react10.useCallback)(async () => {
    if (!dirty || saving || !writable) return;
    setSaving(true);
    setFailed(false);
    try {
      for (const [key, p] of Object.entries(pending)) {
        if (p === void 0) continue;
        if (p.reset) {
          await scope.unset(key);
          continue;
        }
        if (p.value.trim().length === 0) {
          await scope.unset(key);
          continue;
        }
        const field = FIELDS.find((entry) => entry.key === key);
        if (field !== void 0 && isGateLocked(field) && validate(field, p.value) !== null) continue;
        const coerced = field?.kind === "number" ? Number(p.value) : field?.kind === "boolean" ? p.value === "true" : p.value;
        await scope.set(key, coerced);
      }
      setPending({});
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }, [scope, pending, dirty, saving, writable, allowLongEnabled]);
  const invalidField = (field) => {
    if (isGateLocked(field)) return null;
    const p = pending[field.key];
    if (p === void 0) return null;
    return validate(field, p.value);
  };
  const anyInvalid = FIELDS.some((field) => invalidField(field) !== null);
  const saveDisabled = !dirty || saving || !writable || anyInvalid;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-settings-form", children: [
    !writable && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-hint", role: "status", children: t("readOnly") }),
    surface === "detail" && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "ss-section", "aria-labelledby": "ss-section-display-toggle", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { className: "ss-section-heading", id: "ss-section-display-toggle", children: t("sectionDisplayToggle") }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ss-section-fields", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-field ss-fieldToggle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-toggle-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ss-label-group", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("label", { className: "ss-toggle-label", htmlFor: "ss-show-settings", children: t("showInSettings") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              type: "button",
              id: "ss-show-settings",
              role: "switch",
              "aria-checked": showSettings,
              "aria-label": t("showInSettings"),
              className: "ss-toggle-switch",
              onClick: toggleShowSettings
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-toggle-description", children: t("showInSettingsHint") })
      ] }) })
    ] }),
    SECTIONS.map((section) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "ss-section", "aria-labelledby": `ss-section-${section.id}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("h3", { className: "ss-section-heading", id: `ss-section-${section.id}`, children: [
        t(section.titleKey),
        section.beta === true ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ss-section-beta", "aria-label": t("betaBadgeAria"), children: t("betaBadge") }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: section.layout === "grid" ? "ss-section-fields ss-section-fieldsGrid" : "ss-section-fields", children: section.fields.map((field) => {
        const invalid = invalidField(field);
        const isTime = field.kind === "time";
        const labelKey = field.labelKey;
        const hintKey = field.hintKey;
        const userHas = isUserOverridden(field.key);
        const fieldId = `ss-${field.key}`;
        const helpHint = hintKey !== void 0 && t(hintKey).length > 0;
        const gateLocked = isGateLocked(field);
        const badges = userHas ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "ss-card-badges", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ss-card-badge", children: t("overriddenLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              type: "button",
              className: "ss-card-reset",
              disabled: !writable || saving,
              onClick: () => handleResetField(field),
              children: t("resetLabel")
            }
          )
        ] }) : null;
        if (field.kind === "boolean") {
          const checked = displayValue(field) !== "false";
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-field ss-fieldToggle", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-toggle-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ss-label-group", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("label", { htmlFor: fieldId, className: "ss-toggle-label", children: t(labelKey) }) }),
              badges,
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "button",
                {
                  type: "button",
                  id: fieldId,
                  role: "switch",
                  "aria-checked": checked,
                  "aria-label": t(labelKey),
                  className: "ss-toggle-switch",
                  disabled: !writable || saving,
                  onClick: () => handleFieldEdit(field, checked ? "false" : "true")
                }
              )
            ] }),
            helpHint ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-toggle-description", children: t(hintKey) }) : null,
            invalid !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-invalid", role: "status", children: invalid }) : null
          ] }, field.key);
        }
        return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-card-fieldHead", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-label-group", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("label", { htmlFor: fieldId, className: "ss-card-label", children: t(labelKey) }),
              helpHint && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "button",
                {
                  type: "button",
                  className: helpOpen[field.key] === true ? "ss-help-btn ss-help-btnOpen" : "ss-help-btn",
                  "aria-label": `${t(labelKey)}\u8BF4\u660E`,
                  "aria-expanded": helpOpen[field.key] === true,
                  "aria-controls": `ss-help-${field.key}`,
                  onClick: () => setHelpOpen((prev) => ({ ...prev, [field.key]: !prev[field.key] })),
                  children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives6.IconInfoOutlineRegular, { size: 12 })
                }
              )
            ] }),
            badges
          ] }),
          field.kind === "enum" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "select",
            {
              id: fieldId,
              className: invalid !== null ? "ss-input ss-inputInvalid" : "ss-input",
              "aria-invalid": invalid !== null || void 0,
              value: displayValue(field),
              disabled: !writable || saving,
              onChange: (event) => handleFieldEdit(field, event.target.value),
              children: field.options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: option, children: t(`${field.key}Option_${option}`) }, option))
            }
          ) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "input",
            {
              id: fieldId,
              type: isTime ? "time" : "text",
              inputMode: isTime ? void 0 : "numeric",
              className: invalid !== null ? "ss-input ss-inputInvalid" : "ss-input",
              "aria-invalid": invalid !== null || void 0,
              value: displayValue(field),
              placeholder: field.kind === "number" ? String(field.defaultValue) : void 0,
              disabled: !writable || saving || gateLocked,
              "aria-describedby": gateLocked ? `ss-gate-${field.key}` : void 0,
              onChange: (event) => handleFieldEdit(field, event.target.value)
            }
          ),
          gateLocked ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-gate", id: `ss-gate-${field.key}`, role: "status", children: t("maxPromptCharsLockedHint") }) : null,
          invalid !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-invalid", role: "status", children: invalid }) : null,
          helpOpen[field.key] === true && hintKey !== void 0 && t(hintKey).length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { id: `ss-help-${field.key}`, role: "region", "aria-label": `${t(labelKey)}\u8BF4\u660E`, className: "ss-help", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: t(hintKey) }) }) : null,
          field.key === "steerDelivery" && displayValue(field) === "steer" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-risk", role: "status", children: confirmEnabled ? t("steerRiskGuarded") : t("steerRiskUnguarded") }) : null,
          field.key === "onUnconfirmed" && displayValue(field) === "discard" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-risk", role: "status", children: t("discardRisk") }) : null
        ] }, field.key);
      }) })
    ] }, section.id)),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-card-footer", children: [
      failed && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-failed", role: "status", children: t("saveFailed") }),
      dirty && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          type: "button",
          className: "ss-card-discard",
          disabled: saving,
          onClick: handleDiscard,
          children: t("discard")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          type: "button",
          className: "ss-card-save",
          disabled: saveDisabled,
          onClick: () => void handleSave(),
          children: saving ? t("saving") : t("save")
        }
      )
    ] })
  ] });
}

// src/client/session-presence.ts
var BADGE_CLASS = "ss-presence";
var HOVER_ROW_CLASS = "ss-hover-status";
var FIBER_MAX_DEPTH = 8;
var SCAN_DEBOUNCE_MS = 60;
var STATE_TICK_MS = 3e4;
var CLOCK_SVG_CLASSIC = '<svg width="10" height="10" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true"><g class="ss-presence-ring"><rect x="0" y="0" width="2" height="2"/><rect x="4" y="0" width="2" height="2"/><rect x="8" y="0" width="2" height="2"/><rect x="8" y="4" width="2" height="2"/><rect x="8" y="8" width="2" height="2"/><rect x="4" y="8" width="2" height="2"/><rect x="0" y="8" width="2" height="2"/><rect x="0" y="4" width="2" height="2"/></g><g class="ss-presence-hand"><rect x="4" y="2" width="2" height="2"/><rect x="6" y="4" width="2" height="2"/></g></svg>';
var CLOCK_FACE_R = 9.5;
var CLOCK_FACE_CIRCUMFERENCE = 2 * Math.PI * CLOCK_FACE_R;
var CLOCK_SVG_MODERN = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle class="ss-clock-track" cx="12" cy="12" r="${CLOCK_FACE_R}"/><circle class="ss-clock-prog" cx="12" cy="12" r="${CLOCK_FACE_R}" stroke-dasharray="${CLOCK_FACE_CIRCUMFERENCE.toFixed(3)}" stroke-dashoffset="${CLOCK_FACE_CIRCUMFERENCE.toFixed(3)}" transform="rotate(-90 12 12)"/><g class="ss-clock-hand"><line class="ss-clock-hand-h" x1="12" y1="12" x2="12" y2="6.5"/><line class="ss-clock-hand-m" x1="12" y1="12" x2="17" y2="12"/></g></svg>`;
var hhmmFormatter = new Intl.DateTimeFormat(void 0, { hour: "2-digit", minute: "2-digit", hour12: false });
var dateFormatter = new Intl.DateTimeFormat(void 0, { month: "short", day: "numeric" });
var formatHhmm2 = (epoch) => hhmmFormatter.format(epoch);
var formatDate = (epoch) => dateFormatter.format(epoch);
function sessionIdOfRow(row) {
  return sessionIdOfNode(row);
}
function sessionIdOfHoverCard(card) {
  return sessionIdOfNode(card);
}
function sessionIdOfNode(element) {
  const host = element;
  const fiberKey = Object.keys(host).find((key) => key.startsWith("__reactFiber$"));
  if (fiberKey === void 0) return void 0;
  let fiber = host[fiberKey];
  for (let depth = 0; fiber !== void 0 && depth < FIBER_MAX_DEPTH; depth += 1, fiber = fiber.return) {
    const node = fiber.memoizedProps?.node;
    const id = node?.id;
    if (typeof id === "string" && id.startsWith("session-")) return id;
  }
  return void 0;
}
function currentIndex(summary) {
  summary.reload();
  return summary.getSnapshot();
}
function findBadge(row) {
  for (const child of Array.from(row.children)) {
    if (child.classList.contains(BADGE_CLASS)) return child;
    const inside = child.querySelector(`:scope > .${BADGE_CLASS}`);
    if (inside !== null) return inside;
  }
  return null;
}
function labelsFor(dict) {
  return {
    imminent: dict.dueAnyMoment,
    minutes: (m) => format(dict.relMinutes, { m }),
    hours: (h) => format(dict.relHours, { h }),
    tomorrow: (time) => format(dict.relTomorrow, { time }),
    clock: (time) => format(dict.relClock, { time }),
    date: (date, time) => format(dict.relDate, { date, time })
  };
}
function mountSessionPresence(options) {
  const { summary, locale, getClockIconStyle } = options;
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => void 0;
  }
  const getClockSvg = () => {
    const style = getClockIconStyle?.() ?? "auto";
    return style === "classic" ? CLOCK_SVG_CLASSIC : CLOCK_SVG_MODERN;
  };
  let index = /* @__PURE__ */ new Map();
  let scanTimer;
  let disposed = false;
  const dictForNow = () => dictFor(locale?.getSnapshot().active);
  const scan = () => {
    if (disposed) return;
    index = currentIndex(summary);
    const dict = dictForNow();
    const now = Date.now();
    for (const row of Array.from(document.querySelectorAll('[role="treeitem"][draggable="true"]'))) {
      if (row.hasAttribute("aria-expanded")) continue;
      applyBadge(row, now, dict);
    }
    applyHoverCard(now, dict);
  };
  const scheduleScan = () => {
    if (disposed || scanTimer !== void 0) return;
    scanTimer = setTimeout(() => {
      scanTimer = void 0;
      scan();
    }, SCAN_DEBOUNCE_MS);
  };
  function applyBadge(row, now, dict) {
    const sessionId = sessionIdOfRow(row);
    if (sessionId === void 0) return;
    const entry = index.get(sessionId);
    const existing = findBadge(row);
    if (entry === void 0) {
      existing?.remove();
      return;
    }
    const state = badgeStateFor(entry.nextAt, now);
    const time = entry.nextAt === void 0 ? "" : relativeFireLabel(entry.nextAt, now, labelsFor(dict), formatHhmm2, formatDate);
    const allPaused = entry.nextAt === void 0 && entry.pausedCount > 0;
    const aria = allPaused ? format(dict.presencePausedAria, { n: entry.count }) : state === "overdue" ? format(dict.presenceOverdueAria, { n: entry.count }) : format(dict.presenceBadgeAria, { n: entry.count, time });
    const tooltip = allPaused ? format(dict.presencePausedTooltip, { n: entry.count }) : state === "overdue" ? format(dict.presenceOverdueTooltip, { n: entry.count }) : format(dict.presenceTooltip, { n: entry.count, time });
    const progress = progressOf(entry, now);
    if (existing !== null) {
      if (existing.dataset.state !== state) existing.dataset.state = state;
      if (existing.getAttribute("aria-label") !== aria) existing.setAttribute("aria-label", aria);
      if (existing.getAttribute("title") !== tooltip) existing.setAttribute("title", tooltip);
      applyProgress(existing, progress);
      return;
    }
    const slot = row.firstElementChild;
    if (slot === null) return;
    const beside = slot.querySelector("svg") !== null;
    const badge = document.createElement("span");
    badge.className = beside ? `${BADGE_CLASS} ${BADGE_CLASS}-beside` : BADGE_CLASS;
    badge.dataset.state = state;
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", aria);
    badge.setAttribute("title", tooltip);
    badge.innerHTML = getClockSvg();
    applyProgress(badge, progress);
    if (beside) slot.after(badge);
    else slot.append(badge);
  }
  function applyProgress(badge, ratio) {
    const arc = badge.querySelector(".ss-clock-prog");
    if (arc === null) return;
    if (ratio === void 0) {
      arc.style.display = "none";
      return;
    }
    if (arc.style.display === "none") arc.style.display = "";
    arc.style.strokeDashoffset = String(CLOCK_FACE_CIRCUMFERENCE * (1 - ratio));
  }
  function findHoverCard() {
    for (const card of Array.from(document.body.children)) {
      if (!(card instanceof HTMLElement)) continue;
      const statusHost = card.firstElementChild;
      if (!(statusHost instanceof HTMLElement)) continue;
      const hasStatusRow = Array.from(statusHost.children).some((child) => {
        const dot = child.firstElementChild;
        return child.children.length >= 2 && dot !== null && dot.tagName === "SPAN" && dot.getAttribute("aria-hidden") === "true";
      });
      if (!hasStatusRow) continue;
      const sessionId = sessionIdOfHoverCard(card);
      if (sessionId === void 0) continue;
      return { card, statusHost, sessionId };
    }
    return null;
  }
  function applyHoverCard(now, dict) {
    const found = findHoverCard();
    if (found === null) return;
    const { statusHost, sessionId } = found;
    const existing = statusHost.querySelector(`:scope > .${HOVER_ROW_CLASS}`);
    const entry = index.get(sessionId);
    if (entry === void 0) {
      existing?.remove();
      return;
    }
    const { label } = hoverScheduleStatus(entry, now, labelsFor(dict), dict, formatHhmm2, formatDate);
    const state = badgeStateFor(entry.nextAt, now);
    if (existing !== null) {
      const text2 = existing.lastElementChild;
      if (text2 !== null && text2.textContent !== label) text2.textContent = label;
      if (existing.dataset.state !== state) existing.dataset.state = state;
      return;
    }
    const row = document.createElement("div");
    row.className = HOVER_ROW_CLASS;
    row.dataset.state = state;
    const dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    dot.className = "ss-hover-status-dot";
    const text = document.createElement("span");
    text.textContent = label;
    row.append(dot, text);
    statusHost.append(row);
  }
  const unsubscribeSummary = summary.subscribe(scheduleScan);
  const unsubscribeLocale = locale?.subscribe(scheduleScan);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  const stateTick = setInterval(scheduleScan, STATE_TICK_MS);
  scheduleScan();
  return () => {
    disposed = true;
    if (scanTimer !== void 0) clearTimeout(scanTimer);
    clearInterval(stateTick);
    observer.disconnect();
    unsubscribeSummary();
    unsubscribeLocale?.();
    for (const badge of Array.from(document.querySelectorAll(`.${BADGE_CLASS}`))) badge.remove();
    for (const row of Array.from(document.querySelectorAll(`.${HOVER_ROW_CLASS}`))) row.remove();
  };
}

// src/schedule-summary-store.ts
var SUMMARY_STATE_TICK_MS = 3e4;
var SUMMARY_REFRESH_INTERVAL_MS = 6e4;
function documentOf() {
  const doc = globalThis.document;
  return typeof doc === "object" && doc !== null ? doc : void 0;
}
function createScheduleSummaryStore(sessions, options = {}) {
  const now = options.now ?? Date.now;
  const stateTickMs = options.stateTickMs ?? SUMMARY_STATE_TICK_MS;
  const refreshIntervalMs = options.refreshIntervalMs ?? SUMMARY_REFRESH_INTERVAL_MS;
  const autoRefresh = options.autoRefresh ?? true;
  const canRefresh = options.canRefresh ?? (() => {
    const doc2 = documentOf();
    return doc2?.visibilityState === void 0 || doc2.visibilityState === "visible";
  });
  const listeners = /* @__PURE__ */ new Set();
  let snapshot = /* @__PURE__ */ new Map();
  let disposed = false;
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
      }
    }
  };
  const reload = () => {
    if (disposed) return;
    const next = buildScheduleSummary(sessions.list.getSnapshot(), now());
    if (sameScheduleSummary(snapshot, next)) return;
    snapshot = next;
    notify();
  };
  const unsubscribeList = sessions.list.subscribe(reload);
  const stateTick = setInterval(reload, stateTickMs);
  let refreshTick;
  let onVisible;
  const doc = documentOf();
  const target = globalThis;
  const refreshNow = () => {
    if (disposed || !canRefresh()) return;
    try {
      void sessions.refresh().catch(() => void 0);
    } catch {
    }
  };
  if (autoRefresh) {
    onVisible = () => {
      if (!disposed && canRefresh()) {
        refreshNow();
        reload();
      }
    };
    refreshTick = setInterval(() => {
      if (canRefresh()) refreshNow();
    }, refreshIntervalMs);
    doc?.addEventListener?.("visibilitychange", onVisible);
    target.addEventListener?.("online", onVisible);
    refreshNow();
  }
  reload();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(stateTick);
    if (refreshTick !== void 0) clearInterval(refreshTick);
    if (onVisible !== void 0) {
      doc?.removeEventListener?.("visibilitychange", onVisible);
      target.removeEventListener?.("online", onVisible);
    }
    unsubscribeList();
    listeners.clear();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload,
    dispose
  };
}
var activeStore;
var registryListeners = /* @__PURE__ */ new Set();
function setActiveScheduleSummaryStore(store) {
  if (activeStore === store) return;
  activeStore = store;
  for (const listener of [...registryListeners]) {
    try {
      listener();
    } catch {
    }
  }
}
function getScheduleSummaryStore() {
  return activeStore;
}
function subscribeScheduleSummaryStore(listener) {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

// src/client/useScheduleSummary.ts
var import_react11 = require("react");
var EMPTY_SUMMARY = /* @__PURE__ */ new Map();
var noopSubscribe2 = () => () => void 0;
var emptySnapshot = () => EMPTY_SUMMARY;
var missingSnapshot = () => void 0;
function useScheduleSummary(store) {
  const registered = (0, import_react11.useSyncExternalStore)(subscribeScheduleSummaryStore, getScheduleSummaryStore, missingSnapshot);
  const target = store ?? registered;
  const subscribe = (0, import_react11.useMemo)(
    () => target === void 0 ? noopSubscribe2 : (listener) => target.subscribe(listener),
    [target]
  );
  const getSnapshot = (0, import_react11.useMemo)(
    () => target === void 0 ? emptySnapshot : () => target.getSnapshot(),
    [target]
  );
  return (0, import_react11.useSyncExternalStore)(subscribe, getSnapshot, emptySnapshot);
}

// src/client/index.tsx
var INPUT_RIGHT_SLOT = "conversation.input.right";
var inject = ["slots", "sessions", "conversation", "locale"];
var NS = "settings.plugins.later";
var SETTINGS_NS = "dsh-later";
var ENTRY_ID = "later";
function apply(ctx) {
  const slots = ctx.get("slots");
  const sessions = ctx.get("sessions");
  const locale = ctx.get("locale");
  if (slots === void 0 || sessions === void 0) return;
  ctx.effect(() => injectStyles(), "dsh-later: styles");
  let detectedVersion = "classic";
  let getClockIconStyle = () => "auto";
  const summary = createScheduleSummaryStore(sessions);
  setActiveScheduleSummaryStore(summary);
  ctx.effect(
    () => () => {
      if (getScheduleSummaryStore() === summary) setActiveScheduleSummaryStore(void 0);
      summary.dispose();
    },
    "dsh-later: schedule summary"
  );
  ctx.effect(
    () => mountSessionPresence({
      summary,
      ...locale === void 0 ? {} : { locale },
      getClockIconStyle: () => {
        const style = getClockIconStyle();
        if (style === "auto") return detectedVersion;
        return style;
      }
    }),
    "dsh-later: presence"
  );
  if (locale !== void 0) {
    ctx.effect(() => locale.register(NS, {
      zh: {
        ...schedDicts.zh,
        title: "\u5B9A\u65F6\u63D0\u9192",
        description: "\u914D\u7F6E\u4F1A\u8BDD\u5185\u5B9A\u65F6\u63D0\u9192\u7684\u53C2\u6570\u3002",
        pendingBadge: "\u672A\u4FDD\u5B58",
        expand: "\u5C55\u5F00\u8BBE\u7F6E",
        collapse: "\u6536\u8D77\u8BBE\u7F6E",
        readOnly: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
        sectionDisplay: "\u663E\u793A\u8BBE\u7F6E",
        sectionTime: "\u65F6\u95F4\u8BBE\u7F6E",
        sectionDelivery: "\u6295\u9012\u8BBE\u7F6E",
        sectionAdvanced: "\u9AD8\u7EA7\u8BED\u6CD5",
        betaBadge: "Beta",
        betaBadgeAria: "Beta \u529F\u80FD\uFF0C\u884C\u4E3A\u53EF\u80FD\u968F\u7248\u672C\u8C03\u6574",
        advancedSyntaxLabel: "\u542F\u7528\u591A\u6B21\u5199\u6CD5\uFF08+1h*3 / 15:32+16:32\uFF09",
        advancedSyntaxHint: "\u8BA9 /later \u4E0E /schedule \u652F\u6301\u4E00\u6B21\u5199\u591A\u6761\uFF1A+1h*3\uFF08\u7B49\u95F4\u9694 3 \u6B21\uFF09\u3001+1h+1h+0.5h\uFF08\u76F8\u5BF9\u5E8F\u5217\uFF09\u300115:32+16:32 \u4E0E 9:00+1d\uFF08\u951A\u70B9\u5E8F\u5217\uFF0C\u6309\u5899\u949F\u63A8\u8FDB\uFF0C\u8DE8\u590F\u4EE4\u65F6\u4E0D\u6F02\uFF09\u3002\u6BCF\u6761\u90FD\u662F\u72EC\u7ACB\u4EFB\u52A1\uFF0C\u53EF\u5355\u72EC\u53D6\u6D88\u6216\u7F16\u8F91\uFF1B\u5355\u6B21\u6700\u591A 10 \u6761\u3002\u6807\u8BB0\u4E3A Beta\uFF1A\u5C55\u5F00\u540E\u7684\u89C2\u611F\u4E0E\u6761\u6570\u4E0A\u9650\u4ECD\u9700\u89C2\u5BDF\u3002",
        showButtonLabel: "\u663E\u793A\u5B9A\u65F6\u6309\u94AE",
        showButtonHint: "\u5173\u95ED\u540E\u8F93\u5165\u6846\u53F3\u4FA7\u4E0D\u518D\u663E\u793A\u65F6\u949F\u6309\u94AE\uFF1B\u5DF2\u521B\u5EFA\u7684\u63D0\u9192\u4ECD\u4F1A\u7167\u5E38\u89E6\u53D1\uFF0C\u5E76\u5728\u8F93\u5165\u6846\u4E0B\u65B9\u7684\u5F85\u53D1\u9001\u5217\u8868\u4E2D\u663E\u793A\u3002",
        maxSchedulesLabel: "\u5355\u4F1A\u8BDD\u4EFB\u52A1\u4E0A\u9650",
        maxSchedulesHint: "\u5355\u4E2A\u4F1A\u8BDD\u5185\u5141\u8BB8\u521B\u5EFA\u7684\u6700\u5927\u5B9A\u65F6\u4EFB\u52A1\u6570\u91CF\u3002",
        allowLongPromptsLabel: "\u5141\u8BB8\u957F\u6587\u672C\u63D0\u9192",
        allowLongPromptsHint: "\u89E3\u9664\u9ED8\u8BA4 1000 \u5B57\u7B26\u7684\u4E0A\u9650\u3002\u5F00\u542F\u540E\u53EF\u7528\u300C\u63D0\u793A\u5B57\u7B26\u4E0A\u9650\u300D\u81EA\u5B9A\u4E49\u6700\u5927\u957F\u5EA6\uFF1B\u5173\u95ED\u65F6\u8BE5\u4E0A\u9650\u4E0D\u751F\u6548\uFF0C\u6052\u4E3A 1000\u3002",
        maxPromptCharsLabel: "\u63D0\u793A\u5B57\u7B26\u4E0A\u9650",
        maxPromptCharsHint: "\u63D0\u9192\u5185\u5BB9\u6700\u5927\u5B57\u7B26\u6570\uFF08\u4EC5\u5728\u300C\u5141\u8BB8\u957F\u6587\u672C\u63D0\u9192\u300D\u5F00\u542F\u65F6\u751F\u6548\uFF09\u3002",
        maxPromptCharsLockedHint: "\u5F00\u542F\u300C\u5141\u8BB8\u957F\u6587\u672C\u63D0\u9192\u300D\u540E\u53EF\u8C03\u3002",
        smartWindowHint: "\u7528\u4E8E\u300C\u5DE5\u4F5C\u65F6\u95F4\u300D\u82AF\u7247\u4E0E\u667A\u80FD\u6A21\u5F0F\u81EA\u52A8\u6392\u671F\u3002",
        workStartLabel: "\u5DE5\u4F5C\u65F6\u95F4\u5F00\u59CB",
        workEndLabel: "\u5DE5\u4F5C\u65F6\u95F4\u7ED3\u675F\uFF08\u665A\u95F4\u5F00\u59CB\uFF09",
        lunchStartLabel: "\u5348\u4F11\u5F00\u59CB",
        lunchEndLabel: "\u5348\u4F11\u7ED3\u675F",
        eveningEndLabel: "\u591C\u95F4\u9759\u9ED8\u8D77\u70B9",
        steerDeliveryLabel: "\u63D2\u8BDD\u6295\u9012\u65B9\u5F0F",
        steerDeliveryHint: "\u300C\u63D2\u8BDD\u53D1\u9001\u300D\u628A\u63D0\u9192\u5185\u5BB9\u63A8\u7ED9\u4F1A\u8BDD\u65F6\u8FDB\u5165\u7684\u961F\u5217\u3002",
        steerDeliveryOption_followup: "\u72EC\u7ACB\u6210\u4E00\u8F6E\uFF08\u63A8\u8350\uFF09",
        steerDeliveryOption_steer: "\u63D2\u5165\u5F53\u524D\u56DE\u5408\uFF08\u66F4\u5FEB\uFF09",
        confirmDeliveryLabel: "\u6295\u9012\u786E\u8BA4",
        confirmDeliveryHint: "\u6295\u9012\u540E\u6838\u5BF9\u4F1A\u8BDD\u65E5\u5FD7\uFF0C\u786E\u8BA4\u6D88\u606F\u771F\u6B63\u8FDB\u5165\u8BF7\u6C42\u3002\u5173\u95ED\u5219\u4E0D\u518D\u6838\u5BF9\uFF0C\u4E5F\u4E0D\u4FDD\u8BC1\u9001\u8FBE\u3002",
        onUnconfirmedLabel: "\u672A\u786E\u8BA4\u65F6",
        onUnconfirmedHint: "\u6295\u9012\u672A\u80FD\u786E\u8BA4\u65F6\u7684\u5904\u7406\u65B9\u5F0F\u3002",
        onUnconfirmedOption_keep: "\u4FDD\u7559\u6761\u76EE\u53EF\u91CD\u8BD5\uFF08\u63A8\u8350\uFF09",
        onUnconfirmedOption_discard: "\u4E22\u5F03",
        clockIconStyleLabel: "\u65F6\u949F\u56FE\u6807\u98CE\u683C",
        clockIconStyleHint: "\u4FA7\u680F\u4F1A\u8BDD\u884C\u5B9A\u65F6\u72B6\u6001\u56FE\u6807\u7684\u663E\u793A\u98CE\u683C\u3002",
        clockIconStyleOption_auto: "\u81EA\u52A8\uFF08\u63A8\u8350\uFF09",
        clockIconStyleOption_modern: "\u65B0\u7248\u63CF\u8FB9\u98CE\u683C",
        clockIconStyleOption_classic: "\u65E7\u7248\u70B9\u9635\u98CE\u683C",
        steerRiskGuarded: "\u26A0 \u649E\u4E0A\u56DE\u5408\u542F\u52A8\u65F6\u53EF\u80FD\u88AB\u541E\u6389\uFF1B\u5DF2\u5F00\u542F\u6295\u9012\u786E\u8BA4\uFF0C\u672A\u9001\u8FBE\u4F1A\u4FDD\u7559\u6761\u76EE\u5E76\u53EF\u91CD\u8BD5\u3002",
        steerRiskUnguarded: "\u26A0 \u649E\u4E0A\u56DE\u5408\u542F\u52A8\u65F6\u53EF\u80FD\u88AB\u541E\u6389\uFF0C\u4E14\u4E0D\u4F1A\u4FDD\u7559\u6761\u76EE\uFF08\u6295\u9012\u786E\u8BA4\u5DF2\u5173\u95ED\uFF09\u3002",
        discardRisk: "\u26A0 \u672A\u786E\u8BA4\u7684\u63D0\u9192\u4F1A\u88AB\u79FB\u51FA\u5217\u8868 \u2014\u2014 \u9759\u9ED8\u4E22\u5931\u5C06\u91CD\u65B0\u53D8\u5F97\u53EF\u80FD\u3002",
        overriddenLabel: "\u5DF2\u8986\u76D6",
        resetLabel: "\u91CD\u7F6E",
        invalidLabel: "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u6570\u5B57\u3002",
        invalidTimeLabel: "\u8BF7\u4F7F\u7528 HH:mm 24 \u5C0F\u65F6\u5236\u65F6\u95F4\u3002",
        save: "\u4FDD\u5B58",
        saving: "\u4FDD\u5B58\u4E2D\u2026",
        discard: "\u653E\u5F03\u4FEE\u6539",
        saveFailed: "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
        loading: "\u52A0\u8F7D\u4E2D\u2026",
        unavailable: "\u8BBE\u7F6E\u6682\u4E0D\u53EF\u7528\u3002",
        /**
         * 详情页「在设置中显示」开关的 section 标题。
         * 取值必须与 `sectionDisplay` 不同：详情页把这两段连着渲染，同名时页面上会
         * 出现两个「显示设置」。护栏见 tests/settings-section-headings.test.mjs。
         */
        sectionDisplayToggle: "\u8BBE\u7F6E\u5165\u53E3",
        showInSettings: "\u5728\u8BBE\u7F6E\u4E2D\u663E\u793A",
        showInSettingsHint: "\u5728\u8BBE\u7F6E\u5BF9\u8BDD\u6846\u4E2D\u663E\u793A\u672C\u63D2\u4EF6\u7684\u8BBE\u7F6E\u9875\uFF08\u5237\u65B0\u9875\u9762\u540E\u751F\u6548\uFF09"
      },
      en: {
        ...schedDicts.en,
        title: "Session Scheduler",
        description: "Configure in-session scheduled reminders.",
        pendingBadge: "Unsaved",
        expand: "Show settings",
        collapse: "Hide settings",
        readOnly: "Settings for this deployment are read-only.",
        sectionDisplay: "Display",
        sectionTime: "Time windows",
        sectionDelivery: "Delivery",
        sectionAdvanced: "Advanced syntax",
        betaBadge: "Beta",
        betaBadgeAria: "Beta feature; behaviour may change between versions",
        advancedSyntaxLabel: "Multi-shot syntax (+1h*3 / 15:32+16:32)",
        advancedSyntaxHint: "Let /later and /schedule create several tasks at once: +1h*3 (same interval N times), +1h+1h+0.5h (relative chain), 15:32+16:32 and 9:00+1d (anchored on a wall clock \u2014 it keeps the clock time across DST). Each occurrence is an independent task you can cancel or edit on its own; up to 10 per command. Marked Beta: the expanded result and the 10-task cap still need real-world observation.",
        showButtonLabel: "Show schedule button",
        showButtonHint: "Hide the clock button on the input bar. Existing reminders keep firing and stay visible in the dock below the composer.",
        maxSchedulesLabel: "Max schedules per session",
        maxSchedulesHint: "Maximum number of scheduled reminders allowed per session.",
        allowLongPromptsLabel: "Allow long reminder prompts",
        allowLongPromptsHint: 'Lift the default 1000-character cap. Once enabled, "Max prompt characters" lets you set a custom ceiling; while disabled that ceiling has no effect and stays at 1000.',
        maxPromptCharsLabel: "Max prompt characters",
        maxPromptCharsHint: 'Maximum characters per reminder (takes effect only when "Allow long reminder prompts" is on).',
        maxPromptCharsLockedHint: 'Adjustable after enabling "Allow long reminder prompts".',
        smartWindowHint: "Used by the Work-hours chip and smart auto-scheduling.",
        workStartLabel: "Work day start",
        workEndLabel: "Work day end (evening start)",
        lunchStartLabel: "Lunch break start",
        lunchEndLabel: "Lunch break end",
        eveningEndLabel: "Night quiet starts at",
        steerDeliveryLabel: "Interject delivery",
        steerDeliveryHint: 'Which queue the reminder content enters when you press "Send interjection".',
        steerDeliveryOption_followup: "Own turn (recommended)",
        steerDeliveryOption_steer: "Current turn (faster)",
        confirmDeliveryLabel: "Confirm delivery",
        confirmDeliveryHint: "After sending, check the session log to confirm the message actually entered a request. Turning this off skips the check and no longer guarantees delivery.",
        onUnconfirmedLabel: "When unconfirmed",
        onUnconfirmedHint: "What to do when delivery cannot be confirmed.",
        onUnconfirmedOption_keep: "Keep for retry (recommended)",
        onUnconfirmedOption_discard: "Discard",
        clockIconStyleLabel: "Clock icon style",
        clockIconStyleHint: "Display style of the schedule status icon in the sidebar.",
        clockIconStyleOption_auto: "Auto (recommended)",
        clockIconStyleOption_modern: "Modern stroke style",
        clockIconStyleOption_classic: "Classic dot-matrix style",
        steerRiskGuarded: "\u26A0 May be swallowed when it collides with turn start; delivery confirmation is on, so an undelivered reminder is kept and can be retried.",
        steerRiskUnguarded: "\u26A0 May be swallowed when it collides with turn start, and the reminder will NOT be kept (delivery confirmation is off).",
        discardRisk: "\u26A0 Unconfirmed reminders are removed from the list \u2014 silent loss becomes possible again.",
        overriddenLabel: "Overridden",
        resetLabel: "Reset",
        invalidLabel: "Please enter a valid number.",
        invalidTimeLabel: "Use 24-hour HH:mm format.",
        save: "Save",
        saving: "Saving\u2026",
        discard: "Discard",
        saveFailed: "Save failed, please try again.",
        loading: "Loading\u2026",
        unavailable: "Settings unavailable.",
        sectionDisplayToggle: "Settings entry",
        showInSettings: "Show in settings",
        showInSettingsHint: "Show this plugin's settings page in the settings dialog (refresh to take effect)"
      }
    }), "dsh-later: locale");
  }
  ctx.effect(
    () => registerLaterScheduleFacet({
      store: summary,
      scheduledWord: () => dictFor(locale?.getSnapshot().active).facetScheduled
    }),
    "dsh-later: group status facet"
  );
  const callCommand = async (sessionId, line) => {
    const actx = sessions.scope(sessionId);
    const face = actx === void 0 ? void 0 : sessions.sessionOf(actx);
    if (face === void 0) return { matched: false };
    try {
      const result = await face.command(line);
      return { matched: result?.ok === true && result.value?.matched === true };
    } catch {
      return { matched: false };
    }
  };
  const loadAttachmentUrl = (sessionId, ref) => {
    const face = ctx.get("uiConversation");
    if (typeof face?.imageUrl !== "function") {
      return Promise.reject(new Error("later-dock: uiConversation.imageUrl unavailable"));
    }
    return face.imageUrl(sessionId, {
      attachmentId: ref.attachment_id,
      ...ref.media_type !== void 0 ? { mediaType: ref.media_type } : {},
      ...ref.bytes !== void 0 ? { bytes: ref.bytes } : {},
      ...ref.width !== void 0 ? { width: ref.width } : {},
      ...ref.height !== void 0 ? { height: ref.height } : {}
    });
  };
  const peekAttachmentUrl = (sessionId, ref) => {
    const face = ctx.get("uiConversation");
    if (typeof face?.peekImageUrl !== "function") return void 0;
    return face.peekImageUrl(sessionId, {
      attachmentId: ref.attachment_id,
      ...ref.media_type !== void 0 ? { mediaType: ref.media_type } : {}
    });
  };
  const localMediaUrl = (path) => fileMediaUrl(document.baseURI, path);
  ctx.slots.inject(
    "conversation.input.dock",
    () => ctx.slots.register(
      {
        name: "conversation.input.dock",
        id: "later-dock",
        order: 30,
        locale: NS,
        // `loadImage` 是**可选**注入：内部按 `ctx.get('uiConversation')` 取，取不到
        // 时组件自动降级（见 loadAttachmentUrl 的注释）。它不构成激活依赖，所以 dock
        // 仍在顶层无条件注册——**不要**因此把 `uiConversation` 加进模块级 inject。
        // `localMediaUrl` 不依赖任何服务（纯字符串换算 + document.baseURI），因此
        // 待发附件的缩略图在「宿主没有 uiConversation face」这种旧组合下也能出图。
        inject: () => ({
          callCommand,
          loadImage: loadAttachmentUrl,
          peekImage: peekAttachmentUrl,
          localMediaUrl
        })
      },
      ScheduleDock
    )
  );
  let composerMounted = false;
  const mountComposer = (scope) => {
    if (composerMounted) return;
    composerMounted = true;
    ctx.slots.inject(
      INPUT_RIGHT_SLOT,
      () => ctx.slots.register(
        {
          name: INPUT_RIGHT_SLOT,
          id: "later",
          order: 50,
          inject: () => ({ callCommand, locale, schedulerScope: scope })
        },
        SchedButton
      )
    );
  };
  const cardT = locale === void 0 ? void 0 : locale.bind(NS);
  const cardDeclaration = (slot, scope, surface = "detail") => ({
    name: slot,
    id: SETTINGS_NS,
    order: 30,
    key: SETTINGS_NS,
    locale: NS,
    label: () => {
      const active = locale === void 0 ? "zh" : locale.getSnapshot().active;
      return active === "en" ? "Session Scheduler" : "\u5B9A\u65F6\u63D0\u9192";
    },
    inject: () => ({ scope, t: cardT, surface })
  });
  ctx.inject(["settingsScope"], () => {
    const binder = ctx.get("settingsScope");
    if (binder === void 0) return;
    detectedVersion = "classic";
    const scope = binder.bind({ namespace: SETTINGS_NS });
    getClockIconStyle = () => {
      const snap = scope.getSnapshot();
      if (snap.status !== "ready") return "auto";
      const value = snap.value ?? {};
      const style = value["clockIconStyle"];
      return style === "modern" || style === "classic" ? style : "auto";
    };
    mountComposer(scope);
    if (cardT === void 0) return;
    const SHOW_SETTINGS_KEY = "dsh-later:show-settings-section";
    const showSettingsSection = typeof localStorage !== "undefined" && localStorage.getItem(SHOW_SETTINGS_KEY) === "true";
    if (!showSettingsSection) return;
    const disposeSection = ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(cardDeclaration("settings.section", scope, "settings"), SchedulerSettingsCard)
    );
    if (typeof disposeSection === "function") {
      ctx.effect(() => () => {
        disposeSection();
      });
    }
  });
  ctx.inject(["configForms"], () => {
    const forms = ctx.get("configForms");
    if (forms === void 0 || typeof forms.get !== "function" || typeof forms.whileServed !== "function") return;
    detectedVersion = "modern";
    const scope = forms.get(ENTRY_ID);
    getClockIconStyle = () => {
      const snap = scope.getSnapshot();
      if (snap.status !== "ready") return "auto";
      const value = snap.value ?? {};
      const style = value["clockIconStyle"];
      return style === "modern" || style === "classic" ? style : "auto";
    };
    mountComposer(scope);
    if (cardT === void 0) return;
    ctx.effect(
      () => forms.whileServed(
        [ENTRY_ID],
        () => ctx.slots.inject(
          "plugins.bundle.config",
          () => ctx.slots.register(cardDeclaration("plugins.bundle.config", scope, "detail"), SchedulerSettingsCard)
        )
      ),
      "dsh-later: plugins-page card"
    );
    const SHOW_SETTINGS_KEY = "dsh-later:show-settings-section";
    const showSettingsSection = typeof localStorage !== "undefined" && localStorage.getItem(SHOW_SETTINGS_KEY) === "true";
    if (!showSettingsSection) return;
    const disposeSection = ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(cardDeclaration("settings.section", scope, "settings"), SchedulerSettingsCard)
    );
    if (typeof disposeSection === "function") {
      ctx.effect(() => () => {
        disposeSection();
      });
    }
  });
}

		return module.exports;
	}
});
