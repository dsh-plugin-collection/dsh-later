/**
 * 分组状态 **facet** 的纯逻辑面（issue #36）。
 *
 * dsh-later 自己向 dsh-group-status 注册「定时任务」facet，于是折叠徽标的数字、色档、
 * 脉冲、文案都由**状态所有者**判定，不再由消费方按具名字段 + 色档反推。契约见
 * group-status 仓库 [`docs/facet-protocol.md`](https://github.com/dsh-plugin-collection/dsh-group-status/blob/main/docs/facet-protocol.md)（协议 v1）。
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
import { type GroupScheduleSummary, type ScheduleSummaryMap } from './schedule-summary.js';
/** facet id：`'<包名>.<状态名>'`，与过渡适配器同名，注册即顶掉它（同 id 由来源决胜）。 */
export declare const LATER_SCHEDULE_FACET_ID = "dsh-later.schedule";
/** 本文件实现的协议版本（provider 必须原样填进 `protocol`；对不上对方会拒绝登记）。 */
export declare const LATER_SCHEDULE_FACET_PROTOCOL = 1;
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
export declare const GROUP_BADGE_SETTING_KEY = "showInGroupBadge";
/** 读开关所需的最小快照视图（两代 harness 的 scope 快照都落在这个形状里）。 */
export interface GroupBadgeSettingSnapshot {
    readonly status: string;
    readonly value?: unknown;
}
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
export declare function isGroupBadgeVisible(snapshot: GroupBadgeSettingSnapshot): boolean;
/** 图标排列顺序：沿用过渡适配器的 10，注册前后时钟在徽标排格里的位置不动。 */
export declare const LATER_SCHEDULE_FACET_ORDER = 10;
/** 徽标可用的三档语义色（对方色板；本插件只选档，不选具体颜色）。 */
export type FacetTone = 'info' | 'warn' | 'error';
/**
 * 语义色档 → 宿主色令牌。
 *
 * 三个值与本仓 `client/styles.ts` 的 `.ss-presence` 色档同源（紫为定时专属，浅深底
 * 对比均 ≥3:1；urgent / overdue 走宿主 warn / error 别名），也与过渡适配器画的一致，
 * 所以行内 badge 与折叠徽标不会出现「同一件事两种颜色」。
 */
export declare const FACET_TONE_COLOR: Readonly<Record<FacetTone, string>>;
/**
 * 取图标颜色，**未知色档回落 info**。
 *
 * 不是防御性编程的仪式感：协议明文「加新的 `tone` 取值不升版本」。对方哪天多给一档
 * 颜色，这里若直接下标取值就会拿到 `undefined`，于是 `style.color` 缺省、图标跟着
 * 主题色走——徽标换了颜色而不报错，正是这个 issue 要消灭的那类静默漂移。
 * @param tone - 折果里的色档。
 * @returns 可用的 CSS 颜色值。
 */
export declare function facetIconColor(tone: FacetTone | string): string;
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
 * 状态 → 色档：overdue 红、urgent 橙、其余（含无任务）紫。与过渡适配器逐档一致。
 * @param state - 组内最高优先级状态；无任务时 undefined。
 * @returns 徽标色档。
 */
export declare function toneOfState(state: PresenceBadgeState | undefined): FacetTone;
/**
 * 要不要脉冲。
 *
 * 只有「到点了还没送出去」（overdue）和「马上到点」（urgent，≤5min）才催用户；
 * 排好了等会儿再说的任务不闪。这与行内 badge 的动画口径相同（styles.ts 里
 * scheduled 走恒定呼吸、urgent 才 pulse、overdue 停动画），别在这里改成「一直闪」。
 * @param state - 组内最高优先级状态。
 * @returns 是否脉冲。
 */
export declare function pulseOfState(state: PresenceBadgeState | undefined): boolean;
/**
 * 把一组会话折成徽标事实。
 *
 * 纯函数：同样的 `(snapshot, sessionIds)` 必给同样的结果——它在对方每次渲染里被调用。
 * @param snapshot - 摘要快照；store 还没产出数据时 undefined（按「此刻无贡献」处理）。
 * @param sessionIds - 组内会话 id（顺序无关；对方按前缀原样传，口径归本插件判定）。
 * @returns 徽标事实。
 */
export declare function foldLaterSchedule(snapshot: ScheduleSummaryMap | undefined, sessionIds: readonly string[]): LaterFacetFold;
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
export declare function mergeLaterSchedule(a: LaterFacetFold, b: LaterFacetFold): LaterFacetFold;
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
export declare function laterScheduleFacetLabel(fold: LaterFacetFold, word: string): string;
