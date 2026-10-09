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
import { randomUUID } from 'node:crypto';
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
function pick(name) {
    return sched[name];
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
_folded) {
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
export function deriveScheduleTitle(prompt) {
    const normalized = prompt.trim();
    if (normalized.length === 0)
        return '定时提醒';
    if (normalized.length <= SCHEDULE_TITLE_MAX)
        return normalized;
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
function createRecord(name, id, prompt, selector, now) {
    const fn = pick(name);
    if (typeof fn !== 'function') {
        throw new Error(`dsh-later: dsh-schedule does not export ${name} — unsupported kernel generation.`);
    }
    // 0.1.7 的 arity 为 5；0.1.5 为 4。按 arity 择一，无需版本号判断。
    return fn.length >= 5
        ? fn(id, prompt, selector, now, deriveScheduleTitle(prompt))
        : fn(id, prompt, selector, now);
}
/** `createAfterScheduleRecord` 的跨版本包装。 */
export function createAfterRecord(id, prompt, afterSeconds, now) {
    return createRecord('createAfterScheduleRecord', id, prompt, afterSeconds, now);
}
/** `createAtScheduleRecord` 的跨版本包装。 */
export function createAtRecord(id, prompt, scheduledAt, now) {
    return createRecord('createAtScheduleRecord', id, prompt, scheduledAt, now);
}
/** `createEveryScheduleRecord` 的跨版本包装。 */
export function createEveryRecord(id, prompt, everySeconds, now) {
    return createRecord('createEveryScheduleRecord', id, prompt, everySeconds, now);
}
/**
 * 周期提醒批次的 framing 渲染。
 *
 * 0.1.5 导出 `renderEveryReminderBatchFraming`，0.1.7 改名为
 * `renderRecurringReminderBatchFraming`（并扩展到 daily/weekly/cron，本插件
 * 只产生 `every` 记录）。两代参数与返回结构一致，按存在性择一。
 */
export function renderRecurringBatchFraming(reminders) {
    const render = pick('renderEveryReminderBatchFraming') ??
        pick('renderRecurringReminderBatchFraming');
    if (typeof render !== 'function') {
        throw new Error('dsh-later: dsh-schedule exposes neither renderEveryReminderBatchFraming ' +
            'nor renderRecurringReminderBatchFraming — unsupported kernel generation.');
    }
    return render(reminders);
}
/**
 * 提醒注入消息的 `source`。
 *
 * 0.1.5 的 `MessageSourceMap` 含 `plugin: { kind:'plugin'; plugin:string }`；
 * 0.1.7 **删除了 `plugin` 与 `host` 两个 kind**，改由内核为每个生产者登记
 * 具名 kind。官方 `dsh-schedule` 在 0.1.7 里注入提醒用的正是
 * `source: { kind: 'schedule' }`（见其 `lib/index.js` 的 `agent.followup` 调用点）
 * —— 与本插件投递的语义一致，故 0.1.7 走 `schedule`。
 *
 * `form:'notice'` + `summary` 两代都在（`ContextFormed` 未变），保留。
 *
 * 不能用具名类型断言跨代：source 的字面量 union 在两代不同，断言只会把
 * 编译错误推迟到运行期。
 */
export function scheduleMessageSource(boundedSummary) {
    const base = { form: 'notice', summary: boundedSummary };
    // 0.1.7 已删除 'plugin'；`schedule` 与 renderRecurringReminderBatchFraming
    // 同属 0.1.7 引入，二者同时存在即为 0.1.7+。
    const isV17 = pick('renderRecurringReminderBatchFraming') !== undefined;
    return isV17
        ? { kind: 'schedule', ...base }
        : { kind: 'plugin', plugin: PLUGIN_LABEL, ...base };
}
/**
 * `foldScheduleEvents` 结果的读视图收窄。
 *
 * 0.1.5 的 `FoldedSchedules.active` 是 `ScheduleRecord[]`；0.1.7 改为
 * `LegacyScheduleRecord[]`（title 可选）。本插件只消费 `id` / `kind` /
 * `prompt` / `afterSeconds` / `everySeconds` / `scheduledAt`，这些字段在
 * `Legacy*` 视图中全部存在，故收窄无损。
 */
export function asLegacySchedules(folded) {
    return folded;
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
export function toChangePayload(record) {
    return record;
}
/**
 * `foldScheduleEvents().active` 元素的读取侧类型。
 *
 * 0.1.5 直接返回 `ScheduleRecord`；0.1.7 返回 `LegacyScheduleRecord`
 * （title 可选，因为历史事件没有）。本插件读路径只在 title 存在时展示，
 * 缺失时回退到 prompt——故按 Legacy 收窄是**语义正确**的，而非绕过检查。
 */
export function asLegacyRecords(records) {
    return records;
}
