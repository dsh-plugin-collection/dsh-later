/**
 * `useScheduleSummary`：定时摘要的 React 订阅入口（供 dsh-later 自身与其它
 * 客户端插件共用）。
 *
 * 用法（跨插件，消费方先声明 `dsh.client.external: ["dsh-later"]`）：
 * ```js
 * const { useScheduleSummary } = require('dsh-later/client')
 * // 组件内：会话 id → { count, nextAt, state }
 * const summary = useScheduleSummary()
 * ```
 *
 * store 可能在首个渲染之后才被登记（插件 apply 顺序不保证），因此本 hook 同时
 * 订阅 store 登记表：store 一到就重渲染并按新 store 取快照。
 * @module dsh-later/client/useScheduleSummary
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { ScheduleSummaryMap } from '../schedule-summary.js';
import {
  getScheduleSummaryStore,
  subscribeScheduleSummaryStore,
  type ScheduleSummaryStore,
} from '../schedule-summary-store.js';

/** 无 store 时的空快照（引用恒定，避免无限重渲染）。 */
const EMPTY_SUMMARY: ScheduleSummaryMap = new Map();

const noopSubscribe = (): (() => void) => () => undefined;
const emptySnapshot = (): ScheduleSummaryMap => EMPTY_SUMMARY;
const missingSnapshot = (): undefined => undefined;

/**
 * 订阅当前定时摘要。
 * @param store - 显式 store（测试/多实例用）；缺省取已登记的全局 store。
 * @returns 会话 id → 定时摘要（无任务时为空的 Map，引用恒定）。
 */
export function useScheduleSummary(store?: ScheduleSummaryStore): ScheduleSummaryMap {
  const registered = useSyncExternalStore(subscribeScheduleSummaryStore, getScheduleSummaryStore, missingSnapshot);
  const target = store ?? registered;
  const subscribe = useMemo(
    () => (target === undefined ? noopSubscribe : (listener: () => void) => target.subscribe(listener)),
    [target],
  );
  const getSnapshot = useMemo(
    () => (target === undefined ? emptySnapshot : () => target.getSnapshot()),
    [target],
  );
  return useSyncExternalStore(subscribe, getSnapshot, emptySnapshot);
}
