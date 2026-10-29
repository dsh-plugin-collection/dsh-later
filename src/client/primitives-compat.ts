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

/** 宿主是否提供了官方的锚定 hook。 */
export const hasOfficialAnchoredPosition = hostUseAnchoredPosition !== undefined;

/**
 * 锚定并夹取面板位置；宿主提供官方 hook 时直接透传，否则本地兜底。
 * @param options 面板开合、两个 ref、放置边与对齐、间距与留白。
 */
export function usePanelAnchorPosition(options: PanelAnchorOptions): CSSProperties | null {
  if (hostUseAnchoredPosition === undefined) {
    warnMissingHook('useAnchoredPosition');
    return null;
  }
  return hostUseAnchoredPosition(options);
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
