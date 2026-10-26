/**
 * 官方 `dsh-client-ui-primitives` 的特性探测层：优先用官方 hook，缺失则本地兜底。
 *
 * 背景：面板的「抬升面 + 锚定 + 外部点击关闭」在官方 `PickerPopover` 里由
 * primitives 的 `useAnchoredPosition` / `useDismissOnOutsidePointer` 提供
 * （见 `@deepseek-ai/dsh-client-ui-schedule` 的 `PickerPopover.js`）。但本插件的
 * peer 覆盖 0.1.1 → 0.2.0 五个内核代次，早代次宿主提供的 primitives 版本尚无这两个导出。
 *
 * 为什么能安全地「有就用、没有就自己写」：
 *  - primitives 是宿主 seed 模块表基线（PLATFORM_MODULES），bundle 里保持 external，
 *    由 `require()` 直取宿主同一份模块实例，探测结果在**整页生命周期内恒定**；
 *  - 因此下面的 `anchorImpl` / `dismissImpl` 在模块初始化时就定型，之后每次渲染
 *    调用的都是同一个函数 → React 的 hook 调用序列稳定，不会因条件分支跳变。
 *
 * 与 `schedule-compat.ts` 的 `pick()` 同一套理由：**不能用具名 import**——ESM 具名
 * import 在目标导出缺失时是链接期硬失败（`SyntaxError: does not provide an export
 * named …`），会让插件在旧代次宿主上直接加载不了。这里走 namespace + 属性访问。
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
import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** 官方锚定 hook；旧代次 primitives 未导出时为 undefined。 */
const hostUseAnchoredPosition = pick<UseAnchoredPosition>('useAnchoredPosition');

/** 官方外部点击关闭 hook；旧代次 primitives 未导出时为 undefined。 */
const hostUseDismissOnOutsidePointer = pick<UseDismissOnOutsidePointer>('useDismissOnOutsidePointer');

/**
 * 本地兜底锚定：测量锚点 → 放上/下沿 → 夹取进视口。
 *
 * 行为对齐官方 `useAnchoredPosition`：capture 阶段监听 scroll（能盖住页面内嵌套的
 * 滚动容器）、监听 resize，并用 ResizeObserver 跟随面板自身尺寸变化。仅在旧代次
 * 宿主上启用——新代次走官方实现。
 */
function useLegacyAnchoredPosition({
  open,
  anchorRef,
  panelRef,
  side = 'bottom',
  align = 'start',
  gap,
  margin,
}: PanelAnchorOptions): CSSProperties | null {
  const [position, setPosition] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    const measure = (): void => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (anchor === null || panel === null) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = panel.offsetWidth;
      const panelHeight = panel.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const left = align === 'end'
        ? rect.right - panelWidth
        : rect.left;
      const rawTop = side === 'top'
        ? rect.top - panelHeight - gap
        : rect.bottom + gap;

      // 水平留边距后夹取；上/下沿各自翻转，保证面板始终可见。
      const clampedLeft = Math.min(
        Math.max(margin, left),
        Math.max(margin, viewportWidth - panelWidth - margin),
      );
      const overflowsTop = rawTop < margin;
      const overflowsBottom = rawTop + panelHeight > viewportHeight - margin;
      const top = overflowsTop && !overflowsBottom
        ? rect.bottom + gap
        : overflowsBottom && !overflowsTop
          ? rect.top - panelHeight - gap
          : rawTop;

      setPosition({
        left: `${Math.round(clampedLeft)}px`,
        top: `${Math.round(Math.max(margin, Math.min(top, viewportHeight - panelHeight - margin)))}px`,
      });
    };

    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const panel = panelRef.current;
    const observer = typeof ResizeObserver === 'undefined' || panel === null
      ? undefined
      : new ResizeObserver(measure);
    if (observer !== undefined && panel !== null) observer.observe(panel);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [open, anchorRef, panelRef, side, align, gap, margin]);

  return position;
}

/** 兜底用的空实现：不注册监听，关闭交给调用方的既有路径（Escape / mask）。 */
function noopDismiss(): void {
  /* 旧代次宿主无官方 outside-pointer hook，由 SchedButton 的 mask 负责关闭。 */
}

/** 模块初始化时定型，整个页面生命周期内不变（见文件头）。 */
const anchorImpl: UseAnchoredPosition = hostUseAnchoredPosition ?? useLegacyAnchoredPosition;
const dismissImpl: UseDismissOnOutsidePointer = hostUseDismissOnOutsidePointer ?? noopDismiss;

/** 宿主是否提供了官方的外部点击关闭能力。 */
export const hasOfficialOutsideDismiss = hostUseDismissOnOutsidePointer !== undefined;

/** 宿主是否提供了官方的锚定 hook。 */
export const hasOfficialAnchoredPosition = hostUseAnchoredPosition !== undefined;

/**
 * 锚定并夹取面板位置；宿主提供官方 hook 时直接透传，否则本地兜底。
 * @param options 面板开合、两个 ref、放置边与对齐、间距与留白。
 */
export function usePanelAnchorPosition(options: PanelAnchorOptions): CSSProperties | null {
  return anchorImpl(options);
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
  return dismissImpl(root, open, setOpen, portal);
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
 * 本代次解析到的图标名（别名 → 实际用的宿主导出名）。
 *
 * 诊断与测试用：能核对"这一代到底用了哪一套名字"，而不是读代码猜。
 */
export function resolvedIconNames(): Record<string, string | undefined> {
  const table: Record<string, readonly (readonly [string, IconComponent | undefined])[]> = {
    clock: [['IconClockOutlineRegular', pick<IconComponent>('IconClockOutlineRegular')], ['IconClockOutline16', pick<IconComponent>('IconClockOutline16')]],
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
