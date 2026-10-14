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
 * @module dsh-later/client/primitives-compat
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
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