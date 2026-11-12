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
  __panelAnchorProbeForTest: () => __panelAnchorProbeForTest,
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

// src/client/media-url.ts
function isAbsoluteWorkspacePath(path) {
  return path.startsWith("/") || /^[A-Za-z]:[/\\]/u.test(path) || path.startsWith("\\\\");
}
function fileMediaUrlFallback(base, path) {
  const okBase = /^https?:/u.test(base) || base.startsWith("dsh-app://app/");
  if (!okBase || !isAbsoluteWorkspacePath(path) || /^[/\\]{2}/u.test(path) || /[\u0000-\u001f\u007f]/u.test(path)) {
    return void 0;
  }
  return new URL(`api/file?path=${encodeURIComponent(path)}`, base).href;
}

// src/client/workspace-path-compat.ts
function fileMediaUrlCompat(base, path) {
  return fileMediaUrlFallback(base, path);
}

// src/domain.ts
var name = "dsh-later";

// src/client/strings.ts
var zh = {
  /** 输入框按钮 tooltip */
  buttonSchedule: "定时发送",
  /** 面板标题 */
  panelTitle: "定时提醒",
  /** 关闭面板 */
  close: "关闭",
  /** 快捷选项 */
  quick10m: "10分钟后",
  quick1h: "1小时后",
  quickSmart: "工作时间",
  quickCustom: "自定义…",
  /** 自定义输入 */
  dateLabel: "日期",
  timeLabel: "时间",
  today: "今天",
  tomorrow: "明天",
  /** 任务列表 */
  taskListTitle: "已设定",
  emptyTasks: "暂无定时任务",
  deleteTask: "删除提醒",
  /** 编辑提醒内容（dock 行内） */
  editTask: "编辑提醒",
  editSave: "保存",
  editCancel: "取消",
  editErrEmpty: "内容不能为空",
  editErrFailed: "修改失败：{message}",
  editErrNotAccepted: "命令未被受理",
  editErrCommandFailed: "命令失败",
  /** 主动插话发送：立即把提醒内容推给 agent（QueueDock「插话发送」语义） */
  steerTask: "插话发送",
  steerAlreadySent: "已插话",
  steerFailed: "插话失败：{message}",
  steerUnsupportedKind: "周期提醒暂不支持插话",
  /** 投递未确认（宿主保留条目，可重试） */
  steerUnconfirmed: "投递未确认，提醒已保留，可重试",
  steerRetry: "重试",
  /** 暂停 / 恢复（仅 after；原地冻结进度条） */
  pauseTask: "暂停提醒",
  resumeTask: "恢复提醒",
  pausedLabel: "已暂停",
  pauseFailed: "暂停失败：{message}",
  resumeFailed: "恢复失败：{message}",
  pauseUnsupportedKind: "仅支持暂停「再等 N 分钟」类提醒",
  /** dock 折叠头计数（QueueDock「N 条排队消息」样式） */
  panelCount: "{n} 条定时提醒",
  /** 精准倒计时（dock 行 + 折叠头） */
  countdownLeft: "剩",
  dueAnyMoment: "即将发送",
  /** 状态 */
  sending: "正在发送…",
  /** dock 折叠头的状态摘要（issue #31：收起时也要播报「未确认」） */
  statusUnconfirmed: "{n} 条未确认",
  /** 确认按钮 */
  confirmAdd: "加入 · {time} 发送",
  confirmAddNoTime: "选择发送时间",
  /** 提示 */
  promptFromDraft: "将以输入框内容作为提醒内容",
  /** 错误提示 */
  errPromptEmpty: "请先在输入框输入内容",
  /**
   * issue #141：上限数字必须是**校验当场**的 `promptLimits.maxChars`，不是写死的
   * 「1000」——旧文案写死默认值，把上限放开到 10000 后，12000 字的内容被告知
   * 「不能超过 1000 字符」，与实际执行的限制自相矛盾。
   *
   * 与 #125（`5d147c6`）的取舍关系——那条给宿主工具描述 `paramPromptDesc`
   * （宿主 `src/strings.ts`）选了「说明式、不插值」，这里选**插值**，两处不同是
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
  errPromptTooLong: "提醒内容不能超过 {maxChars} 字符",
  errTimePast: "请选择未来的时间",
  errCreateFailed: "创建失败：{message}",
  errDeleteFailed: "删除失败：{message}",
  /** 客户端本地错误（hook 抛令牌，UI 按当前语言翻译） */
  errNoSession: "当前无会话",
  errNotAcceptedStashed: "命令未被受理，已暂存本地",
  /** 侧栏会话行「定时状态」badge（docs/ui/09） */
  presenceBadgeAria: "有 {n} 条定时提醒，下次 {time}",
  presenceOverdueAria: "有 {n} 条定时提醒已到期，等待发送",
  presenceTooltip: "下次 {time} · {n} 条任务",
  presenceOverdueTooltip: "已到期 · {n} 条任务（等待会话空闲发送）",
  /** 全部任务都处于暂停：没有排定的触发时刻，故不显示"下次"或"已到期"。 */
  presencePausedAria: "有 {n} 条定时提醒已暂停",
  presencePausedTooltip: "已暂停 · {n} 条任务",
  /** 悬浮卡片状态区追加行（与宿主 hoverStatus 同构，纯追加不改写既有状态） */
  hoverScheduleStatus: "有 {n} 条定时提醒，下次 {time}",
  hoverScheduleOverdue: "有 {n} 条定时提醒已到期，等待发送",
  hoverSchedulePaused: "有 {n} 条定时提醒已暂停",
  /**
   * 折叠分组徽标（facet）里「定时任务」这个词（issue #36）。
   *
   * 措辞与 dsh-group-status 过渡基线（其 `status.scheduled`）**逐字一致**：迁移的验收
   * 标准是注册前后徽标文案不变，这里换措辞就等于单方面改基线。
   * 完整句子由 `laterScheduleFacetLabel` 拼：`${count} ${facetScheduled}`。
   */
  facetScheduled: "定时任务",
  relMinutes: "{m} 分后",
  relHours: "{h} 小时后",
  relTomorrow: "明天 {time}",
  relDate: "{date} {time}",
  relClock: "{time}",
  /** 附件带 a11y（#38）：措辞结构对齐宿主 `queue.image` / `queue.file`，但把「排队」换成「提醒」。 */
  attachmentImage: "提醒图片",
  attachmentFile: "提醒文件 {name}",
  attachmentPendingSend: "发送后可见",
  attachmentUnavailable: "图片不可用",
  attachmentMore: "另有 {n} 个附件未列出",
  /** 定时消息气泡标记（issue #112）：设置项与四种档位。 */
  bubbleMarkerLabel: "定时消息标记",
  bubbleMarkerHint: "在 /later 到点送出的消息上加一个时钟标记。left 在气泡左侧常显，meta 在气泡上方加一行小字，hover 只在悬停消息行时出现；关闭后不接管渲染，与官方原样一致。标记只在 0.2.1 及以上的内核生效。",
  bubbleMarkerOption_off: "关闭",
  bubbleMarkerOption_left: "气泡左侧",
  bubbleMarkerOption_meta: "气泡上方",
  bubbleMarkerOption_hover: "悬停显示",
  /** 标记的 a11y 文案与 tooltip（{time} 是送达时刻）。 */
  laterMarkerAria: "定时发送的消息，{time} 送达",
  laterMarkerTooltip: "定时发送 · {time} 送达",
  laterMarkerTooltipBatch: "定时发送 · {time} 送达 · {count} 条合并",
  laterMarkerMeta: "定时发送 · {time}",
  /** 复刻操作行的文案（与官方 chat 的 copy/copied 同义）。 */
  actionCopy: "复制",
  actionCopied: "已复制",
  /** 复刻官方 formatMessageClock 的两段格式（仅同年/跨年用得到）。 */
  clockMd: "{m}月{d}日",
  clockYmd: "{y}年{m}月{d}日"
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
  quickCustom: "Custom…",
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
  steerUnconfirmed: "Delivery unconfirmed — reminder kept, you can retry",
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
  sending: "Sending…",
  /** dock collapsed-header status summary (issue #31) */
  statusUnconfirmed: "{n} unconfirmed",
  confirmAdd: "Add · send at {time}",
  confirmAddNoTime: "Pick a send time",
  promptFromDraft: "The composer draft will be used as the reminder content",
  errPromptEmpty: "Type something in the composer first",
  // {maxChars} 由面板在校验当场插值，取舍与防回退说明见 zh 段同名键上方注释（issue #141）。
  errPromptTooLong: "Reminder content cannot exceed {maxChars} characters",
  errTimePast: "Pick a future time",
  errCreateFailed: "Create failed: {message}",
  errDeleteFailed: "Delete failed: {message}",
  errNoSession: "No active session",
  errNotAcceptedStashed: "Command was not accepted; saved locally",
  presenceBadgeAria: "{n} scheduled reminder(s), next at {time}",
  presenceOverdueAria: "{n} scheduled reminder(s) due, waiting to send",
  presenceTooltip: "Next at {time} · {n} task(s)",
  presenceOverdueTooltip: "Due · {n} task(s) (sends when the session is idle)",
  presencePausedAria: "{n} paused reminder(s)",
  presencePausedTooltip: "Paused · {n} task(s)",
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
  attachmentMore: "{n} more attachment(s)",
  bubbleMarkerLabel: "Scheduled message marker",
  bubbleMarkerHint: "Add a clock marker to messages delivered by /later. left shows it beside the bubble, meta adds a small line above, hover reveals it when the row is hovered; off leaves the official renderer untouched. Only available on kernel 0.2.1 and later.",
  bubbleMarkerOption_off: "Off",
  bubbleMarkerOption_left: "Beside bubble",
  bubbleMarkerOption_meta: "Above bubble",
  bubbleMarkerOption_hover: "On hover",
  laterMarkerAria: "Scheduled message, delivered {time}",
  laterMarkerTooltip: "Scheduled · delivered {time}",
  laterMarkerTooltipBatch: "Scheduled · delivered {time} · {count} merged",
  laterMarkerMeta: "Scheduled · {time}",
  actionCopy: "Copy",
  actionCopied: "Copied",
  clockMd: "{m}/{d}",
  clockYmd: "{y}-{m}-{d}"
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
  /* ==================== 输入行容器 ==================== */
  ".ss-sched-row { display: inline-flex; align-items: center; gap: 4px; flex: none; }",
  "",
  /* ==================== ⏰ 按钮（输入框右侧工具按钮） ==================== */
  /* 对齐官方 ui-conversation trigger：28×28、secondary 色、hover interactive-bg-hover */
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
  /* ==================== 待发送提醒 dock（像素级对齐 QueueDock；行内保留 boss 进度条） ==================== */
  /* 外壳几何与 QueueDock .dock 一致（含负下边距贴住 composer 栈）。 */
  ".ss-dock-root {",
  "  box-sizing: border-box; flex: none;",
  "  width: calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance)",
  "    - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));",
  "  max-width: calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));",
  "  margin: 0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);",
  "  padding: 0 var(--dsh-composer-dock-inset);",
  "}",
  /* 面板与 QueueDock .panel 一致：顶部圆角 + 两层伪元素——::before 铺 menu 底（含毛玻璃），
     ::after 画描边并留底边开口，与宿主 panel:before / panel:after 一一对应（issue #32）。 */
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
  /* 描边独立一层（宿主同款拆法）：粗细用 .5px，与宿主的 alias-border-l1 hairline 对齐；
     留底边开口，让面板与 composer 卡片视觉上接成一体。 */
  ".ss-dock-body::after {",
  "  border: .5px solid var(--dsw-alias-border-l1); border-bottom: none;",
  "  border-radius: inherit; content: '';",
  "  pointer-events: none;",
  "  position: absolute; inset: 0;",
  "}",
  /* 管子接缝：判据从「上面那条是不是宿主队列条」（#41 嗅探宿主 QueueDock 的私有属性）换成「我在
     dock 栈里排第几」。选择器只依赖 [data-slot]（渲染器给每个插槽出口的公开标记）与我们自己的
     .ss-dock-root，与邻居是谁无关。唯一事实来源 docs/notes/dock-stack-contract.md §2：下面三条逐字照抄，
     次序只是 A→B 的阅读因果、不承载优先级：A 改 .ss-dock-root 的 margin-bottom、B 改 .ss-dock-body 的顶边，
     两者命中不同元素的不同声明、互不争优先级；能盖过基础规则靠的是特指度本身（基础规则 (0,1,0)、
     A (0,3,0)、B (0,4,0)，走 ::after 的那支 (0,4,1)）。机制没变：上段底边本就是「直角 + 开口」（panel
     的 :after 无 bottom 边），两段的侧描边在同一 x 上首尾相接、底色同为 --dsw-specific-menu，接缝处
     不存在任何一条线；-9px 重叠保留（与接 composer 同款消缝手法，勿"修平"）。solo 时我们既 :first-child
     又 :last-child，三条全不命中，单条 dock 逐像素不变。 */
  /* 为什么「位置」优于「邻居身份」（§1 三条理由）：① 耦合邻居身份——绑死在队列条一家的类名/属性上，
     它改属性、或上面换成 goal／todo／第三方 dock，判据就静默失效；② 答不上真正的问题——要表达的从来
     是「我上面还有东西」与「我是栈底」，邻居身份对了而位置不对时（上面是别的 dock）该方角仍是圆角，
     观感照样错；③ 规模不对——同一条插槽宿主自己占着 todo(0)/goal(10)/queue(20)，各家各画自己的壳：
     实测只有 queue 是 attach 式（margin:0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px)），
     todo/goal 是 margin:0 auto 的浮卡。把「我是栈底」当隐含前提的是 queue 与我们（order: 30）两家，
     而没有任何 API 说谁是栈底 —— 上面多一条 dock 就悄悄翻转，补特例收不了口。回归矩阵见 #42；
     向宿主要 dock 栈契约（data-dock-attach 或共享壳导出）是上游那一半，另追 #43。 */
  /* fail-open 方向（刻意如此）：任何一条新选择器若在真实宿主里永不命中（例如 [data-slot] 的出口结构与
     我们理解的不一致），结果只是退回 #41 之前的观感（接缝多一条描边），不会更糟——所以基础态仍是末位
     attach、只有明确不是末位时才让位，常见路径不依赖「选择器必须命中」。两条已知边界（§4）：① 上方某条
     dock 抛错时渲染器在同一父节点下留一个 [data-slot-error] 空 div，占掉一个兄弟位，于是
     :not(:first-child) 成立而上方并无可见内容 → 顶边画成方角；那是「已经在降级」的场景里的次级观感
     问题，不为此引入 :nth-child(… of …) 这类脆弱写法。② 仍然耦合 [data-slot] 这一手出口 DOM——它比
     私有属性公开得多（那是渲染器给所有插槽的通用锚点，不是某一家 dock 的身份牌），但终归是结构耦合，
     真正的收口在宿主侧（#43）。另：接缝像素判据目前只在 DPR=1 实测过，DPR=2 视网膜屏下的复测是遗留项
     #62；本改动不动任何几何，对它既不利也不弊。 */
  /* A. 不是栈底 → 不再占「贴 composer」那个位置（负下边距收回 0） */
  '[data-slot="conversation.input.dock"] > .ss-dock-root:not(:last-child) { margin-bottom: 0; }',
  /* B. 上面还有兄弟 → 本段是管子的下段：顶边直角 + 无顶描边 */
  '[data-slot="conversation.input.dock"] > .ss-dock-root:not(:first-child) .ss-dock-body { border-radius: 0; }',
  '[data-slot="conversation.input.dock"] > .ss-dock-root:not(:first-child) .ss-dock-body::after { border-top: none; }',
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
  /* 折叠态状态摘要（#31）：逐值对齐宿主 QueueDock 的 .status ——
     color/tertiary + --dsw-font-xs-13 + nowrap + flex:none。缺了它，摘要会按继承样式渲染，
     并在窄输入框下换行把 36px 的 header 顶高。 */
  ".ss-dock-status {",
  "  color: var(--dsw-alias-label-tertiary);",
  "  font: var(--dsw-font-xs-13);",
  "  white-space: nowrap; flex: none;",
  "}",
  /* P5 结论（集成核对表 §1 要求登记）：**有意保留 rotate，不追平宿主的换图标**。
     宿主按展开态在 IconChevronUp/DownOutlineRegular 之间切换；本组件恒用 Down +
     rotate(180deg)。chevron 上下对称，两种做法在展开态的视觉结果一致，故属实现差异
     而非视觉漂移。保留 rotate 的理由：不引入条件图标分支与第二个图标依赖，且日后若要
     给折叠加过渡，rotate 是连续量、换图标是离散跳变。登记于此，免得下轮走查重复报。 */
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
  /* QueueDock 的 preview 是单行文本；同位放「时间 · 倒计时 · 内容」+ boss 进度条（保留插件特性）。 */
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
  /* ==================== 行首附件带（issue #38）====================
     取值逐条照抄宿主 QueueDock.module.css 的 .attachments / .thumb / .file /
     .fileIcon / .fileName / .fileSize。**位置也与宿主一致**：附件带是 .ss-dock-row
     的第一个子元素，在正文左侧同一行（原先独占正文下方一带，与头顶上的原生队列
     叠在一起时观感明显不是一族，故改回行首）。
     唯一保留的有意偏离：不抄宿主的 max-width:55% + overflow:hidden —— 那是给它
     单行正文让路的折中，代价是超出就**静默裁切**；我们改成可收缩 + 横向滚动，
     挤不下时用户能滚着看完，而不是永远看不见第 N 张。
     滚动条外观不用额外声明：.ss-dock-body 上已设 --dsh-scrollbar-thumb，子级继承。 */
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
  /* 图片字节不可用时的退化 chip：与 .ss-dock-file 同形，只换个色档表明是异常。 */
  ".ss-dock-thumb-fallback { flex: 0 auto; max-width: 180px; }",
  ".ss-dock-thumb-fallback .ss-dock-file-name { color: var(--dsw-alias-label-tertiary); }",
  /* 超出 #37 每任务上限时的「+N」尾巴。 */
  ".ss-dock-more {",
  "  box-sizing: border-box; flex: none; display: inline-flex; align-items: center;",
  "  height: 24px; padding: 0 6px; font-size: 10px; color: var(--dsw-alias-label-tertiary);",
  "  border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm);",
  "  background: var(--dsw-alias-bg-base);",
  "}",
  /* boss 血条（保留）：单根长管 + 等比分隔线（每段 1h）。 */
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
  /* 极短任务/早期暂停时进度比接近 0：给最小可见宽度，且 active 与 paused 同一规则，
     避免暂停前后保底阈值不一致导致条长跳变。 */
  "  min-width: 10px;",
  "}",
  /* 进度推进：CSS 动画线性推进（替代「每秒 tick 改宽度 + transition 补间」）。
     参数由 JS 注入 --ss-bar-duration / --ss-bar-delay：
     duration 固定为完整窗口（否则每次 tick 都改变参数、浏览器会重启动画）；
     delay 为 -(已过去) 的负值（把播放头定位到绝对相位，重挂载后不归零）。
     JS 侧只传变量、不写 animationName 简写，避免覆盖这里的声明。
     注意此处**不带** :not(.ss-paused)：暂停态另有 animation: none 覆盖。 */
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
  /* 无障碍：关掉逐帧推进。此时 animation-fill-mode 会让宽度停在起始值(0)，
     故由 JS 侧改走静态 width 路径（见 ScheduleDock 的 prefersReducedMotion）。 */
  "  .ss-dock-bar-fill { animation: none !important; }",
  "}",
  /* 暂停态（P1：不额外加样式）。
     暂停 = 原条 + 完全静止：不叠加斜纹/冰封/阻塞头，也不改底色、不变色。
     状态由「动 / 静」对比表达——进行中进度条在推进，暂停时停住。
     注意：**不额外叠流动纹理**。先前误把"进行中加流光"当作 P1 的一部分实现，
     但那不在 P1 定义内（P1 原文：暂停 = 原条 + 静止，不加任何纹理），已移除。
     只保留下面这行防御：万一动画因故残留，暂停时必须停住。
     （几何与保底宽度沿用 .ss-dock-bar-fill 的公共规则，故暂停前后长度一致。） */
  ".ss-dock-row.ss-paused .ss-dock-bar-fill {",
  "  animation: none;",
  "}",
  "@media (prefers-reduced-motion: reduce) {",
  "  .ss-dock-row:not(.ss-paused) .ss-dock-bar-fill { animation: none; background: var(--dsw-alias-brand-primary); }",
  "}",
  ".ss-dock-row.ss-paused .ss-dock-row-countdown { color: var(--dsw-alias-label-tertiary); }",
  ".ss-dock-row.ss-paused .ss-dock-row-time,",
  ".ss-dock-row.ss-paused .ss-dock-row-prompt { color: var(--dsw-alias-label-secondary); }",
  /* 分隔线：absolute 跨整个 bar 画 N-1 条等比竖线，渲染在 fill 之前（fill 用 z-index:1 盖住「已填充段」上的刻度）。 */
  ".ss-dock-bar-divider {",
  "  position: absolute; inset: 0; pointer-events: none;",
  "  background-repeat: no-repeat;",
  "}",
  ".ss-dock-actions { display: flex; align-items: center; gap: 10px; flex: none; }",
  /* 动作按钮的 tooltip 用 primitives 的 Tooltip（issue #29）：气泡样式与层级由它自带，
     这里不再定义——原先自研气泡的类名、包装层与淡入 keyframes 一并删除。 */
  ".ss-dock-action {",
  "  corner-shape: round; /* 宿主 .action 显式声明了这条。注意 round 本就是该属性的初始值，",
  "   所以这是逐字对齐而非视觉修复：不支持的引擎忽略它，支持的引擎结果不变。 */",
  "  display: grid; place-items: center; width: 28px; height: 28px; padding: 0; flex: none;",
  "  border: none; border-radius: 999px; background: none; cursor: pointer;",
  "  color: var(--dsw-alias-label-tertiary);",
  "}",
  ".ss-dock-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }",
  ".ss-dock-action:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }",
  ".ss-dock-action:disabled { cursor: default; opacity: 0.45; }",
  /* 插话完成态：QueueDock 无此态，用成功色做轻提示（叠加 disabled 半透明）。 */
  ".ss-dock-action-steer.ss-done { color: var(--dsw-alias-state-success-primary); }",
  ".ss-dock-steer-err {",
  "  color: var(--dsw-alias-state-warn-secondary); font-size: 12px; line-height: 16px;",
  "}",
  /*
   * 投递未确认提示：条目被宿主保留（未写 dispatch），行仍在台上。
   * 与普通错误（纯文字）区分：它不是一个"失败"，而是"结果未知且可挽回"，
   * 语气应是提示而非报错，故给浅底 + 边框 + 可点的重试。
   */
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
  /* 行内编辑（宿主 QueueDock `.editor` 逐条对齐：textarea + 自适应高度，上限交 CSS）。
     描边/圆角走 .5px + border-l4 + radius-sm，不再写 1px / 6px 字面量——只有用 token
     才会跟着主题代次变；height 也必须让位给 min/max-height，否则 JS 回填的自适应高度
     会被固定 28px 顶死（宿主的 clamp 就在 max-height，到顶后 textarea 自己滚动）。 */
  ".ss-dock-edit-input {",
  "  box-sizing: border-box; flex: auto; min-width: 0;",
  "  min-height: 28px; max-height: 127px; padding: 3px 8px; overflow-y: auto;",
  "  font: var(--dsw-font-xs-13); font-family: Inter, var(--dsw-font-family);",
  "  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);",
  "  border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-sm);",
  "  outline: none; resize: none;",
  "}",
  ".ss-dock-edit-input:focus { border-color: var(--dsw-alias-state-business-primary); }",
  /* 提交在途：与 .ss-dock-row-save:disabled 同档，让「按了但还没回来」看得出状态。 */
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
  /* ==================== 面板 ==================== */
  /*
   * 抬升面逐项对齐官方 PickerPopover（@deepseek-ai/dsh-client-ui-schedule 的
   * PickerPopover.module.css + primitives MenuSurface.module.css）：
   *   背景 --dsw-menu-surface-fill（带透明度的菜单面）+ blur(40px) 毛玻璃
   *   描边走主题的 --dsw-elevation-stroke（0 0 0 .5px），而不是手写 1px ——
   *     0.5px 描边是高分屏下的正确细线，1px 在 1x 上过重、在 2x 上又发虚。
   *   阴影 --dsw-elevation-prominent（含描边层，不是第二套阴影）。
   *   圆角 16px = --dsw-radius-lg（官方面板同一档；旧的 12px 是 --dsw-radius-md）。
   *   z-index 1100 = 官方浮层档（旧的 101 是自造值，排在 dock 之下）。
   *
   * ⚠️ 勿再引入 --dsw-shadow-lv3 / --dsw-alias-border-inverted：那是更早设计代次的
   *    token，混用会让面板在浅色/深色下都偏离官方观感（issue #24）。
   */
  ".ss-backdrop {",
  "  position: fixed; inset: 0; z-index: 1099; background: transparent;",
  "}",
  /*
   * 定位三档（见 src/client/primitives-compat.ts 的 PANEL_ANCHOR_BACKEND）：
   *   · hook（0.2.2-rc.2 之前）：宿主把 left/top 写成行内值，这里的 auto 只为兜住首帧；
   *   · css-anchor（0.2.2-rc.2 起）：anchored 的行内值 top + height 参与布局，**必须**给
   *     height，否则 `top` 是确定的、高度是 auto，两条都满足时 `bottom` 不产生约束，
   *     面板会从 top 往下铺满而不是贴着锚点往上长；
   *   · static（两者皆无）：只有 `bottom` 起作用。
   */
  ".ss-panel {",
  "  position: fixed; top: auto; left: auto; bottom: auto; z-index: 1100;",
  "  box-sizing: border-box; display: flex; flex-direction: column;",
  "  width: min(340px, calc(100vw - 24px));",
  "  padding: 12px;",
  "  background: var(--dsw-menu-surface-fill);",
  "  backdrop-filter: var(--dsw-menu-backdrop-filter);",
  "  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter);",
  "  border: 0; border-radius: var(--dsw-radius-lg);",
  "  box-shadow: var(--dsw-elevation-prominent);",
  /* 描边与阴影同变量：--dsw-elevation-prominent 自身含 --dsw-elevation-stroke，
     这里只需给 stroke 颜色。官方 schedule/input-trigger/subagent 三个包一致取 l1。 */
  "  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);",
  "  color: var(--dsw-alias-label-secondary);",
  "  font-size: 12px; line-height: 20px; font-family: var(--dsw-font-family);",
  "}",
  /* 上面三档共处一条规则：行内值优先，CSS 只负责「没被行内覆盖时」的缺省。 */
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
  /* ==================== 快捷芯片（单视图，无 tab） ==================== */
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
  /* ==================== 表单字段 ==================== */
  /* 对齐官方 fields.module.css：column 布局、label 在上 13px/500，字段间无分隔线 */
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
  /* ==================== 任务列表 ==================== */
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
  /* ==================== 底部操作栏 ==================== */
  /* 对齐官方按钮规格：radius 8、padding 5px 14px、13px、disabled opacity .4 */
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
  /* ==================== 错误提示 ==================== */
  /* 对齐官方：纯文字色、无背景色块；hint 12px */
  ".ss-error {",
  "  color: var(--dsw-alias-state-error-primary); font-size: 12px;",
  "  line-height: 1.5; margin: 0;",
  "}",
  ".ss-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; margin: 0; }",
  "",
  /* ==================== 侧栏会话行「定时状态」badge（docs/ui/09 路线 B） ==================== */
  /* 紫为定时专属（浅深通用，对白/深底对比均 ≥3:1）；urgent/overdue 复用宿主 warn/error 别名。 */
  ".ss-presence { display: inline-flex; flex: none; color: #8b5cf6; }",
  ".ss-presence-beside { margin-left: 4px; }",
  "",
  /* ── 旧版点阵时钟（classic） ── */
  ".ss-presence rect { fill: currentColor; }",
  ".ss-presence .ss-presence-ring { opacity: 0.8; animation: ss-presence-breathe 2.4s var(--ds-ease-in-out, ease-in-out) infinite; }",
  ".ss-presence .ss-presence-hand { opacity: 1; }",
  '.ss-presence[data-state="urgent"] .ss-presence-ring { animation-name: ss-presence-pulse; animation-duration: 0.9s; }',
  '.ss-presence[data-state="overdue"] .ss-presence-ring { animation: none; }',
  "",
  /*  新版描边时钟（modern）— 对齐 DSH 官方 spinner 样式 ── */
  /* 双环：track 恒定为底（给出「总窗口」的视觉参照），prog 是从 12 点起的进度弧。
     无从算进度时 JS 把 prog 置为 display:none —— 此时视觉与改造前的单环完全一致。 */
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
  /* urgent 只脉冲底环：进度弧承载确定信息，跟着闪会让比例不可读。 */
  '.ss-presence[data-state="urgent"] .ss-clock-track { animation-name: ss-clock-pulse; animation-duration: 0.9s; }',
  '.ss-presence[data-state="overdue"] .ss-clock-track { animation: none; opacity: 1; }',
  "",
  /* ── 三态颜色 ── */
  '.ss-presence[data-state="urgent"] { color: var(--dsw-alias-state-warn-secondary); }',
  '.ss-presence[data-state="overdue"] { color: var(--dsw-alias-state-error-primary); }',
  "",
  /* ── 动画关键帧 ── */
  "@keyframes ss-presence-breathe { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }",
  "@keyframes ss-presence-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }",
  "@keyframes ss-clock-breathe { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }",
  "@keyframes ss-clock-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }",
  "@media (prefers-reduced-motion: reduce) {",
  "  .ss-presence .ss-presence-ring { animation: none; }",
  "  .ss-presence .ss-clock-track { animation: none; }",
  /* 减少动效：进度弧的位移过渡也一并停，避免"进度自己在爬"的观感。 */
  "  .ss-presence .ss-clock-prog { transition: none; }",
  "}",
  "",
  /* ==================== 悬浮卡片状态行增补（issue #4） ==================== */
  /* 与宿主 .hoverStatus 行严格同构。宿主 StateDot 实测结构（dsh-client-ui-primitives
     的 ._dot_* 运行时样式，10×10 relative + ::before 10px/inset:0 + ::after 6px/inset:2px，
     两层同色 → 视觉直径约 8px）：本插件按下述同样的双层写法自绘，避免复用其构建期 hash
     类名（_dot_xxxxxx_n 不稳定，宿主升级会静默失效）。
     颜色跟随宿主语义色板，不引入插件专属色——文案已说明是定时提醒，点不必再承担
     「区分来源」的职责；混入第五种颜色反而与宿主 warning 语义撞车。
  
     ⚠️ 已知限制（浅色适配尚未处理）：以下色值是在**当前深色主题**下从宿主
     实测得到的运行时值，宿主自身引用 --dsw-alias-* token，会随主题变化，
     而此处是硬编码常量。因此当前仅在深色主题下与宿主一致；切换到浅色主题/
     其他配色方案时，本行不会跟随，可能与该卡片其余内容不同步。
     修法：实测浅色主题下该卡片的实际底色后，改用对应 token（待办）。 */
  ".ss-hover-status {",
  "  display: flex; align-items: center; gap: 8px;",
  "  color: #adb2b8; font-size: 12px; line-height: 20px;",
  "}",
  /* 状态点：宿主同款双层结构。关键——::before 是 10% 透明度的**光晕**，
     不是实心外环；::after 才是 6px 实心核心。若 ::before 不设 opacity，
     它会盖住核心并渲染成 10px 实心圆（比宿主明显偏大偏实）。 */
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
  /* 语义映射（对齐宿主 done/ongoing/warning/error 四态色值）：
     scheduled → ongoing 灰（中性：已排期，无紧迫性）
     urgent    → warning 琥珀（≤5min 即将触发）
     overdue   → error 红（已到期，等待会话空闲发送） */
  '.ss-hover-status[data-state="urgent"] .ss-hover-status-dot { color: #f59e0b; }',
  '.ss-hover-status[data-state="overdue"] .ss-hover-status-dot { color: #f25a5a; }',
  "",
  /* ==================== 设置页（定时提醒表单） ==================== */
  /* 视觉对齐官方 SettingsForm（dsh-client-ui-primitives）：裸表单，无卡片容器，
     字段按 section 分组，每组有标题，底部保存按钮。类名统一 ss- 前缀。 */
  ".ss-settings-form {",
  "  display: flex; flex-direction: column;",
  "}",
  /* Section 分组（对齐官方 AZSXYW_section 结构） */
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
  /* label 末尾内联图标（如时钟风格预览）：横向排布、图标紧跟文字，
     flex:0 0 auto 覆盖基类的 flex:1，让 label 收缩到内容宽而非撑满整行。 */
  ".ss-card-label--withIcon {",
  "  display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto;",
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
  /*
   * 选项风险提示（steer 可能被回合启动吞掉 / discard 会让静默丢失复活）。
   * 常驻显示而非 tooltip：这几项配置的后果是"静默失败"，藏在悬浮提示里等于没有。
   */
  ".ss-card-risk {",
  "  margin: 6px 0 0; padding: 6px 9px; border-radius: 6px;",
  "  font-size: 12px; line-height: 1.55;",
  "  color: var(--dsw-alias-state-warn-secondary);",
  "  background: color-mix(in srgb, var(--dsw-alias-state-warn-secondary) 12%, transparent);",
  "  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-secondary) 30%, transparent);",
  "}",
  /*
   * 联动锁说明（§6.3：maxPromptChars 因「允许长文本」关闭而不可编辑）。
   * 与 .ss-card-risk 区分：那是**后果警告**（会静默丢数据），故用 warn 色 + 底色框；
   * 这里只是「为什么现在不能改」的中性说明，用次级文字色、无底色，避免把
   * 一个正常状态渲染成像是出错了。常驻而非 tooltip：disabled 控件上的 title
   * 在多数浏览器里不触发，等于没有提示。
   */
  ".ss-card-gate {",
  "  margin: 0; font-size: 12px; line-height: 1.5;",
  "  color: var(--dsw-alias-label-tertiary);",
  "}",
  ".ss-card-footer {",
  "  justify-content: flex-start; align-items: center; gap: 8px;",
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
  "}",
  /* Section Beta 徽标（对齐官方 Tag tone="info" 样式：无 border、10% 背景透明度） */
  ".ss-section-beta {",
  "  display: inline-flex; align-items: center;",
  "  padding: 1px 8px; margin-left: 8px;",
  "  font-size: 11px; font-weight: 500; line-height: 17px;",
  "  color: var(--dsw-alias-state-business-primary);",
  "  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);",
  "  border-radius: 999px; corner-shape: round; white-space: nowrap;",
  "}",
  /* ==================== 定时消息气泡标记（issue #112） ==================== */
  /* 行容器复刻官方 userRow：列向、右对齐、间距 6px。 */
  ".ss-later-row { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }",
  /* display:contents 让工厂输出继续当行容器的直接 flex item（尺寸/对齐口径不变），只借它做测量。 */
  ".ss-later-stackwrap { display: contents; }",
  ".ss-later-main { display: flex; align-items: flex-start; justify-content: flex-end; gap: 8px; width: 100%; }",
  /* left / hover：气泡左外侧的钟。margin-top 由组件按附件行高度现算（默认 13px）。 */
  ".ss-later-mark { position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-top: 13px; color: var(--dsw-alias-label-tertiary); }",
  ".ss-later-mark:hover { color: var(--dsw-alias-label-secondary); }",
  /* meta：气泡上方一行 12px 文案；16px 行高 + 6px 间距 - 4px 负边距 = 总高 +18px。 */
  ".ss-later-meta { display: flex; align-items: center; gap: 6px; align-self: flex-end; margin-bottom: -4px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }",
  ".ss-later-meta svg { width: 13px; height: 13px; }",
  /* hover：默认隐形，行悬停 / 聚焦淡入；触屏没有 hover，常显。 */
  '.ss-later-row[data-ss-marker="hover"] .ss-later-mark { opacity: 0; transition: opacity 120ms ease; }',
  '.ss-later-row[data-ss-marker="hover"]:hover .ss-later-mark, .ss-later-row[data-ss-marker="hover"]:focus-within .ss-later-mark { opacity: 1; }',
  '@media (hover: none) { .ss-later-row[data-ss-marker="hover"] .ss-later-mark { opacity: 1; } }',
  '@media (prefers-reduced-motion: reduce) { .ss-later-row[data-ss-marker="hover"] .ss-later-mark { transition: none; } }',
  /* tooltip：标记左侧，带 6px 箭头。 */
  ".ss-later-mark[data-tip]:hover::after { content: attr(data-tip); position: absolute; right: calc(100% + 9px); top: 50%; transform: translateY(-50%); background: var(--dsw-alias-tooltip-bg); color: var(--dsw-alias-tooltip-label, #fff); font-size: 12px; line-height: 16px; white-space: nowrap; padding: 5px 9px; border-radius: 8px; box-shadow: 0 6px 18px rgba(0, 0, 0, .22); pointer-events: none; z-index: 3; }",
  '.ss-later-mark[data-tip]:hover::before { content: ""; position: absolute; right: calc(100% + 4px); top: 50%; width: 6px; height: 6px; transform: translateY(-50%) rotate(45deg); background: var(--dsw-alias-tooltip-bg); pointer-events: none; z-index: 3; }',
  /* 操作行：复刻官方 MessageIconActions（时间 + 复制），尺寸随宿主字号变量走。 */
  ".ss-later-actions { height: calc(28px + var(--dsh-content-font-delta, 0px)); display: flex; align-items: center; gap: 8px; }",
  ".ss-later-time { font-size: var(--dsh-content-font-size-secondary, 13px); line-height: calc(24px + var(--dsh-content-font-delta, 0px)); color: var(--dsw-alias-label-tertiary); white-space: nowrap; padding-right: 12px; font-variant-numeric: tabular-nums; }",
  ".ss-later-copy { width: calc(28px + var(--dsh-content-font-delta, 0px)); height: calc(28px + var(--dsh-content-font-delta, 0px)); border-radius: var(--dsw-radius-sm); border: none; background: transparent; color: var(--dsw-alias-label-tertiary); padding: 6px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }",
  ".ss-later-copy svg { width: calc(15px + var(--dsh-content-font-delta, 0px)); height: calc(15px + var(--dsh-content-font-delta, 0px)); }",
  ".ss-later-copy:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }",
  /* 连续两条用户消息时隐藏操作行（与官方同一条规则），悬停 / 聚焦再显示。 */
  ':is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):has(~ :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"])) .ss-later-actions { opacity: 0; transition: opacity 80ms; }',
  ':is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):has(~ :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"])):hover .ss-later-actions, :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):has(~ :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"])):focus-within .ss-later-actions { opacity: 1; }',
  "@media (prefers-reduced-motion: reduce) { .ss-later-actions { transition: none; } }",
  /* 工厂缺席时的兜底气泡：宁可不如官方好看，也不能让消息消失。 */
  ".ss-later-fallback { max-width: min(calc(var(--dsh-chat-content-width, 748px) * .702), 82%); background: var(--dsw-specific-bubble); color: var(--dsw-alias-label-primary); border-radius: var(--dsw-radius-xl); padding: 10px 16px; font-size: var(--dsh-content-font-size, 14px); line-height: calc(22px + var(--dsh-content-font-delta, 0px)); white-space: pre-wrap; word-break: break-word; }"
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

// src/client/presence.ts
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

// src/client/schedule-summary.ts
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

// src/client/schedule-facet.ts
var LATER_SCHEDULE_FACET_ID = "dsh-later.schedule";
var LATER_SCHEDULE_FACET_PROTOCOL = 1;
var GROUP_BADGE_SETTING_KEY = "showInGroupBadge";
function isGroupBadgeVisible(snapshot) {
  if (snapshot.status !== "ready") return true;
  const value = snapshot.value ?? {};
  return value[GROUP_BADGE_SETTING_KEY] !== false;
}
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
var import_react2 = require("react");

// src/client/primitives-compat.ts
var import_react = require("react");
var primitives = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
function pick(name2) {
  return primitives[name2];
}
var hostUseAnchoredPosition = pick("useAnchoredPosition");
var hostUseDismissOnOutsidePointer = pick("useDismissOnOutsidePointer");
var missingHookWarned = false;
function warnMissingHook(name2) {
  if (missingHookWarned) return;
  missingHookWarned = true;
  try {
    console.warn(
      `dsh-later: 宿主 primitives 未导出 ${name2}，面板锚定/外部点击关闭降级为静态定位与遮罩关闭。这通常意味着宿主版本不在本插件已验证的代次表内（见 src/upstream-compat.ts 的 KERNEL_GENERATIONS）。`
    );
  } catch {
  }
}
var hasOfficialOutsideDismiss = hostUseDismissOnOutsidePointer !== void 0;
var hostUseAnchoredMaxHeight = pick("useAnchoredMaxHeight");
function resolvePanelAnchorBackend(host) {
  const source = symbolTagOf(host) === "Module" ? host.default ?? host : host;
  if (typeof source.useAnchoredPosition === "function") return "hook";
  if (typeof source.useAnchoredMaxHeight === "function") return "css-anchor";
  return "static";
}
function symbolTagOf(value) {
  return value[Symbol.toStringTag];
}
var PANEL_ANCHOR_BACKEND = resolvePanelAnchorBackend(
  primitives
);
function __panelAnchorProbeForTest(host) {
  return {
    backend: resolvePanelAnchorBackend(host),
    anchorName: PANEL_ANCHOR_NAME,
    panel: cssAnchorPositionStyle({ side: "top", gap: 4, margin: 12 }, false),
    trigger: cssAnchorPositionStyle({ side: "top", gap: 4, margin: 12 }, true)
  };
}
var PANEL_ANCHOR_NAME = "--dsh-later-sched-anchor";
var ANCHORED_MAX_HEIGHT_CAP = 560;
function cssAnchorPositionStyle(geo, trigger) {
  const name2 = PANEL_ANCHOR_NAME;
  const gap = `${geo.gap}px`;
  const margin = `${geo.margin}px`;
  if (trigger) return { anchorName: name2 };
  const anchored = geo.side === "top" ? { bottom: `max(${margin}, calc(anchor(top) + ${gap}))`, top: "auto" } : { top: `max(${margin}, calc(anchor(bottom) + ${gap}))`, bottom: "auto" };
  return {
    positionAnchor: name2,
    left: `max(${margin}, anchor(left))`,
    right: "auto",
    ...anchored
  };
}
function usePanelAnchorTriggerStyle() {
  return PANEL_ANCHOR_BACKEND === "css-anchor" ? cssAnchorPositionStyle({ side: "top", gap: 0, margin: 0 }, true) : { anchorName: "auto" };
}
function usePanelAnchorPosition(options) {
  if (PANEL_ANCHOR_BACKEND === "hook" && hostUseAnchoredPosition !== void 0) {
    return hostUseAnchoredPosition(options);
  }
  const capped = hostUseAnchoredMaxHeight ?? (() => ANCHORED_MAX_HEIGHT_CAP);
  const maxHeight = capped(
    options.panelRef,
    ANCHORED_MAX_HEIGHT_CAP,
    "dsh-later-panel",
    options.margin
  );
  if (PANEL_ANCHOR_BACKEND === "hook") return null;
  if (PANEL_ANCHOR_BACKEND === "css-anchor") {
    return {
      ...cssAnchorPositionStyle(
        { side: options.side ?? "bottom", gap: options.gap, margin: options.margin },
        false
      ),
      maxHeight
    };
  }
  warnMissingHook("useAnchoredPosition / useAnchoredMaxHeight");
  return null;
}
function usePanelOutsideDismiss(root, open, setOpen, portal) {
  if (hostUseDismissOnOutsidePointer === void 0) {
    warnMissingHook("useDismissOnOutsidePointer");
    return;
  }
  hostUseDismissOnOutsidePointer(root, open, setOpen, portal);
}
var PANEL_MEASURE_STYLE = {
  visibility: "hidden",
  left: 0,
  top: 0
};
function useEscapeToClose(open, setOpen) {
  const setOpenRef = (0, import_react.useRef)(setOpen);
  setOpenRef.current = setOpen;
  (0, import_react.useEffect)(() => {
    if (!open) return void 0;
    const onKey = (event) => {
      if (event.key === "Escape") setOpenRef.current(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
}
var EmptyIcon = () => null;
function firstIcon(...candidates) {
  return candidates.find((candidate) => candidate !== void 0) ?? EmptyIcon;
}
var IconClock = firstIcon(
  pick("IconClockOutlineRegular"),
  pick("IconClockOutline16")
);
var IconCopy = firstIcon(
  pick("IconCopyOutlineRegular"),
  pick("IconCopyOutline16")
);
var IconCheck = firstIcon(
  pick("IconCheckOutlineRegular"),
  pick("IconCheckOutline16")
);
var IconClose = firstIcon(
  pick("IconCloseOutlineRegular"),
  pick("IconCloseOutline16")
);
var IconChevronDown = firstIcon(
  pick("IconChevronDownOutlineRegular"),
  pick("IconChevronDownOutline14")
);
var IconEdit = firstIcon(
  pick("IconEditOutlineRegular"),
  pick("IconEditOutline16")
);
var IconPause = firstIcon(
  pick("IconPauseOutlineRegular"),
  pick("IconPauseOutline16")
);
var IconPlay = firstIcon(
  pick("IconPlayOutlineRegular"),
  pick("IconPlayOutline16")
);
var IconSend = firstIcon(
  pick("IconSendOutlineRegular"),
  pick("IconSendOutline16")
);
var IconTrash = firstIcon(
  pick("IconTrashOutlineRegular"),
  pick("IconTrashOutline16")
);
var IconInfo = firstIcon(
  pick("IconInfoOutlineRegular"),
  pick("IconQuestionOutline14")
);
var tooltipPortalProps = { portal: true };
function FileTypeIconCompat({ path, size }) {
  const host = pick("FileTypeIcon");
  if (host !== void 0) return (0, import_react.createElement)(host, { path, size });
  const paperclip = pick("IconPaperclipOutline16");
  if (paperclip !== void 0) return (0, import_react.createElement)(paperclip, { size });
  return null;
}
function fileSizeTextCompat(bytes) {
  const host = pick("fileSizeText");
  if (host !== void 0) return host(bytes);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
async function writeClipboardCompat(text) {
  const host = pick("writeClipboard");
  if (host !== void 0) {
    try {
      return await host(text);
    } catch {
    }
  }
  try {
    const nav = globalThis.navigator;
    if (nav?.clipboard?.writeText !== void 0) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
  }
  try {
    if (typeof document === "undefined") return false;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
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
      `dsh-later: 跳过分组状态 facet 登记——对端协议版本 ${String(peerProtocol)} 与本插件实现的 v${LATER_SCHEDULE_FACET_PROTOCOL} 不一致`
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
    renderIcon: (fold) => (0, import_react2.createElement)(
      "span",
      { style: { color: facetIconColor(fold.tone), display: "inline-flex", alignItems: "center" } },
      (0, import_react2.createElement)(IconClock, { size: FACET_ICON_SIZE })
    ),
    order: LATER_SCHEDULE_FACET_ORDER
  };
  const unregister = client.registerGroupStatusFacet(facet);
  return typeof unregister === "function" ? unregister : NOOP_UNREGISTER;
}
function mountLaterScheduleFacet(input) {
  let unregister;
  const detach = () => {
    const dispose = unregister;
    if (dispose === void 0) return;
    unregister = void 0;
    dispose();
  };
  return {
    refresh() {
      if (input.enabled()) {
        if (unregister === void 0) unregister = registerLaterScheduleFacet(input);
        return;
      }
      detach();
    },
    dispose: detach
  };
}

// src/client/components/SchedButton.tsx
var import_react8 = require("react");

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
  if (diff < 0) return "已到期";
  if (diff < MINUTE_MS) return "即将发送";
  const minutes = Math.round(diff / MINUTE_MS);
  if (minutes < 60) return `约 ${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes === 0 ? `约 ${hours} 小时后` : `约 ${hours} 小时 ${restMinutes} 分后`;
  }
  const days = Math.floor(hours / 24);
  return `约 ${days} 天后`;
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
var LOCAL_CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;
var LOCAL_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
function parseLocalClock(raw) {
  if (typeof raw !== "string") return void 0;
  const m = LOCAL_CLOCK.exec(raw.trim());
  if (m === null) return void 0;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] === void 0 ? 0 : Number(m[3]);
  const millisecond = m[4] === void 0 ? 0 : Number(m[4].padEnd(3, "0"));
  if (hour > 23 || minute > 59 || second > 59) return void 0;
  return { hour, minute, second, millisecond };
}
function canonicalLocalClock(raw) {
  const parts = parseLocalClock(raw);
  if (parts === void 0) return void 0;
  const base = `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
  return parts.millisecond === 0 && !hasMillisecond(raw) ? base : `${base}.${String(parts.millisecond).padStart(3, "0")}`;
}
function hasMillisecond(raw) {
  return typeof raw === "string" && /\.\d/.test(raw);
}
function parseLocalDate(raw) {
  if (typeof raw !== "string") return void 0;
  const m = LOCAL_DATE.exec(raw.trim());
  if (m === null) return void 0;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return void 0;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return void 0;
  return { year, month, day };
}
function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

// src/client/useSchedT.ts
var import_react3 = require("react");
var noopSubscribe = () => () => {
};
function useSchedT(locale, seatT) {
  const subscribe = (0, import_react3.useCallback)(
    (onStoreChange) => locale === void 0 ? noopSubscribe() : locale.subscribe(onStoreChange),
    [locale]
  );
  const getActive = (0, import_react3.useCallback)(() => locale === void 0 ? "zh" : locale.getSnapshot().active, [locale]);
  const active = (0, import_react3.useSyncExternalStore)(subscribe, getActive);
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
function pickSmartWindowFields(raw) {
  const pick2 = (key, fallback) => isValidHhmm(raw?.[key]) ? raw[key] : fallback;
  return {
    workStart: pick2("workStart", DEFAULT_SMART_WINDOW.workStart),
    workEnd: pick2("workEnd", DEFAULT_SMART_WINDOW.workEnd),
    lunchStart: pick2("lunchStart", DEFAULT_SMART_WINDOW.lunchStart),
    lunchEnd: pick2("lunchEnd", DEFAULT_SMART_WINDOW.lunchEnd),
    eveningEnd: pick2("eveningEnd", DEFAULT_SMART_WINDOW.eveningEnd)
  };
}
function sanitizeSmartWindowConfig(raw) {
  const picked = pickSmartWindowFields(raw);
  return isValidWindow(picked) ? picked : DEFAULT_SMART_WINDOW;
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
var SMART_WINDOW_ORDER = Object.freeze([
  Object.freeze(["workStart", "lunchStart"]),
  Object.freeze(["lunchStart", "lunchEnd"]),
  Object.freeze(["lunchEnd", "workEnd"]),
  Object.freeze(["workEnd", "eveningEnd"])
]);
function firstOrderViolation(window2) {
  for (const [left, right] of SMART_WINDOW_ORDER) {
    const a = hhmmToMinutes(window2[left]);
    const b = hhmmToMinutes(window2[right]);
    if (a === void 0 || b === void 0 || a >= b) return [left, right];
  }
  return null;
}
function isValidWindow(window2) {
  return firstOrderViolation(window2) === null;
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
  const day = parseLocalDate(date);
  const clock = parseLocalClock(time);
  if (day === void 0 || clock === void 0) return void 0;
  const { year, month } = day;
  const { hour, minute, second } = clock;
  const localEpochSecond = Date.UTC(year, month - 1, day.day, hour, minute, second, 0);
  const offsets = /* @__PURE__ */ new Set();
  for (let delta = -2; delta <= 2; delta += 1) {
    offsets.add(offsetOf(localEpochSecond + delta * DAY_MS2, timeZone));
  }
  const candidates = [];
  for (const offset of offsets) {
    const candidate = localEpochSecond - offset + clock.millisecond;
    const f = localFieldsOf(candidate, timeZone);
    if (f.year === year && f.month === month && f.day === day.day && f.hour === hour && f.minute === minute && f.second === second) {
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
          " · ",
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
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconClose, { size: 14 })
        }
      )
    ] }, item.id);
  }) });
}

// src/client/useCountdown.ts
var import_react4 = require("react");
function useNow(intervalMs = 1e3) {
  const [now, setNow] = (0, import_react4.useState)(() => Date.now());
  const prevMsRef = (0, import_react4.useRef)(intervalMs);
  (0, import_react4.useEffect)(() => {
    const resuming = prevMsRef.current <= 0;
    prevMsRef.current = intervalMs;
    if (!(intervalMs > 0)) return void 0;
    if (resuming) setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// src/client/components/SchedPanel.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function atOnDay(dayOffset, hhmm, timeZone, now) {
  const time = canonicalLocalClock(hhmm);
  if (time === void 0) return null;
  const fields = localFieldsOf(now + dayOffset * 24 * 3600 * 1e3, timeZone);
  const date = `${String(fields.year).padStart(4, "0")}-${String(fields.month).padStart(2, "0")}-${String(fields.day).padStart(2, "0")}`;
  const epoch = epochFromLocal(date, time, timeZone);
  if (epoch === void 0 || Number.isNaN(epoch)) return null;
  return { at: { date, time, time_zone: timeZone }, epoch };
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
  const panelStyle = PANEL_ANCHOR_BACKEND === "static" ? { bottom } : anchored ?? PANEL_MEASURE_STYLE;
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
      const time = canonicalLocalClock(customTime);
      if (time === void 0) return null;
      const epoch = epochFromLocal(customDate, time, timeZone);
      if (epoch === void 0 || Number.isNaN(epoch) || epoch <= now) return null;
      return { at: { date: customDate, time, time_zone: timeZone }, epoch };
    }
    const option = quickOptions.find((item) => keyOf(item) === selected);
    if (option === void 0 || option.kind === "custom") return null;
    if (option.kind === "after") return { after_seconds: option.seconds, epoch: now + option.seconds * 1e3 };
    return { at: option.at, epoch: option.epoch };
  }, [selected, customDate, customTime, timeZone, now, quickOptions]);
  const targetLabel = (0, import_react5.useMemo)(() => {
    if (target === void 0 || target === null) return null;
    return `${formatAbsolute(target.epoch, timeZone, lang)} · ${formatRelative(target.epoch, now, lang)}`;
  }, [target, timeZone, now]);
  const handleConfirm = async () => {
    const text = defaultPrompt.trim();
    if (text.length === 0) {
      setError(t.errPromptEmpty);
      return;
    }
    const maxChars = promptLimits?.maxChars ?? 1e3;
    if (text.length > maxChars) {
      setError(format(t.errPromptTooLong, { maxChars }));
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
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "ss-panel-close", "aria-label": t.close, onClick: onClose, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconClose, { size: 14 }) })
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

// src/client/bubble-marker.ts
function resolveBubbleMarker(snapshot) {
  if (snapshot.status !== "ready") return "left";
  const value = snapshot.value;
  if (value === null || typeof value !== "object") return "left";
  const raw = value["bubbleMarker"];
  return raw === "off" || raw === "meta" || raw === "hover" ? raw : "left";
}
function planBubbleMarker(input) {
  if (input.style === "off") return "off";
  if (!input.nodeReady || !input.contentReady) return "wait";
  if (input.nodeSlotKind !== void 0 && input.nodeSlotKind !== "keyed") return "wait";
  if (input.registered) return "wait";
  return "register";
}

// src/client/hooks/useSchedulerSettings.ts
var CLIENT_DEFAULT_MAX_PROMPT_CHARS = 1e3;
var FALLBACK_PROMPT = {
  allowLong: false,
  maxChars: CLIENT_DEFAULT_MAX_PROMPT_CHARS
};
var FALLBACK = {
  ready: false,
  showButton: true,
  bubbleMarker: "left",
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
      bubbleMarker: "left",
      smartWindow: FALLBACK.smartWindow,
      promptLimits: FALLBACK_PROMPT
    };
  }
  const value = snap.value ?? {};
  return {
    ready: true,
    // 仅显式 false 隐藏；缺失/非法一律回退显示（与 schema 默认 true 同源）。
    showButton: value["showButton"] !== false,
    bubbleMarker: resolveBubbleMarker(snap),
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
  const anchorTriggerStyle = usePanelAnchorTriggerStyle();
  if (!showButton) return null;
  const handleCreateWithErrorBoundary = async (inputPayload) => {
    try {
      await handleCreate(inputPayload);
    } catch {
      setOpen(false);
      throw new Error(t.editErrNotAccepted);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { ref: rowRef, className: "ss-sched-row", "data-ss-sched-row": "", style: anchorTriggerStyle, children: [
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
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconClock, { size: 16 })
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
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/attachment-failure.ts
function classifyAttachmentFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /session\/attachment-invalid|not referenced by this session/i.test(message) ? "pending-send" : "unavailable";
}

// src/client/bar-geometry.ts
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
  const now = useNow(schedules.length === 0 || sessionId === void 0 ? 0 : 1e3);
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
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "ss-dock-row", "data-ss-dock-row": item.id, children: [
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
            children: saving ? "…" : t("editSave")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ss-dock-action", onClick: cancelEdit, "aria-label": t("editCancel"), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconClose, { size: 14 }) }),
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
          schedules.length === 1 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-lead", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconClock, { size: 16 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DockAttachments, { item, t, sessionId, loadImage, peekImage, localMediaUrl }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ss-dock-preview", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ss-dock-row-line", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-row-time", children: formatHhmm(epoch, detectTimeZone()) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `ss-dock-row-countdown${!isPaused && state === "overdue" ? " ss-due" : ""}`, children: countdownText }),
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
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-lead", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconClock, { size: 16 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-count", children: t("panelCount", { n: schedules.length }) }),
          !expanded && steerUnconfirmed.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-status", role: "status", children: t("statusUnconfirmed", { n: steerUnconfirmed.size }) }),
          !expanded && steerUnconfirmed.size === 0 && busy && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-status", role: "status", children: t("sending") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: expanded ? "ss-dock-chevron ss-open" : "ss-dock-chevron", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconChevronDown, { size: 14 }) })
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
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: t("editTask"), side: "bottom", delayMs: 500, ...tooltipPortalProps, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        type: "button",
        className: "ss-dock-action",
        "aria-label": t("editTask"),
        disabled: busy,
        onClick: onEdit,
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconEdit, { size: 14 })
      }
    ) }),
    paused ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: t("resumeTask"), side: "bottom", delayMs: 500, ...tooltipPortalProps, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        type: "button",
        className: "ss-dock-action",
        "aria-label": t("resumeTask"),
        disabled: busy,
        onClick: onResume,
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconPlay, { size: 16 })
      }
    ) }) : (
      /* 不可用的原因走宿主那套分工：Tooltip `disabled` 抑制气泡，原生 `title` 承载原因，
       * `aria-label` 只留动作名——避免同一句话在气泡与读屏里各念一遍。 */
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: t("pauseTask"), side: "bottom", delayMs: 500, ...tooltipPortalProps, disabled: !canPauseNow, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "button",
        {
          type: "button",
          className: "ss-dock-action",
          "aria-label": t("pauseTask"),
          title: canPauseNow ? void 0 : t("pauseUnsupportedKind"),
          disabled: !canPauseNow || busy,
          onClick: onPause,
          children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconPause, { size: 16 })
        }
      ) })
    ),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: t("deleteTask"), side: "bottom", delayMs: 500, ...tooltipPortalProps, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        type: "button",
        className: "ss-dock-action",
        "aria-label": t("deleteTask"),
        disabled: busy,
        onClick: onDelete,
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconTrash, { size: 14 })
      }
    ) }),
    item.kind !== "every" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: steerDone ? t("steerAlreadySent") : t("steerTask"), side: "bottom", delayMs: 500, ...tooltipPortalProps, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        type: "button",
        className: `ss-dock-action ss-dock-action-steer${steerDone ? " ss-done" : ""}`,
        "aria-label": steerDone ? t("steerAlreadySent") : t("steerTask"),
        disabled: busy || steerDone,
        onClick: onSteer,
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconSend, { size: 16 })
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
          block.bytes !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-file-size", children: fileSizeTextCompat(block.bytes) })
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
    name2.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-file-icon", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(FileTypeIconCompat, { path: name2, size: 16 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-file-name", children: name2 }),
    block.bytes !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ss-dock-file-size", children: fileSizeTextCompat(block.bytes) })
  ] });
}

// src/client/components/SchedulerSettingsCard.tsx
var import_react10 = require("react");

// src/client/session-presence.ts
var BADGE_CLASS = "ss-presence";
var HOVER_ROW_CLASS = "ss-hover-status";
var ADOPTED_ROW_SELECTOR = "[data-ss-adopted]";
var FIBER_MAX_DEPTH = 8;
var HOST_DOM = Object.freeze({
  /**
   * 侧栏树里的行：会话行与工作区行都会命中，靠下面的 `workspaceRowAttr` 区分。
   *
   * ⚠️ 这里原来还要求 `[draggable="true"]`，**那个假设已经被实测证伪**：0.1.7 起宿主把
   * 会话行改成 `draggable="false"`，于是只剩工作区行命中、再被排除规则剔干净，badge 在
   * 6 个受支持代次里的 4 个上整块不出现（2026-10-28 真 GUI 矩阵：selectorRows=11 /
   * badgeable=0 / badges=0，而同轮 indexSize=1 说明数据面根本没漂——纯 DOM 假设过期）。
   *
   * 现在只押**一个**假设：`aria-expanded` 区分会话行与工作区行，它在全部 6 代都成立。
   * 被删掉的 `draggable` 正是断掉的那一个。放宽后可能误命中的其它 treeitem 由
   * `sessionIdOfRow` 的 fiber 反查自然过滤——拿不到会话 id 就不标注，宁可不标也不误标。
   */
  sessionRow: '[role="treeitem"]',
  /**
   * 工作区行带这个属性、会话行不带：用它把工作区行排除掉。
   * ⚠️ 这是**排除**规则，命中即 `continue`，不是筛选条件。
   */
  workspaceRowAttr: "aria-expanded",
  /** 行首 slot 内的「进行中」orb 图标：存在即 badge 插到 slot 之后，否则塞进 slot。 */
  slotIcon: "svg",
  /**
   * 状态点的前导属性：`aria-hidden="true"` **且带 `data-state`** 才是宿主的状态点。
   *
   * ⚠️ 这里原来还要求 `dot.tagName === statusDotTag`（`'SPAN'`），**已被真 DOM 证伪**
   * （issue #153，2026-11-11，0.2.2-rc.1 真 GUI）：宿主 `StateDot` 是**按档位换元素**的——
   * 空闲出 `SPAN[data-state="idle"]`，进行中的那两条出的是 **`svg[data-state="ongoing"]`**
   * （spinner）。按标签筛的后果是：进行中的卡片里一条状态行都"认不出"，插件行连**追加**
   * 都不会发生。所以读侧只看属性，不看标签名；`statusDotTag` 这个键保留是给产出侧
   * （我们自己的点）与 `tests/presence-drift.test.mjs` 的断言用的，**不再参与识别**。
   */
  statusDotTag: "SPAN",
  statusDotAttr: "aria-hidden",
  statusDotValue: "true",
  /**
   * 状态点携带档位的属性名（结构化判据，见 {@link hostRowState}）。
   * 实测取值：`idle` / `ongoing` / `warning` / `done`（宿主 `sessionStatuses` 的闭合链）。
   */
  statusDotStateAttr: "data-state",
  /** 「空闲」那一档的结构化值：判空闲**只认它**，文案白名单是属性缺席时的退路。 */
  idleStateValue: "idle",
  /**
   * 从 body 直系浮层往下最多钻几层去找状态行容器。
   *
   * 实测层级（issue #153）：浮层 → 卡片壳 → `hoverContent`（状态行的父容器）= 2 层。
   * 留到 5 是给宿主以后多包一层留余量，同时保证「扫不到卡片就安静跳过」——
   * 深度上限是**防御**，不是把猜测范围扩大。
   */
  statusHostMaxDepth: 5,
  /**
   * 宿主 `status.idle` 的文案白名单：**只在 `data-state` 缺席时兜底**（见 {@link isIdleRow}）。
   *
   * 首选判据是结构化的——真 DOM 实测（2026-11-11 真 GUI）空闲行的状态点是
   * `SPAN[data-state="idle"]`，档位写在属性上，与界面语言无关，所以中文宿主、英文宿主
   * 走同一条判据。这份白名单存在的唯一理由是：宿主早先的代次（以及 StateDot 若哪天去掉
   * `data-state`）拿不到档位，那时只能退回文案。
   *
   * ⚠️ **这条退路有多脆弱就怎么写清楚**：八种语言的值是从宿主 bundle 的 locale 表里逐条
   * 抄下来的（`"status.idle"` 的全部取值），宿主改字、加语言、或把「空闲」换成语境不同的
   * 近义词，白名单就认不出来——后果是**退回追加**（宿主原行 + 插件行并列，即 #153 修复前
   * 的形状），属安全侧：宁可少合并，也不会把「进行中」误当空闲替换掉。
   * 反过来它也有误判面：若宿主某档位的**文案**恰好等于这里某个值而档位不是 idle，我们会
   * 替换掉不该替换的行——所以白名单只在 `data-state` 完全拿不到时启用，有属性就不看文案。
   */
  idleLabels: [
    "空闲",
    "Idle",
    "待機中",
    "inactivo",
    "Inactif",
    "Leerlauf",
    "Простой",
    "Inativo"
  ],
  /** fiber 反查：React 内部 key 的前缀与会话 id 的前缀。 */
  fiberKeyPrefix: "__reactFiber$",
  sessionIdPrefix: "session-"
});
var SCAN_DEBOUNCE_MS = 60;
var STATE_TICK_MS = 3e4;
var sidebarDriftWarned = false;
function reportSidebarDrift(remindedSessions, matched, badgeable) {
  if (sidebarDriftWarned) return;
  sidebarDriftWarned = true;
  try {
    console.warn(
      `dsh-later: 侧栏 badge 未注入——选择器 \`${HOST_DOM.sessionRow}\` 命中 ${matched} 行，但排除带 \`${HOST_DOM.workspaceRowAttr}\` 的工作区行后**可标注 0 行**（badgeable=${badgeable}），而摘要里有 ${remindedSessions} 个带定时提醒的会话。这不是「用户没有提醒」，而是本模块的结构探测对不上宿主 DOM（宿主侧栏很可能已改版）。排查只看 src/client/session-presence.ts 顶部的 HOST_DOM 耦合块：逐条核对行选择器与 ${HOST_DOM.workspaceRowAttr} 排除规则。（本轮漂移只提示一次；一旦重新有可标注行即复位，下次改版会再提示。）`
    );
  } catch {
  }
}
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
  const fiberKey = Object.keys(host).find((key) => key.startsWith(HOST_DOM.fiberKeyPrefix));
  if (fiberKey === void 0) return void 0;
  let fiber = host[fiberKey];
  for (let depth = 0; fiber !== void 0 && depth < FIBER_MAX_DEPTH; depth += 1, fiber = fiber.return) {
    const node = fiber.memoizedProps?.node;
    const id = node?.id;
    if (typeof id === "string" && id.startsWith(HOST_DOM.sessionIdPrefix)) return id;
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
    const rows = Array.from(document.querySelectorAll(HOST_DOM.sessionRow));
    const badgeable = rows.filter((row) => !row.hasAttribute(HOST_DOM.workspaceRowAttr));
    if (badgeable.length > 0) {
      sidebarDriftWarned = false;
    } else if (index.size > 0) {
      reportSidebarDrift(index.size, rows.length, badgeable.length);
    }
    for (const row of badgeable) {
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
    const beside = slot.querySelector(HOST_DOM.slotIcon) !== null;
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
      const statusHost = findStatusHost(card);
      if (statusHost === null) continue;
      const sessionId = sessionIdOfHoverCard(card);
      if (sessionId === void 0) continue;
      return { card, statusHost, sessionId };
    }
    return null;
  }
  function findStatusHost(root) {
    const limit = HOST_DOM.statusHostMaxDepth;
    const walk = (el, depth) => {
      if (depth > limit) return null;
      if (Array.from(el.children).some(isHostStatusRow)) return el;
      for (const child of Array.from(el.children)) {
        if (!(child instanceof HTMLElement)) continue;
        const found = walk(child, depth + 1);
        if (found !== null) return found;
      }
      return null;
    };
    return walk(root, 0);
  }
  function isHostStatusRow(child) {
    if (child.classList.contains(HOVER_ROW_CLASS)) return false;
    if (child.children.length < 2) return false;
    const dot = child.firstElementChild;
    if (dot === null) return false;
    if (dot.getAttribute(HOST_DOM.statusDotAttr) !== HOST_DOM.statusDotValue) return false;
    return (child.textContent ?? "").trim().length > 0;
  }
  function hostRowState(row) {
    const dot = row.firstElementChild;
    if (dot === null) return void 0;
    const raw = dot.getAttribute(HOST_DOM.statusDotStateAttr);
    return raw === null || raw === "" ? void 0 : raw;
  }
  function isIdleRow(row, allowTextFallback) {
    const state = hostRowState(row);
    if (state !== void 0) return state === HOST_DOM.idleStateValue;
    if (!allowTextFallback) return false;
    const text = (row.lastElementChild?.textContent ?? "").trim();
    return HOST_DOM.idleLabels.some((label) => text === label);
  }
  function findIdleRow(statusHost) {
    const children = Array.from(statusHost.children);
    for (let index2 = 0; index2 < children.length; index2 += 1) {
      const child = children[index2];
      const host = child;
      if (host.dataset.ssAdopted === "idle") return host;
      if (!isHostStatusRow(child)) continue;
      if (isIdleRow(child, index2 > 0)) return child;
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
      restoreIdleRow(statusHost);
      return;
    }
    const { label } = hoverScheduleStatus(entry, now, labelsFor(dict), dict, formatHhmm2, formatDate);
    const state = badgeStateFor(entry.nextAt, now);
    const idleRow = findIdleRow(statusHost);
    if (idleRow !== null) {
      existing?.remove();
      adoptIdleRow(idleRow, label, state);
      return;
    }
    restoreIdleRow(statusHost);
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
  function adoptIdleRow(row, label, state) {
    const host = row;
    const text = row.lastElementChild;
    if (host.dataset.ssAdopted !== "idle") {
      if (text !== null) host.dataset.ssIdleLabel = text.textContent ?? "";
      host.dataset.ssAdopted = "idle";
    }
    if (text !== null && text.textContent !== label) text.textContent = label;
    host.dataset.ssState = state;
  }
  function restoreAdoptedRow(row) {
    const host = row;
    if (host.dataset.ssAdopted !== "idle") return;
    const text = host.lastElementChild;
    if (text !== null) text.textContent = host.dataset.ssIdleLabel ?? "";
    delete host.dataset.ssAdopted;
    delete host.dataset.ssIdleLabel;
    delete host.dataset.ssState;
  }
  function restoreIdleRow(statusHost) {
    for (const child of Array.from(statusHost.children)) restoreAdoptedRow(child);
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
    for (const row of Array.from(document.querySelectorAll(ADOPTED_ROW_SELECTOR))) restoreAdoptedRow(row);
  };
}

// src/client/components/SchedulerSettingsCard.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function ClockIconPreview({ style }) {
  const svg = style === "classic" ? CLOCK_SVG_CLASSIC : CLOCK_SVG_MODERN;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ss-presence", "aria-hidden": "true", dangerouslySetInnerHTML: { __html: svg } });
}
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
        // 与 showButton 同为「纯显隐」：关掉只是不再向 dsh-group-status 登记 facet，
        // 提醒本身照触发。默认开（与 host Config 同源），且**只有显式 false 才关**。
        kind: "boolean",
        key: "showInGroupBadge",
        labelKey: "showInGroupBadgeLabel",
        hintKey: "showInGroupBadgeHint",
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
      {
        kind: "enum",
        key: "bubbleMarker",
        labelKey: "bubbleMarkerLabel",
        hintKey: "bubbleMarkerHint",
        options: ["left", "meta", "hover", "off"],
        defaultValue: "left"
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
var TIME_KEYS = FIELDS.flatMap((field) => field.kind === "time" ? [field.key] : []);
var ORDER_MESSAGE_ID = "ss-window-order";
function SchedulerSettingsCard({ scope, t, surface }) {
  const [snapshot, setSnapshot] = (0, import_react10.useState)(() => scope.getSnapshot());
  const [failed, setFailed] = (0, import_react10.useState)(false);
  (0, import_react10.useEffect)(() => {
    const initial = scope.getSnapshot();
    setSnapshot(initial);
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
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    SchedulerSettingsForm,
    {
      scope,
      t,
      surface,
      snapshot,
      failed,
      setFailed
    }
  );
}
function SchedulerSettingsForm({ scope, t, surface, snapshot, failed, setFailed }) {
  const [pending, setPending] = (0, import_react10.useState)({});
  const [saving, setSaving] = (0, import_react10.useState)(false);
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
    setPending({});
  }, [scope]);
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
  const windowDraft = () => {
    const raw = {};
    for (const key of TIME_KEYS) {
      const text = effectiveOf(key);
      if (text.trim().length > 0) raw[key] = text;
    }
    return pickSmartWindowFields(raw);
  };
  const orderViolation = firstOrderViolation(windowDraft());
  const orderBlocked = orderViolation !== null && TIME_KEYS.some((key) => pending[key] !== void 0);
  const isOrderFlagged = (field) => orderViolation !== null && (orderViolation[0] === field.key || orderViolation[1] === field.key);
  const handleSave = (0, import_react10.useCallback)(async () => {
    if (!dirty || saving || !writable || orderBlocked) return;
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
  }, [scope, pending, dirty, saving, writable, allowLongEnabled, orderBlocked]);
  const invalidField = (field) => {
    if (isGateLocked(field)) return null;
    const p = pending[field.key];
    if (p === void 0) return null;
    return validate(field, p.value);
  };
  const anyInvalid = FIELDS.some((field) => invalidField(field) !== null);
  const saveDisabled = !dirty || saving || !writable || anyInvalid || orderBlocked;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-settings-form", children: [
    !writable && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-hint", role: "status", children: t("readOnly") }),
    surface === "detail" && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "ss-section", "aria-labelledby": "ss-section-display-toggle", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { className: "ss-section-heading", id: "ss-section-display-toggle", children: t("sectionDisplayToggle") }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ss-section-fields", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-field", children: [
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
        const orderFlagged = isOrderFlagged(field);
        const labelKey = field.labelKey;
        const hintKey = field.hintKey;
        const userHas = isUserOverridden(field.key);
        const fieldId = `ss-${field.key}`;
        const hasLabelIcon = field.key === "clockIconStyle";
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
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ss-field", children: [
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
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { htmlFor: fieldId, className: hasLabelIcon ? "ss-card-label ss-card-label--withIcon" : "ss-card-label", children: [
                t(labelKey),
                hasLabelIcon && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ClockIconPreview, { style: displayValue(field) })
              ] }),
              helpHint && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "button",
                {
                  type: "button",
                  className: helpOpen[field.key] === true ? "ss-help-btn ss-help-btnOpen" : "ss-help-btn",
                  "aria-label": `${t(labelKey)}说明`,
                  "aria-expanded": helpOpen[field.key] === true,
                  "aria-controls": `ss-help-${field.key}`,
                  onClick: () => setHelpOpen((prev) => ({ ...prev, [field.key]: !prev[field.key] })),
                  children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(IconInfo, { size: 12 })
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
              className: invalid !== null || orderFlagged ? "ss-input ss-inputInvalid" : "ss-input",
              "aria-invalid": invalid !== null || orderFlagged || void 0,
              value: displayValue(field),
              placeholder: field.kind === "number" ? String(field.defaultValue) : void 0,
              disabled: !writable || saving || gateLocked,
              "aria-describedby": gateLocked ? `ss-gate-${field.key}` : orderFlagged ? ORDER_MESSAGE_ID : void 0,
              onChange: (event) => handleFieldEdit(field, event.target.value)
            }
          ),
          gateLocked ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-gate", id: `ss-gate-${field.key}`, role: "status", children: t("maxPromptCharsLockedHint") }) : null,
          invalid !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-invalid", role: "status", children: invalid }) : null,
          helpOpen[field.key] === true && hintKey !== void 0 && t(hintKey).length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { id: `ss-help-${field.key}`, role: "region", "aria-label": `${t(labelKey)}说明`, className: "ss-help", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: t(hintKey) }) }) : null,
          field.key === "steerDelivery" && displayValue(field) === "steer" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-risk", role: "status", children: confirmEnabled ? t("steerRiskGuarded") : t("steerRiskUnguarded") }) : null,
          field.key === "onUnconfirmed" && displayValue(field) === "discard" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-risk", role: "status", children: t("discardRisk") }) : null
        ] }, field.key);
      }) }),
      section.fields.some((field) => field.kind === "time") && orderViolation !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ss-card-invalid", id: ORDER_MESSAGE_ID, role: "status", children: t("smartWindowOrderHint") }) : null
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

// src/client/components/LaterUserMessageView.tsx
var import_react11 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/later-message-source.ts
var LATER_FIELD = "later";
function normalizeCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}
function readLaterMarker(source) {
  if (source === null || typeof source !== "object") return void 0;
  const raw = source[LATER_FIELD];
  if (raw === null || typeof raw !== "object") return void 0;
  const record = raw;
  const version = record["v"];
  if (typeof version !== "number" || !Number.isFinite(version) || version < 1) return void 0;
  return {
    v: version,
    delivery: record["delivery"] === "every" ? "every" : "one-shot",
    count: normalizeCount(record["count"])
  };
}

// src/client/components/LaterUserMessageView.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
function prepareContent(data) {
  const texts = [];
  const attachments = [];
  const rest = [];
  for (const block of data.content ?? []) {
    if (block === null || typeof block !== "object") {
      rest.push(block);
      continue;
    }
    const record = block;
    if (record["type"] === "text" && typeof record["text"] === "string") {
      texts.push(record["text"]);
    } else if (record["type"] === "image" && record["attachment"] !== void 0) {
      attachments.push({ type: "image", image: { attachment: record["attachment"] } });
    } else if (record["type"] === "file" && record["attachment"] !== void 0) {
      attachments.push({ type: "file", file: record["attachment"] });
    } else {
      rest.push(block);
    }
  }
  const text = texts.join("");
  return {
    text,
    attachments,
    extraBlocks: rest,
    ...data.referenceLabels === void 0 ? {} : { referenceLabels: data.referenceLabels }
  };
}
function pad22(value) {
  return value < 10 ? `0${value}` : String(value);
}
function startOfLocalDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
function formatClock(time, dayStart, tr) {
  const date = new Date(time);
  const clock = `${pad22(date.getHours())}:${pad22(date.getMinutes())}`;
  if (startOfLocalDay(time) === dayStart) return clock;
  const sameYear = new Date(dayStart).getFullYear() === date.getFullYear();
  const params = { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
  return `${tr(sameYear ? "clockMd" : "clockYmd", params)} ${clock}`.trim();
}
function useLocalDay() {
  const [day, setDay] = (0, import_react11.useState)(() => startOfLocalDay(Date.now()));
  (0, import_react11.useEffect)(() => {
    let timer;
    const arm = () => {
      const now = Date.now();
      setDay(startOfLocalDay(now));
      const next2 = new Date(now);
      next2.setHours(24, 0, 0, 0);
      timer = setTimeout(arm, Math.max(1e3, next2.getTime() - now));
    };
    const next = new Date(Date.now());
    next.setHours(24, 0, 0, 0);
    timer = setTimeout(arm, Math.max(1e3, next.getTime() - Date.now()));
    return () => {
      if (timer !== void 0) clearTimeout(timer);
    };
  }, []);
  return day;
}
function LaterMessageActions(props) {
  const { tr } = useSchedT(props.locale);
  const day = useLocalDay();
  const [copied, setCopied] = (0, import_react11.useState)(false);
  const timer = (0, import_react11.useRef)(void 0);
  (0, import_react11.useEffect)(
    () => () => {
      if (timer.current !== void 0) clearTimeout(timer.current);
    },
    []
  );
  const onCopy = (0, import_react11.useCallback)(() => {
    void writeClipboardCompat(props.text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (timer.current !== void 0) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1e3);
    });
  }, [props.text]);
  const clock = formatClock(props.time, day, tr);
  const label = copied ? tr("actionCopied") : tr("actionCopy");
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ss-later-actions", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ss-later-time", children: clock }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label, side: "bottom", delayMs: 500, ...tooltipPortalProps, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "ss-later-copy", "aria-label": label, onClick: onCopy, children: copied ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(IconCheck, { size: 15 }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(IconCopy, { size: 15 }) }) })
  ] });
}
function markerText(marker, clock, tr) {
  const merged = marker !== void 0 && marker.count > 1;
  return {
    aria: tr("laterMarkerAria", { time: clock }),
    tip: merged ? tr("laterMarkerTooltipBatch", { time: clock, count: marker.count }) : tr("laterMarkerTooltip", { time: clock })
  };
}
function LaterUserMessageView(props) {
  const { node, renderFactorySlot, loadImage, schedulerScope, locale } = props;
  const settings = useSchedulerSettings(schedulerScope);
  const { tr } = useSchedT(locale);
  const day = useLocalDay();
  const data = node?.data ?? {};
  const marker = readLaterMarker(data.source);
  const style = settings.bubbleMarker;
  const decorated = marker !== void 0 && style !== "off";
  const prepared = prepareContent(data);
  const stackRef = (0, import_react11.useRef)(null);
  const [markOffset, setMarkOffset] = (0, import_react11.useState)(13);
  const measure = (0, import_react11.useCallback)(() => {
    const wrap = stackRef.current;
    const stack2 = wrap?.firstElementChild;
    const first = stack2?.firstElementChild;
    if (first !== void 0 && first !== null && first.hasAttribute("data-message-attachments")) {
      setMarkOffset(first.offsetHeight + 8 + 13);
      return;
    }
    setMarkOffset(13);
  }, []);
  (0, import_react11.useLayoutEffect)(() => {
    measure();
  }, [measure, data.content, style]);
  (0, import_react11.useEffect)(() => {
    if (style !== "left" && style !== "hover") return void 0;
    if (typeof ResizeObserver === "undefined") return void 0;
    const first = stackRef.current?.firstElementChild?.firstElementChild;
    if (first === void 0 || first === null) return void 0;
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(first);
    return () => {
      observer.disconnect();
    };
  }, [measure, style, data.content]);
  const facts = (0, import_react11.useMemo)(
    () => ({
      ...data.referenceLabels === void 0 ? {} : { sessionLabels: data.referenceLabels },
      ...data.skillNames === void 0 ? {} : { skillNames: data.skillNames }
    }),
    [data.referenceLabels, data.skillNames]
  );
  const content = (0, import_react11.useMemo)(() => {
    if (renderFactorySlot === void 0) {
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "ss-later-fallback", children: prepared.text });
    }
    return renderFactorySlot(
      "conversation.chat.user.content",
      { content: prepared, loadImage, facts, interactive: true },
      { fallback: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "ss-later-fallback", children: prepared.text }) }
    );
  }, [facts, loadImage, prepared, renderFactorySlot]);
  const clock = formatClock(data.time ?? Date.now(), day, tr);
  const text = markerText(marker, clock, tr);
  const mark = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
    "span",
    {
      className: "ss-later-mark",
      role: "img",
      "aria-label": text.aria,
      "data-tip": text.tip,
      "data-ss-later-mark": "",
      style: { marginTop: `${markOffset}px` },
      children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(IconClock, { size: 16 })
    }
  );
  const stack = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "ss-later-stackwrap", ref: stackRef, children: content });
  const actions = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(LaterMessageActions, { text: prepared.text, time: data.time ?? Date.now(), locale });
  if (!decorated) {
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ss-later-row", "data-ss-later-row": "", children: [
      stack,
      actions
    ] });
  }
  if (style === "meta") {
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ss-later-row", "data-ss-later-row": "", "data-ss-marker": "meta", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ss-later-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(IconClock, { size: 13 }),
        tr("laterMarkerMeta", { time: clock })
      ] }),
      stack,
      actions
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ss-later-row", "data-ss-later-row": "", "data-ss-marker": style, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ss-later-main", children: [
      mark,
      stack
    ] }),
    actions
  ] });
}

// src/client/marker-controller.ts
var NODE_SLOT = "conversation.chat.node";
var CONTENT_PROBE_SLOT = "conversation.chat.user.images";
var NODE_KEYS = ["user", "steering"];
var SHADOW_PRIORITY = -10;
var warned = false;
function warnOnce(message) {
  if (warned) return;
  warned = true;
  try {
    console.warn(`dsh-later: 气泡标记未注册：${message}`);
  } catch {
  }
}
function mountBubbleMarker(host) {
  let nodeReady = false;
  let contentReady = false;
  let disposers = [];
  const disposeEntries = () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch {
      }
    }
  };
  const registerEntries = () => {
    const inject2 = () => ({
      schedulerScope: host.scope,
      ...host.locale === void 0 ? {} : { locale: host.locale }
    });
    for (const key of NODE_KEYS) {
      try {
        disposers.push(
          host.slots.register(
            { name: NODE_SLOT, key, priority: SHADOW_PRIORITY, inject: inject2 },
            LaterUserMessageView
          )
        );
      } catch (error) {
        warnOnce(`${NODE_SLOT}[${key}] ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const sync = () => {
    const snapshot = host.scope.getSnapshot();
    if (snapshot.status !== "ready") {
      disposeEntries();
      return;
    }
    const spec = host.slots.spec?.(NODE_SLOT);
    const plan = planBubbleMarker({
      style: resolveBubbleMarker(snapshot),
      nodeReady,
      contentReady,
      registered: disposers.length > 0,
      ...spec === void 0 ? {} : { nodeSlotKind: spec.kind }
    });
    if (plan === "register") registerEntries();
    else if (plan === "off") disposeEntries();
  };
  const offContent = host.slots.inject(CONTENT_PROBE_SLOT, () => {
    contentReady = true;
    sync();
    return () => {
      contentReady = false;
      disposeEntries();
    };
  });
  const offNode = host.slots.inject(NODE_SLOT, () => {
    nodeReady = true;
    sync();
    return () => {
      nodeReady = false;
      disposeEntries();
    };
  });
  const offScope = host.scope.subscribe(sync);
  sync();
  return () => {
    for (const stop of [offScope, offNode, offContent]) {
      if (typeof stop === "function") stop();
    }
    disposeEntries();
  };
}

// src/client/schedule-summary-store.ts
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
var import_react12 = require("react");
var EMPTY_SUMMARY = /* @__PURE__ */ new Map();
var noopSubscribe2 = () => () => void 0;
var emptySnapshot = () => EMPTY_SUMMARY;
var missingSnapshot = () => void 0;
function useScheduleSummary(store) {
  const registered = (0, import_react12.useSyncExternalStore)(subscribeScheduleSummaryStore, getScheduleSummaryStore, missingSnapshot);
  const target = store ?? registered;
  const subscribe = (0, import_react12.useMemo)(
    () => target === void 0 ? noopSubscribe2 : (listener) => target.subscribe(listener),
    [target]
  );
  const getSnapshot = (0, import_react12.useMemo)(
    () => target === void 0 ? emptySnapshot : () => target.getSnapshot(),
    [target]
  );
  return (0, import_react12.useSyncExternalStore)(subscribe, getSnapshot, emptySnapshot);
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
  let getShowInGroupBadge = () => true;
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
        title: "定时提醒",
        description: "配置会话内定时提醒的参数。",
        pendingBadge: "未保存",
        expand: "展开设置",
        collapse: "收起设置",
        readOnly: "本部署的设置为只读。",
        sectionDisplay: "显示设置",
        sectionTime: "时间设置",
        sectionDelivery: "投递设置",
        sectionAdvanced: "高级语法",
        betaBadge: "实验性",
        betaBadgeAria: "实验性功能，行为可能随版本调整",
        advancedSyntaxLabel: "启用多次写法（+1h*3 / 15:32+16:32）",
        advancedSyntaxHint: "让 /later 与 /schedule 支持一次写多条：+1h*3（等间隔 3 次）、+1h+1h+0.5h（相对序列）、15:32+16:32 与 9:00+1d（锚点序列，按墙钟推进，跨夏令时不漂）。每条都是独立任务，可单独取消或编辑；单次最多 10 条。标记为实验性：展开后的观感与条数上限仍需观察。",
        showButtonLabel: "显示定时按钮",
        showButtonHint: "关闭后输入框右侧不再显示时钟按钮；已创建的提醒仍会照常触发，并在输入框下方的待发送列表中显示。",
        showInGroupBadgeLabel: "在分组徽标中显示定时任务",
        showInGroupBadgeHint: "关闭后不再向 dsh-group-status 的折叠分组徽标登记「定时任务」这一格，徽标上不再出现定时任务计数。提醒本身照常触发，输入框下方的待发送列表与侧栏状态不受影响；未安装 dsh-group-status 时这一项没有可见效果。",
        maxSchedulesLabel: "单会话任务上限",
        maxSchedulesHint: "单个会话内允许创建的最大定时任务数量。",
        allowLongPromptsLabel: "允许长文本提醒",
        allowLongPromptsHint: "解除默认 1000 字符的上限。开启后可用「提示字符上限」自定义最大长度；关闭时该上限不生效，恒为 1000。",
        maxPromptCharsLabel: "提示字符上限",
        maxPromptCharsHint: "提醒内容最大字符数（仅在「允许长文本提醒」开启时生效）。",
        maxPromptCharsLockedHint: "开启「允许长文本提醒」后可调。",
        smartWindowHint: "用于「工作时间」芯片与智能模式自动排期。",
        /**
         * 五个时段的跨字段序关系被写反时，段尾挂这一句（同时锁住保存）。
         * 规则本身只有一份，在 `src/smart-window.ts` 的 `SMART_WINDOW_ORDER`；
         * 这里的顺序措辞必须与那张表同序——改了表要连着改这句。
         */
        smartWindowOrderHint: "五个时段需依次递增：工作时间开始 < 午休开始 < 午休结束 < 工作时间结束 < 夜间静默起点。",
        workStartLabel: "工作时间开始",
        workEndLabel: "工作时间结束（晚间开始）",
        lunchStartLabel: "午休开始",
        lunchEndLabel: "午休结束",
        eveningEndLabel: "夜间静默起点",
        steerDeliveryLabel: "插话投递方式",
        steerDeliveryHint: "「插话发送」把提醒内容推给会话时进入的队列。",
        steerDeliveryOption_followup: "独立成一轮（推荐）",
        steerDeliveryOption_steer: "插入当前回合（更快）",
        confirmDeliveryLabel: "投递确认",
        confirmDeliveryHint: "投递后核对会话日志，确认消息真正进入请求。关闭则不再核对，也不保证送达。",
        onUnconfirmedLabel: "未确认时",
        onUnconfirmedHint: "投递未能确认时的处理方式。",
        onUnconfirmedOption_keep: "保留条目可重试（推荐）",
        onUnconfirmedOption_discard: "丢弃",
        clockIconStyleLabel: "时钟图标风格",
        clockIconStyleHint: "侧栏会话行定时状态图标的显示风格。",
        clockIconStyleOption_auto: "自动（推荐）",
        clockIconStyleOption_modern: "新版描边风格",
        clockIconStyleOption_classic: "旧版点阵风格",
        steerRiskGuarded: "⚠ 撞上回合启动时可能被吞掉；已开启投递确认，未送达会保留条目并可重试。",
        steerRiskUnguarded: "⚠ 撞上回合启动时可能被吞掉，且不会保留条目（投递确认已关闭）。",
        discardRisk: "⚠ 未确认的提醒会被移出列表 —— 静默丢失将重新变得可能。",
        overriddenLabel: "已覆盖",
        resetLabel: "重置",
        invalidLabel: "请输入有效的数字。",
        invalidTimeLabel: "请使用 HH:mm 24 小时制时间。",
        save: "保存",
        saving: "保存中…",
        discard: "放弃修改",
        saveFailed: "保存失败，请重试。",
        loading: "加载中…",
        unavailable: "设置暂不可用。",
        /**
         * 详情页「在设置中显示」开关的 section 标题。
         * 取值必须与 `sectionDisplay` 不同：详情页把这两段连着渲染，同名时页面上会
         * 出现两个「显示设置」。护栏见 tests/settings-section-headings.test.mjs。
         */
        sectionDisplayToggle: "设置入口",
        showInSettings: "在设置中显示",
        showInSettingsHint: "在设置对话框中显示本插件的设置页（刷新页面后生效）"
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
        advancedSyntaxHint: "Let /later and /schedule create several tasks at once: +1h*3 (same interval N times), +1h+1h+0.5h (relative chain), 15:32+16:32 and 9:00+1d (anchored on a wall clock — it keeps the clock time across DST). Each occurrence is an independent task you can cancel or edit on its own; up to 10 per command. Marked Beta: the expanded result and the 10-task cap still need real-world observation.",
        showButtonLabel: "Show schedule button",
        showButtonHint: "Hide the clock button on the input bar. Existing reminders keep firing and stay visible in the dock below the composer.",
        showInGroupBadgeLabel: "Show scheduled in group badge",
        showInGroupBadgeHint: `Stop registering the "Scheduled" cell on dsh-group-status's folded-group badge, so its count disappears. Reminders keep firing and stay visible in the dock below the composer and in the sidebar; this row has no visible effect when dsh-group-status is not installed.`,
        maxSchedulesLabel: "Max schedules per session",
        maxSchedulesHint: "Maximum number of scheduled reminders allowed per session.",
        allowLongPromptsLabel: "Allow long reminder prompts",
        allowLongPromptsHint: 'Lift the default 1000-character cap. Once enabled, "Max prompt characters" lets you set a custom ceiling; while disabled that ceiling has no effect and stays at 1000.',
        maxPromptCharsLabel: "Max prompt characters",
        maxPromptCharsHint: 'Maximum characters per reminder (takes effect only when "Allow long reminder prompts" is on).',
        maxPromptCharsLockedHint: 'Adjustable after enabling "Allow long reminder prompts".',
        smartWindowHint: "Used by the Work-hours chip and smart auto-scheduling.",
        // 与 zh 那条同序：措辞就是 `SMART_WINDOW_ORDER` 那张表的读法。
        smartWindowOrderHint: "The five windows must increase in order: work start < lunch start < lunch end < work end < night quiet.",
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
        steerRiskGuarded: "⚠ May be swallowed when it collides with turn start; delivery confirmation is on, so an undelivered reminder is kept and can be retried.",
        steerRiskUnguarded: "⚠ May be swallowed when it collides with turn start, and the reminder will NOT be kept (delivery confirmation is off).",
        discardRisk: "⚠ Unconfirmed reminders are removed from the list — silent loss becomes possible again.",
        overriddenLabel: "Overridden",
        resetLabel: "Reset",
        invalidLabel: "Please enter a valid number.",
        invalidTimeLabel: "Use 24-hour HH:mm format.",
        save: "Save",
        saving: "Saving…",
        discard: "Discard",
        saveFailed: "Save failed, please try again.",
        loading: "Loading…",
        unavailable: "Settings unavailable.",
        sectionDisplayToggle: "Settings entry",
        showInSettings: "Show in settings",
        showInSettingsHint: "Show this plugin's settings page in the settings dialog (refresh to take effect)"
      }
    }), "dsh-later: locale");
  }
  const facetMount = mountLaterScheduleFacet({
    store: summary,
    scheduledWord: () => dictFor(locale?.getSnapshot().active).facetScheduled,
    enabled: () => getShowInGroupBadge()
  });
  ctx.effect(
    () => {
      facetMount.refresh();
      return () => facetMount.dispose();
    },
    "dsh-later: group status facet"
  );
  const attachBadgeVisibility = (scope) => {
    getShowInGroupBadge = () => isGroupBadgeVisible(scope.getSnapshot());
    ctx.effect(
      () => scope.subscribe(() => facetMount.refresh()),
      "dsh-later: facet visibility setting"
    );
    facetMount.refresh();
  };
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
  const localMediaUrl = (path) => fileMediaUrlCompat(document.baseURI, path);
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
  let markerMounted = false;
  const mountMarker = (scope) => {
    if (markerMounted) return;
    markerMounted = true;
    ctx.effect(
      () => mountBubbleMarker({
        slots,
        scope,
        ...locale === void 0 ? {} : { locale }
      }),
      "dsh-later: bubble marker"
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
      return active === "en" ? "Session Scheduler" : "定时提醒";
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
    attachBadgeVisibility(scope);
    mountComposer(scope);
    mountMarker(scope);
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
    attachBadgeVisibility(scope);
    mountComposer(scope);
    mountMarker(scope);
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
