/**
 * 侧栏会话行「定时状态」badge（设计稿 docs/ui/09 路线 B：DOM 注入）。
 *
 * 数据源（零宿主改动）：`sessions.list` 快照里每行 summary 携带
 * `projectionValues.userSchedules` —— `session.list` 基线为全会话携带
 * projections 块（live 走注册表现值、冷会话走持久化投影缓存），当前打开的
 * 会话由 `session/projection` mux 帧实时推进并合入同一快照。
 *
 * ⚠️ 本模块**不直接读** `sessions.list`，而是消费
 * `src/schedule-summary-store.ts` 的摘要 store：store 内部订阅列表变化、周期
 * `sessions.refresh()`（session.list 读 RPC，不写会话日志）补时效，并在 30s
 * 状态 tick 上重算 `scheduled/urgent/overdue`。这样「外部插件读到的摘要」与
 * 「本插件侧栏 badge」必然同源（issue #17）；本模块只保留 30s 本地 tick 以刷新
 * 相对时间文案（零网络）。
 *
 * 行→会话映射：行元素向上走 ≤8 层 React fiber，取 `memoizedProps.node.id`
 * （ui-workspace 会话行的行数据，实测深度 3）。**禁止**依赖 `YDXeBa_*` 等
 * 构建期 hash 类名；探测失败时安静跳过（badge 缺失，绝不误标）。
 *
 * 安静跳过的代价由**漂移自检**兜住：摘要里有提醒、而会话行选择器命中 0 行时，
 * 按 `console.warn` 提示一次「宿主 DOM 可能已改版」（每轮漂移一次，命中即复位），
 * 免得整块消失被读成「用户就是没有提醒」。全部宿主结构字符串见 `HOST_DOM` 块。
 *
 * 插入策略：行首子元素是状态 slot —— slot 内已有 svg（进行中 orb）时 badge
 * 插在 slot 之后（`.ss-presence-beside`），否则塞进 slot 内（与 orb 同位）。
 * badge 元素带 `.ss-presence` 类，全部状态用 data-state 表达；React 重渲染
 * 移除注入节点时由 MutationObserver 重插。
 *
 * ## 悬浮卡片状态区增补（issue #4）
 *
 * 行内 badge 与宿主悬浮卡片数据源不一致：卡片正文由宿主 `sessionStatuses`
 * 的**闭合硬编码状态链**生成（只读 subagents / pendingInteraction / running
 * / completed），`userSchedules` 不在其中，且宿主**没有对外暴露任何 hover
 * 卡片插槽**（ui-conversation / ui-sidebar / ui-workspace 的 SlotMap 里均无
 * hover 相关槽位）。因此卡片侧不存在注册式扩展点，只能在 DOM 层增补。
 *
 * 可行性的关键事实（实测）：卡片是挂在 `document.body` 下的 portal，**不与
 * 宿主行共享 DOM 祖先**，无法靠行元素找过去；但卡片的 React fiber 在浅层
 * （实测深度 4）携带 `memoizedProps.node.id`，与行元素用的是**同一套反查
 * 技术**，因此仍能把卡片关联回 sessionId。
 *
 * 增补方式**原本是纯追加**（issue #4 的决策：只在状态区末尾追加一行，绝不改写宿主的
 * 状态行，好让 pendingInteraction / running 的优先级天然不变），**已被 issue #153 推翻**。
 * 两条理由，一条是用户的，一条是实测的：
 *
 *  1. **纯追加读起来是错的**。有定时待发任务的会话，卡片里并排出现「● 空闲」和
 *     「🕒 有 1 条定时提醒，下次 23:15」——用户先看到「空闲」，而那个「空闲」在这个语境里
 *     根本不成立：到点会自动发出去，会话是被安排了事的。反馈原话是「状态区应合并而不是
 *     并列」。同类插件 `dsh-group-status` 在同一个行/卡上聚合状态时空闲从不单独成句，
 *     也是这个读感。（所以这里不是「加一行」的问题，是「同一句话说了两种状态」的问题。）
 *  2. **纯追加这条其实一直没生效**。宿主卡片比当初记的形状多包了一层：
 *     `body > span._portal_* > div._card_* > div.hoverContent`，而旧代码只看
 *     `card.firstElementChild` 的直接子元素，于是状态区永远定位不到、插件行在所有会话
 *     上都没注入过（真 DOM 取证见 {@link findHoverCard} 的注释）。#153 报的是"看不到合并"，
 *     实际先是"什么都看不到"。
 *
 * 现在的规则是**按宿主档位分叉的合并**，边界只有一句：**只动 idle 这一档**。
 *  - 宿主是「空闲」⇒ 把那一行的**文案**替换成插件的定时文案（点节点、行结构、类名一概
 *    不碰，也**不做「空闲 · 定时中」这种拼接**——拼接等于把错的那句留着）；
 *  - 宿主是**任何非空闲档**（进行中 / 等待审批 / 计划待审 / 待回答 / 已完成）⇒ 宿主行
 *    **一字不改**，插件行追加在后：agent 正在做的事比定时安排更高优先级，不能被替换；
 *  - **没有**活动定时任务 ⇒ 一个节点都不碰：替换过的还原原文案、追加过的删掉，卡片字节级
 *    回到宿主自己渲染的样子（这条是回归面，也是卸载路径的收尾）。
 * 改动全程可逆：接管只写 `data-ss-*` 标记并把原文案存在节点上，重扫（MutationObserver）
 * 与卸载都走 {@link restoreAdoptedRow}。卡片每次悬浮由 React 重建子树，标记跟着节点一起消失。
 *
 * 判「是不是空闲」**优先用结构化判据**：状态点上的 `data-state="idle"`（实测宿主只在这里
 * 表达档位，`ongoing` 甚至是另一个元素 `svg`）。文案白名单只在属性缺席时兜底。
 * 详见 `HOST_DOM` 块与 `docs/design-decisions.md` §11。
 * @module dsh-later/client/session-presence
 */
import {
  badgeStateFor,
  hoverScheduleStatus,
  progressOf,
  relativeFireLabel,
  type PresenceBadgeState,
  type RelativeFireLabels,
} from '../presence.js';
import type { ScheduleSummaryEntry, ScheduleSummaryMap } from '../schedule-summary.js';
import type { ScheduleSummaryStore } from '../schedule-summary-store.js';
import { dictFor, format, type SchedStrings } from './strings.js';

/** 宿主 locale 服务的结构化子集。 */
export interface PresenceLocaleLike {
  getSnapshot(): { active: string };
  subscribe(fn: () => void): () => void;
}

export interface SessionPresenceOptions {
  /**
   * 定时摘要 store（`src/schedule-summary-store.ts`）。本模块**不再**自己读
   * `sessions.list`、也不再自己周期 `refresh()`——数据权威只有一个，外部插件
   * （dsh-group-status）读到的与本插件侧栏 badge 必然一致（issue #17）。
   */
  readonly summary: ScheduleSummaryStore;
  readonly locale?: PresenceLocaleLike;
  /** 获取时钟图标风格的函数（支持动态获取最新设置）。 */
  readonly getClockIconStyle?: () => 'auto' | 'modern' | 'classic';
}

/** badge 类名（本插件命名空间，绝不复用宿主类名）。 */
const BADGE_CLASS = 'ss-presence';
/** 悬浮卡片增补行类名（本插件命名空间）。 */
const HOVER_ROW_CLASS = 'ss-hover-status';
/**
 * 被本插件「接管文案」的宿主空闲行上的标记属性（见 {@link adoptIdleRow}）。
 * 卸载时要按它把宿主原文案还原回来——不能依赖卡片还能被定位，卸载时卡片可能已经换了形状。
 */
const ADOPTED_ROW_SELECTOR = '[data-ss-adopted]';
/** fiber 探测的最大上溯层数（实测深度 3；留余量到 8）。 */
const FIBER_MAX_DEPTH = 8;

/**
 * ## 宿主 DOM 结构耦合：唯一清单
 *
 * 本模块靠结构探测定位宿主的会话行与悬浮卡片，**以下每一项都是一处对宿主实现
 * 的假设**（散落在函数里时跨宿主代次排查极易漏看，故集中于此）。语义一律不变，
 * 这里只是「搬家」：改动任何一条都必须同步 tests/presence-drift.test.mjs。
 *
 * 探测不到的处置是安静跳过（绝不误标），代价由 {@link reportSidebarDrift} 的
 * 漂移告警兜住——会话行那一条至少有信号，其余各条仍会静默降级。
 */
const HOST_DOM = Object.freeze({
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
  workspaceRowAttr: 'aria-expanded',
  /** 行首 slot 内的「进行中」orb 图标：存在即 badge 插到 slot 之后，否则塞进 slot。 */
  slotIcon: 'svg',
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
  statusDotTag: 'SPAN',
  statusDotAttr: 'aria-hidden',
  statusDotValue: 'true',
  /**
   * 状态点携带档位的属性名（结构化判据，见 {@link hostRowState}）。
   * 实测取值：`idle` / `ongoing` / `warning` / `done`（宿主 `sessionStatuses` 的闭合链）。
   */
  statusDotStateAttr: 'data-state',
  /** 「空闲」那一档的结构化值：判空闲**只认它**，文案白名单是属性缺席时的退路。 */
  idleStateValue: 'idle',
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
    '空闲', 'Idle', '待機中', 'inactivo', 'Inactif', 'Leerlauf', 'Простой', 'Inativo',
  ] as readonly string[],
  /** fiber 反查：React 内部 key 的前缀与会话 id 的前缀。 */
  fiberKeyPrefix: '__reactFiber$',
  sessionIdPrefix: 'session-',
});

/** 扫描去抖（流式输出期间 mutation 密集，合并到每帧级别足够）。 */
const SCAN_DEBOUNCE_MS = 60;
/** badge 状态重算周期（本地时钟，零网络）。 */
const STATE_TICK_MS = 30_000;

/**
 * 漂移告警是否已在本轮发出（**模块级**：跨 mount 共享，宿主热重载插件也不会再刷一条）。
 * 恢复时由扫描循环置回 false，见 {@link reportSidebarDrift} 的恢复条件。
 */
let sidebarDriftWarned = false;

/**
 * 有提醒却一行都不能标注 → 宿主 DOM 漂移告警（每轮漂移只报一次）。
 *
 * **判据**（两个条件同时成立才报）：
 * 1. `remindedSessions > 0`——摘要索引里确实有带定时提醒的会话，排除「用户就是没有提醒」
 *    这一最常见也最无害的解释；
 * 2. **排除工作区行之后**可标注行为 0。注意是"排除后"，不是"选择器命中 0"：
 *    2026-10-28 那次真漂移就是选择器命中 11 行（全是工作区行）、排除后 0 行，
 *    用"命中 0 行"当判据正好错过它。
 *
 * 两者同时成立几乎只有一种解释：宿主侧栏改版，badge 整块静默消失。这正是本模块
 * 「探测不到就安静跳过」策略唯一的盲区（其余降级仍静默，见 HOST_DOM 块说明）。
 *
 * **只报一次**：扫描由 60ms 去抖的 MutationObserver 驱动，逐次刷屏会打死控制台，
 * 也会把真问题淹在噪音里（同 `group-status-facet` / `schedule-compat` 的克制法）。
 *
 * **恢复条件**：后续任意一次扫描有 ≥1 行可标注即把标志置回 false。于是
 * 「漂移 → 告警 → 修好（或宿主自己回来了） → 再次漂移」这条链上每一轮漂移各告警
 * 一次，而不是整个页面生命周期只告警一次——后者会让第二次改版重新变成静默失效。
 *
 * **已知代价**：侧栏尚未挂载（首屏极早期、侧栏收起）同样命中「有提醒 + 可标注 0 行」，
 * 此时会多出一条告警。刻意不加「树容器必须存在」这类额外前置条件：加了就会稀释上面
 * 那条判据、把真漂移也一起吞掉。权衡后接受——它一次只多一行、文案点名的是具体
 * 选择器与两个计数，而 badge 缺失本就是用户需要知道的降级。
 *
 * **fail-open**：整段包在 try/catch 里（控制台可能被 stub 或抛错），告警失败绝不影响
 * badge 渲染路径；调用点也在渲染循环之外，不改变任何探测语义。
 *
 * @param remindedSessions - 本次摘要索引的条目数（`index.size`）。
 * @param matched - 选择器命中的行数（排除前）。
 * @param badgeable - 排除工作区行后可标注的行数。
 */
function reportSidebarDrift(remindedSessions: number, matched: number, badgeable: number): void {
  if (sidebarDriftWarned) return;
  sidebarDriftWarned = true;
  try {
    console.warn(
      `dsh-later: 侧栏 badge 未注入——选择器 \`${HOST_DOM.sessionRow}\` 命中 ${matched} 行，`
        + `但排除带 \`${HOST_DOM.workspaceRowAttr}\` 的工作区行后**可标注 0 行**（badgeable=${badgeable}），`
        + `而摘要里有 ${remindedSessions} 个带定时提醒的会话。这不是「用户没有提醒」，`
        + '而是本模块的结构探测对不上宿主 DOM（宿主侧栏很可能已改版）。'
        + `排查只看 src/client/session-presence.ts 顶部的 HOST_DOM 耦合块：逐条核对行选择器与 ${HOST_DOM.workspaceRowAttr} 排除规则。`
        + '（本轮漂移只提示一次；一旦重新有可标注行即复位，下次改版会再提示。）',
    );
  } catch {
    /* 告警出口本身失败不影响渲染；标志保持已置位，不会因此刷屏 */
  }
}
/** 旧版时钟 glyph（10×10 crispEdges，外圈 8 方块 + 上/右指针，中心留空）。 */
export const CLOCK_SVG_CLASSIC =
  '<svg width="10" height="10" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true">' +
  '<g class="ss-presence-ring">' +
  '<rect x="0" y="0" width="2" height="2"/><rect x="4" y="0" width="2" height="2"/>' +
  '<rect x="8" y="0" width="2" height="2"/><rect x="8" y="4" width="2" height="2"/>' +
  '<rect x="8" y="8" width="2" height="2"/><rect x="4" y="8" width="2" height="2"/>' +
  '<rect x="0" y="8" width="2" height="2"/><rect x="0" y="4" width="2" height="2"/>' +
  '</g>' +
  '<g class="ss-presence-hand">' +
  '<rect x="4" y="2" width="2" height="2"/><rect x="6" y="4" width="2" height="2"/>' +
  '</g></svg>';

/** 新版表盘半径（viewBox 24 用户单位）。 */
const CLOCK_FACE_R = 9.5;
/**
 * 表盘周长。进度弧用 `stroke-dasharray = 周长` + 可变 `stroke-dashoffset`
 * 表达"已过比例"：offset = 周长 × (1 − 比例)，写满周长即 0%。
 */
const CLOCK_FACE_CIRCUMFERENCE = 2 * Math.PI * CLOCK_FACE_R;

/**
 * 新版时钟 glyph（24×24 stroke 圆头线帽）—— 方案 A：双环。
 *
 * `ss-clock-track` 是恒定底环，给出「总窗口」的视觉参照；`ss-clock-prog` 是
 * 进度弧，从 12 点顺时针填充（`rotate(-90 12 12)` 把 SVG 默认的 3 点起点挪到
 * 12 点）。时针分针原样保留，不动。
 *
 * 初始 `dashoffset` 直接写满周长（= 0%），插入后由 {@link applyProgress} 按真实
 * 比例改写。**无从算进度时那条弧会被隐藏**，于是退回改造前的"恒定整环" ——
 * 旧形状即新形状的退化态，不需要分支渲染。
 */
export const CLOCK_SVG_MODERN =
  '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
  `<circle class="ss-clock-track" cx="12" cy="12" r="${CLOCK_FACE_R}"/>` +
  `<circle class="ss-clock-prog" cx="12" cy="12" r="${CLOCK_FACE_R}" ` +
  `stroke-dasharray="${CLOCK_FACE_CIRCUMFERENCE.toFixed(3)}" ` +
  `stroke-dashoffset="${CLOCK_FACE_CIRCUMFERENCE.toFixed(3)}" ` +
  'transform="rotate(-90 12 12)"/>' +
  '<g class="ss-clock-hand">' +
  '<line class="ss-clock-hand-h" x1="12" y1="12" x2="12" y2="6.5"/>' +
  '<line class="ss-clock-hand-m" x1="12" y1="12" x2="17" y2="12"/>' +
  '</g></svg>';

const hhmmFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const formatHhmm = (epoch: number): string => hhmmFormatter.format(epoch);
const formatDate = (epoch: number): string => dateFormatter.format(epoch);

/** React fiber 节点的结构化子集（内部字段，仅读）。 */
interface FiberNodeLike {
  readonly return?: FiberNodeLike;
  readonly memoizedProps?: { readonly node?: { readonly id?: unknown } };
}

/** 会话行 → sessionId：向上 ≤8 层 fiber，取 `memoizedProps.node.id`（session- 前缀）。 */
function sessionIdOfRow(row: Element): string | undefined {
  return sessionIdOfNode(row);
}

/**
 * 悬浮卡片 → sessionId。
 *
 * 卡片是 `document.body` 下的 portal，与宿主会话行没有 DOM 祖先关系，只能靠
 * fiber 反查；实测从卡片根上溯第 4 层即 `SessionNode`（携带 node.id），与行
 * 元素同源。探测失败返回 undefined（安静跳过，绝不误标）。
 */
function sessionIdOfHoverCard(card: Element): string | undefined {
  return sessionIdOfNode(card);
}

/** 共享的 fiber 反查：向上 ≤8 层取 `memoizedProps.node.id`（session- 前缀）。 */
function sessionIdOfNode(element: Element): string | undefined {
  const host = element as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(host).find((key) => key.startsWith(HOST_DOM.fiberKeyPrefix));
  if (fiberKey === undefined) return undefined;
  let fiber = host[fiberKey] as FiberNodeLike | undefined;
  for (let depth = 0; fiber !== undefined && depth < FIBER_MAX_DEPTH; depth += 1, fiber = fiber.return) {
    const node = fiber.memoizedProps?.node;
    const id = node?.id;
    if (typeof id === 'string' && id.startsWith(HOST_DOM.sessionIdPrefix)) return id;
  }
  return undefined;
}

/** 取当前摘要索引：先拉最新快照（store 是唯一数据权威），再读缓存。 */
function currentIndex(summary: ScheduleSummaryStore): ScheduleSummaryMap {
  summary.reload();
  return summary.getSnapshot();
}

/** 找行内已注入的 badge（slot 内或 slot 后；不越界到嵌套子行）。 */
function findBadge(row: HTMLElement): HTMLElement | null {
  for (const child of Array.from(row.children)) {
    if (child.classList.contains(BADGE_CLASS)) return child as HTMLElement;
    const inside = child.querySelector(`:scope > .${BADGE_CLASS}`);
    if (inside !== null) return inside as HTMLElement;
  }
  return null;
}

/** 相对时间文案槽位（按语言组装）。 */
function labelsFor(dict: SchedStrings): RelativeFireLabels {
  return {
    imminent: dict.dueAnyMoment,
    minutes: (m) => format(dict.relMinutes, { m }),
    hours: (h) => format(dict.relHours, { h }),
    tomorrow: (time) => format(dict.relTomorrow, { time }),
    clock: (time) => format(dict.relClock, { time }),
    date: (date, time) => format(dict.relDate, { date, time }),
  };
}

/**
 * 挂载侧栏 badge 层。返回卸载函数（断开 observer、清理定时器/订阅，并移除
 * 已注入的 badge 节点）。
 */
export function mountSessionPresence(options: SessionPresenceOptions): () => void {
  const { summary, locale, getClockIconStyle } = options;
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined;
  }

  // 根据设置选择 SVG：auto 时默认使用新版（modern），后续可接入版本检测
  const getClockSvg = (): string => {
    const style = getClockIconStyle?.() ?? 'auto';
    return style === 'classic' ? CLOCK_SVG_CLASSIC : CLOCK_SVG_MODERN;
  };

  let index: ScheduleSummaryMap = new Map<string, ScheduleSummaryEntry>();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const dictForNow = (): SchedStrings => dictFor(locale?.getSnapshot().active);

  /** 全量重扫：重建索引 + 按当前 DOM 对账 badge。 */
  const scan = (): void => {
    if (disposed) return;
    index = currentIndex(summary);
    const dict = dictForNow();
    const now = Date.now();
    const rows = Array.from(document.querySelectorAll<HTMLElement>(HOST_DOM.sessionRow));
    /**
     * 排除工作区行之后、真正能挂 badge 的行数。
     *
     * ⚠️ 漂移判据必须看这个数，**不能看排除前的 `rows.length`**。上一版写的是
     * `if (rows.length > 0) 复位`，注释还写着「命中过行 = 结构探测仍然对得上」——
     * 而真漂移的形态恰恰是「还命中一堆（工作区行），排除后一个不剩」。实测后果：
     * badge 自 0.1.7 起在 4 个代次整块不出现，这条自检一条都没告，等于它最该说话的时候
     * 沉默。判据错位比没有判据更糟，因为它提供虚假的安全感。
     */
    const badgeable = rows.filter((row) => !row.hasAttribute(HOST_DOM.workspaceRowAttr));
    // 漂移自检（fail-open，唯一副作用是一条 console.warn，见 reportSidebarDrift）。
    if (badgeable.length > 0) {
      // 确实有行可标注 = 结构探测仍然对得上：复位，让下一轮漂移还能告出来。
      sidebarDriftWarned = false;
    } else if (index.size > 0) {
      reportSidebarDrift(index.size, rows.length, badgeable.length);
    }
    for (const row of badgeable) {
      applyBadge(row, now, dict);
    }
    // 悬浮卡片只有在弹出时才存在于 DOM；未弹出时是零开销的空查询。
    applyHoverCard(now, dict);
  };

  const scheduleScan = (): void => {
    if (disposed || scanTimer !== undefined) return;
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      scan();
    }, SCAN_DEBOUNCE_MS);
  };

  /** 对单行插入/更新/移除 badge。 */
  function applyBadge(row: HTMLElement, now: number, dict: SchedStrings): void {
    const sessionId = sessionIdOfRow(row);
    if (sessionId === undefined) return;
    const entry = index.get(sessionId);
    const existing = findBadge(row);
    if (entry === undefined) {
      existing?.remove();
      return;
    }
    const state: PresenceBadgeState = badgeStateFor(entry.nextAt, now);
    const time =
      entry.nextAt === undefined ? '' : relativeFireLabel(entry.nextAt, now, labelsFor(dict), formatHhmm, formatDate);
    /**
     * 全部任务都暂停时 `nextAt` 为 undefined：此时既不能说「下次 {time}」
     * （没有排定时刻），也不能说「已到期」（暂停项不会自行触发）。改用专门的
     * 「已暂停」文案，避免出现「下次  · 1 条任务」这种残缺句子。
     */
    const allPaused = entry.nextAt === undefined && entry.pausedCount > 0;
    const aria = allPaused
      ? format(dict.presencePausedAria, { n: entry.count })
      : state === 'overdue'
        ? format(dict.presenceOverdueAria, { n: entry.count })
        : format(dict.presenceBadgeAria, { n: entry.count, time });
    const tooltip = allPaused
      ? format(dict.presencePausedTooltip, { n: entry.count })
      : state === 'overdue'
        ? format(dict.presenceOverdueTooltip, { n: entry.count })
        : format(dict.presenceTooltip, { n: entry.count, time });
    /**
     * 进度按 `now` 现算、不缓存：它随时间单调变化，而 scan 每 30s 就会带着新的
     * `now` 重跑一遍，缓存只会多出失效分支。
     */
    const progress = progressOf(entry, now);
    if (existing !== null) {
      if (existing.dataset.state !== state) existing.dataset.state = state;
      if (existing.getAttribute('aria-label') !== aria) existing.setAttribute('aria-label', aria);
      if (existing.getAttribute('title') !== tooltip) existing.setAttribute('title', tooltip);
      applyProgress(existing, progress);
      return;
    }
    const slot = row.firstElementChild;
    if (slot === null) return;
    const beside = slot.querySelector(HOST_DOM.slotIcon) !== null;
    const badge = document.createElement('span');
    badge.className = beside ? `${BADGE_CLASS} ${BADGE_CLASS}-beside` : BADGE_CLASS;
    badge.dataset.state = state;
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', aria);
    badge.setAttribute('title', tooltip);
    badge.innerHTML = getClockSvg();
    applyProgress(badge, progress);
    if (beside) slot.after(badge);
    else slot.append(badge);
  }

  /**
   * 把进度写进已注入 badge 的进度弧（`stroke-dashoffset`）。
   *
   * 无从算进度（`undefined`）时**隐藏**弧线、退回恒定整环 —— 比画一个 0% 的空环
   * 诚实：0% 是"刚开始"，`undefined` 是"算不出来"。classic 点阵风格没有这条弧，
   * 查询落空即静默跳过（两套图标共用调用方，不需要分支）。
   */
  function applyProgress(badge: HTMLElement, ratio: number | undefined): void {
    const arc = badge.querySelector<SVGCircleElement>('.ss-clock-prog');
    if (arc === null) return;
    if (ratio === undefined) {
      arc.style.display = 'none';
      return;
    }
    if (arc.style.display === 'none') arc.style.display = '';
    arc.style.strokeDashoffset = String(CLOCK_FACE_CIRCUMFERENCE * (1 - ratio));
  }

  /**
   * 找当前弹出的悬浮卡片：返回卡片 portal 根、正文根（状态行的父容器）与
   * 关联到的 sessionId。
   *
   * 卡片是 `body` 的直系 portal（实测 DOM：`body > div._card_* > div.hoverContent`），
   * 与会话行没有 DOM 祖先关系，故只能按结构探测 + fiber 反查关联：
   * 遍历 body 直系浮层，取「首个子元素内含状态点行、且自身 fiber 能反查到
   * sessionId」的那个作为卡片。
   *
   * ⚠️ 刻意不依赖 `YDXeBa_*` / `_card_*` 等构建期 hash 类名；探测不到就返回
   * null（安静跳过，绝不误标）。
   */
  function findHoverCard(): { card: HTMLElement; statusHost: HTMLElement; sessionId: string } | null {
    for (const card of Array.from(document.body.children)) {
      if (!(card instanceof HTMLElement)) continue;
      /**
       * ⚠️ 这里原来只取 `card.firstElementChild`，**实测证伪**（issue #153，2026-11-11，
       * 0.2.2-rc.1 + 真 GUI）：
       *
       *     BODY > SPAN._portal_*          ← body 直系浮层（不是卡片本身）
       *              > DIV._card_*         ← 卡片壳（firstElementChild，**没有**状态行）
       *                > DIV.hoverContent  ← 状态行真正的父容器（隔 2 层）
       *
       * 真 DOM 里状态行 `<div class="*_hoverStatus"><span aria-hidden="true"/>空闲</div>`
       * 是有的（状态点也在），但它在 `hoverContent` 里、比原来的假设深两层 —— 旧条件永远
       * 不成立，于是插件那一行在**所有**会话上都没注入过，而侧栏徽标一切正常（数据面没漂，
       * 纯 DOM 假设过期）。这正是本仓踩过的第二回：`[draggable="true"]` 那次也是同样的形状。
       *
       * 所以改成**下钻找状态行父容器**，而不是押固定层级。返回的是「行所在的容器」，
       * 追加/替换都挂在它上面，层级再变也不影响行为。
       */
      const statusHost = findStatusHost(card);
      if (statusHost === null) continue;
      const sessionId = sessionIdOfHoverCard(card);
      if (sessionId === undefined) continue;
      return { card, statusHost, sessionId };
    }
    return null;
  }

  /**
   * 从 body 直系浮层往下找「装着宿主状态行」的容器（深度受限，不扫整棵应用树）。
   *
   * 识别一条状态行只押**形状 + 属性**，不押构建期 hash 类名，见 {@link isHostStatusRow}。
   * 找不到就返回 `null` —— 安静跳过，绝不在非卡片浮层上误标。
   */
  function findStatusHost(root: HTMLElement): HTMLElement | null {
    const limit = HOST_DOM.statusHostMaxDepth;
    const walk = (el: HTMLElement, depth: number): HTMLElement | null => {
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

  /**
   * 这一条是不是宿主渲染出来的状态行。
   *
   * 三个条件同时成立：行有 ≥2 个元素子、前导子元素是 `aria-hidden="true"` 的状态点、
   * 行自身有文本。刻意**不看标签名**（ongoing 的状态点是 `svg`，见 HOST_DOM 块的证伪
   * 记录）、**不看类名**（`_dot_*` / `_*_hoverStatus` 都是构建期 hash）。
   *
   * 实测的排除效果：卡片里的标题行 / 时间行（前导不是 `aria-hidden` 的点）、宿主留给
   * 插件的空 slot（`data-slot=…`，无子节点）都不命中；「已归档」那条命中「是行」但
   * 不带 `data-state`，只会影响容器定位、不影响替换判定（{@link isIdleRow} 另有判据）。
   * 本插件自己追加的行带 {@link HOVER_ROW_CLASS}，显式排除，免得把自己的行读成宿主的。
   */
  function isHostStatusRow(child: Element): boolean {
    if (child.classList.contains(HOVER_ROW_CLASS)) return false;
    if (child.children.length < 2) return false;
    const dot = child.firstElementChild;
    if (dot === null) return false;
    if (dot.getAttribute(HOST_DOM.statusDotAttr) !== HOST_DOM.statusDotValue) return false;
    return (child.textContent ?? '').trim().length > 0;
  }

  /**
   * 宿主状态行的**档位**（结构化判据）：取状态点上的 `data-state`。
   * 实测宿主只在状态点上写它（`idle` / `ongoing` / `warning` / `done`），
   * 属性缺席或为空返回 `undefined`——调用方据此退回文案白名单。
   */
  function hostRowState(row: Element): string | undefined {
    const dot = row.firstElementChild;
    if (dot === null) return undefined;
    const raw = dot.getAttribute(HOST_DOM.statusDotStateAttr);
    return raw === null || raw === '' ? undefined : raw;
  }

  /**
   * 宿主状态行 → 是否「空闲」。
   *
   * **判据顺序（issue #153 的要求）**：先读结构化的 `data-state`（{@link HOST_DOM.idleStateValue}），
   * 与语言无关；只有拿不到档位属性时才退回 {@link HOST_DOM.idleLabels} 文案白名单，
   * 且那条退路还要过 {@link findIdleRow} 的位置闸（标题那一行不许用文案判空闲）。
   * 刻意不把「空闲」这个中文串当唯一判据——八种界面语言下它各不相同，而宿主换字比换
   * 档位便宜得多。白名单的脆弱点写在 HOST_DOM 那块。
   */
  function isIdleRow(row: Element, allowTextFallback: boolean): boolean {
    const state = hostRowState(row);
    if (state !== undefined) return state === HOST_DOM.idleStateValue;
    if (!allowTextFallback) return false;
    const text = (row.lastElementChild?.textContent ?? '').trim();
    return HOST_DOM.idleLabels.some((label) => text === label);
  }

  /**
   * 找宿主那条「空闲」状态行（本插件自己的行不算）。
   *
   * `index > 0` 是给文案退路加的一道**位置闸**：`hoverContent` 里第一个子元素永远是标题
   * （实测顺序 标题 → 路径 → 时间 → slot → 状态行…），而会话标题完全可能正好等于某个语言的
   * 「空闲」（`Idle` 就是个普通英文词）——结构化判据不怕这种巧合，文案判据怕，所以退路只在
   * 标题之后的行上生效。真带 `data-state="idle"` 的第一行照旧命中，位置闸只管退路。
   */
  function findIdleRow(statusHost: HTMLElement): Element | null {
    const children = Array.from(statusHost.children);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index] as Element;
      /**
       * ⚠️ **已被接管的那条要单独认**（真 GUI 实测复现过一次的 bug）：
       * 接管之后这条行的文案已经换成插件文案、状态点的 `data-state` 也可能被改，
       * 若只按「是不是 idle」判，第二轮扫描会得出「没有空闲行」→ 走追加分支，
       * 于是同一条状态区里出现两份内容（插件文案 + 新增的那一行）。
       * 所以先认 `dataset.ssAdopted`，再认「宿主原样 + idle」。
       */
      const host = child as HTMLElement;
      if (host.dataset.ssAdopted === 'idle') return host;
      if (!isHostStatusRow(child)) continue;
      if (isIdleRow(child, index > 0)) return child;
    }
    return null;
  }

  /**
   * 对悬浮卡片的状态区写入定时状态（仅当该会话有活动任务时）。
   *
   * ## 合并语义（issue #153，**这条取代了原来的「纯追加」约定**）
   *
   * 原来的约定是「只追加一行、绝不改写宿主状态行」。实测证伪了它的代价：有定时待发任务
   * 的会话，卡片里同时显示「空闲」与本插件那行，用户读到的是「空闲」——
   * 而「空闲」在那个语境里表达的是「没有别的事」，可恰恰有事（到点会自动发出去）。
   *
   * 现在的规则，**只动 idle 这一档**：
   *  - 宿主状态是**空闲** ⇒ 把那条状态行的文案**替换**成插件的定时文案（保留宿主的
   *    状态点节点，形状与 `HOST_DOM.statusDot*` 一致，所以下一轮仍能被识别）；
   *  - 宿主状态**不是空闲**（进行中 / 等待审批 / 计划待审 / 待回答…）⇒ 宿主行**原样保留**，
   *    插件的行追加在后 —— agent 正在做的事优先级更高，不能被替换掉；
   *  - 会话**没有**活动任务 ⇒ 把替换过的宿主行**还原**，并把追加行移除（一个节点都不许碰地
   *    回到宿主原样，含「有任务 → 删掉任务」的状态切换）。
   *
   * 依据：同类插件 `dsh-group-status` 在同一个侧栏行/悬停卡上聚合状态，空闲时它拼出空串、
   * **从不单独输出「空闲」**（`src/client/badge-labels.ts` 的 `groupLiveLabel` 只在非零时 push）。
   * 换句话说，「空闲」不该在一次悬停里成为唯一被说的话。
   */
  function applyHoverCard(now: number, dict: SchedStrings): void {
    const found = findHoverCard();
    if (found === null) return;
    const { statusHost, sessionId } = found;
    const existing = statusHost.querySelector<HTMLElement>(`:scope > .${HOVER_ROW_CLASS}`);
    const entry = index.get(sessionId);
    if (entry === undefined) {
      // 该会话无活动任务：移除残留行，并把被替换过的宿主行还原（「有任务 → 删掉任务」）。
      existing?.remove();
      restoreIdleRow(statusHost);
      return;
    }
    const { label } = hoverScheduleStatus(entry, now, labelsFor(dict), dict, formatHhmm, formatDate);
    const state = badgeStateFor(entry.nextAt, now);

    /**
     * 先处理「宿主空闲」这一档：替换文案而不是新增行。
     *
     * 判「是不是空闲」**不靠硬编码文案**：真 DOM 里空闲行的状态点是
     * `SPAN[data-state="idle"]`、进行中的是 `svg[data-state="ongoing"]`，档位就写在
     * 属性上（见 {@link hostRowState}）。只有宿主没给出 `data-state` 时才退回文案白名单，
     * 那条退路的脆弱性记在 `HOST_DOM.idleLabels`。
     *
     * 替换保留宿主那个点节点本身（不动属性、不动形状），于是这一行下一轮仍然
     * 是「宿主的行」、也仍然能被认成空闲档。
     */
    const idleRow = findIdleRow(statusHost);
    if (idleRow !== null) {
      // 空闲 + 有任务 ⇒ 接管这条行；同时把可能存在的追加行收掉，避免出现两行。
      existing?.remove();
      adoptIdleRow(idleRow, label, state);
      return;
    }
    restoreIdleRow(statusHost);

    if (existing !== null) {
      const text = existing.lastElementChild;
      if (text !== null && text.textContent !== label) text.textContent = label;
      if (existing.dataset.state !== state) existing.dataset.state = state;
      return;
    }
    // 与宿主 .hoverStatus 行同构：状态点（aria-hidden）+ 文案 span。
    const row = document.createElement('div');
    row.className = HOVER_ROW_CLASS;
    row.dataset.state = state;
    const dot = document.createElement('span');
    // 这里是**产出**宿主同构形状（刻意不进 HOST_DOM 块：那块只描述「读」侧耦合）。
    // 点节点刻意**不带** `data-state`：档位属性留给宿主自己的行，我们的行只靠
    // `.ss-hover-status` 类与行上的 `data-state`（tone）表达，`isHostStatusRow` 也显式
    // 排除本插件行，两条都不会把我们的行读成宿主的（那会被当成空闲档替换掉）。
    dot.setAttribute('aria-hidden', 'true');
    dot.className = 'ss-hover-status-dot';
    const text = document.createElement('span');
    text.textContent = label;
    row.append(dot, text);
    statusHost.append(row);
  }

  /**
   * 接管空闲行：**只换文案**，状态点节点与行属性原样留着。
   *
   * 原始文案记在 `dataset` 上（不是模块级 Map）：卡片每次悬浮由 React 重建子树，
   * 记在节点上就跟着节点一起消失，不会残留到别的会话。
   */
  function adoptIdleRow(row: Element, label: string, state: PresenceBadgeState): void {
    const host = row as HTMLElement;
    const text = row.lastElementChild;
    if (host.dataset.ssAdopted !== 'idle') {
      if (text !== null) host.dataset.ssIdleLabel = text.textContent ?? '';
      host.dataset.ssAdopted = 'idle';
    }
    if (text !== null && text.textContent !== label) text.textContent = label;
    host.dataset.ssState = state;
  }

  /** 把一条被接管的行还原回宿主原文案（没被接管过则什么都不做）。 */
  function restoreAdoptedRow(row: Element): void {
    const host = row as HTMLElement;
    if (host.dataset.ssAdopted !== 'idle') return;
    const text = host.lastElementChild;
    if (text !== null) text.textContent = host.dataset.ssIdleLabel ?? '';
    delete host.dataset.ssAdopted;
    delete host.dataset.ssIdleLabel;
    delete host.dataset.ssState;
  }

  /** 还原这个状态区里所有被接管的宿主行（「有任务 → 删掉任务」/ 切到非空闲档）。 */
  function restoreIdleRow(statusHost: HTMLElement): void {
    for (const child of Array.from(statusHost.children)) restoreAdoptedRow(child);
  }

  // 数据/环境触发：摘要变化（含当前会话投影帧与状态 tick）、语言切换、DOM 变化。
  // 「其余会话的时效」由 store 负责（周期 session.list 读 RPC + 可见性/online 触发），
  // 本模块不再自己 refresh，避免同一份数据被拉两次。
  const unsubscribeSummary = summary.subscribe(scheduleScan);
  const unsubscribeLocale = locale?.subscribe(scheduleScan);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });

  const stateTick = setInterval(scheduleScan, STATE_TICK_MS);

  scheduleScan();

  return () => {
    disposed = true;
    if (scanTimer !== undefined) clearTimeout(scanTimer);
    clearInterval(stateTick);
    observer.disconnect();
    unsubscribeSummary();
    unsubscribeLocale?.();
    for (const badge of Array.from(document.querySelectorAll(`.${BADGE_CLASS}`))) badge.remove();
    // 追加行整体删掉；被接管的宿主行**不能删**，只把文案还原回去（删了就是在改宿主的结构）。
    for (const row of Array.from(document.querySelectorAll(`.${HOVER_ROW_CLASS}`))) row.remove();
    for (const row of Array.from(document.querySelectorAll(ADOPTED_ROW_SELECTOR))) restoreAdoptedRow(row);
  };
}
