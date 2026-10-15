/**
 * dsh-later client 端：会话输入框右侧的「定时提醒」按钮 + 面板。
 *
 * 数据流：
 *  - 读状态：`useProjection('userSchedules')`（宿主会话投影实时推送）。
 *  - 写状态：`session.command('/user-schedule-create ...')` 等 slash 命令
 *    直达宿主（命令 handler 与工具共享同一套 user-tools 领域逻辑）。
 *
 * 零核心改动，纯插件挂载：注册 `conversation.input.right` 插槽条目
 * （order 50，紧跟附件/语音之后、发送按钮之前）。
 *
 * rc.7 兼容性：所需服务通过模块级 `inject` 数组声明（fiber 激活门控），
 * apply 内用 `ctx.get(name)` 读取；缺失时静默跳过（不阻塞会话其他能力）。
 *
 * 设置服务两代双轨：0.1.7 的 settings rewrite 删掉了浏览器端 `settingsScope`，
 * 配置面改由 `configForms` 提供（同名 namespace 的表单，快照/写入形状一致），
 * 设置页卡片插槽也从 `settings.plugin.item` 换到 Plugins 页的
 * `plugins.bundle.config`。两条轨道各注册一次、先到先得，因此 `settingsScope`
 * **不进**顶层 `inject`（否则会在新 harness 下永久 pending），只在嵌套
 * `ctx.inject([...])` 里按需等待。
 *
 * Context 服务类型增强在 `./runtime-augment.d.ts`：声明 `slots`/`sessions`/
 * `settingsScope`/`configForms`/`locale` 的最小契约，避免引入 `@deepseek-ai/dsh-client-*`
 * 这一族浏览器运行时包作为 NPM 依赖（它们是宿主注入产物，pnpm 解析预发布版
 * 会带来 hoisting/range 噪音）。
 * @module dsh-later/client
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ClientConfigForm, ClientSettingsScope } from './runtime-augment.js';
import { name } from '../domain.js';
import { injectStyles } from './styles.js';
import { SchedButton } from './components/SchedButton.js';
import { ScheduleDock } from './components/ScheduleDock.js';
import { SchedulerSettingsCard } from './components/SchedulerSettingsCard.js';
import type { SchedButtonInjected } from './components/SchedButton.js';
import type { ScheduleDockInjected } from './components/ScheduleDock.js';
import type { CommandOutcome } from '../command-outcome.js';
import { mountSessionPresence, type PresenceLocaleLike } from './session-presence.js';
import {
  createScheduleSummaryStore,
  getScheduleSummaryStore,
  setActiveScheduleSummaryStore,
  type ScheduleSummarySessionsLike,
} from '../schedule-summary-store.js';

/** Filled slot：输入框右侧工具行。 */
const INPUT_RIGHT_SLOT = 'conversation.input.right';

/** 所需服务：插槽注册 + 会话解析（命令通道需要 session face）。设置服务另走
 *  嵌套 `ctx.inject` 双轨等待，不在此列（见文件头）。 */
const inject = ['slots', 'sessions', 'conversation', 'locale'];

/** Locale 字典命名空间（locale 命名空间允许点分）。 */
const NS = 'settings.plugins.later';

/** Settings 命名空间（必须与 host 端注册的字符串一致：dsh-later）。 */
const SETTINGS_NS = 'dsh-later';

/**
 * profile 里的**条目 id**（`cordis.patch.yml` 的 `id: later`）。
 *
 * 0.1.7+ 的 settings rewrite 用条目 id 而非 namespace 寻址表单：
 * - `configForms.get(entryId)`
 * - `SettingsForms.describe()` 的 `ns: entry.options.id`
 *
 * 用错不会报错，只会让设置页空白 —— 故与 `SETTINGS_NS` 分开命名、各司其职。
 */
const ENTRY_ID = 'later';

/**
 * 浏览器插件主体。
 * @param ctx - client 根上下文。
 */
/**
 * 浏览器插件主体。
 * @param ctx - client 根上下文。
 */
function apply(ctx: Context): void {
  const slots = ctx.get('slots');
  const sessions = ctx.get('sessions');
  const locale = ctx.get('locale');
  if (slots === undefined || sessions === undefined) return;

  // 样式注入（卸载清理）。
  ctx.effect(() => injectStyles(), 'dsh-later: styles');

  // 设置服务两代双轨：获取 clockIconStyle 设置
  // auto 模式根据 DSH 版本自动选择：0.2.0+ 用新版，0.1.x 用旧版
  // 检测方式：有 configForms 服务 = 0.2.0+，否则 = 0.1.x
  let detectedVersion: 'modern' | 'classic' = 'classic';
  let getClockIconStyle: () => 'auto' | 'modern' | 'classic' = () => 'auto';

  // 定时摘要 store（issue #17）：全插件唯一的定时任务数据权威。本插件的侧栏
  // badge 与外部插件（dsh-group-status 等，经 `require('dsh-later/client')`）
  // 读同一份摘要，因此 GroupLiveStatus 与行内 badge 永不漂移。
  // 卸载时先撤销登记再 dispose，避免消费方拿到已释放的 store。
  const summary = createScheduleSummaryStore(sessions as unknown as ScheduleSummarySessionsLike);
  setActiveScheduleSummaryStore(summary);
  ctx.effect(
    () => () => {
      if (getScheduleSummaryStore() === summary) setActiveScheduleSummaryStore(undefined);
      summary.dispose();
    },
    'dsh-later: schedule summary',
  );

  // 侧栏会话行「定时状态」badge（docs/ui/09 路线 B）：数据源为上面的摘要 store
  // （store 内部订阅 sessions.list 的行级 projectionValues——session.list 基线
  // 覆盖全会话，当前会话由投影帧实时推进——并周期 refresh() 读 RPC 补时效）。
  // 服务缺失时静默跳过。
  ctx.effect(
    () =>
      mountSessionPresence({
        summary,
        ...(locale === undefined ? {} : { locale: locale as unknown as PresenceLocaleLike }),
        getClockIconStyle: () => {
          const style = getClockIconStyle();
          if (style === 'auto') return detectedVersion;
          return style;
        },
      }),
    'dsh-later: presence',
  );

  // 注册 locale 字典
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, {
      zh: {
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
        betaBadge: 'Beta',
        betaBadgeAria: 'Beta 功能，行为可能随版本调整',
        advancedSyntaxLabel: '启用多次写法（+1h*3 / 15:32+16:32）',
        advancedSyntaxHint:
            '让 /later 与 /schedule 支持一次写多条：+1h*3（等间隔 3 次）、+1h+1h+0.5h（相对序列）、'
            + '15:32+16:32 与 9:00+1d（锚点序列，按墙钟推进，跨夏令时不漂）。每条都是独立任务，'
            + '可单独取消或编辑；单次最多 10 条。标记为 Beta：展开后的观感与条数上限仍需观察。',
        showButtonLabel: '显示定时按钮',
        showButtonHint: '关闭后输入框右侧不再显示时钟按钮；已创建的提醒仍会照常触发，并在输入框下方的待发送列表中显示。',
        maxSchedulesLabel: '单会话任务上限',
        maxSchedulesHint: '单个会话内允许创建的最大定时任务数量。',
        allowLongPromptsLabel: '允许长文本提醒',
        allowLongPromptsHint:
          '解除默认 1000 字符的上限。开启后可用「提示字符上限」自定义最大长度；关闭时该上限不生效，恒为 1000。',
        maxPromptCharsLabel: '提示字符上限',
        maxPromptCharsHint: '提醒内容最大字符数（仅在「允许长文本提醒」开启时生效）。',
        maxPromptCharsLockedHint: '开启「允许长文本提醒」后可调。',
        smartWindowHint: '用于「工作时间」芯片与智能模式自动排期。',
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
        sectionDisplayToggle: '显示设置',
        showInSettings: '在设置中显示',
        showInSettingsHint: '在设置对话框中显示本插件的设置页（刷新页面后生效）',
      },
      en: {
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
        advancedSyntaxHint:
            'Let /later and /schedule create several tasks at once: +1h*3 (same interval N times), '
            + '+1h+1h+0.5h (relative chain), 15:32+16:32 and 9:00+1d (anchored on a wall clock — '
            + 'it keeps the clock time across DST). Each occurrence is an independent task you can '
            + 'cancel or edit on its own; up to 10 per command. Marked Beta: the expanded result and '
            + 'the 10-task cap still need real-world observation.',
        showButtonLabel: 'Show schedule button',
        showButtonHint: 'Hide the clock button on the input bar. Existing reminders keep firing and stay visible in the dock below the composer.',
        maxSchedulesLabel: 'Max schedules per session',
        maxSchedulesHint: 'Maximum number of scheduled reminders allowed per session.',
        allowLongPromptsLabel: 'Allow long reminder prompts',
        allowLongPromptsHint:
          'Lift the default 1000-character cap. Once enabled, "Max prompt characters" lets you set a custom ceiling; while disabled that ceiling has no effect and stays at 1000.',
        maxPromptCharsLabel: 'Max prompt characters',
        maxPromptCharsHint: 'Maximum characters per reminder (takes effect only when "Allow long reminder prompts" is on).',
        maxPromptCharsLockedHint: 'Adjustable after enabling "Allow long reminder prompts".',
        smartWindowHint: 'Used by the Work-hours chip and smart auto-scheduling.',
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
        sectionDisplayToggle: 'Display',
        showInSettings: 'Show in settings',
        showInSettingsHint: 'Show this plugin\'s settings page in the settings dialog (refresh to take effect)',
      },
    }), 'dsh-later: locale');
  }

  /**
   * 执行一条 slash 命令（解析会话 face → command()）。
   *
   * 注意：commands 框架的 admission 语义只回 `{matched}`，handler 的业务结果
   * **不**经此返回（它落在会话记录里）。因此这里只能回答「是否受理」，调用方
   * 不得据此判断「业务是否真的发生了」——状态以 `userSchedules` 投影为准。
   */
  const callCommand: SchedButtonInjected['callCommand'] = async (sessionId, line) => {
    const actx = sessions.scope(sessionId as never);
    const face = actx === undefined ? undefined : sessions.sessionOf(actx);
    if (face === undefined) return { matched: false };
    try {
      const result = await face.command(line);
      return { matched: result?.ok === true && result.value?.matched === true };
    } catch {
      return { matched: false };
    }
  };

  // 待发送提醒 dock（对齐 QueueDock 呈现；排在排队消息之后）。只依赖命令通道，
  // 不依赖设置服务，因此在顶层无条件注册。
  ctx.slots.inject(
    'conversation.input.dock',
    () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'later-dock',
          order: 30,
          inject: () => ({ callCommand, locale } as ScheduleDockInjected),
        },
        ScheduleDock,
      ),
  );

  /** 输入框按钮是否已挂载：两条设置轨道只会命中一条，重复挂载会出现两颗按钮。 */
  let composerMounted = false;

  /**
   * 挂载输入框右侧按钮（其面板订阅智能时段配置，故需要设置 scope）。
   * @param scope - 本插件 namespace 的设置面（旧 `settingsScope` 或新 `configForms`）。
   */
  const mountComposer = (scope: ClientSettingsScope | ClientConfigForm): void => {
    if (composerMounted) return;
    composerMounted = true;
    ctx.slots.inject(
      INPUT_RIGHT_SLOT,
      () =>
        ctx.slots.register(
          {
            name: INPUT_RIGHT_SLOT,
            id: 'later',
            order: 50,
            inject: () => ({ callCommand, locale, schedulerScope: scope } as SchedButtonInjected),
          },
          SchedButton,
        ),
    );
  };

  /** 设置卡文案取值器；locale 服务缺失时卡片不注册（按钮自带回退，仍可挂载）。 */
  const cardT = locale === undefined ? undefined : locale.bind(NS);

  /** 设置页卡片声明（两代 harness 仅插槽名不同）。 */
  const cardDeclaration = (slot: string, scope: ClientSettingsScope | ClientConfigForm, surface: 'detail' | 'settings' = 'detail') => ({
    name: slot,
    id: SETTINGS_NS,
    order: 30,
    key: SETTINGS_NS,
    locale: NS,
    label: () => {
      const active = locale === undefined ? 'zh' : locale.getSnapshot().active;
      return active === 'en' ? 'Session Scheduler' : '定时提醒';
    },
    inject: () => ({ scope, t: cardT, surface }),
  });

  // 旧 harness（≤ 0.1.5）：浏览器端 settingsScope + 设置页 settings.plugin.item。
  ctx.inject(['settingsScope'], () => {
    const binder = ctx.get('settingsScope');
    if (binder === undefined) return;
    // 旧版本（0.1.x）使用旧版点阵时钟
    detectedVersion = 'classic';
    const scope = binder.bind({ namespace: SETTINGS_NS });
    // 更新 getClockIconStyle 函数，从 scope 中读取 clockIconStyle 设置
    getClockIconStyle = () => {
      const snap = scope.getSnapshot();
      if (snap.status !== 'ready') return 'auto';
      const value = (snap.value ?? {}) as Record<string, unknown>;
      const style = value['clockIconStyle'];
      return style === 'modern' || style === 'classic' ? style : 'auto';
    };
    mountComposer(scope);
    if (cardT === undefined) return;
    // 设置对话框中的设置页：默认不显示，由插件详情页的开关控制。
    // 开关状态存储在 localStorage 中，key 为 'dsh-later:show-settings-section'。
    const SHOW_SETTINGS_KEY = 'dsh-later:show-settings-section';
    const showSettingsSection = typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_SETTINGS_KEY) === 'true';
    if (!showSettingsSection) return;
    const disposeSection = ctx.slots.inject('settings.section', () =>
      ctx.slots.register(cardDeclaration('settings.section', scope, 'settings'), SchedulerSettingsCard),
    );
    if (typeof disposeSection === 'function') {
      ctx.effect(() => () => {
        disposeSection();
      });
    }
  });

  // 新 harness（0.1.7+ settings rewrite）：configForms 表单 + Plugins 页
  // `plugins.bundle.config` 卡片。该插槽由宿主按「条目确被服务」渲染，故用
  // whileServed 等宿主 describe 里出现本插件**条目 id** 再注册（撤服时连带注销）。
  //
  // ⚠️ 寻址键是**条目 id**（`cordis.patch.yml` 的 `id: later`），不是 settings
  // namespace（'dsh-later'）：`configForms.get(entryId)` 与 describe() 的
  // `ns: entry.options.id` 都用条目 id。宿主 describe() 直接从
  // `entry.fiber.runtime.Config` 生成表单，而 `ns` 即条目 id——用错会静默拿到
  // 空表单（设置页空白、无报错）。这正是 0.2.0 下卡片不显示的原因之一。
  ctx.inject(['configForms'], () => {
    const forms = ctx.get('configForms');
    if (forms === undefined || typeof forms.get !== 'function' || typeof forms.whileServed !== 'function') return;
    // 新版本（0.2.0+）使用新版描边时钟
    detectedVersion = 'modern';
    const scope = forms.get(ENTRY_ID);
    // 更新 getClockIconStyle 函数，从 configForms scope 中读取 clockIconStyle 设置
    getClockIconStyle = () => {
      const snap = scope.getSnapshot();
      if (snap.status !== 'ready') return 'auto';
      const value = (snap.value ?? {}) as Record<string, unknown>;
      const style = value['clockIconStyle'];
      return style === 'modern' || style === 'classic' ? style : 'auto';
    };
    mountComposer(scope);
    if (cardT === undefined) return;
    ctx.effect(
      () =>
        forms.whileServed([ENTRY_ID], () =>
          ctx.slots.inject('plugins.bundle.config', () =>
            ctx.slots.register(cardDeclaration('plugins.bundle.config', scope, 'detail'), SchedulerSettingsCard),
          ),
        ),
      'dsh-later: plugins-page card',
    );
    // 设置对话框中的设置页：默认不显示，由插件详情页的开关控制。
    // 开关状态存储在 localStorage 中，key 为 'dsh-later:show-settings-section'。
    const SHOW_SETTINGS_KEY = 'dsh-later:show-settings-section';
    const showSettingsSection = typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_SETTINGS_KEY) === 'true';
    if (!showSettingsSection) return;
    const disposeSection = ctx.slots.inject('settings.section', () =>
      ctx.slots.register(cardDeclaration('settings.section', scope, 'settings'), SchedulerSettingsCard),
    );
    if (typeof disposeSection === 'function') {
      ctx.effect(() => () => {
        disposeSection();
      });
    }
  });
}

export { apply, inject, name };

// ── 跨插件公共 API（issue #17）──────────────────────────────────────────────
//
// 消费方（如 dsh-group-status）在 package.json 声明
// `"dsh.client": { "external": ["dsh-later"] }` 后，在客户端 factory 里
// `require('dsh-later/client')` 即可拿到下面这组导出：
//
//   const later = require('dsh-later/client')
//   const store = later.getScheduleSummaryStore()          // 可能为 undefined（未加载）
//   later.summarizeScheduleGroup(store.getSnapshot(), ids) // 分组聚合
//
// 或直接读 React hook：`later.useScheduleSummary()`。
export {
  buildScheduleSummary,
  schedulesOfProjection,
  summarizeScheduleGroup,
} from '../schedule-summary.js';
export {
  createScheduleSummaryStore,
  getScheduleSummaryStore,
  subscribeScheduleSummaryStore,
} from '../schedule-summary-store.js';
export { useScheduleSummary } from './useScheduleSummary.js';
export type {
  GroupScheduleSummary,
  ScheduleSummaryEntry,
  ScheduleSummaryMap,
  ScheduleSummarySource,
} from '../schedule-summary.js';
export type {
  ScheduleSummarySessionsLike,
  ScheduleSummaryStore,
  ScheduleSummaryStoreOptions,
} from '../schedule-summary-store.js';
