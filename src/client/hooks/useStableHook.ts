/**
 * 会话作用域 hook 的「身份冻结」助手（issue #203）。
 *
 * ## 为什么需要
 *
 * 宿主插槽的会话作用域 hook（`useInput` / `useProjection`）在类型上是**可选**的
 * ——旧 renderer 可能压根不给。旧实现直接按「这一帧有没有」分支调用：
 *
 * ```ts
 * const draft = input?.draft ?? (typeof useInput === 'function' ? useInput(select) : '');
 * ```
 *
 * React 的规则是「同一次组件渲染里 hook 槽位数必须与上一次相同」，而不是
 * 「源码里不许写 if」。上面那句 if 的问题在于**判据会随帧变**：宿主某一帧不给
 * input 快照，槽位就从 N 掉到 N-1，React 抛
 * `Rendered more/fewer hooks than during the previous render` 并卸载整棵子树
 * （用户看到的是按钮与面板直接消失）。
 *
 * ## 做法
 *
 * 把「给不给」冻结在**首次挂载**：首帧拿到哪个 hook 就永久用它，首帧没有就永久
 * 不调。于是分支结果逐帧一致 → 槽位恒定，同时保住「缺失时安静降级」的既有语义。
 *
 * ## 代价（刻意接受）
 *
 * 宿主运行中更换 hook 身份的假设**不成立就没事**：标准件按插槽条目装配，身份在
 * 条目存活期间稳定（`dsh-client-ui-renderer` 的 `scoped-slots.tsx` 用 `kit`
 * 对象一次性 bind）。万一某代宿主每帧新建闭包，我们继续用首帧那一个 —— 它仍
 * 闭包着同一份 store，读到的是旧引用而非崩溃，比抛 hook 数错误好得多。
 *
 * @module dsh-later/client/hooks/useStableHook
 */
import { useRef } from 'react';

/** 任意 hook 的形状（这里只关心「它会被调用」，不关心参数与返回）。 */
type AnyHook = (...args: any[]) => unknown;

/**
 * 冻结一个可选 hook 的身份。
 *
 * 返回值的「有无」在**整个实例生命周期内恒定**：首帧是 undefined 就永远是
 * undefined（调用点据此跳过），首帧给了就永远返回同一个函数（即使后续帧 props
 * 不再带它）。
 *
 * 调用点必须遵守一条配套约定：**只要有值就无条件调用**，不得再叠加
 * 「这一帧有没有数据」之类的第二重判据 —— 那会把槽位重新变成变量。
 *
 * @param hook - 本帧宿主给的 hook（可为 undefined）。
 * @returns 冻结后的 hook（可为 undefined）。
 */
export function useStableHook<H extends AnyHook>(hook: H | undefined): H | undefined {
  // 首帧初始化之后不再写入：render 期改 ref 会让「这一帧用哪个 hook」变得不可推理。
  const frozen = useRef<H | undefined>(hook);
  return frozen.current;
}
