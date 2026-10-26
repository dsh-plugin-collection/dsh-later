/**
 * 向 dsh-group-status 登记本插件的分组状态 facet（issue #36）。
 *
 * ## 为什么是「我注册」而不是「它适配」
 *
 * 折叠分组徽标上「组内有几个会话挂着定时任务」这件事，语义一直归本插件，实现却写在
 * 对方仓库里（具名字段 `scheduledSessions` / `scheduleState` + 一份色档反推）。任何一方
 * 改口径，对方不会报错，只会静默显示成旧口径。现在按
 * [`docs/facet-protocol.md`](https://github.com/dsh-plugin-collection/dsh-group-status/blob/main/docs/facet-protocol.md)
 * v1 由本插件自己注册，对方只认协议形状。
 *
 * facet id 与它的过渡适配器**同名**（`dsh-later.schedule`）：同 id 冲突由来源决胜，
 * `provider` 恒胜 `legacy`，与两家 apply 的先后无关——所以本插件一登记，代管的那份
 * 自动让位，不重复计数，也不需要协调发布顺序。
 *
 * ## 「关掉定时任务提示」这个开关在本插件（issue #83）
 *
 * 协议 v1 曾有 `settingKey`：provider 报出**消费方**的某个布尔开关名，由消费方筛显隐。
 * 对端 #37 把它废弃了（v1 仍接受、不报错，但**不再读取**），因为那等于把别人家的域名、
 * 来源名和图标形状写死在消费方的配置面里。规则收敛成一条：**登记即显示，不注册即不显示**。
 *
 * 于是开关搬进本插件自己的 `Config`（字段名 `showInGroupBadge`，读取处 `isGroupBadgeVisible`），
 * 关掉走 {@link mountLaterScheduleFacet} 的注销分支。旧字段既不再交出、也不再指望——留着它
 * 只会让用户以为「那个开关还能管我」，而它连管什么都不管了。
 *
 * ## 为什么必须容错，且绝不写进 `inject` / `dsh.client.external`
 *
 * dsh-group-status 是**可选**搭档。它未安装 / 未启用时模块表里没有这一行，
 * `require()` 直接抛。若把它列进模块级 `inject` 或 `dsh.client.external`，本插件在对方
 * 缺席时会卡在 pending（宿主把顶层 inject 当激活门控，见 issue #34 那次 P0），
 * **整个插件永不激活**——用「分组徽标」这一项增强换掉定时功能本身，是笔亏本买卖。
 * 所以这里只有 `try` + 可选链，拿不到就当作「没有徽标可登记」。
 *
 * ## 基线
 *
 * 图标、色档、脉冲、文案全部对齐过渡适配器：官方描边时钟 14px，外层 span 带上色档
 * 颜色。注册前后徽标应当逐字不变（含 `aria-label` 与悬停明细）。
 * @module dsh-later/client/group-status-facet
 */
import { createElement, type ReactNode } from 'react';
import { IconClock } from './primitives-compat.js';
import type { ScheduleSummaryMap } from '../schedule-summary.js';
import {
  LATER_SCHEDULE_FACET_ID,
  LATER_SCHEDULE_FACET_ORDER,
  LATER_SCHEDULE_FACET_PROTOCOL,
  facetIconColor,
  foldLaterSchedule,
  laterScheduleFacetLabel,
  mergeLaterSchedule,
  type LaterFacetFold,
} from '../schedule-facet.js';

/**
 * 客户端 factory 作用域里的模块解析器。
 *
 * 宿主把 `require` 作为 client bundle factory 的参数注入（见 `build.mjs` 的
 * `factory: (require) => …`），**不是**全局：走 `globalThis.require` 会静默拿到
 * undefined，于是整条集成「看起来装着、其实一直没工作」。group-status 的
 * `legacy/bridge.ts` 记的是同一条实测结论。
 */
declare const require: (id: string) => unknown;

/** 对端 client 的模块表 specifier。 */
const GROUP_STATUS_CLIENT = 'dsh-group-status/client';

/** 徽标图标尺寸：与过渡适配器同为 14，注册前后排格宽度不变。 */
const FACET_ICON_SIZE = 14;

/**
 * facet 协议 v1 在本插件视角下的最小形状。
 *
 * **不**引 dsh-group-status 作为依赖（可选搭档不能变成编译期依赖），所以这里自己声明
 * 一遍契约。字段名与语义以对方仓库的 `docs/facet-protocol.md` 为准；两边各声明一份的
 * 风险由 `tests/group-status-facet.test.mjs` 的字段清单断言兜住。
 *
 * 镜像里**刻意没有** `settingKey`：那个字段被对端 #37 废弃（它不再读取），显隐改由
 * 本插件决定是否登记（issue #83，见 {@link mountLaterScheduleFacet}）。协议把它留成
 * 可选字段只是为了让已接入方不必同步改版本，填了不影响任何显示——所以正确处置是删掉，
 * 而不是留着继续承诺一件对端已经不执行的事。
 */
interface GroupStatusFacetV1 {
  readonly protocol: number;
  readonly id: string;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ScheduleSummaryMap | undefined;
  fold(snapshot: ScheduleSummaryMap | undefined, sessionIds: readonly string[], now: number): LaterFacetFold;
  merge(a: LaterFacetFold, b: LaterFacetFold): LaterFacetFold;
  label(fold: LaterFacetFold): string;
  renderIcon(fold: LaterFacetFold): ReactNode;
  readonly order: number;
}

/** 对端 client 里本插件真正用到的那两个符号。 */
interface GroupStatusClientLike {
  readonly GROUP_STATUS_FACET_PROTOCOL_VERSION?: unknown;
  registerGroupStatusFacet?(facet: GroupStatusFacetV1): unknown;
}

/** 摘要 store 中被 facet 用到的那一面（`ScheduleSummaryStore` 的结构子集）。 */
export interface LaterScheduleStoreLike {
  getSnapshot(): ScheduleSummaryMap;
  subscribe(listener: () => void): () => void;
}

/** {@link registerLaterScheduleFacet} 的入参。 */
export interface RegisterLaterScheduleFacetInput {
  /** 本插件的定时摘要 store（apply 内创建的那个唯一权威）。 */
  readonly store: LaterScheduleStoreLike;
  /**
   * 「定时任务 / Scheduled」这个词，按宿主当前语言**现取**。
   *
   * 必须是取值函数而不是字符串：`label` 在对方的渲染期被调用，语言随时可能已经切了。
   * 定死字符串的后果是徽标文案停在插件激活那一刻的语言上。
   */
  readonly scheduledWord: () => string;
}

/**
 * 读对端的 client 模块表行。
 * @returns 模块导出对象；未安装 / 未启用（require 抛错）时为 undefined。
 */
function groupStatusClient(): GroupStatusClientLike | undefined {
  try {
    const mod = require(GROUP_STATUS_CLIENT);
    return typeof mod === 'object' && mod !== null ? (mod as GroupStatusClientLike) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 空注销。
 *
 * 三条「没登记成」的路径都返回它，而不是 undefined：`ctx.effect` 的 execute 必须交出
 * 一个 disposer（cordis 的 `SyncEffect`，不接受 undefined），调用方也就不必区分成败——
 * 与对端 `registerGroupStatusFacet` 「注册失败也返回一个空操作」是同一个约定。
 */
const NOOP_UNREGISTER: () => void = () => {};

/**
 * 登记 facet。
 *
 * @param input - store 与文案取值器。
 * @returns 注销函数；**没有可登记的对端时返回空操作**，调用方一律挂到清理路径上即可。
 */
export function registerLaterScheduleFacet(
  input: RegisterLaterScheduleFacetInput,
): () => void {
  const client = groupStatusClient();
  if (client === undefined || typeof client.registerGroupStatusFacet !== 'function') {
    // 未安装 / 未启用 / 对端版本还没有登记面。三种情况的处置都一样：没有徽标可登记。
    // 刻意不 console.warn——前两种是本插件的正常部署形态，一条每次启动都刷的警告
    // 只会把真正需要看见的问题淹掉。还没有登记面的旧版 group-status 仍由它的过渡
    // 适配器替我们画徽标，行为与迁移前一致。
    return NOOP_UNREGISTER;
  }

  const peerProtocol = client.GROUP_STATUS_FACET_PROTOCOL_VERSION;
  if (peerProtocol !== LATER_SCHEDULE_FACET_PROTOCOL) {
    // 有登记面但对不上版本：这条**必须**可见——「我注册了为什么没显示」查不到原因，
    // 正是协议文档点名要避免的那类不可诊断失败。
    console.warn(
      `dsh-later: 跳过分组状态 facet 登记——对端协议版本 ${String(peerProtocol)} 与本插件实现的 v${LATER_SCHEDULE_FACET_PROTOCOL} 不一致`,
    );
    return NOOP_UNREGISTER;
  }

  const facet: GroupStatusFacetV1 = {
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
    renderIcon: (fold) => createElement(
      'span',
      { style: { color: facetIconColor(fold.tone), display: 'inline-flex', alignItems: 'center' } },
      createElement(IconClock, { size: FACET_ICON_SIZE }),
    ),
    order: LATER_SCHEDULE_FACET_ORDER,
  };

  const unregister = client.registerGroupStatusFacet(facet);
  // 对端约定：注册失败（同 id 上站着更高来源等）也返回一个空操作。仍按「可能不是
  // 函数」收口，免得将来它改成返回结果对象时，这里的 dispose 变成一次 TypeError。
  return typeof unregister === 'function' ? (unregister as () => void) : NOOP_UNREGISTER;
}

/** {@link mountLaterScheduleFacet} 的入参：登记所需 + 一个现读的显隐开关。 */
export interface LaterScheduleFacetMountInput extends RegisterLaterScheduleFacetInput {
  /**
   * 当前是否应当显示（读本插件 `Config.showInGroupBadge`，判定见 `isGroupBadgeVisible`）。
   *
   * 必须是取值函数而不是布尔值：设置页保存后**不刷新页面**就要生效，而 `apply` 只跑一次。
   */
  readonly enabled: () => boolean;
}

/** {@link mountLaterScheduleFacet} 返回的控制器。 */
export interface LaterScheduleFacetMount {
  /** 按 `enabled()` 的当前值重估：该登记而没登记 → 登记；该关而登记着 → 注销。幂等。 */
  refresh(): void;
  /** 注销当前登记，并不再重估（插件卸载路径）。 */
  dispose(): void;
}

/**
 * 让 facet 的登记跟随本插件自己的开关（issue #83）。
 *
 * 对端 #37 废弃 `settingKey` 之后，协议里唯一决定显隐的机制就是「登记与否」，所以
 * 「关掉定时任务提示」这个产品决定只能由状态所有者在登记面上执行：`enabled()` 为假就
 * 注销，为真就登记。
 *
 * 为什么是控制器而不是「apply 时读一次」：`ctx.effect` 的 execute 在 apply 里**同步**跑，
 * 而那一刻两条设置轨道都还没绑上（它们各自在 `ctx.inject([...])` 里，宿主什么时候给服务
 * 不保证），读到的永远是「还没设置」→ 恒等于默认值。读一次会把开关做成「刷新页面才生效」。
 *
 * 为什么 `refresh()` 可以多调：登记与否只有 `unregister === undefined` 这一个状态位，
 * 重复 refresh 登记不出第二份；注销走对端的 `remove(id, facet)`，只摘「还是自己」那一份，
 * 摘不掉别人的登记。
 *
 * @param input - store、文案取值器与开关取值器。
 * @returns 控制器；调用方负责在卸载时 `dispose()`。
 */
export function mountLaterScheduleFacet(input: LaterScheduleFacetMountInput): LaterScheduleFacetMount {
  let unregister: (() => void) | undefined;

  /** 注销当前登记（没登记着时是空操作）。 */
  const detach = (): void => {
    const dispose = unregister;
    if (dispose === undefined) return;
    // 先清状态再调用：disposer 里若有任何路径回调到 refresh，也不会重复注销同一个 facet。
    unregister = undefined;
    dispose();
  };

  return {
    refresh(): void {
      if (input.enabled()) {
        if (unregister === undefined) unregister = registerLaterScheduleFacet(input);
        return;
      }
      detach();
    },
    dispose: detach,
  };
}
