/**
 * 倒计时工厂 hook：以给定间隔重渲染，供倒计时文本与紧急度判断使用。
 * @module dsh-later/client/useCountdown
 */
import { useEffect, useRef, useState } from 'react';

/**
 * 每秒 tick；`intervalMs <= 0` 时**完全停摆**（不注册 interval）。
 *
 * 停摆做成「同一个 hook 的内部行为」而不是「调用方条件调用 hook」，是为了守住 React 的
 * hook 次序规则：无论启用与否，本 hook 恒为 `useState` + `useRef` + `useEffect` 三个槽位，
 * 调用方的分支（有没有提醒、面板开没开）都改变不了它的数量与顺序。
 *
 * **停摆信号用 `0`，不用 `undefined`**：形参默认值让「显式传 undefined」与「省略不传」在
 * 运行时不可区分，而 `useRemaining` 的默认参数（`now: number | undefined = useNow()`）正是
 * 靠省略来拿到每秒 tick 的。把 `undefined` 当停摆信号会连那条路径一起停掉。用 `0` 还顺手
 * 挡掉 `setInterval(fn, 0)` 这个真会发生的误用——浏览器把它钳到 ~4ms，那不是停摆，是把主
 * 线程点着。
 *
 * 重新启用（停摆 → `> 0`）时先把 `now` 对齐到当下再挂 interval：停摆期间 `now` 不再推进，
 * 不对齐的话，「一条提醒都没有 → 用户刚建了第一条」的那次渲染会拿着一个可能已经旧了很久
 * 的 `now`，倒计时文本虚高、`canPause` 这类「未到点」判据也会误判。
 * 残留一处：对齐发生在 effect 里，而 React 的 passive effect 在绘制之后才跑，所以启用后的
 * **第一帧**仍可能画着旧值、下一瞬即被纠正。换 `useLayoutEffect` 能消掉这一帧，但那会把
 * 「注册/注销 interval」一起挪到绘制前，改动面比这条收益大，这里不换。
 *
 * @param intervalMs - 重渲染间隔毫秒；`<= 0`（含 `0`、负数、`NaN`）表示停摆。默认每秒。
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  /** 上一次生效的间隔，只用来识别「从停摆切回启用」这一次切换。 */
  const prevMsRef = useRef<number>(intervalMs);
  useEffect(() => {
    const resuming = prevMsRef.current <= 0;
    prevMsRef.current = intervalMs;
    if (!(intervalMs > 0)) return undefined;
    // 挂载即启用时 resuming 为 false（useState 刚在同一轮渲染里读过 Date.now()），
    // 不必多渲染一次；只有从停摆切回来才对齐。
    if (resuming) setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** 相对目标时间的剩余毫秒。 */
export function useRemaining(targetEpoch: number | undefined, now: number | undefined = useNow()): number {
  if (targetEpoch === undefined) return 0;
  return Math.max(0, targetEpoch - (now ?? Date.now()));
}
