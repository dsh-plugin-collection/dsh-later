/**
 * dsh-later 宿主入口。
 *
 * 挂载职责：
 *  1. 注册 `userSchedules` 会话投影（GUI 读取任务列表的权威状态）；
 *  2. 注册 slash 命令（客户端 → host 的创建/删除/列表变更通道）；
 *  3. 为每个 root agent 注册用户工具 `user_schedule_create/list/delete`
 *     （PRD「用户工具（底层暴露）」，模型亦可调用，与 dsh-schedule 双入口互补）。
 *  4. 把随包分发的 `SKILL.md` 注册进 skills 服务（可选面：装配里没有该服务时静默跳过）。
 *
 * 依赖顺序：作为 peer 依赖的 dsh-schedule 需先加载（其 agent-runtime 负责
 * 到期 dispatch + followup 注入；本插件只负责「用户接口层」）。
 * @module dsh-later
 */
import type { Context } from '@deepseek-ai/cordis';
import s from '@deepseek-ai/schemastery';
import type z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenericCallView, ToolCallKind } from '@deepseek-ai/dsh-tools/presentation';
import type {} from '@deepseek-ai/dsh-session-projection';
// Type-only：把 ctx.settings 的 Context merge 引入本程序（两代内核都有该包）。
import type {} from '@deepseek-ai/dsh-settings';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
// Type-only：把 ctx.attachments 的 Context merge 引入本程序（同上两行的用法）。
// 只为拿到 `AttachmentStore.imageHostPath` 的真实签名，不新增运行时依赖。
import type {} from '@deepseek-ai/dsh-attachment';
import { setImageHostPathResolver } from './projection.js';
import { registerUserSchedulesProjection } from './projection-registration.js';
import { registerUserScheduleCommands } from './commands.js';
import { UserScheduleRuntime } from './runtime.js';
import {
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_MAX_SCHEDULES,
  resolvePromptLimits,
  userScheduleCreate,
  userScheduleDelete,
  userScheduleList,
} from './user-tools.js';
import type { PromptLimits, UserScheduleCreateInput } from './user-tools.js';
import { name, SETTINGS_NAMESPACE } from './domain.js';
import { DEFAULT_SMART_WINDOW } from './smart-window.js';
import { checkKernelIdentityAtStartup } from './kernel-identity.js';
import { createRuntimeRegistry } from './runtime-registry.js';
import { createExpirySweeper, resolveScheduledAtFromLog } from './expiry-sweeper.js';
import { listOwnershipSnapshots } from './ownership-store.js';
import { isDueIndex } from './due.js';
import { isRootAgent, liveRootAgents, readDelegationDepth, readOwnEvents } from './upstream-compat.js';
import { hostDictFor } from './strings.js';
import { registerBundledSkill } from './skill.js';
import type { SkillHostLike } from './skill.js';

/** 插件配置 schema（全可选，默认开箱即用；经 cordis config 覆盖）。 */
/**
 * 插件配置 schema（**单一事实来源**）。
 *
 * 0.2.0 起 `ctx.settings.describe()` 直接读 `entry.fiber.runtime.Config`
 * （见 dsh-settings `schema(entry)`：「`entry.fiber?.runtime?.Config`，且需有
 * `toJSON`」），据此生成该插件设置页的表单。因此**可编辑字段必须全部声明在
 * `Config` 上**——只放在 `SchedulerSettingsSchema` 里的字段在 0.2.0 下不会
 * 出现在设置 UI 中。
 *
 * 历史：0.1.5 用 `settingsProvider.register(ns, schema, …)` 注册一个**独立于
 * Config 的** schema（即 `SchedulerSettingsSchema`），0.1.7 删除了该 API。
 * 两代并存期间两份 schema 内容一致，现统一为 `Config` 一份，`SchedulerSettingsSchema`
 * 保留为别名以免大范围改动调用点。
 */
/**
 * `.volatile()` 的降级调用：**schemastery 3.18.4 起才有**这个方法。
 *
 * 0.1.5 线的安装树装的是 schemastery **3.18.2**，真机上整条插件加载失败：
 * `s.object(...).volatile is not a function`（`verify-across-kernels --steps mount` 在
 * 0.1.5-rc.3 上复现）。这不是本插件的抽象问题，是那个包少了一个方法。
 *
 * 老内核上退化成**普通 schema**，代价只有一个：`advancedSyntax` 这类字段会被**持久化**
 * （新内核上 `.volatile()` 标的是"不落盘"）。它是布尔开关，写进 profile 也无害，
 * 所以选择"降级"而不是"老内核完全不加载插件"。
 *
 * 判定按**方法是否存在**（能力探测，不是代次推断）：`.volatile()` 的有无不影响任何业务分支，
 * 它只是 schema 的模式标记。
 * @param schema - `s.object({...})` 得来的 schema。
 * @returns 支持时 `.volatile()` 的结果，否则原样返回。
 */
function volatileIfSupported(schema: z): z {
  const candidate = schema as z & { volatile?: () => z };
  return typeof candidate.volatile === 'function' ? candidate.volatile() : schema;
}

const configSchema: z = s.object({
  /** 单 session 用户任务上限。 */
  maxSchedules: s.number().step(1).min(1).default(DEFAULT_MAX_SCHEDULES),
  /** 是否解除提示字符的默认上限（1000）；关闭时 maxPromptChars 不生效。 */
  allowLongPrompts: s.boolean().default(false),
  /** 提示字符上限（≥1 整数）；仅在 allowLongPrompts=true 时生效。 */
  maxPromptChars: s.number().step(1).min(1).default(DEFAULT_MAX_PROMPT_CHARS),
  /** 是否显示输入框右侧的定时按钮（仅 GUI 显隐；提醒触发与 dock 不受影响）。 */
  showButton: s.boolean().default(true),
  /**
   * 是否在 dsh-group-status 的折叠分组徽标里显示「定时任务」这一格（issue #83）。
   *
   * 关闭的实现是**不向对端登记 facet**：对端 #37 把协议里的 `settingKey` 废弃之后，
   * 「登记即显示，不注册即不显示」是唯一规则，显隐只能由状态所有者自己执行。
   * 与 `showButton` 同为纯显隐：提醒照常触发，dock 与侧栏状态不受影响；对端未安装时
   * 这一项没有可见效果（那本来就没有徽标可关）。
   */
  showInGroupBadge: s.boolean().default(true),
  /**
   * 插话投递方式（「插话发送」把提醒内容推给 agent 时进哪个队列）。
   *
   * - `followup`：入 `next-turn`，**独立成一轮**（等价于「正常发送」）。`next-turn`
   *   与 `next-step` 是两条独立队列，核心的 `claim('next-step', …)` 不触碰它，
   *   因此**不存在**与 `turn/start` 竞争而被吞的窗口。默认。
   * - `steer`：入 `next-step`，在下一个 step 边界消费，更快；但若插话恰好撞上
   *   `turn/start`，核心的 `claim` 会把整批 `next-step` 取走并交给一个**请求上下文
   *   已定**的 step，消息会落进 surface 却不进实际请求 —— 静默丢失（实测复现见
   *   runtime.steerById 注释）。
   */
  steerDelivery: s.union([s.const('followup'), s.const('steer')]).default('followup'),
  /**
   * 投递确认：投递后核对会话日志中是否出现该 message id。
   *
   * 关闭则恢复 fire-and-forget（不读日志、不保证送达）。
   */
  confirmDelivery: s.boolean().default(true),
  /**
   * 投递未确认时的处理。
   *
   * - `keep`：**不写 dispatch**，条目留在 active 可重试（配合确认默认开启，使
   *   `steer` 由「会丢」降级为「需重试」）。默认。
   * - `discard`：按旧语义写 dispatch 出列 —— 注意这会让静默丢失重新变得可能，
   *   仅供明确需要旧行为的场景。
   */
  onUnconfirmed: s.union([s.const('keep'), s.const('discard')]).default('keep'),
  /**
   * 时钟图标风格。
   *
   * - `auto`：按 DSH 内核版本自动选择（0.2.0+ 用新版官方描边风格，0.1.x 用旧版点阵风格）。默认。
   * - `modern`：强制使用新版官方描边风格（24×24 stroke 圆头线帽）。
   * - `classic`：强制使用旧版点阵风格（10×10 fill 方块 crispEdges）。
   */
  clockIconStyle: s.union([s.const('auto'), s.const('modern'), s.const('classic')]).default('auto'),
  /**
   * 定时消息气泡标记的档位（issue #112）。
   *
   * - `off`：不注册渲染器，官方 user/steering 行原样工作。
   * - `left`：气泡左外侧常显一个时钟（默认）。
   * - `meta`：气泡上方一行 12px 文案。
   * - `hover`：与 `left` 同位置，行悬停/聚焦时淡入。
   *
   * 只在 0.2.1+ 生效：那一代起才有 `conversation.chat.user.content` 工厂与
   * `renderFactorySlot` 席位；老代次客户端不注册（能力门禁，不按版本号猜）。
   */
  bubbleMarker: s
    .union([s.const('off'), s.const('left'), s.const('meta'), s.const('hover')])
    .default('left'),
  /**
   * 智能时段的五个边界（HH:mm）。设置卡的「时间设置」段渲染的就是这五项，
   * 面板的「今天晚间 / 明天早上 / 智能」三枚芯片与 `nextSmartTarget` 消费的就是这五个值。
   *
   * **这五个字段为什么必须写在 `Config` 上**（issue #19）：卡片一直在写这五个 key，
   * 但 `Config` 里一个都没有，于是设置层的快照永远不会带上它们，客户端
   * `sanitizeSmartWindowConfig` 的 `pick` 逐项落空 → 面板恒用默认时段，用户的改动
   * 不报错、不生效、也不消失（最难发现的一类）。声明在 `Config` 上是两代内核唯一的
   * 落地路径：0.2.0 的 `describe()` 只从 `entry.fiber.runtime.Config` 生成表单，
   * 0.1.5 的 `settingsProvider.register()` 传的也是同一个对象
   * （{@link SchedulerSettingsSchema} 只是别名）。反向门禁见
   * `tests/settings-schema-coverage.test.mjs`：卡片可写字段 ⊆ `Config.dict` 键集。
   *
   * **只声明 `s.string()`，不加 `.pattern()` 做格式校验**，两个理由：
   *  1. 这五个值之间有**跨字段**的序关系（见 `SMART_WINDOW_ORDER`），per-field 的
   *     schema 约束表达不了；把格式放这里、把序关系放别处，等于同一份输入有两套
   *     「什么算合法」，迟早漂移。
   *  2. `.pattern()` 在这条依赖链上并非到处都有。`.volatile()` 已经在 0.1.5 线的
   *     schemastery 3.18.2 上缺过一次，缺的后果是**整个插件不加载**（见
   *     {@link volatileIfSupported}）。格式判定放在消费端的
   *     {@link import('./smart-window.js').sanitizeSmartWindowConfig} 里，任何代次都
   *     是同一份行为，而且非法值的降级（逐项回落 + 序关系不成立则整体回落）与
   *     格式校验天然在同一处、同一个函数里说完。
   *
   * 默认值直接取 `DEFAULT_SMART_WINDOW`：卡片与算法共用那一份常量，这里再抄一遍
   * 字面量就是第三个事实来源。
   */
  workStart: s.string().default(DEFAULT_SMART_WINDOW.workStart),
  workEnd: s.string().default(DEFAULT_SMART_WINDOW.workEnd),
  lunchStart: s.string().default(DEFAULT_SMART_WINDOW.lunchStart),
  lunchEnd: s.string().default(DEFAULT_SMART_WINDOW.lunchEnd),
  eveningEnd: s.string().default(DEFAULT_SMART_WINDOW.eveningEnd),
  /**
   * 高级语法（**Beta**，默认开启）：`/later` 与 `/schedule` 的多次写法。
   *
   * 覆盖三种写法：等间隔重复 `+1h*3`、相对链式序列 `+1h+1h+0.5h`、绝对锚点序列
   * `15:32+16:32` / `9:00+1d`。标 Beta 的理由不是"没测"（38 个单测已覆盖），而是
   * **展开语义还没被真实使用验证过**：一次命令写 10 条任务会不会刷屏 dock、
   * 60 秒地板与 10 条上限的尺度是否合适，都需要一段观察期。
   *
   * 关闭后这些写法被**明确拒绝**并提示来设置页开启——不会退回"静默建成一条乱码"
   * 的旧行为：那是 bug，不属于可回退的功能面。残片守卫（`15:32*3`、`+1h..3h`）
   * 与本开关无关，始终生效。
   */
  advancedSyntax: s.boolean().default(true),
});

/** 插件配置 schema（0.1.5 的 schemastery 没有 `.volatile()`，见上面的降级说明）。 */
export const Config: z = volatileIfSupported(configSchema);

/**
 * 0.1.5 时代 settings namespace 注册所用的 schema。
 *
 * 与 {@link Config} 同源（同一 schema 对象）：0.1.5 的
 * `settingsProvider.register()` 需要显式传入，而 0.2.0 的 `describe()` 只认
 * `Config`。保留此别名让两代共用一份定义，避免两份 schema 漂移。
 */
const SchedulerSettingsSchema = Config;

/**
 * 所需服务（延后激活，缺失时插件不加载）。
 *
 * ⚠️ 这里**只能列 host 平面存在的服务**。`locale` 是 client 侧服务
 * （`@deepseek-ai/dsh-client-locale`），在 agent/host 平面上永远不出现：一旦列进
 * 这份顶层 inject，cordis 的激活门控会让整个入口永久 `pending`，日志表现为
 * `later (dsh-later): pending (waiting for service: locale)`，连带 `/later`、
 * `/schedule`、`/user-schedule-*` 全部消失（b7fc4b7 就这么炸过一次）。
 * 需要语言时走 `ctx.get('locale')?.getSnapshot().active`——那三处消费点本来就是
 * 可选链，拿不到就走默认语言，而不是让整个插件不加载。
 * 同一条纪律在本仓 client 入口的文件头也写着（`src/client/index.tsx`：「**不进**
 * 顶层 `inject`，否则会永久 pending」）。
 */
export const inject = ['agents', 'sessions', 'tools', 'commands', 'settings'];

/** 解析配置（容错非法值回落默认）。 */
function resolveMaxSchedules(value: number | undefined): number {
  if (typeof value !== 'number' || value < 1) return DEFAULT_MAX_SCHEDULES;
  return Math.floor(value);
}

/** 宿主持有的 settings 形状（settings getter 返回值与 register* 接受入参）。 */
export interface SchedulerSettings {
  readonly maxSchedules: number;
  readonly allowLongPrompts: boolean;
  readonly maxPromptChars: number;
  /** 插话投递方式（见 Config.steerDelivery）。 */
  readonly steerDelivery: UserScheduleSteerDelivery;
  /** 是否核对投递是否真正送达。 */
  readonly confirmDelivery: boolean;
  /** 投递未确认时：保留可重试 / 丢弃。 */
  readonly onUnconfirmed: UserScheduleOnUnconfirmed;
  /** 时钟图标风格（auto / modern / classic）。 */
  readonly clockIconStyle: 'auto' | 'modern' | 'classic';
  /** 高级语法（Beta）：多次写法是否可用。默认开。 */
  readonly advancedSyntax: boolean;
}

/**
 * settings 原始值（未经规整）：三条代次轨道的入参形状。
 * 全部可选 —— 配置可能只声明了部分字段，或宿主尚未填充默认值。
 */
interface SettingsRawValue {
  readonly maxSchedules?: number;
  readonly allowLongPrompts?: boolean;
  readonly maxPromptChars?: number;
  readonly steerDelivery?: string;
  readonly confirmDelivery?: boolean;
  readonly onUnconfirmed?: string;
  readonly clockIconStyle?: string;
  readonly advancedSyntax?: boolean;
}

/**
 * 0.2.0 `SettingsForms.describe()` 返回行的最小面。
 *
 * `ns` 是 **profile 条目 id**（`cordis.patch.yml` 的 `id`），不是 settings
 * namespace —— 见 dsh-settings `describe()` 的 `ns: entry.options.id`。
 */
interface SettingsDescriptorLike {
  readonly ns: string;
  readonly value?: unknown;
}

/**
 * 本插件在 profile 里的**条目 id**。
 *
 * 必须与 `cordis.patch.yml` 的 `id:` 一致：0.2.0 的 `configForms.get(entryId)`
 * 与 `SettingsForms.describe()` 的 `ns` 都用条目 id 寻址，用错会静默拿不到
 * 表单/值（设置页空白，无报错）。
 */
const ENTRY_ID = 'later';

/** 插话投递方式。 */
export type UserScheduleSteerDelivery = 'followup' | 'steer';

/** 投递未确认时的处理。 */
export type UserScheduleOnUnconfirmed = 'keep' | 'discard';

/** 根据 settings 计算当前生效的提示字符上限（与 user-tools.resolvePromptLimits 同源）。 */
function resolveSchedulerPromptLimits(settings: SchedulerSettings): PromptLimits {
  return resolvePromptLimits({
    allowLongPrompts: settings.allowLongPrompts,
    maxPromptChars: settings.maxPromptChars,
  });
}

/** 纯泛化等待卡片（GenericCallView）。 */
function present(title: string, kind: ToolCallKind, rawInput?: unknown): GenericCallView {
  return {
    card: 'generic',
    title,
    kind,
    ...(rawInput === undefined ? {} : { rawInput }),
  };
}

/** 渲染工具结果：JSON 文本。 */
function renderText(_args: unknown, value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }];
}

/**
 * 为单个 root agent 注册 `user_schedule_*` 工具。
 *
 * 导出仅为可测性：注册半途失败必须拆掉已成注册，这条只能直接驱动本函数才验得到
 * （走完整 `apply` 要假的 cordis 上下文全套，成本高到没人写，于是这条纪律历史上
 * 从来没被测过——正是不测的原因）。宿主入口不消费它。
 */
export function registerUserScheduleTools(
  rootCtx: Context,
  toolCtx: Context,
  agent: Agent,
  getSettings: () => SchedulerSettings,
  getLocale: () => string | undefined,
  onUserChange: (agent: Agent) => boolean,
): () => void {
  /**
   * 已成功注册的工具撤销句柄。
   *
   * 为什么要有这个队列：`tools.register` 的返回是「拆掉这一个」的 disposer，而注册
   * 副作用**先于**返回值生效。原先写成数组字面量
   * `const disposers = [register(A), register(B), register(C)]`，三个 register 会在
   * 字面量求值时**全部执行完**才绑定给 `disposers`——于是第 2 个抛错时第 1 个已经进了
   * 宿主注册表，却没有任何句柄能拆它。catch 里原先调的 `dispose` 又是个
   * `() => undefined` 占位，等于什么都不做，然后把错误重抛出去。后果是之后每次
   * attach 都撞 `already registered`，该会话永久拿不到 runtime（正是
   * `runtime-registry.ts` 模块头警告的那类事故）。
   *
   * 现在改成登记「待注册的工厂」再逐个执行、逐个入账，半途失败可拆干净。
   */
  const disposers: Array<() => void> = [];

  /** 倒序撤销已成注册；可重复调用，第二次起是空操作。 */
  const unwind = (): void => {
    for (const disposeOne of disposers.splice(0, disposers.length).reverse()) {
      try {
        disposeOne();
      } catch {
        /* 尽力而为：一个拆不掉不该阻断其余拆除，否则漏拆的比拆掉的更多 */
      }
    }
  };

  /** 逐个注册并即时登记句柄（不要在字面量里一次算完，理由见上）。 */
  const registerAll = (entries: ReadonlyArray<() => () => void>): void => {
    for (const entry of entries) disposers.push(entry());
  };

  try {
    const t = hostDictFor(getLocale());
    // 注意：这里**不再**取注册时刻的 maxChars 快照。工具 description 与 parameters
    // 是注册时算一次的静态串，而注册发生在挂载时（hydrate 挂载的会话早于设置注入），
    // 快照会永久停留成旧值 ⇒ 描述与实际校验口径可能不一致。改由文案本身说明「上限随设置
    // 变化、错误文案给出实际值」，实际判定仍在 user-tools.validatePrompt（每次调用现读）。
    /**
     * 重驱该 agent 的调度器。
     * @returns 调度器是否在位（false == 这条提醒不会被触发，必须告诉用户）。
     */
    const armScheduler = (target: Agent): boolean => {
      try {
        return onUserChange(target);
      } catch {
        /* 通知失败不影响工具结果 */
        return false;
      }
    };
    registerAll([
      () => toolCtx.tools.register(
        defineTool({
          name: 'user_schedule_create',
          // description 在每次 register 时按当前 settings + locale 生成：
          // 模型看到的字符上限始终与宿主实际校验一致，避免描述与实现脱节。
          description: t.toolCreateDesc,
          parameters: {
            prompt: {
              type: 'string',
              required: true,
              description: t.paramPromptDesc,
            },
            after_seconds: { type: 'number', description: t.paramAfterSecondsDesc },
            every_seconds: { type: 'number', description: t.paramEverySecondsDesc },
            at: {
              description: t.paramAtDesc,
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    date: { type: 'string', required: true },
                    time: { type: 'string', required: true },
                    time_zone: { type: 'string', required: true },
                  },
                },
              ],
            },
            time_zone: { type: 'string', description: t.paramTimeZoneDesc },
          },
          output: {
            schema: { type: 'string' },
            render: renderText,
          },
          async execute(args: UserScheduleCreateInput, exec) {
            if (exec.agent !== agent) return JSON.stringify({ ok: false, code: 'internal_error', message: hostDictFor(getLocale()).errToolAgentMismatch });
            const settings = getSettings();
            const result = await userScheduleCreate(
              args,
              agent,
              rootCtx,
              settings.maxSchedules,
              undefined,
              resolveSchedulerPromptLimits(settings),
            );
            if (result.ok) {
              // 调度器不在位就如实标注：返回 ok:true 却永远等不到投递，是 #71 里
              // 这个 bug 最贵的部分（安静）。warning 不改 ok，调用方仍可继续用 id。
              return JSON.stringify(
                armScheduler(agent) ? result : { ...result, warning: t.warnSchedulerNotArmed },
              );
            }
            return JSON.stringify(result);
          },
          presentCall: (args) => present(t.presentCreate, 'other', (args as { prompt?: unknown })?.prompt),
        }),
      ),
      () => toolCtx.tools.register(
        defineTool({
          name: 'user_schedule_list',
          description: t.toolListDesc,
          parameters: {},
          output: {
            schema: { type: 'string' },
            render: renderText,
          },
          async execute(_args, exec) {
            if (exec.agent !== agent) return JSON.stringify({ ok: false, code: 'internal_error', message: hostDictFor(getLocale()).errToolAgentMismatch });
            const result = await userScheduleList(agent);
            return JSON.stringify(result);
          },
          presentCall: () => present(t.presentList, 'read'),
        }),
      ),
      () => toolCtx.tools.register(
        defineTool({
          name: 'user_schedule_delete',
          description: t.toolDeleteDesc,
          parameters: {
            id: { type: 'string', required: true, description: t.paramIdDesc },
          },
          output: {
            schema: { type: 'string' },
            render: renderText,
          },
          async execute(args: { id: string }, exec) {
            if (exec.agent !== agent) return JSON.stringify({ ok: false, code: 'internal_error', message: hostDictFor(getLocale()).errToolAgentMismatch });
            const result = await userScheduleDelete(args.id, agent, rootCtx);
            if (result.ok && result.deleted) {
              try {
                onUserChange(agent);
              } catch {
                /* 通知失败不影响结果 */
              }
            }
            return JSON.stringify(result);
          },
          presentCall: (args) => present(t.presentDelete, 'other', (args as { id?: unknown })?.id),
        }),
      ),
    ]);
    return unwind;
  } catch (error) {
    unwind();
    rootCtx.logger.warn(`later: user tools 注册失败: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Cordis 函数插件主体。
 * @param ctx - 全局服务上下文。
 * @param config - 可选配置（maxSchedules）。
 */
/**
 * 冷唤醒的「用户最近动过这条会话」标记（只在本进程内存里，不落盘）。
 *
 * 为什么要它：宿主级扫描器会在**没人打开会话**时把 agent 拉起来。如果用户刚刚主动把某个
 * 会话的 agent 关掉（或刚打开、正要自己操作），扫描器的"帮忙"就是打扰。这里用「监听会话
 * 生命周期」的口径兜住：本进程里被 dispose 的、或最近被打开过的会话，两个扫描周期内
 * （{@link COLD_WAKE_QUIET_MS}）不主动拉起。跨进程的场景由 diff 口径兜住（见
 * `canWakeColdSession`）。
 */
interface UserWatch {
  /** sessionId → 最近一次「用户动作」的时刻（epoch ms）。 */
  readonly recent: Map<string, number>;
  /**
   * sessionId → 被静默期挡下的到期条目（issue #11b 的修正）。
   *
   * 静默期的语义是「别主动去**打开**一个用户刚碰过的会话」，**不是**「到期任务可以不发」。
   * 把两者混在一起，就成了"有一条到期了，因为它刚被关过，所以谁都不知道它没发"——
   * 正是本仓一直在清理的那类安静失败。所以挡下来的每一条都在这里留痕，由扫描器取走并
   * 报成 `undelivered`（原因 `quiet-window`），下次到期重排时重试。
   */
  readonly suppressed: Map<string, Set<string>>;
}

/** 用户动作后的静默期：两个扫描周期（120s）内不**主动**冷唤醒。 */
const COLD_WAKE_QUIET_MS = 120_000;

/**
 * 建一份用户动作表。
 *
 * ⚠️ 这里**只造表、不挂监听**。曾经把 `ctx.on('agent/disposed', …)` 放在这里，而本函数在
 * `apply()` 顶层被调用——那一刻 fiber 还是 `LOADING`，`ctx` 是根上下文，cordis 会把这种
 * 作用域外的注册**立刻拆掉**（实测：`ctx.on` 返回了、事件也 emit 了，回调一次都没进）。
 * 结果静默期从未生效过。现在监听由调用方在 `ctx.effect` 里挂，跟着 fiber 的命走。
 */
function createUserWatch(): UserWatch {
  return {
    recent: new Map<string, number>(),
    suppressed: new Map<string, Set<string>>(),
  };
}

/**
 * 把会话生命周期事件接进用户动作表（**必须在 `ctx.effect` 里调用**，见 {@link createUserWatch}）。
 *
 * 只挂 `agent/disposed`，**不挂** `agent/created`：后者是「谁在什么时机给会话挂 runtime」的
 * 事件，本插件在那里只有一个消费者（`later.userToolsLifecycle()`），再挂一个会让那条接线
 * 从"唯一判定点"退化成"多处判定"。而这里真正要的信息（用户刚动过这个会话）也只缺
 * disposed 这一半：冷启动时 live agent 天然不存在，扫描器要的就是"没人碰过它"。
 *
 * 监听失败绝不能影响插件加载——它只影响「要不要再等一会儿」，等不到就按默认（可唤醒）。
 * @param ctx - 宿主上下文（effect 作用域内的）。
 * @param watch - 用户动作表。
 * @returns 撤销函数（由 `ctx.effect` 负责调用，这里只是 shape 对齐）。
 */
function watchSessionLifecycle(ctx: Context, watch: UserWatch): () => void {
  const note = (sessionId: unknown): void => {
    if (typeof sessionId === 'string' && sessionId.length > 0) watch.recent.set(sessionId, Date.now());
  };
  // 事件名与载荷形状两代一致（`{ agent }`）。
  try {
    return ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => note(agent?.id)) as unknown as () => void;
  } catch {
    /* 事件面缺席：静默退化 */
    return () => undefined;
  }
}

/**
 * 判断一个会话是否**允许**被宿主级扫描器冷唤醒（决策 D3 的拒绝面）。
 *
 * 三条拒绝理由，每条都有实证/上下文：
 *  1. **被委托子会话**（`delegationDepth > 0`）：上游对子会话的 reminder 投递一律拒绝
 *     （`session/agent-busy`，见 schedule 的 `reminderTargetRefusal`）。它的提醒本就不该由
 *     本插件投递；拉起来只会白跑一轮 turn 再失败。
 *  2. **非 root**：宿主不把它当顶层 agent ⇒ runtime 挂不上 ⇒ 唤醒等于白拉。冷会话在
 *     这里看到的是「此刻没有对应 agent」，属于正常现象，不算拒绝。
 *     （0.2.2-rc.1 及更早由 `ctx.agents.roots()` 回答，rc.2 起宿主删了该方法，改由
 *     `isRootAgent` 的深度判据回答——见 upstream-compat。）
 *  3. **用户刚动过**（{@link COLD_WAKE_QUIET_MS} 内）：给"我刚关掉，你别又打开"留出静默期。
 *     注意这是**优先级最低**的一条：前两条（子会话 / 非 root）是「叫醒了也投不出去」，
 *     这一条只是「现在别打开」。被它挡下的到期任务必须留痕（见 `UserWatch.suppressed`）。
 * @param ctx - 宿主上下文。
 * @param sessionId - 候选会话。
 * @param watch - 用户动作表。
 * @returns 可唤醒返回 true。
 */
export function canWakeColdSession(ctx: Context, sessionId: string, watch?: UserWatch): boolean {
  if (coldWakeRefusal(ctx, sessionId) !== undefined) return false;
  return !isQuiet(sessionId, watch);
}

/**
 * 「叫醒也没用」的硬拒绝（与时间无关）：被委托子会话、或此刻是非 root 的活体 agent。
 * @param ctx - 宿主上下文。
 * @param sessionId - 候选会话。
 * @returns 拒绝原因；可唤醒时为 undefined。`quiet-window` **不**是硬拒绝（见下）。
 */
export function coldWakeRefusal(ctx: Context, sessionId: string): 'subagent' | 'not-root' | undefined {
  let live: Agent | undefined;
  try {
    live = ctx.agents.get(sessionId as never);
  } catch {
    return 'not-root';
  }
  if (live === undefined) return undefined;
  // root 判定统一走 `isRootAgent`：0.2.2-rc.1 及更早用宿主 `roots()`（逐字行为），
  // rc.2 起宿主删掉了 `roots()`，改读会话头的 `delegationDepth`（判据链见 upstream-compat）。
  // 深度判据本身已经覆盖了 `delegationDepth > 0` 的那些，但仍单列一条 `'subagent'`：
  // 两个拒绝理由对用户/诊断是不同的事实（子会话 vs 非顶层），不能压成一个。
  if (readDelegationDepth(live) > 0) return 'subagent';
  return isRootAgent(ctx.agents, live as Agent) ? undefined : 'not-root';
}

/**
 * 这个会话在 sidecar 里是否有一条**已经过期**的条目（与 live / 静默期无关的硬事实）。
 *
 * 为什么用它、而不是问 runtime：真宿主里 `agent.dispose()` 之后内核会把会话日志封口，
 * `foldUserState` 折出来的 `active` 变成 0（实测 0.2.1-rc.2），runtime 于是说不出"到期"。
 * sidecar 是本插件自己写的断点索引，不随会话生命周期变化——它是这个问题唯一可靠的答案。
 * @param sessionId - 候选会话。
 * @returns 存在已过期条目时为 true。
 */
function hasOverdueEntry(sessionId: string): boolean {
  try {
    const snapshot = listOwnershipSnapshots().find((entry) => entry.sessionId === sessionId);
    if (snapshot === undefined) return false;
    const now = Date.now();
    // 索引面那一版的同一判据（`due.ts`）。⚠️ 不能用 `isDue`：已投递的条目（带消化标记）
    // 在这里不能再算"到期"，否则静默期会让路给一条根本不需要再投的提醒（#139 的另一面）。
    // 时刻缺失/非法一律不算到期，回算在读侧另外那一处做。
    return Object.values(snapshot.entries).some((entry) => isDueIndex(entry, now));
  } catch {
    return false;
  }
}

/** 会话是否处于「用户刚动过」的静默期内（{@link COLD_WAKE_QUIET_MS}）。 */
function isQuiet(sessionId: string, watch?: UserWatch): boolean {
  const lastTouch = watch?.recent.get(sessionId);
  return lastTouch !== undefined && Date.now() - lastTouch < COLD_WAKE_QUIET_MS;
}

/**
 * 释放冷唤醒句柄的两个参数（完整取舍见 `docs/design-decisions.md` D1）。
 * 轮询 50ms；上限 30s，**超时就留着**——句柄留在表里的代价是内存，而在投递收敛之前
 * 拆掉它的代价是用户那条提醒。
 */
const COLD_WAKE_RELEASE_POLL_MS = 50;
const COLD_WAKE_RELEASE_WAIT_MS = 30_000;

/** agent 是否「没有 turn 在跑」（跨代次 duck-typing：认不出的形状按空闲处理）。 */
function isAgentIdle(agent: Agent): boolean {
  return (agent as unknown as { status?: unknown }).status !== 'running';
}

/**
 * 叫醒之后释放**我们自己**创建的 agent 句柄（issue #140；为何必须释放、为什么不释放
 * 路径一、以及它与「同会话第二条又到点」的竞态，都写在 `docs/design-decisions.md` D1）。
 *
 * 三条硬约束，代码上各自对应一处判断：
 *  - 句柄归属：`ctx.agents.get(sessionId)` 必须仍是本次唤醒拿到的那个实例，否则用户或
 *    宿主已经接管，本插件没有拆它的资格（宁可留热）；
 *  - 收敛判据：agent 空闲 **且** 索引面里这个会话已无到期条目（`hasOverdueEntry` 走
 *    `isDueIndex`，已消化的条目不算到期）——两条同时成立才拆，否则就是在 `driveOnce`
 *    写完 dispatch 之前把 agent 连它的 `runMaintenance` 一起端掉；
 *  - 自造的用户动作要抹掉：我们自己的 `dispose()` 会发 `agent/disposed`，而那个监听把它
 *    当成「用户刚关过」；静默期的语义是"别打扰用户刚碰过的会话"，插件收尾不是打扰。
 *
 * @param handle - `agents.resume` 交回的能力型句柄；没有它就没有任何释放动作。
 */
async function releaseWokenAgent(
  ctx: Context,
  sessionId: string,
  agent: Agent,
  handle: { dispose?: () => unknown } | undefined,
  watch?: UserWatch,
): Promise<void> {
  if (handle === undefined || typeof handle.dispose !== 'function') return;
  const deadline = Date.now() + COLD_WAKE_RELEASE_WAIT_MS;
  for (;;) {
    // 插件正在拆：本次 apply 的 teardown 会 `unmountAll()`，这里不插第二手。
    if (stopping) return;
    let current: Agent | undefined;
    try {
      current = ctx.agents.get(sessionId as never);
    } catch {
      return;
    }
    if (current !== agent) return;
    if (isAgentIdle(agent) && !hasOverdueEntry(sessionId)) break;
    if (Date.now() >= deadline) {
      // 没收敛 ⇒ **故意留热**并喊一声：不喊就等于这条边界不存在（D1）。
      ctx.logger.warn(
        `later: 会话 ${sessionId} 唤醒后 ${Math.round(COLD_WAKE_RELEASE_WAIT_MS / 1000)}s 内未收敛，` +
          `本次不释放（提醒不能因为收尾而丢）；下次到期或收敛后再释放。`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, COLD_WAKE_RELEASE_POLL_MS));
  }
  try {
    await handle.dispose();
  } catch (error) {
    ctx.logger.warn(
      `later: 释放冷唤醒的会话句柄失败（不影响本次投递）: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  if (watch !== undefined) watch.recent.delete(sessionId);
}

/**
 * 叫醒一个冷会话（决策 D3）：先惰性取 `sessionController`，拿不到回退 `agents.resume`。
 *
 * 两条路径都不进顶层 `inject`（见 apply 里 3b 的注释）。失败一律**不外抛**：抛出去会被
 * 扫描器记成一次失败并退避——那是对的；但这里更希望把"一条都不通"的情况也变成一次
 * 可读的 `undelivered` 告警，而不是一个没头没尾的异常。
 *
 * ⚠️ 唤醒**有代价**（决策 D1 明确接受）：冷 resume 会真建 agent 并跑出一轮 turn；无 provider
 * 时那轮以 `turn/end` 错误收尾（`agent "…" has no provider/model`）。扫描器用退避 + 上限
 * 兜住"反复投不出去"的情形，这里不额外做业务判断。
 * @param ctx - 宿主上下文。
 * @param sessionId - 要叫醒的会话。
 * @param registry - runtime 注册表（`mount` 幂等，重驱走原有链路）。
 * @param watch - 用户动作表。
 */
async function wakeColdSession(
  ctx: Context,
  sessionId: string,
  registry: { mount(agent: Agent): unknown; drive(agent: Agent): boolean },
  watch?: UserWatch,
): Promise<void> {
  let agent: Agent | undefined;
  /**
   * 本次唤醒拿到的**能力型句柄**（issue #140）。只有路径二会给句柄；路径一交回的是控制器
   * 持有的 agent，为 `undefined` 就是"不释放"——那是正确行为，不是漏做（取舍见 D1）。
   */
  let handle: { dispose?: () => unknown } | undefined;
  // 路径一：web profile 的会话控制器（`dsh-web-app` 挂载时才存在）。
  let controller: { resolveAgent?(id: string): Promise<unknown> } | undefined;
  try {
    controller = ctx.get('sessionController') as typeof controller;
  } catch {
    controller = undefined;
  }
  if (controller !== undefined && typeof controller.resolveAgent === 'function') {
    const resolved = await controller.resolveAgent(sessionId);
    if (resolved !== undefined && resolved !== null && typeof resolved === 'object' && 'agent' in resolved) {
      // `{ error }` 形状：会话控制器自己拒绝（子会话 / 不存在 / 写者持有），回退第二条路径。
      const candidate = resolved as { agent?: Agent; error?: unknown };
      if (candidate.error === undefined) agent = candidate.agent;
    } else {
      agent = resolved as Agent;
    }
  } else {
    // 路径二：非 web profile（CLI/ACP 等）没有会话控制器，直接走 agents.resume。
    const agents = ctx.agents as unknown as {
      resume?: (options: { resumeSessionId: string }) => Promise<unknown>;
    };
    if (typeof agents.resume === 'function') {
      const resumed = (await agents.resume({ resumeSessionId: sessionId })) as
        | { agent?: Agent; dispose?: () => unknown }
        | Agent
        | undefined;
      if (resumed !== undefined && resumed !== null && 'agent' in resumed) {
        const owned = resumed as { agent?: Agent; dispose?: () => unknown };
        agent = owned.agent;
        handle = owned;
      } else {
        agent = resumed as Agent;
      }
    }
  }
  if (agent === undefined) {
    // 两条路都不通：记 undelivered，**不在这里重试**（扫描器侧有退避与上限，避免重试风暴）。
    ctx.logger.warn(
      `later: 会话 ${sessionId} 的提醒已到期但无法叫醒（sessionController 与 agents.resume 都不可用），` +
        `本轮记为 undelivered；该会话被打开时会立即补投。`,
    );
    return;
  }
  // 回到「有人打开会话」的同一条链路：mount 幂等，attach 里会 requestDrive。
  //
  // 这里清掉静默标记是**有意的**：既然本次已经决定唤醒并真的叫起来了，那这条会话就不再是
  // 「用户刚关掉、先别碰」的状态——留着它只会让下一轮扫描继续把它当静默期内的条目挡住。
  // （反过来不成立：`agent/disposed` **不能**一律当成用户动作，见 `createUserWatch`。）
  if (watch !== undefined) {
    watch.recent.delete(sessionId);
    watch.suppressed.delete(sessionId);
  }
  // 无条件重驱一次。
  //
  // 原实现写成 `if (mounted === undefined) registry.drive(agent)`——但 `mount()` 成功后
  // **返回**的是 runtime 而不是 undefined（`runtime-registry.ts` 的 `mount` 结尾
  // `return runtime`），于是条件恒假，冷唤醒之后从来没有真正驱动过投递。表现是：
  // 会话被拉起来了（日志里有 `session` 事件），但 `agent/inbox/spliced` 与 `dispatch`
  // 永远不出现，扫描器随后报「唤醒后提醒仍然到期」。
  //
  // 「0.1.2…0.2.2-alpha.2 九代为什么是绿的」已经查清，不需要再猜（issue #144 第 4 条）：
  // 恒假 guard 是 `8a74442`（2026-11-05 13:21）写测试时带进来的，比 #11b 的落地
  // `9c586e5`（同日 12:50）还晚半小时；而它在 `9867852`（2026-11-06 10:41）就被改掉了，
  // 从未进入任何发布版本。所以那九代矩阵跑的是**修复后**的代码，绿是真绿——
  // 这条缺陷只在开发树里活了一天，随后以 1.12.1 之前的形态被修掉。
  registry.mount(agent);
  const driven = registry.drive(agent);
  if (!driven) {
    ctx.logger.warn(
      `later: 会话 ${sessionId} 已被唤醒，但 runtime 未能驱动（root 判定未命中），` +
        `本轮按未投递处理；该会话被打开时会立即补投。`,
    );
  }
  /**
   * 收尾：释放**我们自己**叫起来的会话（issue #140）。刻意**不 await**：`wake()` 的 promise
   * 是扫描器的 in-flight 标记，把它吊到"这轮 turn 跑完"会让整个 turn 期间无法清算、扫描器
   * 每秒空转排下一次尝试。释放任务只是投递事实的**读者**，不参与判定。
   */
  if (handle !== undefined) {
    const releasing = releaseWokenAgent(ctx, sessionId, agent, handle, watch);
    void releasing.catch((error: unknown) => {
      ctx.logger.warn(
        `later: 冷唤醒后的释放任务异常（不影响本次投递）: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}

/**
 * 这条会话此刻是否已有活着的 root agent（= 已有 runtime 武装着自己的 timer）。
 *
 * 为什么扫描器要先问这一句：live 会话的到点投递是 runtime 的**既有职责**，它靠自己的
 * `setTimeout` 在毫秒级触发；扫描器的低频 tick 只会在它已经投完之后再看到同一批 sidecar
 * 条目，届时 `wake` 若还是去 `agents.resume`，就会把**刚被 dispose 的那个会话**又拉起来
 * 一轮——对 live 会话而言这是纯粹的多余唤醒（也正是"不回归"那条测试钉住的东西）。
 * 有 agent 时交给 runtime，扫描器不动手。
 * @param ctx - 宿主上下文。
 * @param sessionId - 候选会话。
 * @returns 有活着的 root agent 时为 true。
 */
function hasLiveRootAgent(ctx: Context, sessionId: string): boolean {
  let live: Agent | undefined;
  try {
    live = ctx.agents.get(sessionId as never);
  } catch {
    return false;
  }
  if (live === undefined) return false;
  return isRootAgent(ctx.agents, live as Agent);
}

/** 插件卸载中的标记（避免继续接受新 agent 挂载）。 */
let stopping = false;

export function apply(ctx: Context, config?: { maxSchedules?: number }): void {
  // P0-2：cordis 在配置变更/重载时会 teardown 后再次 apply。stopping 是模块级
  // 标志，若不复位，第二次 apply 起所有 agent 都会在 agent/created 处早退，
  // 用户工具与调度器静默不挂载（GUI 无按钮、提醒永不触发）。
  stopping = false;

  // yml 启动配置仅在首次解析时生效（与运行时用户设置正交，参见
  // dsh-smooth-stream 等同款做法）：用户在设置页保存的值走自己的 user 层，
  // 不与 yml base 混合。命令/工具每次调用通过 getSettings() 按需读取设置层的
  // maxSchedules（设置未保存则回退 yml/默认）。
  const startMaxSchedules = resolveMaxSchedules(config?.maxSchedules);

  // 0. 内核模块同源护栏（issue #57）：link: 开发态下插件可能解析到自己的
  //    @deepseek-ai/dsh-* 实例（自己 node_modules/.pnpm），而宿主用的是 dsh
  //    安装目录那份，两份模块级状态互不可见。历史上这里还有一步「把自有会话
  //    事件类型 add 进 KNOWN_SESSION_EVENT_TYPES」的读兼容注册，已随 #58 移除：
  //    上游明确否决了事件名注册这条路（读会变成 composition-dependent），
  //    兼容机制是 envelope 的 `ignorable: true`，旧日志改由
  //    scripts/migrate-owned-events.mjs 一次性迁移。护栏只观测、不修复。
  checkKernelIdentityAtStartup();

  // 1a. 耐久图片 → 宿主绝对路径的解析器（dock 缩略图经宿主 `/api/file` 出图用）。
  //
  // 为什么必须现算而不是存进 sidecar：路径是 `DSH_HOME/attachments/v1/objects/…`
  // 的派生值，落盘等于把「后端换了仍自称有路径」的 stale 风险请进仓库；现算则天然
  // 跟着后端走，非文件后端返回 undefined，wire 就不带这个键。
  //
  // 为什么用 `ctx.get` 而不是 `ctx.inject(['attachments'])`：附件存储缺席时投影必须
  // 照常工作（只少一张缩略图）。把 `attachments` 放进激活门控会重演 #34——服务不来
  // 则整个插件永久 pending、`/later` 与 `/schedule` 集体消失。
  setImageHostPathResolver((ref) => {
    // 每次调用现取：attachments 可能晚于本插件挂载。非法引用抛的 AttachmentError
    // 由 projection 侧收敛成 undefined（一张图降级，不让整份投影拒读）。
    const store = ctx.get('attachments');
    if (store === undefined) return undefined;
    return store.imageHostPath(ref);
  });

  // 1b. `userSchedules` 会话投影（GUI 读状态）。
  //
  // **跨代收敛点已搬到 `src/projection-registration.ts`**：本插件 dev 依赖解析到的
  // @deepseek-ai/dsh-session-projection 可能是旧版（rc.1，契约 `schema`+顶层 `view`），
  // 而宿主运行时可能更晚（rc.2 起契约 `stateSchema`+`wire{viewSchema,view}`；
  // 0.2.2-alpha.2 起 `register` 还改成了 `Promise<ProjectionHandle>`）。两代在类型层
  // 冲突、运行时契约以宿主为准，投影注册处的 `as never` 显式转换现在只留在
  // projection-registration.ts 里；注册单元的运行时形状由
  // `tests/projection-unit.test.mjs` 锁定，防止回归。
  //
  // **为什么包 `ctx.effect` 且 body 是 async**：0.2.2-alpha.2 的契约是
  // *Callers must await registration before publishing consumers*——注册完成之前
  // 不得对外发布消费方。cordis 4.0.1 的 `Effect` 接受 `Promise<Disposable>`
  // （`effect()` 在 fiber 激活前 await 异步 body），于是「await 完注册才让消费方可见」
  // 由框架保证；`@deepseek-ai/cordis` 是全代次同一个 `^4.0.1` peer，老代次同样支持。
  // 别改成 `.then()`——那会把时序丢掉，而装配面照样 GREEN，问题要到用户侧才显形。
  // 运行期失败（返回值形状未知 / 注册被拒）在收敛点 warn 并降级，不从这里抛。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.effect(
      () => registerUserSchedulesProjection(projectionCtx.sessionProjections, (m) => ctx.logger.warn(m)),
      'later.userSchedulesProjection()',
    );
  });

  // 2. 注册 settings namespace（设置 - 插件 配置 UI）。
  // 拿住 owner scope：`applies: 'live'` 声明改动即时生效。工具/命令 handler
  // 每次调用通过 getSettings() 按需读取——避免主动 watch 引入的一致性边界与
  // 误同步（对齐 dsh-smooth-stream / dsh-auto-collapse 的写法）。
  const startSettings: SchedulerSettings = {
    maxSchedules: startMaxSchedules,
    allowLongPrompts: false,
    maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
    steerDelivery: 'followup',
    confirmDelivery: true,
    onUnconfirmed: 'keep',
    clockIconStyle: 'auto',
    // Beta 功能默认开：语法已经过 38 个单测，关闭它只会把用户推向报错。
    advancedSyntax: true,
  };
  // 稳定读取入口（GitHub issue #9）。`getSettings` 的**函数身份永不变**，三处注册点
  // （runtimeRegistry.create 的 :692、registerUserScheduleTools 的 :703、
  // registerUserScheduleCommands 的 :757）按值传进去的就是这个恒定引用；注入路径只
  // 重新赋值内部的 `readLive`。
  //
  // 为什么不能写成 `let getSettings`（改动前那样）：cordis 的 `ctx.effect` **同步**执行、
  // 而 `ctx.inject(['settings'], …)` 回调延后一个微任务（`fiber.ts` 的 `_reload()` 先
  // `await Promise.resolve()` 再 `_execute`）。于是 effect 里读到的 `getSettings` 仍是
  // 此刻那个 `() => startSettings`——被当参数按值冻结进命令/工具/runtime，之后回调再怎么
  // 重新赋值都追不回来。后果不止斜杠命令：`src/runtime.ts:168/:183` 把它存成实例字段，
  // 连插件 apply 时就存在、走 `hydrate()` 挂载的会话的投递口径（onUnconfirmed /
  // steerDelivery / confirmDelivery）都一起冻结。
  //
  // 选「稳定入口」而不是在 :692/:703/:757 各包一层 `() => getSettings()`：后者能修但脆弱，
  // 以后新增第四个消费者会重踩同一个坑；这里让所有消费者天然共享同一个实时读取点。
  let readLive: () => SchedulerSettings = () => startSettings;
  const getSettings = (): SchedulerSettings => readLive();
  ctx.inject(['settings'], (settingsCtx) => {
    // 0.1.7 移除了整个 `settings.yaml` 体系：`SettingsProvider.register()` 不复存在，
    // `ctx.settings` 变成 `SettingsForms`（只有 configure/describe/prepareDocument），
    // 命名空间 schema 改为**由 profile 声明驱动**（见 0.1.7 dsh-settings 的类型注释
    // “Move the sections of the removed settings.yaml into the active profile”）。
    //
    // 照旧调用会抛错并让整个 settings 注入失败，因此这里做代次探测：拿不到
    // `register` 就保持 `startSettings`（即 profile yml 的 `base` 值），
    // 插件功能不受影响，只是不再支持运行时热改设置。
    //
    // TODO(0.1.7 配置迁移)：把 SchedulerSettingsSchema 迁到 profile 声明式配置，
    // 恢复 GUI 设置页与 live 生效。这是跨 15 个插件的架构课题，单独排期。
    //
    // 类型收窄：0.1.5 的 `SettingsProvider` 有 `register`，0.1.7 的 `SettingsForms`
    // 没有——直接用联合类型会让两代都无法通过编译，故按「本插件所需的最小面」
    // 声明本地接口，再对运行时对象做一次存在性判断。
    const provider = settingsCtx.settings as unknown as {
      register?: (
        ns: SettingsNamespace,
        schema: typeof SchedulerSettingsSchema,
        options: { applies: 'live' },
      ) => { get: () => unknown };
    };

    /**
     * 把「settings 原始值」规整为运行时设置（容错非法值回落默认）。
     * 三条代次轨道共用，避免各处重复解析逻辑。
     *
     * ⚠️ 这里**故意不搬运 `workStart`/`workEnd`/`lunchStart`/`lunchEnd`/`eveningEnd`**：
     * `getSettings()` 的宿主消费者（runtime 的投递口径、commands、user-tools 的字符上限）
     * 没有一个算时段——智能时段是**面板**的功能，唯一读者是客户端
     * `useSchedulerSettings` → `sanitizeSmartWindowConfig`（实测：全仓 `nextSmartTarget`
     * 的调用点只有 `SchedPanel`）。宿主侧再抄一份就等于给同一个值造第二条通路，
     * 而两条通路各有各的降级口径正是这个 bug 能活这么久的原因。
     * 若将来真的要宿主侧算时段（例如 `/later` 无参数时默认排到下一个智能时段），
     * 正确做法是在这里加 `smartWindow: sanitizeSmartWindowConfig(value)`，
     * 与客户端共用**同一个**清洗函数，而不是新写一份。
     */
    const readSettings = (value: SettingsRawValue | undefined): SchedulerSettings => ({
      maxSchedules: resolveMaxSchedules(value?.maxSchedules ?? startSettings.maxSchedules),
      allowLongPrompts: value?.allowLongPrompts === true,
      maxPromptChars:
        typeof value?.maxPromptChars === 'number' && value.maxPromptChars >= 1
          ? Math.floor(value.maxPromptChars)
          : startSettings.maxPromptChars,
      // 非法/缺失回落默认：投递方式默认 followup（安全侧），确认默认开，
      // 未确认默认保留（不丢消息）。
      steerDelivery: value?.steerDelivery === 'steer' ? 'steer' : 'followup',
      confirmDelivery: value?.confirmDelivery !== false,
      onUnconfirmed: value?.onUnconfirmed === 'discard' ? 'discard' : 'keep',
      clockIconStyle:
        value?.clockIconStyle === 'modern' || value?.clockIconStyle === 'classic'
          ? value.clockIconStyle
          : 'auto',
      // 仅显式 false 关闭；缺失/非法一律按默认开（与 schema 的 default(true) 同源）
      advancedSyntax: value?.advancedSyntax !== false,
    });

    // ── 轨道 1：0.2.0（settings rewrite 第二版）─────────────────────────────
    //
    // 0.2.0 的 `ctx.settings` 是 `SettingsForms`，**没有 `register()`**；表单由
    // `describe()` 从 `entry.fiber.runtime.Config`（即本插件导出的 `Config`）
    // 自动生成，值来自该 profile 条目已合并的 `config`。
    //
    // 因此这一代**无需注册**：字段已在 `Config` 上声明，宿主自会渲染设置页。
    // 插件侧只需读取「当前生效配置」。但 `Config` 的默认值由 cordis 在构造时
    // 填充，运行中热改需从 describe() 快照取——故这里订阅 document 更新事件，
    // 把最新值同步进 `readLive`（`getSettings` 的稳定入口每次读取都走它），实现与
    // 0.1.5 相同的 `applies: 'live'` 语义。
    const forms = settingsCtx.settings as unknown as {
      describe?: (options?: { redactSecrets?: boolean }) => readonly SettingsDescriptorLike[];
      register?: unknown;
    };
    if (typeof provider.register !== 'function' && typeof forms.describe === 'function') {
      const describeValue = (): SettingsRawValue | undefined => {
        try {
          // entry id = profile 条目 id（`cordis.patch.yml` 的 `id: later`），
          // **不是** settings namespace（'dsh-later'）——见 dsh-settings
          // describe()：`ns: entry.options.id`。
          const row = forms
            .describe?.({ redactSecrets: true })
            .find((candidate) => candidate.ns === ENTRY_ID);
          return row?.value as SettingsRawValue | undefined;
        } catch {
          return undefined;
        }
      };
      readLive = () => readSettings(describeValue());

      // 文档更新 → 重新取值（宿主在 describe 检测到变化时发该事件）。
      settingsCtx.on('settings/document-updated', (ns: unknown) => {
        if (ns !== ENTRY_ID && ns !== SETTINGS_NAMESPACE) return;
        readLive = () => readSettings(describeValue());
      });
      return;
    }

    // ── 轨道 2：0.1.5 及更早（settings.yaml 体系）──────────────────────────
    if (typeof provider.register !== 'function') return;

    const scope = provider.register(
      // 断言而非 settingsNamespace()：0.1.1 要求 branded 类型，0.1.2 已删除该 helper。
      SETTINGS_NAMESPACE as SettingsNamespace,
      SchedulerSettingsSchema,
      { applies: 'live' },
    );
    readLive = () => {
      try {
        return readSettings(scope.get() as SettingsRawValue | undefined);
      } catch {
        return startSettings;
      }
    };
  });

  // 每个 root agent 一个「用户提醒调度器」：负责确保命令/工具创建的提醒会武装 timer 并触发。
  // 每个 root agent 一个「用户提醒调度器」。挂载规则全部在 runtime-registry.ts
  //（幂等 / 只认 root / 水合 / 自愈 / teardown 守卫，且有行为级测试），这里只做接线。
  const runtimeRegistry = createRuntimeRegistry<Agent, UserScheduleRuntime>({
    // 0.2.2-rc.2 删掉了 `AgentRegistry.roots()`，这里不能直连宿主那一个：注入面问的是
    // 「当前 live root 列表」，`liveRootAgents` 有 `roots()` 就用它（rc.1 逐字行为），
    // 没有才从 `list()` 按 `delegationDepth` 过滤（rc.2）。
    roots: () => liveRootAgents(ctx.agents) as readonly Agent[],
    isStopping: () => stopping,
    create: (agent) => new UserScheduleRuntime(ctx, agent, getSettings),
    drive: (runtime) => runtime.requestDrive(),
    warn: (message) => ctx.logger.warn(message),
    attach: (agent, runtime) => {
      // 把 effect disposer 交回注册表，别丢。这些副作用挂在 agent.ctx 上（跟着 agent
      // 的命，不是跟着插件的命）：插件 fiber 被拆时宿主不会替我们撤销，所以必须由
      // 注册表在 unmountAll() 里主动拆 —— 否则重载后旧实例留下的同名工具注册会让
      // 新实例的 attach 撞上内核守卫（tool "…" is already registered in this
      // scope），该会话从此永久 no_runtime：提醒能建、dock 能显示、到点不响。
      const disposeMount = agent.ctx.effect(() => {
        const getLocale = () => ctx.get('locale')?.getSnapshot().active;
        const disposeTools = registerUserScheduleTools(ctx, agent.ctx, agent, getSettings, getLocale, notifyUserChange);
        const stopStatus = agent.ctx.on('agent/status', ({ status }: { status: string }) => {
          // 自愈：agent 转 idle 时重算（与 dsh-schedule 同构），覆盖被遗漏的重驱。
          if (status === 'idle') runtime.requestDrive();
        });
        runtime.requestDrive();
        return async () => {
          stopStatus();
          disposeTools();
          try {
            await runtime.dispose();
          } finally {
            runtimeRegistry.forget(agent, runtime);
          }
        };
      }, 'later.userTools()');
      return () => disposeMount();
    },
  });

  /**
   * 用户创建/删除成功 → 重驱该 agent 的调度器（缺挂载时自愈补挂，见注册表）。
   * @returns 是否真的挂上了。false 意味着这条提醒**不会被触发**，调用方必须如实说，
   *   不能再给用户一句"将于 X 发送"。（#71 的教训：静默是最贵的部分。）
   */
  const notifyUserChange = (agent: Agent): boolean => {
    // 宿主级扫描器也**重新武装**一次（它有自己的"最近到期点"缓存）。与 runtime 的驱动**并列**、
    // 不在同一处 try 里：扫描器重排失败不该把"会话已挂上"这个事实说成失败。
    //
    // ⚠️ 是 `rearm` 不是 `reschedule`：后者纯重排、不碰退避，于是已 `gaveUp` 的会话在用户
    // 亲手新建提醒之后仍不被叫醒（第三条解除路径，见 expiry-sweeper.ts 的 D2）。
    try {
      activeSweeper?.rearm(agent.id);
    } catch {
      /* 重排失败只影响"多快被看见"，兜底 tick 仍会补上 */
    }
    try {
      return runtimeRegistry.drive(agent);
    } catch {
      /* 调度失败不影响工具/命令的结果 */
      return false;
    }
  };

  /** 用户主动插话（GUI「插话发送」按钮）：路由到该 agent 的 runtime。 */
  const notifyUserSteer = async (
    agent: Agent,
    id: string,
  ): Promise<
    | { readonly ok: true; readonly id: string; readonly steered: true }
    | { readonly ok: false; readonly code: string; readonly message: string }
  > => {
    // ensure 会先自愈；自愈不了（非 root / teardown / attach 失败）才如实报错。
    const runtime = runtimeRegistry.ensure(agent);
    if (runtime === undefined) {
      return {
        ok: false,
        code: 'no_runtime',
        // 这里没有 getLocale 形参（不在 registerUserScheduleTools 内），现取一次：
        // 宿主侧读 locale 走 ctx.get 的可选链（不能列进 inject，见上文那段说明）。
        message: hostDictFor((() => {
          try {
            return ctx.get('locale')?.getSnapshot().active;
          } catch {
            return undefined;
          }
        })()).errToolNoRuntime,
      };
    }
    try {
      // 插话成功 = 这条提醒出列（sidecar 不再有它），扫描器的最早到期点可能因此变晚。
      activeSweeper?.reschedule();
    } catch {
      /* 同上：只是排程不够及时，不影响本次结果 */
    }
    return runtime.steerById(id);
  };

  // 2. slash 命令（客户端变更通道），全局注册一次。
  ctx.effect(
    () => {
      const getLocale = () => ctx.get('locale')?.getSnapshot().active;
      return registerUserScheduleCommands(ctx, getSettings, notifyUserChange, notifyUserSteer, getLocale);
    },
    'later.commands()',
  );

  // 3. 每个 root agent：注册用户工具 + 用户调度器生命周期。
  ctx.effect(() => {
    // 0.1.7 起 `agent/created` 是**异步串行**事件：回调须返回 Promise，且首次
    // 模型请求会等待初始化完成。0.1.5/0.1.2 的同步回调签名在 0.1.7 下会因
    // 返回 void 而不匹配，故显式 async。
    const stopCreated = ctx.on('agent/created', async ({ agent }: { agent: Agent }) => {
      runtimeRegistry.mount(agent);
    });
    return async () => {
      stopping = true;
      stopCreated();
      // 关键一步：拆掉自己注册过的东西（工具 / 状态监听 / runtime）。
      // 只 dispose runtime 是不够的 —— 工具注册在 agent.ctx 上，宿主不会替插件撤，
      // 留着它们，下一次 apply 的 attach 就会撞内核的同名守卫而永久失败。
      await runtimeRegistry.unmountAll();
    };
  }, 'later.userToolsLifecycle()');

  // 3b. 宿主级到期扫描（issue #11b 的投递半面）。
  //
  // 为什么必须有一个插件级（而不是会话级）的扫描器：到点投递此前只有「该会话的 runtime
  // 自己的 setTimeout」一条路，而 runtime 只在会话的 agent 是 live root 时才挂得上。
  // 进程重启后没人打开过那条会话 ⇒ 一个 runtime 都不挂 ⇒ 没有任何组件知道某条提醒到点了
  // （实测：`/later +2m` → 杀进程 → 同 DSH_HOME 重启 → 不开浏览器 → 到期后 +90s 投递 0 条；
  // 手动打开会话立刻 1 条）。所以这里补的只是"谁来叫醒"，不是第二份投递逻辑。
  //
  // 扫描器**只做叫醒**：`sweepWake` 里 `runtimeRegistry.mount()`（幂等）+ `requestDrive()`，
  // 之后走的是与「有人打开会话」完全相同的链路（确认窗口、dispatch 记账、/later 的 user
  // 代发、暂停/逾期、every 的周期重挂都由 runtime 负责）。这也是为什么 delivery/occurrences
  // 那份判据一个字都不用改。
  //
  // 生命周期：挂在本 apply 的顶层 fiber 上、由 `ctx.effect` 交回撤销动作，dispose 时清掉
  // 精确 timer 与兜底 tick —— 热重载后不能留下第二个扫描器（同 runtime-registry 的纪律）。
  const userWatch = createUserWatch();
  /**
   * 当前活着的扫描器（teardown 后置 undefined）。
   *
   * 为什么要一个模块级句柄：用户建/改/暂停/恢复提醒之后，**必须立刻让扫描器重排**
   * ——否则新写进 sidecar 的那条 `scheduledAt` 只有等 60s 兜底 tick 才会被看见，
   * 「建完 +2s 的提醒」就会晚几十秒。runtime 那边有 `requestDrive()`，扫描器这边
   * 目前没有任何人通知它，这是一个真实的设计缺口（跨内核用例第一次跑就撞上了）。
   */
  let activeSweeper: { reschedule(): void; rearm(sessionId: string): void } | undefined;
  ctx.effect(() => {
    // 监听必须在 effect 里注册：`apply()` 顶层那一刻 fiber 还是 LOADING，作用域外的
    // `ctx.on` 会被立刻拆掉（静默期曾经因此从未生效过）。
    const stopWatching = watchSessionLifecycle(ctx, userWatch);
    const sweeper = createExpirySweeper({
      snapshots: () =>
        listOwnershipSnapshots((message) => ctx.logger.warn(`later: ${message}`)).filter((snapshot) => {
          // 只有**硬拒绝**（子会话 / 非 root）在枚举层摘掉：那些会话叫醒了也投不出去，
          // 留着只会被当成"失败的唤醒"反复退避，最后刷一条"已停止自动唤醒"的假告警。
          //
          // ⚠️ 静默期（quiet-window）**不在这里摘**。它只是"现在别主动打开"，
          // 不是"到期任务可以不发"——摘掉就等于静默丢任务，正是本仓最不想要的那类
          // 安静失败。静默期内的条目照常进扫描，在 wake 里挡下并记 `undelivered`。
          return coldWakeRefusal(ctx, snapshot.sessionId) === undefined;
        }),
      /**
       * 能不能唤醒。静默期是**软**拒绝：返回 false，但原因随 `quiet-window` 旁路给扫描器，
       * 让它在同一轮里把这几条记成 `undelivered`（留痕、下一轮再试），而不是无声滤掉。
       */
      /**
       * 能不能唤醒。
       *
       * 静默期是**软**拒绝，而且只拦两种情况：
       *  1. 扫描器**自己猜**着要打开一个用户刚关过的会话；
       *  2. 该会话的到期条目**还没到点**（那当然不该现在叫醒）。
       *
       * 一旦 sidecar 里确实有一条**已过期**的条目，静默期就让路。理由：静默期的本意是
       * 「别在用户刚关掉时主动去打开」，不是「到期任务可以不发」。runtime 那里拿不到这个
       * 信号——真宿主里 `agent.dispose()` 之后会话日志已经被内核封口，`foldUserState` 折出
       * 来的 `active` 是 0（实测），所以"到期"这件事只能由 sidecar 这个断点索引来回答。
       * 被它挡下的条目一律记 `undelivered(quiet-window)`，绝不无声滤掉。
       */
      wakeable: (sessionId) =>
        coldWakeRefusal(ctx, sessionId) === undefined &&
        (!isQuiet(sessionId, userWatch) || hasOverdueEntry(sessionId)),
      refuseReason: (sessionId) =>
        coldWakeRefusal(ctx, sessionId) === undefined &&
        isQuiet(sessionId, userWatch) &&
        !hasOverdueEntry(sessionId)
          ? 'quiet-window'
          : undefined,
      /**
       * 叫醒一个会话。两条路径都**不写进顶层 inject**：`sessionController` 只由
       * `dsh-web-app` 挂载，写进顶层 inject 会让整条 fiber 永久 pending
       * （`waiting for service: sessionController`），插件整体消失。
       */
      wake: (sessionId) => {
        if (hasLiveRootAgent(ctx, sessionId)) {
          // live 会话：到点投递是它自己 runtime 的职责（timer 已武装）。扫描器只在这里补一次
          // "现在就去核算"，绝不去 resume——那会把刚被拆掉的会话又拉起来一轮。
          runtimeRegistry.drive(ctx.agents.get(sessionId as never) as Agent);
          return;
        }
        return wakeColdSession(ctx, sessionId, runtimeRegistry, userWatch);
      },
      /**
       * v2→v3：老条目缺 `scheduledAt` 时从会话日志回算（`after` 用 createdAt+afterSeconds，
       * `at` 用记录自带的时刻）。读日志要有 session 句柄——`ctx.sessions.get` 只认**已发布**
       * 的会话，冷会话根本没有，因此回算只在「那条会话此刻恰好附着」时才可能成功；拿不到
       * 就返回 undefined，扫描器保守跳过并告警一次（绝不猜，也绝不当成永久逾期反复唤醒）。
       */
      resolveScheduledAt: (sessionId, scheduleId) => {
        const session = (() => {
          try {
            return ctx.sessions.get(sessionId as never);
          } catch {
            return undefined;
          }
        })();
        if (session === undefined) return undefined;
        const entry = listOwnershipSnapshots().find((snapshot) => snapshot.sessionId === sessionId)?.entries[scheduleId];
        if (entry === undefined) return undefined;
        return resolveScheduledAtFromLog(readOwnEvents(session) as never, scheduleId, entry.createdAt);
      },
      warn: (message) => ctx.logger.warn(message),
    });
    activeSweeper = sweeper;
    return async () => {
      activeSweeper = undefined;
      stopWatching();
      await sweeper.dispose();
    };
  }, 'later.expirySweeper()');

  // 4. 随插件分发的 `SKILL.md`：把「何时该主动排程、两个调度工具怎么选」放进模型的
  //    skill catalog。工具 description 只有模型**已经**考虑调用该工具时才进上下文，
  //    catalog 的每一行则每轮常驻，是「用户没开口只说了一句稍后再做」这类场景唯一的曝光位。
  //
  //    为什么走 `ctx.inject(['skills'], …)` 这条**子 fiber** 注入，而不是加进顶层
  //    `inject`：顶层 `inject` 是整个入口的激活门控，服务不来则入口永久 pending、
  //    `/later` 与 `/schedule` 全体消失（见文件头注释与 `tests/host-entry-activation.test.mjs`）。
  //    skills 是一个曝光位，不是本插件功能的必要条件，而且它**不在**本包的
  //    peerDependencies 里：宿主是否挂载它由装配决定，不该由插件去断言。拿一个可选面
  //    去当激活门控，等于让「少一行 catalog」升级成「整个插件不加载」。子 fiber 的门控
  //    只挂它自己，缺席时少的只有这个曝光位。守卫形状与三层退化都在 `skill.ts` 的
  //    `registerBundledSkill` 里，那里可直接用假 ctx 测。
  registerBundledSkill(
    ctx as unknown as SkillHostLike,
    () => ctx.get('locale')?.getSnapshot().active,
  );

  // 既有会话水合：插件重载/热更新会 teardown 再 apply，而既有会话不会重发
  // `agent/created`。不补这一次，那些会话的提醒永远不触发、Send now 报 no_runtime。
  runtimeRegistry.hydrate();
}

export { name };
