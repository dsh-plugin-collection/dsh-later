/**
 * 分组状态 **facet** 的纯逻辑面（issue #36）。
 *
 * dsh-later 自己向 dsh-group-status 注册「定时任务」facet，于是折叠徽标的数字、色档、
 * 脉冲、文案都由**状态所有者**判定，不再由消费方按具名字段 + 色档反推。契约见
 * group-status 仓库 [`docs/facet-protocol.md`](http://192.168.4.77:3000/dsh-plugins/dsh-group-status/src/branch/main/docs/facet-protocol.md)（协议 v1）。
 *
 * 为什么再拆一层（与本仓 `schedule-summary.ts` / client 组件同一姿态）：
 *  - 本文件**零 React、零 DOM**，`node --test` 直接跑。「徽标数字与 label 同口径」
 *    「多层合并不改色档判定」这类不变式因此有单测，而不是靠肉眼看一次徽标；
 *  - `src/client/group-status-facet.ts` 只做两件事：`require('dsh-group-status/client')`
 *    的容错，与画图标（宿主图标集的 `require` 图在 `node --test` 里解析不了，逻辑跟它
 *    分不开就永远进不了测试——group-status 切 `badge-labels.ts` 用的是同一条理由）。
 *
 * **基线是什么**：迁移前这件事由 group-status 的过渡适配器
 * `src/client/legacy/schedule.ts` 代管，它的输出就是验收基线——`count` 取「组内**有任务**
 * 的会话数」、overdue / urgent 才脉冲、文案 `N 定时任务` / `N Scheduled`。本文件与它
 * 逐字段对齐；注册后徽标若有任何一处与迁移前不同，要么是本仓语义写错，要么是对方
 * bug，两种都回 issue #36 说一声，而不是顺手改口径。
 * @module dsh-later/schedule-facet
 */
import type { PresenceBadgeState } from './presence.js';
import { STATE_RANK, summarizeScheduleGroup, type GroupScheduleSummary, type ScheduleSummaryMap } from './schedule-summary.js';

/** facet id：`'<包名>.<状态名>'`，与过渡适配器同名，注册即顶掉它（同 id 由来源决胜）。 */
export const LATER_SCHEDULE_FACET_ID = 'dsh-later.schedule';

/** 本文件实现的协议版本（provider 必须原样填进 `protocol`；对不上对方会拒绝登记）。 */
export const LATER_SCHEDULE_FACET_PROTOCOL = 1;

/** 挂到 group-status 已有的布尔开关上：用户关掉的还是同一个开关，设置不丢。 */
export const LATER_SCHEDULE_FACET_SETTING_KEY = 'showScheduledInBadge';

/** 图标排列顺序：沿用过渡适配器的 10，注册前后时钟在徽标排格里的位置不动。 */
export const LATER_SCHEDULE_FACET_ORDER = 10;

/** 徽标可用的三档语义色（对方色板；本插件只选档，不选具体颜色）。 */
export type FacetTone = 'info' | 'warn' | 'error';

/**
 * 语义色档 → 宿主色令牌。
 *
 * 三个值与本仓 `client/styles.ts` 的 `.ss-presence` 色档同源（紫为定时专属，浅深底
 * 对比均 ≥3:1；urgent / overdue 走宿主 warn / error 别名），也与过渡适配器画的一致，
 * 所以行内 badge 与折叠徽标不会出现「同一件事两种颜色」。
 */
export const FACET_TONE_COLOR: Readonly<Record<FacetTone, string>> = {
  info: '#8b5cf6',
  warn: 'var(--dsw-alias-state-warn-secondary)',
  error: 'var(--dsw-alias-state-error-primary)',
};

/**
 * 取图标颜色，**未知色档回落 info**。
 *
 * 不是防御性编程的仪式感：协议明文「加新的 `tone` 取值不升版本」。对方哪天多给一档
 * 颜色，这里若直接下标取值就会拿到 `undefined`，于是 `style.color` 缺省、图标跟着
 * 主题色走——徽标换了颜色而不报错，正是这个 issue 要消灭的那类静默漂移。
 * @param tone - 折果里的色档。
 * @returns 可用的 CSS 颜色值。
 */
export function facetIconColor(tone: FacetTone | string): string {
  return tone === 'warn' ? FACET_TONE_COLOR.warn : tone === 'error' ? FACET_TONE_COLOR.error : FACET_TONE_COLOR.info;
}

/** 一个 facet 折出来的事实（协议形状；`data` 是本插件私有形状，对方从不读）。 */
export interface LaterFacetFold {
  /** 贡献给徽标数字的条数：组内**有任务的会话数**（与行级读数同口径）。 */
  readonly count: number;
  readonly tone: FacetTone;
  readonly pulse: boolean;
  /** 私有形状：组级定时摘要，供 merge 与后续文案使用。 */
  readonly data: GroupScheduleSummary;
}

/**
 * 空快照（store 还没产出数据时用它代替「undefined 到处判」）。
 *
 * 常量而非每次 `new Map()`：`fold` 在对方**每次渲染**里都会被调用，为一个永远为空
 * 的映射反复分配没有意义。
 */
const NO_SCHEDULES: ScheduleSummaryMap = new Map();

/**
 * 状态 → 色档：overdue 红、urgent 橙、其余（含无任务）紫。与过渡适配器逐档一致。
 * @param state - 组内最高优先级状态；无任务时 undefined。
 * @returns 徽标色档。
 */
export function toneOfState(state: PresenceBadgeState | undefined): FacetTone {
  return state === 'overdue' ? 'error' : state === 'urgent' ? 'warn' : 'info';
}

/**
 * 要不要脉冲。
 *
 * 只有「到点了还没送出去」（overdue）和「马上到点」（urgent，≤5min）才催用户；
 * 排好了等会儿再说的任务不闪。这与行内 badge 的动画口径相同（styles.ts 里
 * scheduled 走恒定呼吸、urgent 才 pulse、overdue 停动画），别在这里改成「一直闪」。
 * @param state - 组内最高优先级状态。
 * @returns 是否脉冲。
 */
export function pulseOfState(state: PresenceBadgeState | undefined): boolean {
  return state === 'overdue' || state === 'urgent';
}

/**
 * 把一组会话折成徽标事实。
 *
 * 纯函数：同样的 `(snapshot, sessionIds)` 必给同样的结果——它在对方每次渲染里被调用。
 * @param snapshot - 摘要快照；store 还没产出数据时 undefined（按「此刻无贡献」处理）。
 * @param sessionIds - 组内会话 id（顺序无关；对方按前缀原样传，口径归本插件判定）。
 * @returns 徽标事实。
 */
export function foldLaterSchedule(
  snapshot: ScheduleSummaryMap | undefined,
  sessionIds: readonly string[],
): LaterFacetFold {
  const group = summarizeScheduleGroup(snapshot ?? NO_SCHEDULES, sessionIds);
  return {
    count: group.sessions,
    tone: toneOfState(group.state),
    pulse: pulseOfState(group.state),
    data: group,
  };
}

/**
 * 合并同一 facet 在子树两层的折果（多层文件夹）。
 *
 * 会话数、任务数、暂停数各自相加，`nextAt` 取更早的一档，`state` 取更紧急的一档，
 * 色档与脉冲**由合并后的 state 现算**而不是 `a.pulse || b.pulse`：结果与过渡适配器
 * 一致（pulse 恰是 state 的函数），少一个「两处判定各写一遍」的漂移点。
 * @param a - 本层折果。
 * @param b - 子层折果。
 * @returns 合并后的折果。
 */
export function mergeLaterSchedule(a: LaterFacetFold, b: LaterFacetFold): LaterFacetFold {
  const state = moreUrgent(a.data.state, b.data.state);
  const nextAt = earliestNextAt(a.data.nextAt, b.data.nextAt);
  const group: GroupScheduleSummary = nextAt === undefined
    ? {
        sessions: a.data.sessions + b.data.sessions,
        count: a.data.count + b.data.count,
        pausedCount: a.data.pausedCount + b.data.pausedCount,
        ...(state === undefined ? {} : { state }),
      }
    : {
        sessions: a.data.sessions + b.data.sessions,
        count: a.data.count + b.data.count,
        pausedCount: a.data.pausedCount + b.data.pausedCount,
        nextAt,
        ...(state === undefined ? {} : { state }),
      };
  return { count: group.sessions, tone: toneOfState(state), pulse: pulseOfState(state), data: group };
}

/** 更紧急的一档（overdue > urgent > scheduled）；两边都没有时 undefined。 */
function moreUrgent(
  a: PresenceBadgeState | undefined,
  b: PresenceBadgeState | undefined,
): PresenceBadgeState | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return STATE_RANK[b] > STATE_RANK[a] ? b : a;
}

/** 更早的触发时刻；两边都没有（全部暂停 / 无任务）时 undefined。 */
function earliestNextAt(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return b < a ? b : a;
}

/**
 * 进徽标 `aria-label` / `title` 与悬停明细的那句话。
 *
 * `count` 与文案**同源**：句子只念折果里的数字，绝不另算一份任务数，否则会出现
 * 「徽标显示 2、明细写 5 条任务」这种让界面撒谎的读法（措辞是否要说清「2 会话 · 5 条
 * 任务」是另一件事，得连过渡基线一起改，见 issue #36 的口径决定）。
 * @param fold - 折果（合并后的也一样）。
 * @param word - 「定时任务 / Scheduled」这个词，由调用方按当前语言取。
 * @returns 文案；`word` 为空串时返回空串（协议把空串当作「我没有文案」）。
 */
export function laterScheduleFacetLabel(fold: LaterFacetFold, word: string): string {
  return word === '' ? '' : `${fold.count} ${word}`;
}
