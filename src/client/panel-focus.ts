/**
 * 面板的焦点合同（issue #204）：打开即入面板，关闭时按需还回触发按钮。
 *
 * ## 为什么单独抽出来
 *
 * 焦点是**副作用**，不是渲染结果：面板打开时 `document.activeElement` 仍是点击前的那个
 * 元素（通常是输入框），屏幕阅读器根本不会念 dialog 的内容，键盘用户按 Tab 也会先走到
 * 面板**后面**的元素上去。所以打开时必须主动把焦点搬进面板。
 *
 * 关闭时的归还同样有讲究。无条件 `trigger.focus()` 会**抢焦点**：用户在面板外点了一下、
 * 或从别处把焦点挪走了，此时再把焦点拽回时钟按钮，下一次敲键盘就莫名落回输入框旁。
 * 所以只在一种情况下归还——**关闭那一刻焦点仍在面板内**（等价于「这次关闭是面板自己
 * 发起的」：面板里的关闭按钮、Esc、某个快捷芯片）。
 *
 * ## 为什么在「关闭动作」里判，而不是在 effect 的 cleanup 里
 *
 * `useEffect` 的 cleanup 在 DOM 变更**之后**才跑（passive effect 的次序是 commit →
 * cleanup → create），那时面板节点已从文档里摘掉，`document.activeElement` 也已被浏览器
 * 重置成 `body`——「用户点了外面」和「面板刚被摘掉」这两件事在那一刻**无法区分**。
 * 关闭动作发生在事件处理里，面板还挂着、焦点还在原位，判据才是准的。
 *
 * 抽成独立模块而不是写进组件里，是为了让上面两条判据能被直接测到：组件级假 React
 * 不挂真 DOM ref，effect 里的 DOM 行为在那种夹具里根本不会发生（`panelRef.current ===
 * null` → 整段空转），断言只能退化成读源码。
 *
 * @module dsh-later/client/panel-focus
 */

/** 本模块需要的最小元素面（`focus()` 与 `contains()`；DOM 元素天然满足）。 */
export interface FocusableElementLike {
  focus(): void;
  contains?(node: unknown): boolean;
}

/** 读当前焦点元素；非浏览器环境返回 null。 */
function activeElementOf(): unknown {
  return typeof document === 'undefined' ? null : document.activeElement;
}

/**
 * 把焦点搬进面板。
 *
 * 面板自身必须可聚焦（`tabIndex={-1}`），否则 `focus()` 是空操作——这条由调用点保证。
 *
 * @param panel - 已挂载的面板元素。
 */
export function focusIntoPanel(panel: FocusableElementLike): void {
  try {
    panel.focus();
  } catch {
    /* 拒绝聚焦（如面板已被移除）：不影响渲染，交由浏览器默认行为 */
  }
}

/**
 * 关闭面板前把焦点还给触发按钮——**仅当焦点还在面板内**。
 *
 * @param panel - 正在关闭的面板元素（调用时它必须仍挂载）。
 * @param trigger - 触发面板的按钮；缺失时不归还（宁可不动，也不猜一个焦点目标）。
 * @returns 焦点是否被归还（调用方如需要可以据此记日志；不影响关闭动作）。
 */
export function restoreFocusToTrigger(
  panel: FocusableElementLike,
  trigger: FocusableElementLike | null,
): boolean {
  if (trigger === null) return false;
  const active = activeElementOf();
  const stillInside =
    active === null
      ? false
      : typeof panel.contains === 'function'
        ? panel.contains(active)
        : active === panel;
  if (!stillInside) return false;
  try {
    trigger.focus();
    return true;
  } catch {
    /* 触发元素可能已随会话卸载：静默降级 */
    return false;
  }
}
