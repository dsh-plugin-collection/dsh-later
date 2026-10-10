/**
 * 定时摘要 store：把 {@link buildScheduleSummary} 的纯计算接到宿主 `sessions`
 * 服务上，得到一个**可订阅的公共数据源**。
 *
 * 为什么需要它（issue #17）：dsh-later 自己的侧栏 badge 与外部插件（如
 * dsh-group-status）都需要「全会话定时任务摘要」。两条独立通路会各自订阅
 * `sessions.list`、各自周期 `refresh()`，既浪费 RPC 又容易漂移。本 store 是
 * **唯一**的数据权威：内部负责列表订阅、状态 tick（scheduled→urgent→overdue）
 * 与 `session.list` 读 RPC 补时效；外部只读 {@link ScheduleSummaryStore.getSnapshot}
 * 或订阅变更。
 *
 * 跨插件使用方式（消费方声明 `dsh.client.external: ["dsh-later"]` 后）：
 * ```js
 * const later = require('dsh-later/client')
 * const store = later.getScheduleSummaryStore()
 * ```
 *
 * 本模块零 DOM / 零 React 依赖（`document` / `window` 一律经 `globalThis`
 * 结构化探测），宿主 tsc 与浏览器 esbuild 都能编译，`node --test` 也能直接跑。
 * @module dsh-later/schedule-summary-store
 */
import { buildScheduleSummary, sameScheduleSummary, type ScheduleSummaryMap, type ScheduleSummarySource } from './schedule-summary.js';

/** 摘要状态重算周期（本地时钟，零网络）。 */
export const SUMMARY_STATE_TICK_MS = 30_000;
/** `session.list` 重拉周期（读 RPC；仅页面可见时执行）。 */
export const SUMMARY_REFRESH_INTERVAL_MS = 60_000;

/** 宿主 `sessions` 服务的结构子集（只用到列表快照与 refresh）。 */
export interface ScheduleSummarySessionsLike {
  /** 会话列表 store（快照 + 变更订阅）。 */
  readonly list: {
    getSnapshot(): ScheduleSummarySource;
    subscribe(listener: () => void): () => void;
  };
  /** 重拉会话列表（读 RPC，不写会话日志）。 */
  refresh(): Promise<unknown>;
}

/** 可订阅的定时摘要 store。 */
export interface ScheduleSummaryStore {
  /** 当前摘要（引用稳定；内容变化时才换成新对象）。 */
  getSnapshot(): ScheduleSummaryMap;
  /** 订阅变更；返回退订函数。 */
  subscribe(listener: () => void): () => void;
  /** 立即按最新会话列表快照重算（内容有变化才通知）。 */
  reload(): void;
  /** 释放订阅/定时器（宿主卸载时调用）。 */
  dispose(): void;
}

export interface ScheduleSummaryStoreOptions {
  /** 状态重算周期（毫秒）；缺省 {@link SUMMARY_STATE_TICK_MS}。 */
  readonly stateTickMs?: number;
  /** 会话列表重拉周期（毫秒）；缺省 {@link SUMMARY_REFRESH_INTERVAL_MS}。 */
  readonly refreshIntervalMs?: number;
  /** 当前时刻注入（单测用）；缺省 `Date.now`。 */
  readonly now?: () => number;
  /** 是否允许发起 refresh RPC；缺省「页面可见时允许」。 */
  readonly canRefresh?: () => boolean;
  /** 是否自动周期 refresh；缺省 true（单测可关）。 */
  readonly autoRefresh?: boolean;
}

/** 最小事件目标面（DOM 的 `document` / `globalThis`）。 */
interface EventTargetLike {
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

/** 页面可见性面。 */
interface VisibilityLike {
  readonly visibilityState?: string;
}

/** 取 `globalThis.document`（不引 DOM 类型，宿主编译期无 document 也能通过）。 */
function documentOf(): (VisibilityLike & EventTargetLike) | undefined {
  const doc = (globalThis as { document?: unknown }).document;
  return typeof doc === 'object' && doc !== null ? (doc as VisibilityLike & EventTargetLike) : undefined;
}

/**
 * 创建定时摘要 store（宿主 `apply` 内创建一次，全插件共享）。
 * @param sessions - 宿主 `sessions` 服务。
 * @param options - 周期/时钟/刷新策略覆盖（单测用）。
 * @returns 可订阅 store。
 */
export function createScheduleSummaryStore(
  sessions: ScheduleSummarySessionsLike,
  options: ScheduleSummaryStoreOptions = {},
): ScheduleSummaryStore {
  const now = options.now ?? Date.now;
  const stateTickMs = options.stateTickMs ?? SUMMARY_STATE_TICK_MS;
  const refreshIntervalMs = options.refreshIntervalMs ?? SUMMARY_REFRESH_INTERVAL_MS;
  const autoRefresh = options.autoRefresh ?? true;
  const canRefresh =
    options.canRefresh ??
    ((): boolean => {
      const doc = documentOf();
      return doc?.visibilityState === undefined || doc.visibilityState === 'visible';
    });

  const listeners = new Set<() => void>();
  let snapshot: ScheduleSummaryMap = new Map();
  let disposed = false;

  const notify = (): void => {
    // 快照一份再遍历：订阅者可能在回调里退订。
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* 单个订阅者异常不影响其余订阅者与主流程 */
      }
    }
  };

  const reload = (): void => {
    if (disposed) return;
    const next = buildScheduleSummary(sessions.list.getSnapshot(), now());
    if (sameScheduleSummary(snapshot, next)) return;
    snapshot = next;
    notify();
  };

  const unsubscribeList = sessions.list.subscribe(reload);
  const stateTick = setInterval(reload, stateTickMs);

  let refreshTick: ReturnType<typeof setInterval> | undefined;
  let onVisible: (() => void) | undefined;
  const doc = documentOf();
  const target = globalThis as EventTargetLike;

  const refreshNow = (): void => {
    if (disposed || !canRefresh()) return;
    try {
      void sessions.refresh().catch(() => undefined);
    } catch {
      /* 刷新失败不影响既有摘要 */
    }
  };

  if (autoRefresh) {
    onVisible = (): void => {
      if (!disposed && canRefresh()) {
        refreshNow();
        reload();
      }
    };
    refreshTick = setInterval(() => {
      if (canRefresh()) refreshNow();
    }, refreshIntervalMs);
    doc?.addEventListener?.('visibilitychange', onVisible);
    target.addEventListener?.('online', onVisible);
    refreshNow();
  }

  reload();

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearInterval(stateTick);
    if (refreshTick !== undefined) clearInterval(refreshTick);
    if (onVisible !== undefined) {
      doc?.removeEventListener?.('visibilitychange', onVisible);
      target.removeEventListener?.('online', onVisible);
    }
    unsubscribeList();
    listeners.clear();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload,
    dispose,
  };
}

/** 当前生效的 store（client 插件 `apply` 挂载时登记；跨插件只读入口）。 */
let activeStore: ScheduleSummaryStore | undefined;
/** store 登记变化的订阅者（消费方可能在 store 就绪前先渲染）。 */
const registryListeners = new Set<() => void>();

/**
 * 登记/撤销当前 store（由 dsh-later 自身 `apply` 调用；外部插件不要调用）。
 * @param store - 生效的 store；undefined 表示撤销。
 */
export function setActiveScheduleSummaryStore(store: ScheduleSummaryStore | undefined): void {
  if (activeStore === store) return;
  activeStore = store;
  for (const listener of [...registryListeners]) {
    try {
      listener();
    } catch {
      /* 忽略单个订阅者异常 */
    }
  }
}

/** 读取当前生效的 store；dsh-later 未加载时为 undefined。 */
export function getScheduleSummaryStore(): ScheduleSummaryStore | undefined {
  return activeStore;
}

/** 订阅 store 登记变化（供 React hook 在 store 迟到时仍能重渲染）。 */
export function subscribeScheduleSummaryStore(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}
