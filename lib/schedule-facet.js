import { STATE_RANK, summarizeScheduleGroup } from './schedule-summary.js';
/** facet id：`'<包名>.<状态名>'`，与过渡适配器同名，注册即顶掉它（同 id 由来源决胜）。 */
export const LATER_SCHEDULE_FACET_ID = 'dsh-later.schedule';
/** 本文件实现的协议版本（provider 必须原样填进 `protocol`；对不上对方会拒绝登记）。 */
export const LATER_SCHEDULE_FACET_PROTOCOL = 1;
/**
 * 本插件自己的「在分组徽标中显示定时任务」开关，在 `Config` 里的字段名（issue #83）。
 *
 * 这个位置原来站的是 group-status 的 `showScheduledInBadge`——协议 v1 的 `settingKey`，
 * 语义是「我受**消费方**哪个开关管」。它 #37 把那个字段废弃了：那等于把别人家的域名、
 * 来源名和图标形状写死在消费方的配置面里，与它「不认识任何具体来源」直接矛盾。
 * 现在协议只有一条规则：**登记即显示，不注册即不显示**，开关归状态所有者自己。
 *
 * 所以本常量的语义换了边：它不再交给对端，而是**本插件设置卡的字段名**，关掉时本插件
 * 不去登记 facet。三处字面量（host `Config`、设置卡 SECTIONS、下面的读取处）由
 * `tests/group-badge-visibility.test.mjs` 锁成同一份——写错不会报错，只会让开关失灵。
 */
export const GROUP_BADGE_SETTING_KEY = 'showInGroupBadge';
/**
 * 「在分组徽标中显示定时任务」当前是否生效。
 *
 * 只有**显式 false** 才算关。`status !== 'ready'`（还在加载、或该 namespace 不可用）、
 * 字段缺失、值不是布尔，一律按 schema 默认「显示」处理——理由与 `showButton` 同源：
 * 读不到设置面就把用户本来看得见的东西关掉，是拿「我看不见」冒充「用户不要」。
 * 反过来的代价是「用户以为关了但还显示」，那是刷新一下就自愈的显示问题；而这条写反
 * 是徽标凭空少一格、且没有任何地方解释为什么少。
 *
 * @param snapshot - 本插件设置 scope 的原始快照。
 * @returns 是否应当登记 facet。
 */
export function isGroupBadgeVisible(snapshot) {
    if (snapshot.status !== 'ready')
        return true;
    const value = (snapshot.value ?? {});
    return value[GROUP_BADGE_SETTING_KEY] !== false;
}
/** 图标排列顺序：沿用过渡适配器的 10，注册前后时钟在徽标排格里的位置不动。 */
export const LATER_SCHEDULE_FACET_ORDER = 10;
/**
 * 语义色档 → 宿主色令牌。
 *
 * 三个值与本仓 `client/styles.ts` 的 `.ss-presence` 色档同源（紫为定时专属，浅深底
 * 对比均 ≥3:1；urgent / overdue 走宿主 warn / error 别名），也与过渡适配器画的一致，
 * 所以行内 badge 与折叠徽标不会出现「同一件事两种颜色」。
 */
export const FACET_TONE_COLOR = {
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
export function facetIconColor(tone) {
    return tone === 'warn' ? FACET_TONE_COLOR.warn : tone === 'error' ? FACET_TONE_COLOR.error : FACET_TONE_COLOR.info;
}
/**
 * 空快照（store 还没产出数据时用它代替「undefined 到处判」）。
 *
 * 常量而非每次 `new Map()`：`fold` 在对方**每次渲染**里都会被调用，为一个永远为空
 * 的映射反复分配没有意义。
 */
const NO_SCHEDULES = new Map();
/**
 * 状态 → 色档：overdue 红、urgent 橙、其余（含无任务）紫。与过渡适配器逐档一致。
 * @param state - 组内最高优先级状态；无任务时 undefined。
 * @returns 徽标色档。
 */
export function toneOfState(state) {
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
export function pulseOfState(state) {
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
export function foldLaterSchedule(snapshot, sessionIds) {
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
export function mergeLaterSchedule(a, b) {
    const state = moreUrgent(a.data.state, b.data.state);
    const nextAt = earliestNextAt(a.data.nextAt, b.data.nextAt);
    const group = nextAt === undefined
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
function moreUrgent(a, b) {
    if (a === undefined)
        return b;
    if (b === undefined)
        return a;
    return STATE_RANK[b] > STATE_RANK[a] ? b : a;
}
/** 更早的触发时刻；两边都没有（全部暂停 / 无任务）时 undefined。 */
function earliestNextAt(a, b) {
    if (a === undefined)
        return b;
    if (b === undefined)
        return a;
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
export function laterScheduleFacetLabel(fold, word) {
    return word === '' ? '' : `${fold.count} ${word}`;
}
