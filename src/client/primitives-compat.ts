/**
 * 官方 `dsh-client-ui-primitives` 的特性探测层：只用官方实现，缺失时响亮降级。
 *
 * 背景：面板的「抬升面 + 锚定 + 外部点击关闭」在官方 `PickerPopover` 里由
 * primitives 的 `useAnchoredPosition` / `useDismissOnOutsidePointer` 提供
 * （见 `@deepseek-ai/dsh-client-ui-schedule` 的 `PickerPopover.js`）。
 *
 * ⚠️ 本文件头此前写着「本插件 peer 覆盖 0.1.1 → 0.2.0，**早代次宿主尚无这两个导出**」，
 * 并据此维护了一份手写锚定实现。**那句前提是错的**：2026-10-29 逐代实测，8 个已登记
 * 代次全都导出这两个 hook（证据与逐代核对方式见下方 `usePanelAnchorPosition` 上方注释）。
 * 保留 namespace + 属性访问的**加载安全**（具名 import 在导出缺失时是链接期硬失败，
 * 会让插件整条加载不了），但缺失时不再切换到一份没人验证过的几何实现——改为告警一次
 * 并退到调用方已有的静态定位与遮罩关闭。
 *
 * 探测结果在**整页生命周期内恒定**：primitives 是宿主 seed 模块表基线
 * （PLATFORM_MODULES），bundle 里保持 external，由 `require()` 直取宿主同一份实例。
 * 因此下面两个 hook 的分支选择不会随渲染跳变，React 的 hook 调用序列稳定。
 *
 * ## 第二组：图标与两个工具（issue #95 方案 B，0.1.5 / 0.1.2 兼容）
 *
 * 同一个包在 0.1.7 之前/之后还有三处差异，全部收敛在本文件末尾：
 *
 * | 东西 | 0.1.2 / 0.1.5 | 0.1.7+ |
 * |---|---|---|
 * | 图标命名 | 尺寸后缀 `IconClockOutline16` / `IconChevronDownOutline14` | 尺寸无关的 `…OutlineRegular` |
 * | `Tooltip` 的 `portal` | **没有这个 prop**（实现只解构已知字段，多传被忽略） | 有 |
 * | `FileTypeIcon` / `fileSizeText` | 0.1.5 有，**0.1.2 没有** | 有 |
 *
 * 直接 `import { IconClockOutlineRegular }` 在 0.1.5 上是 `TS2724`（实测 19 条红全在这里）。
 * 所以图标也走 `pick()`：**新名优先、旧名兜底**，用法处拿到的是普通组件，调用点不必关心代次。
 *
 * @module dsh-later/client/primitives-compat
 */
import { createElement, useEffect, useRef } from 'react';
import type { CSSProperties, JSX, RefObject } from 'react';
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';

/** 锚定 hook 的入参（与官方 `AnchoredPositionOptions` 同构）。 */
export interface PanelAnchorOptions {
  /** 面板是否已挂载（关闭时不测量）。 */
  open: boolean;
  /** 触发元素（输入行上的时钟按钮容器）。 */
  anchorRef: RefObject<HTMLElement | null>;
  /** 面板自身，用于按真实尺寸做视口夹取。 */
  panelRef: RefObject<HTMLElement | null>;
  /** 挂在锚点下沿（bottom）还是上沿（top）。 */
  side?: 'top' | 'bottom';
  /** 左对齐（start）还是右对齐（end）触发元素。 */
  align?: 'start' | 'end';
  /** 面板与锚点边缘的间距。 */
  gap: number;
  /** 面板与视口四边的最小留白。 */
  margin: number;
}

/** 官方 hook 的函数签名（本地兜底按同一形状实现，便于互换）。 */
type UseAnchoredPosition = (options: PanelAnchorOptions) => CSSProperties | null;

/** 外部点击关闭的函数签名。 */
type UseDismissOnOutsidePointer = (
  root: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
  portal?: RefObject<HTMLElement | null>,
) => void;

/** 读取一个**可能不存在**的导出（见文件头：不能用具名 import）。 */
function pick<T>(name: string): T | undefined {
  return (primitives as unknown as Record<string, unknown>)[name] as T | undefined;
}

/** 图标组件的形状（两代一致：`({ size, className }) => JSX.Element`）。 */
export type IconComponent = (props: IconProps) => JSX.Element | null;

/** 官方锚定 hook；宿主未导出时为 undefined（8 个已验证代次都有）。 */
const hostUseAnchoredPosition = pick<UseAnchoredPosition>('useAnchoredPosition');

/** 官方外部点击关闭 hook；宿主未导出时为 undefined（8 个已验证代次都有）。 */
const hostUseDismissOnOutsidePointer = pick<UseDismissOnOutsidePointer>('useDismissOnOutsidePointer');

/**
 * 锚定与外部点击关闭：**只用宿主官方实现**，不再自带手写几何兜底。
 *
 * 原来这里有一份 69 行的 `useLegacyAnchoredPosition`（测量 + 视口夹取 + 翻转 +
 * ResizeObserver）和一个 `noopDismiss`，条件是"旧代次 primitives 没导出这两个 hook"。
 * 2026-10-29 逐代实测：该条件**在全部 8 个已登记代次上都不成立**——
 *   · 0.1.7-rc.1 / 0.1.7-rc.2 / 0.2.0-rc.2：树内 `dsh-client-ui-primitives` 直接含两个导出
 *   · 0.2.1-rc.2 / rc.3 / rc.4：本仓钉的那份 + 发布包 + 0.2.1-rc.4 的 shell 均含
 *   · 0.1.2-rc.1：宿主 shell `index-Df-65__b.js` 含两个名字
 *   · 0.1.5-rc.3：树内没有该包，改从 registry 取发布包核对，两个导出都在
 * 也就是说那段手写几何**一次都没执行过**。没执行过的代码不是保险，是负债：它不会被
 * 任何测试覆盖，而一旦真的走到，等于用一条从未验证的路径去画用户看得见的面板。
 *
 * 保留 `pick()` 与两个 `hasOfficial*` 标志（各一行），因为**加载安全**与**行为兜底**
 * 是两件事：具名 import 在导出缺失时是链接期硬失败，会让插件在那种宿主上整条加载不了；
 * 而属性访问 + 缺失时响亮告警，面板退到调用方已有的静态 `bottom` 样式与遮罩关闭，
 * 功能降级但看得见、日志里有话。删掉的是没人走的算法，不是兜底本身。
 *
 * ## 第三次反转：0.2.2-rc.2 删掉了 `useAnchoredPosition`（issue #158）
 *
 * 上面那段"8 个代次全都导出"的结论**止于 0.2.2-rc.1**。`0.2.2-rc.2` 把这个 hook 整个删了，
 * 替代面是一**对语义不同**的导出，且不是"换一个 hook 继续量几何"：
 *
 * | 导出 | 做的事 | 能不能替 `useAnchoredPosition` |
 * |---|---|---|
 * | `useAnchoredMaxHeight(ref, cap, signal, margin)` | 只算 **max-height**：把下沿贴住锚点的浮层往视口顶部夹 | 只能替"夹取"里的高的一半 |
 * | `usePointerGrace(close)` | 指针离开弹层时的 **200ms 关闭延迟** | 与定位无关 |
 *
 * 官方自己不再用 JS 量位置：rc.2 的 `Menu` portal 分支改用 **CSS 锚点定位**
 * （`anchor-name` + `position-anchor` + `position-area`/`@position-try` 回退链），
 * 见发布包 `Menu.module.css` 的 `.portal` 与 `.portal[data-anchor-side='top']`。
 * 所以降级路径不是"再写一份手写几何"（那正是本文件上文刚论证过不该有的东西），
 * 而是**改用同一个平台特性**：给触发元素写 `anchor-name`，面板用内联
 * `positionAnchor`/`top`/`bottom`/`left` 做 `top` 边锚定 + 视口夹取，浏览器不支持
 * CSS 锚点定位时内联值无效（相当于 `auto`），面板落回调用方给的静态 `bottom`。
 *
 * 三档后端在整页生命周期内**恒定**，由模块加载时一次算出（`resolvePanelAnchorBackend`）：
 * 老代次有 `useAnchoredPosition` → 用它（它的行内 `top/left` 与 rc.2 的 CSS 锚点
 * 是两套坐标系，只能二选一）；否则看宿主有没有 top 边锚定的替代导出 → 有就用 CSS 锚点
 * + `useAnchoredMaxHeight`；两者都没有才退到静态 `bottom` 并告警一次。
 * 面板的 `style` 字段集合在三档之间**相同**（都是同一组 CSSProperties 键），React 不会
 * 因为字段增减改变 hook 序列，也不会留下上一档的残留行内值。
 */

/** 缺官方实现时只告警一次：扫描/渲染是高频路径，刷屏会淹掉真问题。 */
let missingHookWarned = false;
function warnMissingHook(name: string): void {
  if (missingHookWarned) return;
  missingHookWarned = true;
  try {
    console.warn(
      `dsh-later: 宿主 primitives 未导出 ${name}，面板锚定/外部点击关闭降级为静态定位与遮罩关闭。`
        + '这通常意味着宿主版本不在本插件已验证的代次表内（见 src/upstream-compat.ts 的 KERNEL_GENERATIONS）。',
    );
  } catch {
    /* 告警出口失败不影响渲染 */
  }
}

/** 宿主是否提供了官方的外部点击关闭能力。 */
export const hasOfficialOutsideDismiss = hostUseDismissOnOutsidePointer !== undefined;

/** 宿主是否提供了官方的锚定 hook（老代次）。 */
export const hasOfficialAnchoredPosition = hostUseAnchoredPosition !== undefined;

/**
 * rc.2 的「下沿锚定 + 视口夹取」导出（官方签名见发布包 `useAnchoredMaxHeight.d.ts`）。
 *
 * 只拿来量 max-height，**不**决定位置——位置在 rc.2 交给 CSS 锚点定位。
 */
type UseAnchoredMaxHeight = (
  ref: RefObject<HTMLElement | null>,
  cap: number,
  signal: unknown,
  margin?: number,
) => number;

const hostUseAnchoredMaxHeight = pick<UseAnchoredMaxHeight>('useAnchoredMaxHeight');

/**
 * 面板锚定的三档后端，取值见文件头「第三次反转」一节。
 *
 * - `hook`：0.2.2-rc.2 之前，宿主 `useAnchoredPosition` 直接给出行内 `top/left`；
 * - `css-anchor`：0.2.2-rc.2 起，用 CSS 锚点定位 + 宿主的 `useAnchoredMaxHeight` 夹高度；
 * - `static`：两样都没有——只有静态 `bottom` 与遮罩关闭，并告警一次。
 */
export type PanelAnchorBackend = 'hook' | 'css-anchor' | 'static';

/**
 * 按宿主导出面决定用哪一档后端。
 *
 * **新旧 API 同时探到（老代次 + 未来某个把两边都留下的版本）时 `useAnchoredPosition`
 * 优先**：它是完整几何（测量、翻转、夹取），而 rc.2 的替代导出只算高度、位置要靠 CSS；
 * 两者混用会让面板拿到两套坐标系。纯函数，便于在假宿主上逐档断言。
 *
 * @param host - 候选导出面：`primitives` 本身，或一个装了它的模块记录（如
 *   `{ '@deepseek-ai/dsh-client-ui-primitives': primitives }`），便于对**发布包**原样断言。
 * @returns 该宿主应该走的后端。
 */
export function resolvePanelAnchorBackend(host: Record<string, unknown>): PanelAnchorBackend {
  // ESM 命名空间的具名导出是只读事实，`default` 没有意义，但它带着 `Symbol.toStringTag === 'Module'`；
  // CJS 互操作装出来的对象没有这个 tag，直接看自己的属性。两种形状都从同一处取。
  const source = symbolTagOf(host) === 'Module'
    ? ((host.default as Record<string, unknown> | undefined) ?? host)
    : host;
  if (typeof source.useAnchoredPosition === 'function') return 'hook';
  if (typeof source.useAnchoredMaxHeight === 'function') return 'css-anchor';
  return 'static';
}

/** 读 `Symbol.toStringTag`（TS 不允许把 unique symbol 直接当下标用）。 */
function symbolTagOf(value: Record<string, unknown>): unknown {
  return (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
}

/** 本代次宿主实际走的锚定后端（模块加载时一次算出，整页生命周期恒定）。 */
export const PANEL_ANCHOR_BACKEND: PanelAnchorBackend = resolvePanelAnchorBackend(
  primitives as unknown as Record<string, unknown>,
);

/**
 * 测试专用探针：按给定宿主导出面重算后端，并回读该后端的定位样式。
 *
 * 为什么需要它：{@link PANEL_ANCHOR_BACKEND} 是**模块加载期**算出的常量，测试想对不同的
 * 宿主断言分派结论，只能重新加载一份 bundle 再对同一份导出面重算。客户端入口
 * （`src/client/index.tsx`）只再导出跨插件公共 API，所以这里是那批内部函数的唯一出口，
 * 且**只有这一个**——别把整组内部函数摊成公共 API。见
 * `tests/panel-anchor-backends.test.mjs`。
 *
 * @param host - 候选导出面，含义同 {@link resolvePanelAnchorBackend}。
 * @returns 该宿主对应的后端与两份定位样式（面板侧 / 触发元素侧）。
 */
export function __panelAnchorProbeForTest(host: Record<string, unknown>): {
  readonly backend: PanelAnchorBackend;
  readonly anchorName: string;
  readonly panel: Record<string, unknown>;
  readonly trigger: Record<string, unknown>;
} {
  return {
    backend: resolvePanelAnchorBackend(host),
    anchorName: PANEL_ANCHOR_NAME,
    panel: cssAnchorPositionStyle({ side: 'top', gap: 4, margin: 12 }, false),
    trigger: cssAnchorPositionStyle({ side: 'top', gap: 4, margin: 12 }, true),
  };
}

/**
 * CSS 锚点定位用的 CSS `anchor-name`（同时满足两个条件才生效）：
 *   · 名字以 `--` 开头（锚点名必须是 dashed-ident）；
 *   · **不加引号**——React 把无引号的 CSS 自定义属性当字符串直写，引号会被写进 DOM，
 *     浏览器就认不出是 dashed-ident 了。
 */
export const PANEL_ANCHOR_NAME = '--dsh-later-sched-anchor';

/** CSS 锚点定位的几何参数；与 `.ss-panel` 的 `position: fixed` 是同一套约定。 */
export interface CssAnchorGeometry {
  /** 面板落在锚点上方（`bottom`）还是下方（`top`）。 */
  readonly side: 'top' | 'bottom';
  /** 面板与锚点边缘的间距。 */
  readonly gap: number;
  /** 面板与视口边缘的最小留白。 */
  readonly margin: number;
}

/** rc.2 的 `MARGIN` 默认值（发布包 `useAnchoredMaxHeight.js`），缺省对齐官方。 */
export const ANCHORED_MAX_HEIGHT_CAP = 560;

/**
 * CSS 锚点定位的行内样式：`anchor-name`/`position-anchor` 是 core 属性，
 * `position-anchor` 在 `@types/react` 里还没有声明，故用 `Record<string, unknown>` 递交。
 *
 * 坐标写法对齐 rc.2 `Menu.module.css` 的 `.portal[data-anchor-side='top']`：
 * `bottom: max(margin, calc(anchor(top) + gap))`、`left: max(margin, anchor(left))`。
 * `max()` 就是视口夹取——锚点贴边时面板不会被推出视口。浏览器不支持 CSS 锚点定位时
 * 这些值不成立（`anchor()` 使声明失效），面板退回 `.ss-panel` 的静态定位。
 *
 * @param geo - 放置边、间距与留白。
 * @param trigger - 面板自身（它写 `position-anchor`）；`false` 时这份样式给触发元素。
 * @returns 可直接挂在 `style` 上的对象。
 */
export function cssAnchorPositionStyle(
  geo: CssAnchorGeometry,
  trigger: boolean,
): Record<string, unknown> {
  const name = PANEL_ANCHOR_NAME;
  const gap = `${geo.gap}px`;
  const margin = `${geo.margin}px`;
  if (trigger) return { anchorName: name };
  const anchored = geo.side === 'top'
    ? { bottom: `max(${margin}, calc(anchor(top) + ${gap}))`, top: 'auto' }
    : { top: `max(${margin}, calc(anchor(bottom) + ${gap}))`, bottom: 'auto' };
  return {
    positionAnchor: name,
    left: `max(${margin}, anchor(left))`,
    right: 'auto',
    ...anchored,
  };
}

/**
 * 触发元素一侧的样式：`css-anchor` 档给面板一个锚点，其余档返回空对象。
 *
 * `auto` 表示显式清掉同名锚点：老代次的触发元素上万一残留（同页其它组件写过同名
 * dashed-ident，或发生过热更新），面板仍不会去读它。
 *
 * @returns 可直接挂在触发元素 `style` 上的对象。
 */
export function usePanelAnchorTriggerStyle(): Record<string, unknown> {
  return PANEL_ANCHOR_BACKEND === 'css-anchor'
    ? cssAnchorPositionStyle({ side: 'top', gap: 0, margin: 0 }, true)
    : { anchorName: 'auto' };
}

/**
 * 定位并夹取面板；按 {@link PANEL_ANCHOR_BACKEND} 三档分派。
 *
 * 三档都必须**无条件**调用同名 hooks（`useAnchoredMaxHeight` 在 `static` 档也调用，
 * 只是取值时不用）——按宿主分支决定调不调 hook 会让 hook 序列随宿主跳变。
 *
 * @param options - 面板开合、两个 ref、放置边与对齐、间距与留白。
 * @returns 面板 `style` 的定位部分；`hook` 档是宿主给的行内几何，`css-anchor` 档是 CSS
 *   锚点行内样式，`static` 档是 `null`（调用方退到静态 `bottom`）。
 */
export function usePanelAnchorPosition(options: PanelAnchorOptions): CSSProperties | null {
  if (PANEL_ANCHOR_BACKEND === 'hook' && hostUseAnchoredPosition !== undefined) {
    return hostUseAnchoredPosition(options);
  }
  // 参数恒为定值：rc.2 的 hook 以 `signal` 决定何时重量，而本面板的锚点在整个张开期间不变。
  const capped = hostUseAnchoredMaxHeight ?? ((): number => ANCHORED_MAX_HEIGHT_CAP);
  const maxHeight = capped(
    options.panelRef,
    ANCHORED_MAX_HEIGHT_CAP,
    'dsh-later-panel',
    options.margin,
  );
  if (PANEL_ANCHOR_BACKEND === 'hook') return null;
  if (PANEL_ANCHOR_BACKEND === 'css-anchor') {
    return {
      ...cssAnchorPositionStyle(
        { side: options.side ?? 'bottom', gap: options.gap, margin: options.margin },
        false,
      ),
      maxHeight,
    } as CSSProperties;
  }
  warnMissingHook('useAnchoredPosition / useAnchoredMaxHeight');
  return null;
}

/**
 * 点击面板与触发元素之外时关闭；宿主提供官方 hook 时直接透传。
 * @param root 触发元素（面板不在其子树内，故需一并给出 portal ref）。
 * @param open 面板是否展开（false 时解绑监听）。
 * @param setOpen 关闭回调（官方 hook 以 `false` 调用）。
 * @param portal 被 portal 到 body 的面板元素。
 */
export function usePanelOutsideDismiss(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
  portal?: RefObject<HTMLElement | null>,
): void {
  if (hostUseDismissOnOutsidePointer === undefined) {
    // 不注册监听：关闭仍由调用方的遮罩与 Escape 负责（见 SchedButton 的 !hasOfficial 分支）。
    warnMissingHook('useDismissOnOutsidePointer');
    return;
  }
  hostUseDismissOnOutsidePointer(root, open, setOpen, portal);
}

/**
 * 面板挂载前的「先排版、后上色」样式，避免首帧从视口原点闪一下。
 *
 * 与官方 `PickerPopover` 的 `MEASURE_STYLE` 同款：`fixed` 元素默认落在 static
 * 位置，若等第一帧测量再定位，会看到面板先出现在左上角。
 */
export const PANEL_MEASURE_STYLE: CSSProperties = {
  visibility: 'hidden',
  left: 0,
  top: 0,
};

/** 兜底路径用：Esc 关闭的监听（官方 outside-pointer 不覆盖键盘）。 */
export function useEscapeToClose(open: boolean, setOpen: (open: boolean) => void): void {
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenRef.current(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
}

/**
 * 图标别名：新名优先、老代次的尺寸后缀兜底。
 *
 * 两代都没有时的兜底是**什么都不画**（比画一个错图标更容易被发现）。
 * `IconInfoOutline` 在老代次没有任何对应图标（两代都没有 `IconInfo*`），语义最近的是问号图标。
 */
/**
 * 本插件**可能查询**的图标导出名（两代命名合起来的全集）。
 *
 * 为什么要把这张表公开：`import * as ns` 在 bundle 里会被 esbuild 改写成
 * `__toESM(require(...))` —— 它只**拷贝可枚举自有属性**到新对象。真实宿主返回的是含静态导出的
 * 普通对象（拷贝得到全部图标），但测试桩是 `Proxy`（默认没有 `ownKeys`），拷贝后什么都查不到，
 * 图标会退化成兜底。所以测试桩要按这张表声明可枚举属性 —— 表在这里，桩才不必另抄一份。
 */
export const ICON_EXPORT_NAMES: readonly string[] = [
  'IconClockOutlineRegular', 'IconClockOutline16',
  'IconCopyOutlineRegular', 'IconCopyOutline16',
  'IconCheckOutlineRegular', 'IconCheckOutline16',
  'IconCloseOutlineRegular', 'IconCloseOutline16',
  'IconChevronDownOutlineRegular', 'IconChevronDownOutline14',
  'IconEditOutlineRegular', 'IconEditOutline16',
  'IconPauseOutlineRegular', 'IconPauseOutline16',
  'IconPlayOutlineRegular', 'IconPlayOutline16',
  'IconSendOutlineRegular', 'IconSendOutline16',
  'IconTrashOutlineRegular', 'IconTrashOutline16',
  'IconInfoOutlineRegular', 'IconQuestionOutline14',
  'IconPaperclipOutline16',
  'FileTypeIcon', 'fileSizeText',
] as const;

const EmptyIcon: IconComponent = () => null;

function firstIcon(...candidates: readonly (IconComponent | undefined)[]): IconComponent {
  return candidates.find((candidate) => candidate !== undefined) ?? EmptyIcon;
}

export const IconClock = firstIcon(
  pick<IconComponent>('IconClockOutlineRegular'),
  pick<IconComponent>('IconClockOutline16'),
);
export const IconCopy = firstIcon(
  pick<IconComponent>('IconCopyOutlineRegular'),
  pick<IconComponent>('IconCopyOutline16'),
);
export const IconCheck = firstIcon(
  pick<IconComponent>('IconCheckOutlineRegular'),
  pick<IconComponent>('IconCheckOutline16'),
);
export const IconClose = firstIcon(
  pick<IconComponent>('IconCloseOutlineRegular'),
  pick<IconComponent>('IconCloseOutline16'),
);
export const IconChevronDown = firstIcon(
  pick<IconComponent>('IconChevronDownOutlineRegular'),
  pick<IconComponent>('IconChevronDownOutline14'),
);
export const IconEdit = firstIcon(
  pick<IconComponent>('IconEditOutlineRegular'),
  pick<IconComponent>('IconEditOutline16'),
);
export const IconPause = firstIcon(
  pick<IconComponent>('IconPauseOutlineRegular'),
  pick<IconComponent>('IconPauseOutline16'),
);
export const IconPlay = firstIcon(
  pick<IconComponent>('IconPlayOutlineRegular'),
  pick<IconComponent>('IconPlayOutline16'),
);
export const IconSend = firstIcon(
  pick<IconComponent>('IconSendOutlineRegular'),
  pick<IconComponent>('IconSendOutline16'),
);
export const IconTrash = firstIcon(
  pick<IconComponent>('IconTrashOutlineRegular'),
  pick<IconComponent>('IconTrashOutline16'),
);
export const IconInfo = firstIcon(
  pick<IconComponent>('IconInfoOutlineRegular'),
  pick<IconComponent>('IconQuestionOutline14'),
);

/**
 * `Tooltip` 的 `portal` prop：0.1.7 起才有。
 *
 * 用 **spread** 而不是直接写 `<Tooltip portal>`：JSX 的 spread 不做多余属性检查，两代都能编译；
 * 0.1.5 的 Tooltip 实现只解构 `label/side/delayMs/disabled/maxWidth/children`（已核对该代
 * `lib/index.js`），多出来的 `portal` 被**静默忽略**，不会漏到 DOM 上，也不会告警。
 *
 * 代价：老代次的 tooltip 不再固定渲染到 `document.body`，可能被可滚动的祖先裁切 ——
 * 这是 0.1.5 的既有能力上限，不是我们引入的降级。
 */
export const tooltipPortalProps: { portal?: true } = { portal: true };

/** `FileTypeIcon` 的 props（两代同名同形：`{ path, size? }`）。 */
export interface FileTypeIconProps {
  readonly path: string;
  readonly size?: number;
}

/**
 * 文件类型图标：0.1.5 有 `FileTypeIcon`，**0.1.2 没有**。
 *
 * 降级：0.1.2 上统一画回形针（两代都有 `IconPaperclipOutline16`），即"这是个附件"而不是
 * "这是哪种文件"。代价是丢失按扩展名区分的图标 —— 在 0.1.2 上可接受（那里连 `fileSizeText`
 * 都没有，附件行本来就是简化形态）。
 */
export function FileTypeIconCompat({ path, size }: FileTypeIconProps): JSX.Element | null {
  const host = pick<(props: FileTypeIconProps) => JSX.Element | null>('FileTypeIcon');
  if (host !== undefined) return createElement(host, { path, size });
  const paperclip = pick<IconComponent>('IconPaperclipOutline16');
  if (paperclip !== undefined) return createElement(paperclip, { size });
  return null;
}

/**
 * 字节数的可读文本：宿主有 `fileSizeText` 就用它；0.1.2 没有，走本地实现。
 *
 * 本地实现刻意与宿主同量级（1024 进制、一位小数、整数不带 `.0`），差异只可能出现在极值上。
 * 老代次没有可比对的实现，这是能做到的最接近的近似 —— **不声称与宿主逐字相同**。
 */
export function fileSizeTextCompat(bytes: number): string {
  const host = pick<(value: number) => string>('fileSizeText');
  if (host !== undefined) return host(bytes);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/**
 * 复制到剪贴板：优先宿主的 `writeClipboard`，缺失时退到 `navigator.clipboard`，
 * 再退到隐藏 textarea + `execCommand('copy')`（旧宿主 / 非安全上下文）。
 *
 * 为什么不用具名 import：`writeClipboard` 在部分代次的 primitives 里不存在，
 * 具名 import 是链接期硬失败，会让整条插件加载不了。用 `pick()` 探测后逐级降级。
 * @param text - 要复制的纯文本。
 * @returns 是否成功（失败由调用方决定要不要反馈）。
 */
export async function writeClipboardCompat(text: string): Promise<boolean> {
  const host = pick<(value: string) => Promise<boolean>>('writeClipboard');
  if (host !== undefined) {
    try {
      return await host(text);
    } catch {
      /* 宿主实现失败时继续走本地降级 */
    }
  }
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (value: string) => Promise<void> } } })
      .navigator;
    if (nav?.clipboard?.writeText !== undefined) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 权限/非安全上下文，继续降级 */
  }
  try {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

/**
 * 本代次解析到的图标名（别名 → 实际用的宿主导出名）。
 *
 * 诊断与测试用：能核对"这一代到底用了哪一套名字"，而不是读代码猜。
 */
export function resolvedIconNames(): Record<string, string | undefined> {
  const table: Record<string, readonly (readonly [string, IconComponent | undefined])[]> = {
    clock: [['IconClockOutlineRegular', pick<IconComponent>('IconClockOutlineRegular')], ['IconClockOutline16', pick<IconComponent>('IconClockOutline16')]],
    copy: [['IconCopyOutlineRegular', pick<IconComponent>('IconCopyOutlineRegular')], ['IconCopyOutline16', pick<IconComponent>('IconCopyOutline16')]],
    check: [['IconCheckOutlineRegular', pick<IconComponent>('IconCheckOutlineRegular')], ['IconCheckOutline16', pick<IconComponent>('IconCheckOutline16')]],
    close: [['IconCloseOutlineRegular', pick<IconComponent>('IconCloseOutlineRegular')], ['IconCloseOutline16', pick<IconComponent>('IconCloseOutline16')]],
    chevronDown: [['IconChevronDownOutlineRegular', pick<IconComponent>('IconChevronDownOutlineRegular')], ['IconChevronDownOutline14', pick<IconComponent>('IconChevronDownOutline14')]],
    edit: [['IconEditOutlineRegular', pick<IconComponent>('IconEditOutlineRegular')], ['IconEditOutline16', pick<IconComponent>('IconEditOutline16')]],
    pause: [['IconPauseOutlineRegular', pick<IconComponent>('IconPauseOutlineRegular')], ['IconPauseOutline16', pick<IconComponent>('IconPauseOutline16')]],
    play: [['IconPlayOutlineRegular', pick<IconComponent>('IconPlayOutlineRegular')], ['IconPlayOutline16', pick<IconComponent>('IconPlayOutline16')]],
    send: [['IconSendOutlineRegular', pick<IconComponent>('IconSendOutlineRegular')], ['IconSendOutline16', pick<IconComponent>('IconSendOutline16')]],
    trash: [['IconTrashOutlineRegular', pick<IconComponent>('IconTrashOutlineRegular')], ['IconTrashOutline16', pick<IconComponent>('IconTrashOutline16')]],
    info: [['IconInfoOutlineRegular', pick<IconComponent>('IconInfoOutlineRegular')], ['IconQuestionOutline14', pick<IconComponent>('IconQuestionOutline14')]],
  };
  const out: Record<string, string | undefined> = {};
  for (const [alias, candidates] of Object.entries(table)) {
    out[alias] = candidates.find(([, value]) => value !== undefined)?.[0];
  }
  return out;
}
