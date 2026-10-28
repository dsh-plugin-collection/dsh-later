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
 * 增补方式是**纯追加**：仅在卡片状态区末尾追加一行与宿主 `.hoverStatus`
 * 同构的节点，不改写、不替换、不重排宿主已有状态行，故 pendingInteraction /
 * running 等既有状态的优先级天然不变；无活动定时任务的会话不做任何改动。
 * 卡片每次悬浮由 React 重建子树（注入节点会被清掉），重插同样交给既有的
 * MutationObserver 重扫循环。
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
  /** 会话行 + 工作区行共同命中的选择器（实测：ui-workspace 的会话行树节点）。 */
  sessionRow: '[role="treeitem"][draggable="true"]',
  /**
   * 工作区行带这个属性、会话行不带：用它把工作区行排除掉。
   * ⚠️ 这是**排除**规则，命中即 `continue`，不是筛选条件。
   */
  workspaceRowAttr: 'aria-expanded',
  /** 行首 slot 内的「进行中」orb 图标：存在即 badge 插到 slot 之后，否则塞进 slot。 */
  slotIcon: 'svg',
  /** 悬浮卡片状态行的前导状态点：该标签名 + 该属性值（用于识别宿主状态行）。 */
  statusDotTag: 'SPAN',
  statusDotAttr: 'aria-hidden',
  statusDotValue: 'true',
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
 * 侧栏会话行选择器零命中 → 宿主 DOM 漂移告警（每轮漂移只报一次）。
 *
 * **判据**（两个条件同时成立才报）：
 * 1. `remindedSessions > 0`——摘要索引里确实有带定时提醒的会话，排除「用户就是没有提醒」
 *    这一最常见也最无害的解释；
 * 2. 本次 `HOST_DOM.sessionRow` 命中 **0 行**——不是某些行没映射到会话
 *    （那会命中 ≥1 行、只是 badge 少几个），而是一个可标注的行都找不到。
 *
 * 两者同时成立几乎只有一种解释：宿主侧栏改版，badge 整块静默消失。这正是本模块
 * 「探测不到就安静跳过」策略唯一的盲区（其余降级仍静默，见 HOST_DOM 块说明）。
 *
 * **只报一次**：扫描由 60ms 去抖的 MutationObserver 驱动，逐次刷屏会打死控制台，
 * 也会把真问题淹在噪音里（同 `group-status-facet` / `schedule-compat` 的克制法）。
 *
 * **恢复条件**：后续任意一次扫描命中 ≥1 行即把标志置回 false。于是
 * 「漂移 → 告警 → 修好（或宿主自己回来了） → 再次漂移」这条链上每一轮漂移各告警
 * 一次，而不是整个页面生命周期只告警一次——后者会让第二次改版重新变成静默失效。
 *
 * **已知代价**：侧栏尚未挂载（首屏极早期、侧栏收起）同样命中「有提醒 + 0 行」，
 * 此时会多出一条告警。刻意不加「树容器必须存在」这类额外前置条件：加了就会稀释上面
 * 那条判据、把真漂移也一起吞掉。权衡后接受——它一次只多一行、文案点名的是具体
 * 选择器而不是泛泛的 failed，而 badge 缺失本就是用户需要知道的降级。
 *
 * **fail-open**：整段包在 try/catch 里（控制台可能被 stub 或抛错），告警失败绝不影响
 * badge 渲染路径；调用点也在渲染循环之外，不改变任何探测语义。
 *
 * @param remindedSessions - 本次摘要索引的条目数（`index.size`）。
 */
function reportSidebarDrift(remindedSessions: number): void {
  if (sidebarDriftWarned) return;
  sidebarDriftWarned = true;
  try {
    console.warn(
      `dsh-later: 侧栏 badge 未注入——会话行选择器 \`${HOST_DOM.sessionRow}\` 命中 0 行，`
        + `而摘要里有 ${remindedSessions} 个带定时提醒的会话。这不是「用户没有提醒」，`
        + '而是本模块的结构探测对不上宿主 DOM（宿主侧栏很可能已改版）。'
        + `排查只看 src/client/session-presence.ts 顶部的 HOST_DOM 耦合块：重新确认行选择器与 ${HOST_DOM.workspaceRowAttr} 排除规则。`
        + '（本轮漂移只提示一次；一旦重新命中行即复位，下次改版会再提示。）',
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
      reportSidebarDrift(index.size);
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
      const statusHost = card.firstElementChild;
      if (!(statusHost instanceof HTMLElement)) continue;
      // 状态行：直接子块里含 aria-hidden 的前导 span（状态点）+ 文案 span。
      const hasStatusRow = Array.from(statusHost.children).some((child) => {
        const dot = child.firstElementChild;
        return (
          child.children.length >= 2 &&
          dot !== null &&
          dot.tagName === HOST_DOM.statusDotTag &&
          dot.getAttribute(HOST_DOM.statusDotAttr) === HOST_DOM.statusDotValue
        );
      });
      if (!hasStatusRow) continue;
      const sessionId = sessionIdOfHoverCard(card);
      if (sessionId === undefined) continue;
      return { card, statusHost, sessionId };
    }
    return null;
  }

  /**
   * 对悬浮卡片追加一行定时状态（仅当该会话有活动任务时）。
   *
   * 纯追加：宿主既有状态行原样保留，故 pendingInteraction / running 的优先级
   * 不受影响；已有本插件行时只更新文案（React 重建后由重扫重插）。
   */
  function applyHoverCard(now: number, dict: SchedStrings): void {
    const found = findHoverCard();
    if (found === null) return;
    const { statusHost, sessionId } = found;
    const existing = statusHost.querySelector<HTMLElement>(`:scope > .${HOVER_ROW_CLASS}`);
    const entry = index.get(sessionId);
    if (entry === undefined) {
      // 该会话无活动任务：移除可能残留的行（含从有任务行切到无任务行）。
      existing?.remove();
      return;
    }
    const { label } = hoverScheduleStatus(entry, now, labelsFor(dict), dict, formatHhmm, formatDate);
    const state = badgeStateFor(entry.nextAt, now);
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
    // 这里是**产出**宿主同构形状（刻意不进 HOST_DOM 块：那块只描述「读」侧耦合），
    // 但要与 HOST_DOM.statusDot* 保持一致，否则我们的行自己也不满足识别条件。
    dot.setAttribute('aria-hidden', 'true');
    dot.className = 'ss-hover-status-dot';
    const text = document.createElement('span');
    text.textContent = label;
    row.append(dot, text);
    statusHost.append(row);
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
    for (const row of Array.from(document.querySelectorAll(`.${HOVER_ROW_CLASS}`))) row.remove();
  };
}
