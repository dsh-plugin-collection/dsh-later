/**
 * 跨插件公共 API 契约单测（issue #17）——直接驱动构建产物 `lib/client.js`。
 *
 * 验收标准：消费方（dsh-group-status 等）在 `dsh.client.external` 里声明
 * dsh-later 后 `require('dsh-later/client')`，即可拿到：
 *   - `getScheduleSummaryStore()`：已由 apply 登记的摘要 store
 *   - `summarizeScheduleGroup(map, sessionIds)`：分组聚合
 *   - `useScheduleSummary()`：React 订阅 hook
 * 并且 store 与 `sessions.list` 同源、卸载后自动注销。
 * @module tests/client-summary-api.test
 */
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

/** 装载客户端 bundle（浏览器模块加载器格式的最小 shim）。 */
async function loadClientBundle() {
  const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let captured;
  const savedWindow = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: {
      load: (def) => {
        captured = def;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    innerHeight: 800,
  };
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', src)(globalThis.window);
  } finally {
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  }
  if (captured === undefined) throw new Error('bundle did not register a module');
  const require = (id) => {
    if (id === 'react') {
      return {
        createElement: () => null,
        Fragment: () => null,
        useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
        useEffect: () => {},
        useMemo: (f) => f(),
        useCallback: (f) => f,
        useRef: (v) => ({ current: v }),
        useSyncExternalStore: (_sub, get) => get(),
      };
    }
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') {
      return { jsx: () => null, jsxs: () => null, Fragment: () => null };
    }
    if (id === 'react-dom' || id === 'react-dom/client') {
      return { createPortal: () => null, createRoot: () => ({ render() {}, unmount() {} }) };
    }
    throw new Error(`unexpected host require: ${id}`);
  };
  return captured.factory(require);
}

/** 最小 sessions 服务桩。 */
function makeSessions(byId) {
  let current = { byId };
  const listeners = new Set();
  return {
    list: {
      getSnapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    refresh: async () => {},
    set(next) {
      current = { byId: next };
      for (const listener of [...listeners]) listener();
    },
  };
}

/** 驱动 apply 的 ctx 桩（与 tests/hover-card.test.mjs 同形）。 */
function makeCtx(sessions, disposers) {
  const slots = {
    register: () => () => {},
    inject: (hole, fn) => {
      try {
        fn();
      } catch {
        /* 插槽注册在本测不参与渲染 */
      }
    },
    subscribe: () => () => {},
    entries: () => [],
    entriesOfSlot: () => [],
  };
  const ctx = {
    get: (name) => {
      if (name === 'slots') return slots;
      if (name === 'sessions') return sessions;
      if (name === 'locale') return { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {}, register: () => () => {}, bind: () => (key) => key };
      return undefined;
    },
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return () => {};
    },
    on: () => () => {},
    inject: (_names, callback) => callback(ctx),
  };
  ctx.slots = slots;
  return ctx;
}

const NOW = Date.now();
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

test('契约：bundle 导出摘要 API，apply 登记 store 且与 sessions.list 同源', async () => {
  const mod = await loadClientBundle();
  for (const name of ['apply', 'getScheduleSummaryStore', 'subscribeScheduleSummaryStore', 'useScheduleSummary', 'buildScheduleSummary', 'summarizeScheduleGroup']) {
    assert.equal(typeof mod[name], 'function', `lib/client.js 必须导出 ${name}`);
  }

  const SESSION = 'session-abc';
  const OTHER = 'session-def';
  const sessions = makeSessions({
    [SESSION]: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(3600_000) }] } } },
    [OTHER]: { projectionValues: { userSchedules: { schedules: [] } } },
  });

  // apply 之前：没有生效的 store（消费方必须容忍）。
  assert.equal(mod.getScheduleSummaryStore(), undefined);

  const disposers = [];
  mod.apply(makeCtx(sessions, disposers));

  const store = mod.getScheduleSummaryStore();
  assert.ok(store !== undefined, 'apply 必须登记摘要 store');

  // 契约形状：Map<SessionId, { count, nextAt, state }>
  const summary = store.getSnapshot();
  assert.equal(summary.size, 1, '无任务的会话不得出现在摘要里');
  const entry = summary.get(SESSION);
  assert.equal(entry.count, 1);
  assert.equal(entry.nextAt, Date.parse(iso(3600_000)));
  assert.ok(['scheduled', 'urgent', 'overdue'].includes(entry.state));

  // 分组聚合（消费方最常用的入口）。
  const group = mod.summarizeScheduleGroup(summary, [SESSION, OTHER, 'session-missing']);
  assert.equal(group.sessions, 1);
  assert.equal(group.count, 1);

  // 列表变化 → store 摘要随之更新。
  sessions.set({});
  assert.equal(store.getSnapshot().size, 0, '列表清空后摘要必须同步清空');

  // 卸载 → 注销 store（消费方再次读到 undefined，不得拿着已释放的 store）。
  assert.ok(disposers.length > 0, 'apply 必须注册清理函数');
  for (const dispose of disposers) dispose();
  assert.equal(mod.getScheduleSummaryStore(), undefined);
});

test('契约：多次 require 拿到同一份 store（模块级单例）', async () => {
  const mod = await loadClientBundle();
  const sessions = makeSessions({});
  const disposers = [];
  mod.apply(makeCtx(sessions, disposers));
  try {
    const a = mod.getScheduleSummaryStore();
    // 等效消费方的 `require('dsh-later/client')`：模块导出面是同一对象。
    const b = mod.getScheduleSummaryStore();
    assert.equal(a, b);
    assert.equal(a.getSnapshot().size, 0);
  } finally {
    for (const dispose of disposers) dispose();
  }
});
