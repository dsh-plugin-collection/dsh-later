/**
 * dsh-schedule 0.1.5 → 0.1.7 的版本桥接层。
 *
 * 0.1.7 对 `dsh-schedule` 做了三处破坏性变更，本模块把差异收敛为三个函数，
 * 使 `user-tools.ts` / `runtime.ts` 不必写版本分支：
 *
 * 1. `allocateScheduleId(folded)` → 删除。0.1.5 用确定性递增
 *    （`schedule-1`、`schedule-2`…，靠 `seenIds` 避让），0.1.7 内联改为
 *    `ScheduleId(\`schedule-${randomUUID()}\`)`（见 0.1.7 `ScheduleService.create`）。
 *    本插件的 `ownership-store` 把 id 当**不透明字符串**处理（无排序、无数字
 *    解析，见 docs/verification.md），故行为差异对功能无影响。
 *
 * 2. `createAfterScheduleRecord` 新增第 5 个必填参数 `title`。0.1.7 起
 *    `decodeStoredTitle` 会在读取时校验：缺失 / 未 trim / 超长（>120）的
 *    存量记录抛 `ScheduleLogError`——**不是跳过，是整份日志拒读**。
 *
 * 3. `renderEveryReminderBatchFraming` → 改名
 *    `renderRecurringReminderBatchFraming`（语义与参数不变）。
 *
 * @module dsh-later/schedule-compat
 */
import * as sched from '@deepseek-ai/dsh-schedule';
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule';
import { randomUUID } from 'node:crypto';
import {
  PLUGIN_KIND_RETIRED_SINCE,
  readKernelVersion,
  versionAtLeast,
  type KernelVersion,
} from './upstream-compat.js';

const { ScheduleId } = sched;

/** 0.1.7 `MAX_TITLE_LENGTH`；0.1.5 无此概念，该常量在此仅作截断阈值。 */
export const SCHEDULE_TITLE_MAX = 120;

/**
 * 读取一个**可能不存在**的导出。
 *
 * 必须走 namespace + 属性访问，不能用具名 import：ESM 具名 import 在目标导出
 * 缺失时是**链接期硬失败**（`SyntaxError: does not provide an export named …`），
 * 无法用 `as unknown as` 兜底。0.1.7 删掉 `renderEveryReminderBatchFraming` 后，
 * 具名 import 会让整个插件在 0.1.5 上也无法加载——正好与支持区间相反。
 */
function pick<T>(name: string): T | undefined {
  return (sched as unknown as Record<string, unknown>)[name] as T | undefined;
}

/**
 * 0.1.7 的 `allocateScheduleId` 等价物。
 *
 * 随机 UUID 而非递增序号：与官方 `ScheduleService.create` 行为一致，且并发
 * 创建时天然无碰撞。0.1.5 下也可用（`ScheduleId` 是纯 brand 校验，任意
 * 非空字符串通过），因此本函数在两个代次上语义相同，无需双轨。
 *
 * @param _folded 仅为**保持调用点不变**而接受 0.1.5 的 `folded` 参数；0.1.7
 *   不再需要它来避让碰撞（UUID 本身唯一），故不使用。
 */
export function allocateScheduleIdCompat(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _folded?: unknown,
): ReturnType<typeof ScheduleId> {
  return ScheduleId(`schedule-${randomUUID()}`);
}

/**
 * 从提醒正文派生 `title`。
 *
 * 0.1.7 要求 title 非空、已 trim、≤120 字符。实测本插件历史 496 条提醒中
 * 最长 575 字符（27 条超限，占 5.4%），故**必须截断**而非直接透传 prompt。
 * 截断在词边界优先，找不到合适边界时按字符硬切并补省略号，保证结果始终
 * 是合法 title（`scheduleTitle` 不会抛）。
 */
export function deriveScheduleTitle(prompt: string): string {
  const normalized = prompt.trim();
  if (normalized.length === 0) return '定时提醒';
  if (normalized.length <= SCHEDULE_TITLE_MAX) return normalized;
  const clipped = normalized.slice(0, SCHEDULE_TITLE_MAX - 1);
  const lastBreak = Math.max(clipped.lastIndexOf(' '), clipped.lastIndexOf('　'));
  const body = lastBreak >= SCHEDULE_TITLE_MAX * 0.6 ? clipped.slice(0, lastBreak) : clipped;
  return `${body.trimEnd()}…`;
}

/**
 * 调用一个 `create*ScheduleRecord`，按目标代次决定是否追加 `title`。
 *
 * 0.1.5 签名为 `(id, prompt, selector, now)`；0.1.7 追加第 5 位必填 `title`。
 * 0.1.7 的 `scheduleTitle` 对空 / 未 trim / >120 字符一律抛错，故 title 必须
 * 由 `deriveScheduleTitle` 保证合法。
 */
function createRecord(
  name: string,
  id: ReturnType<typeof ScheduleId>,
  prompt: string,
  selector: unknown,
  now: number,
): ScheduleRecord {
  const fn = pick<(...args: unknown[]) => ScheduleRecord>(name);
  if (typeof fn !== 'function') {
    throw new Error(`dsh-later: dsh-schedule does not export ${name} — unsupported kernel generation.`);
  }
  // 0.1.7 的 arity 为 5；0.1.5 为 4。按 arity 择一，无需版本号判断。
  return fn.length >= 5
    ? fn(id, prompt, selector, now, deriveScheduleTitle(prompt))
    : fn(id, prompt, selector, now);
}

/** `createAfterScheduleRecord` 的跨版本包装。 */
export function createAfterRecord(
  id: ReturnType<typeof ScheduleId>,
  prompt: string,
  afterSeconds: number,
  now: number,
): ScheduleRecord {
  return createRecord('createAfterScheduleRecord', id, prompt, afterSeconds, now);
}

/** `createAtScheduleRecord` 的跨版本包装。 */
export function createAtRecord(
  id: ReturnType<typeof ScheduleId>,
  prompt: string,
  scheduledAt: string,
  now: number,
): ScheduleRecord {
  return createRecord('createAtScheduleRecord', id, prompt, scheduledAt, now);
}

/** `createEveryScheduleRecord` 的跨版本包装。 */
export function createEveryRecord(
  id: ReturnType<typeof ScheduleId>,
  prompt: string,
  everySeconds: number,
  now: number,
): ScheduleRecord {
  return createRecord('createEveryScheduleRecord', id, prompt, everySeconds, now);
}

/**
 * 周期提醒批次的 framing 渲染。
 *
 * 0.1.5 导出 `renderEveryReminderBatchFraming`，0.1.7 改名为
 * `renderRecurringReminderBatchFraming`（并扩展到 daily/weekly/cron，本插件
 * 只产生 `every` 记录）。两代参数与返回结构一致，按存在性择一。
 */
export function renderRecurringBatchFraming(reminders: readonly unknown[]): string {
  const render =
    pick<(r: readonly unknown[]) => string>('renderEveryReminderBatchFraming') ??
    pick<(r: readonly unknown[]) => string>('renderRecurringReminderBatchFraming');
  if (typeof render !== 'function') {
    throw new Error(
      'dsh-later: dsh-schedule exposes neither renderEveryReminderBatchFraming ' +
        'nor renderRecurringReminderBatchFraming — unsupported kernel generation.',
    );
  }
  return render(reminders);
}

/** 判定结果的出处（诊断文案要说清「凭什么这么选」）。 */
export type MessageSourceVia = 'kernel-version' | 'symbol-probe';

/** 一次 source kind 判定的完整结论。 */
export interface MessageSourceDecision {
  readonly kind: 'schedule' | 'plugin';
  readonly via: MessageSourceVia;
  /** 人类可读的依据，例如 `内核 0.1.7-rc.1（读自 @deepseek-ai/dsh-schedule）`。 */
  readonly detail: string;
}

/** `messageSourceDecision` 的可注入面（测试不依赖真实内核安装）。 */
export interface MessageSourceProbeOptions {
  /** 读内核版本；默认真去解析宿主包。读不到时返回 `undefined`。 */
  readKernel?: () => KernelVersion | undefined;
  /** 符号探测：`renderRecurringReminderBatchFraming` 是否存在（降级路径用）。 */
  hasModernRenderName?: () => boolean;
  /** 降级警告出口（默认 `console.warn`，每进程一次）。 */
  warn?: (message: string) => void;
}

/** 判定缓存：本进程内内核版本不会变，投递却每次都要用这个结论。 */
let decisionCache: MessageSourceDecision | undefined;
/** 降级警告只刷一次（每次都刷会淹掉真问题，同 `group-status-facet` 的克制法）。 */
let warnedFallback = false;

/** 清掉判定缓存与「已警告」状态。只给测试用——生产路径上缓存就该活到进程结束。 */
export function resetMessageSourceDecision(): void {
  decisionCache = undefined;
  warnedFallback = false;
}

/**
 * 提醒注入消息该用哪个 `source.kind`（issue #75 改的就是这里的判定方式）。
 *
 * **版本优先，符号兜底**：
 *
 * 1. 读到内核版本 → 与 {@link PLUGIN_KIND_RETIRED_SINCE} 比（含预发布语义）。
 *    `0.1.7-rc.1` 起 `kind:'plugin'` 被 v4 准入拒绝，官方 `dsh-schedule` 自己在那一代
 *    注入提醒用的就是 `{ kind: 'schedule' }`，所以这一代往后一律 `schedule`；更早一律 `plugin`。
 * 2. 读不到版本 → 退回旧的符号探测，并**警告一次**。
 *
 * 为什么非用版本号不可：这两个破坏性变更**不在同一个 rc 落地**——rc.1 已经删了
 * `plugin` kind，但 `renderEveryReminderBatchFraming` 的改名要到 rc.2。于是 rc.1 是一代
 * 「旧符号还在、旧 kind 已死」的组合代，按符号存在性推断必然选错。而且 0.1.5 与
 * 0.1.7-rc.1 的 `dsh-schedule` 导出面**逐符号相同**（两版都在 registry 里，实测
 * `renderEveryReminderBatchFraming` / `allocateScheduleId` 两边都有），所以连换个符号探测
 * 都救不回来——能区分的只有版本号。原注释写的「`schedule` 与
 * `renderRecurringReminderBatchFraming` 同属 0.1.7 引入，二者同时存在即为 0.1.7+」正是
 * 这个被实测推翻的前提。
 *
 * 后果为什么必须被看见：选错是**静默**的——提醒到点不投递、会话日志里没有 dispatch 也没有
 * 校验报错（那条在宿主 stdout），用户只看到「超时未确认」。
 */
export function messageSourceDecision(options: MessageSourceProbeOptions = {}): MessageSourceDecision {
  if (decisionCache !== undefined) return decisionCache;
  const readKernel = options.readKernel ?? readKernelVersion;
  const kernel = readKernel();
  if (kernel !== undefined) {
    const retired = versionAtLeast(kernel.version, PLUGIN_KIND_RETIRED_SINCE);
    if (retired !== undefined) {
      decisionCache = {
        kind: retired ? 'schedule' : 'plugin',
        via: 'kernel-version',
        detail: `内核 ${kernel.version}（读自 ${kernel.specifier}），plugin kind ${retired ? '已淘汰' : '仍受支持'}（阈值 ${PLUGIN_KIND_RETIRED_SINCE}）`,
      };
      return decisionCache;
    }
  }
  const hasModernRenderName = options.hasModernRenderName
    ?? (() => pick<(r: readonly unknown[]) => string>('renderRecurringReminderBatchFraming') !== undefined);
  const kind: MessageSourceDecision['kind'] = hasModernRenderName() ? 'schedule' : 'plugin';
  if (!warnedFallback) {
    warnedFallback = true;
    const warn = options.warn ?? ((message: string) => console.warn(message));
    warn(
      'dsh-later: 读不到内核版本，退回符号探测判定消息 source kind。在 0.1.7-rc.1 这类'
      + '「旧符号仍在、plugin kind 已淘汰」的组合代上这会选错（issue #75），表现为提醒到点'
      + '不投递且无报错。排查：确认插件的解析根能解析到 @deepseek-ai/dsh 或 dsh-schedule 的 package.json。',
    );
  }
  const decision: MessageSourceDecision = {
    kind,
    via: 'symbol-probe',
    detail: `符号探测（内核版本读不到，阈值 ${PLUGIN_KIND_RETIRED_SINCE} 无法应用）`,
  };
  // 降级结论**同样缓存**：探测一次要解析四个 specifier、每次投递都重跑没有意义，而「读不到版本」
  // 基本是装配现场问题——修好它必然伴随宿主重启，届时本模块重载、缓存自然干净。
  decisionCache = decision;
  return decision;
}

/**
 * 提醒注入消息的 `source`。
 *
 * `form:'notice'` + `summary` 两代都在（`ContextFormed` 未变），保留。
 *
 * 不能用具名类型断言跨代：source 的字面量 union 在两代不同，断言只会把
 * 编译错误推迟到运行期。
 */
export function scheduleMessageSource(boundedSummary: string): Record<string, unknown> {
  const base = { form: 'notice', summary: boundedSummary };
  const { kind } = messageSourceDecision();
  return kind === 'schedule'
    ? { kind, ...base }
    : { kind, plugin: PLUGIN_LABEL, ...base };
}

/**
 * `foldScheduleEvents` 结果的读视图收窄。
 *
 * 0.1.5 的 `FoldedSchedules.active` 是 `ScheduleRecord[]`；0.1.7 改为
 * `LegacyScheduleRecord[]`（title 可选）。本插件只消费 `id` / `kind` /
 * `prompt` / `afterSeconds` / `everySeconds` / `scheduledAt`，这些字段在
 * `Legacy*` 视图中全部存在，故收窄无损。
 */
export function asLegacySchedules(folded: unknown): {
  readonly active: readonly ScheduleRecord[];
  readonly seenIds: ReadonlySet<string>;
} {
  return folded as {
    readonly active: readonly ScheduleRecord[];
    readonly seenIds: ReadonlySet<string>;
  };
}

/** 本插件在 0.1.5 时代的 source 标签（0.1.7 已无 plugin kind，仅作回退标识）。 */
const PLUGIN_LABEL = '定时提醒';

/**
 * `schedule/change` 事件里 `create` 操作的载荷类型。
 *
 * 0.1.7 起内核把「事件载荷」与「内部记录」拆成两个类型：
 * - `ScheduleCreateChange.schedule` 是 **`LegacyScheduleRecord`**（title 可选）
 * - `ScheduleRecord` 是 Host 内部的新格式（title 必填，且含 daily/weekly/cron）
 *
 * 本插件只产生 `after` / `at` / `every` 三种（见 buildScheduleRecord），三者都是
 * `Legacy*` 的对应分支去掉「title 必填」后的结果，故结构兼容。
 *
 * 但 TS 层面 `ScheduleRecord`（6 变体联合）对 `LegacyScheduleRecord`（3 变体）
 * 不可赋值——**这不是运行时问题，是联合宽度问题**。故在此显式收窄：本插件
 * 的产出已经过 `createAfter/At/EveryRecord` 限定，不含 daily/weekly/cron。
 */
export function toChangePayload(record: ScheduleRecord): never {
  return record as never;
}

/**
 * `foldScheduleEvents().active` 元素的读取侧类型。
 *
 * 0.1.5 直接返回 `ScheduleRecord`；0.1.7 返回 `LegacyScheduleRecord`
 * （title 可选，因为历史事件没有）。本插件读路径只在 title 存在时展示，
 * 缺失时回退到 prompt——故按 Legacy 收窄是**语义正确**的，而非绕过检查。
 */
export function asLegacyRecords(
  records: readonly unknown[],
): readonly ScheduleRecord[] {
  return records as readonly ScheduleRecord[];
}
