/**
 * 定时摘要 store 单测（src/schedule-summary-store.ts → lib/schedule-summary-store.js）。
 *
 * 覆盖 issue #17 的订阅面：
 *  - 列表变化 → 立即重算并通知（引用仅在内容变化时替换）
 *  - 状态 tick → scheduled/urgent/overdue 随时间推进（本地时钟，零网络）
 *  - 订阅/退订、dispose 后不再通知、清理定时器
 *  - 全局登记表（get/set/subscribe）供消费方在 store 迟到时仍能重渲染
 *
 * @module tests/schedule-summary-store.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScheduleSummaryStore,
  getScheduleSummaryStore,
  setActiveScheduleSummaryStore,
  subscribeScheduleSummaryStore,
} from '../lib/schedule-summary-store.js';

const NOW = Date.parse('2026-09-05T12:00:00Z');
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

/** 最小 sessions 服务桩：可注入快照、可触发变更、计 refresh 次数。 */
function makeSessions(byId = {}) {
  let current = { byId };
  const listeners = new Set();
  const state = { refreshCalls: 0 };
  return {
    state,
    list: {
      getSnapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    refresh: async () => {
      state.refreshCalls += 1;
    },
    /** 替换快照并通知列表订阅者（等效宿主推送新投影帧）。 */
    set(next) {
      current = { byId: next };
      for (const listener of [...listeners]) listener();
    },
  };
}

const scheduled = (offsetMs, extra = {}) => ({ scheduled_at: iso(offsetMs), ...extra });

test('store：创建即取当前快照，列表变化时重算并通知', async () => {
  const sessions = makeSessions({
    a: { projectionValues: { userSchedules: { schedules: [scheduled(60 * 60_000)] } } },
  });
  const store = createScheduleSummaryStore(sessions, { now: () => NOW, autoRefresh: false });
  try {
    assert.equal(store.getSnapshot().size, 1);
    assert.equal(store.getSnapshot().get('a').state, 'scheduled');

    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });

    // 无变化：reload 不应通知（引用稳定是 useSyncExternalStore 的前提）。
    const before = store.getSnapshot();
    store.reload();
    assert.equal(store.getSnapshot(), before);
    assert.equal(notified, 0);

    // 新会话出现 → 重算 + 通知。
    sessions.set({
      a: { projectionValues: { userSchedules: { schedules: [scheduled(60 * 60_000)] } } },
      b: { projectionValues: { userSchedules: { schedules: [scheduled(2 * 60_000)] } } },
    });
    assert.equal(notified, 1);
    assert.equal(store.getSnapshot().size, 2);
    assert.equal(store.getSnapshot().get('b').state, 'urgent');

    // 退订后不再收到通知。
    unsubscribe();
    sessions.set({});
    assert.equal(notified, 1);
    assert.equal(store.getSnapshot().size, 0);
  } finally {
    store.dispose();
  }
});

test('store：状态 tick 随时间推进 scheduled → urgent → overdue', async () => {
  let clock = NOW;
  const sessions = makeSessions({
    a: { projectionValues: { userSchedules: { schedules: [scheduled(10 * 60_000)] } } },
  });
  const store = createScheduleSummaryStore(sessions, {
    now: () => clock,
    stateTickMs: 5,
    autoRefresh: false,
  });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    assert.equal(store.getSnapshot().get('a').state, 'scheduled');

    clock = NOW + 6 * 60_000; // 距触发 4min ≤ 5min 窗口
    await wait(40);
    assert.equal(store.getSnapshot().get('a').state, 'urgent');

    clock = NOW + 11 * 60_000; // 已过触发时刻
    await wait(40);
    assert.equal(store.getSnapshot().get('a').state, 'overdue');
  } finally {
    store.dispose();
  }
});

test('store：autoRefresh 只在允许时发 refresh RPC；dispose 后停止一切', async () => {
  const sessions = makeSessions({});
  const store = createScheduleSummaryStore(sessions, {
    now: () => NOW,
    autoRefresh: true,
    canRefresh: () => true,
    stateTickMs: 5,
    refreshIntervalMs: 5,
  });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(40);
  assert.ok(sessions.state.refreshCalls > 1, `应至少刷新两次，实际 ${sessions.state.refreshCalls}`);

  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  store.dispose();

  const afterDispose = sessions.state.refreshCalls;
  await wait(40);
  assert.equal(sessions.state.refreshCalls, afterDispose, 'dispose 后不得再发 refresh');
  // dispose 后列表变化也不得再通知。
  sessions.set({ a: { projectionValues: { userSchedules: { schedules: [scheduled(1_000)] } } } });
  assert.equal(notified, 0);
  // dispose 幂等。
  store.dispose();
});

test('store：canRefresh 为 false 时不发 RPC', async () => {
  const sessions = makeSessions({});
  const store = createScheduleSummaryStore(sessions, {
    now: () => NOW,
    autoRefresh: true,
    canRefresh: () => false,
    refreshIntervalMs: 5,
    stateTickMs: 5,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(sessions.state.refreshCalls, 0);
  } finally {
    store.dispose();
  }
});

test('登记表：set/get 通知订阅者，重复 set 同一 store 不重复通知', () => {
  const sessions = makeSessions({});
  const store = createScheduleSummaryStore(sessions, { now: () => NOW, autoRefresh: false });
  const seen = [];
  const unsubscribe = subscribeScheduleSummaryStore(() => seen.push(getScheduleSummaryStore()));
  try {
    setActiveScheduleSummaryStore(store);
    assert.equal(getScheduleSummaryStore(), store);
    assert.deepEqual(seen, [store]);

    setActiveScheduleSummaryStore(store);
    assert.equal(seen.length, 1, '同一 store 重复登记不应再通知');

    setActiveScheduleSummaryStore(undefined);
    assert.equal(getScheduleSummaryStore(), undefined);
    assert.equal(seen.length, 2);

    unsubscribe();
    setActiveScheduleSummaryStore(store);
    assert.equal(seen.length, 2, '退订后不再通知');
    assert.equal(getScheduleSummaryStore(), store);
  } finally {
    unsubscribe();
    setActiveScheduleSummaryStore(undefined);
    store.dispose();
  }
});
