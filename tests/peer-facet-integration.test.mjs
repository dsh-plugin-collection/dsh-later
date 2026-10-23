/**
 * 真对端集成：拿 dsh-group-status **真实** client bundle 当登记面（issue #83 的加固）。
 *
 * ## 为什么还要这一条
 *
 * `tests/group-status-facet.test.mjs` 里的登记面，是本仓按 `docs/facet-protocol.md` 的规则
 * 复刻出来的**假货**（同 id 由来源决胜、`remove(id, facet)` 只摘「还是自己」那一份）。它能回答
 * 「我们有没有按规则办事」，回答不了「规则本身对不对得上」。而两份契约各写一遍的风险恰好就在这儿：
 * 对端哪天改了接受条件、或者 `list()` 的条目形状变了，假货会照样绿——**静默不工作**正是这两个仓
 * 一路在消灭的那类失败（issue #36 的动机就是它）。
 *
 * 这里把对面换成真的：装 `../dsh-group-status/lib/client.js`，取它导出的
 * `registerGroupStatusFacet` / `groupStatusFacetRegistry`，让我们自己的真实 bundle 往里登记，
 * 然后按**它亲口说的结果**断言：收下几份、它的消费口径读出什么、关掉时有没有真摘掉，以及
 * 摘掉**有没有通知它的订阅者**（`subscribe` bump）。最后这条就是 issue #83 的全部用户可见后果——
 * 关掉开关后徽标少一格，靠的正是这次 bump；没有它，格会留在原地变成一个不再被更新的幽灵。
 *
 * ## 为什么 skip-if-absent
 *
 * dsh-group-status 是**可选搭档**，不是 npm 依赖：写进依赖会让本插件在对方缺席时永久 pending
 * （issue #34 那次 P0），所以 CI 里根本不存在这份 checkout，`--frozen-lockfile` 也装不出来。
 * 本地开发时两个仓是兄弟目录，这条就真跑。跳过时**打印原因**（与 `dock-tube-seam` 同一处置），
 * 不静默通过——一条永远不会跑的测试必须让人看出来它没跑。
 *
 * 路径可用 `DSH_GROUP_STATUS_HOME` 覆盖（指向那个仓库的根，不是 `lib/`）。
 *
 * **一条诚实的限制**：这里读的是对端的 `lib/client.js`，也就是它的**构建产物**。那份产物比它的
 * 源码旧时，本文件测到的就是旧行为——判不出「对端刚改了但我们还不知道」。所以本地跑之前，兄弟仓
 * 应当是 build 过的；这条比 `group-status-facet.test.mjs` 的假货更接近真话，但**不等于**真话。
 * @module tests/peer-facet-integration
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 找对端的 checkout。
 *
 * 不能写死「`tests/` 的上两级」：主检出里那是 `dsh-plugins/dsh-group-status`，而 **git worktree
 * 的目录更深**（`…/dsh-later/.agents/worktrees/<分支名>/tests`），按层数算会指向一个不存在的兄弟，
 * 于是本地明明有两个仓却天天 skip——一条从不跑的测试比没有测试更糟。所以从本文件逐级向上找，
 * 每级都看一眼 `<父目录>/dsh-group-status`，找到为止；`DSH_GROUP_STATUS_HOME` 优先。
 */
function findPeerClient() {
  if (process.env.DSH_GROUP_STATUS_HOME !== undefined) {
    return path.join(process.env.DSH_GROUP_STATUS_HOME, 'lib', 'client.js');
  }
  // 逐级向上直到文件系统根：worktree 埋得比主检出深两层，层数写死就会漏。
  // 每级只做一次 existsSync，走到根的代价可以忽略。
  let dir = HERE;
  for (;;) {
    const candidate = path.join(dir, 'dsh-group-status', 'lib', 'client.js');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 找不到时报出来的是「按约定该在哪儿」，而不是搜索过程中路过的一串路径。
  return path.resolve(HERE, '..', '..', 'dsh-group-status', 'lib', 'client.js');
}

const PEER_CLIENT = findPeerClient();
const LATER_CLIENT = path.join(HERE, '..', 'lib', 'client.js');
const SKIP = existsSync(PEER_CLIENT)
  ? false
  : `没找到对端构建产物 ${PEER_CLIENT}：dsh-group-status 不是 npm 依赖（可选搭档进依赖 = 对方缺席时本插件永不激活），CI 里没有这份 checkout。本地把它与 dsh-later 并排放，或设 DSH_GROUP_STATUS_HOME。`;

/** 协议 v1 里本插件实际交出的成员清单。多一个（尤其 `settingKey`）就是漂移到旧协议上。 */
const HANDED_OVER_MEMBERS = ['protocol', 'id', 'subscribe', 'getSnapshot', 'fold', 'merge', 'label', 'renderIcon', 'order'];

/**
 * react 的最小桩。`Component` 必须给**真的类**：对端 bundle 里有 `class … extends react.Component`，
 * 拿到 undefined 会在 factory 求值期直接 TypeError（本文件第一次跑就撞在这上面）。
 */
function makeReactStub() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? null, children }),
    Fragment: 'Fragment',
    Component: class Component {},
    PureComponent: class PureComponent {},
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    createContext: () => ({}),
    useContext: () => ({}),
    memo: (component) => component,
    forwardRef: (fn) => fn,
  };
}

/**
 * 装载一个宿主 client bundle（`window.__ModuleLoader__.load(def)` 那份形状）。
 * @param file - bundle 路径。
 * @returns bundle 的模块定义（含 `factory`）。
 */
async function loadDefinition(file) {
  const src = await readFile(file, 'utf8');
  let captured;
  const savedWindow = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: { load: (def) => { captured = def; } },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: (...args) => setInterval(...args),
    clearInterval: (...args) => clearInterval(...args),
    innerHeight: 900,
  };
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', src)(globalThis.window);
    assert.ok(captured, `${file} 没有注册模块（bundle 形状变了）`);
    return captured;
  } finally {
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  }
}

/** 本仓 → 对端：真 cordis 从 node_modules 取（对端 bundle 里有 `class … extends Service`）。 */
const nodeRequire = createRequire(path.join(HERE, '..', 'package.json'));

/** 给某个 bundle 造 require 表；`peerClient` 非空时把 `dsh-group-status/client` 换成真模块。 */
function makeRequire(peerModule) {
  const reactStub = makeReactStub();
  return (id) => {
    if (id === 'react') return reactStub;
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') {
      return { jsx: () => null, jsxs: () => null, Fragment: () => null };
    }
    if (id === 'react-dom' || id === 'react-dom/client') {
      return { createPortal: () => null, createRoot: () => ({ render() {}, unmount() {} }) };
    }
    if (id.startsWith('@deepseek-ai/cordis')) return nodeRequire(id);
    if (id.startsWith('@deepseek-ai/dsh-client-ui-primitives')) {
      return new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? function IconStub() { return null; } : undefined) });
    }
    if (id === 'dsh-group-status/client') {
      if (peerModule === undefined) throw new Error('对端未加载');
      return peerModule;
    }
    // 其余宿主模块：本文件的三条断言都不经过它们，给一个「成员全 undefined」的兜底，
    // 免得将来谁往 apply 里加了新依赖，这里是崩栈而不是可读的失败。
    return new Proxy({}, { get: () => undefined });
  };
}

/** 一条会话摘要事实（与 group-status-facet.test.mjs 同形：一行=一个有任务的会话）。 */
const NOW = Date.now();
const ROW_FUTURE = { projectionValues: { userSchedules: { schedules: [{ scheduled_at: new Date(NOW + 3600_000).toISOString() }] } } };

/** 驱动 `apply` 的 ctx 桩 + 一份可写的设置 scope（两代 harness 的读取面同形状）。 */
function makeHarness(settingValue) {
  const listeners = new Set();
  let value = settingValue === undefined ? {} : { showInGroupBadge: settingValue };
  const scope = {
    getSnapshot: () => ({ status: 'ready', value, base: null, user: null, writable: true }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 等价于「用户在设置页点了保存」。 */
    save(next) {
      value = { ...value, ...next };
      for (const listener of [...listeners]) listener();
    },
  };
  const sessions = {
    list: {
      getSnapshot: () => ({ byId: { a: ROW_FUTURE } }),
      subscribe: () => () => {},
    },
    refresh: async () => {},
    scope: () => undefined,
    sessionOf: () => undefined,
  };
  const slots = {
    register: () => () => {},
    inject: (_hole, fn) => {
      try {
        fn();
      } catch {
        /* 插槽渲染与本文件无关 */
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
      if (name === 'locale') {
        return {
          getSnapshot: () => ({ active: 'zh', revision: 1 }),
          subscribe: () => () => {},
          register: () => () => {},
          bind: () => (key) => key,
        };
      }
      if (name === 'settingsScope') return { bind: () => scope };
      return undefined;
    },
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === 'function') ctx.disposers.push(dispose);
      return () => {};
    },
    on: () => () => {},
    inject: (_names, callback) => callback(ctx),
    slots,
    disposers: [],
  };
  return { ctx, scope };
}

/**
 * 装好「真对端 + 我们的 bundle」这一对，并跑一次 `apply`。
 * @param options.setting - `undefined` = 未设置（走默认）；true / false = 显式值。
 * @returns 对端登记面、我们的模块、harness 与 `list()` 里属于我们的那几份。
 */
async function mount({ setting } = {}) {
  const peerModule = (await loadDefinition(PEER_CLIENT)).factory(makeRequire(undefined));
  assert.equal(
    typeof peerModule.registerGroupStatusFacet,
    'function',
    `对端没有登记面（${PEER_CLIENT}）：那份 checkout 早于 facet 协议（#36），或它的 lib/ 是旧构建——`
    + '去它那儿 `git pull && npm run build` 再跑本文件',
  );
  assert.ok(peerModule.groupStatusFacetRegistry, '对端没有导出 groupStatusFacetRegistry：同样是「产物比源码旧」的样子');

  const registry = peerModule.groupStatusFacetRegistry;
  let bumps = 0;
  const stopBumpCounting = registry.subscribe(() => { bumps += 1; });

  const laterRequire = makeRequire(peerModule);
  const laterModule = (await loadDefinition(LATER_CLIENT)).factory(laterRequire);
  const { ctx, scope } = makeHarness(setting);
  laterModule.apply(ctx);

  const idOf = (entry) => entry.id ?? entry.facet?.id;
  const ours = () => registry.list().filter((entry) => idOf(entry) === 'dsh-later.schedule');
  return {
    peer: peerModule,
    registry,
    ours,
    later: laterModule,
    ctx,
    scope,
    bumps: () => bumps,
    dispose() {
      for (const dispose of ctx.disposers) dispose();
      stopBumpCounting();
    },
  };
}

test('真对端收下我们的 facet，并用它自己的消费口径读出基线事实', { skip: SKIP }, async () => {
  const h = await mount();
  try {
    assert.equal(h.ours().length, 1, '默认（未设置）必须在真登记面上有一份');
    const facet = h.ours()[0].facet ?? h.ours()[0];
    assert.equal(facet.protocol, h.peer.GROUP_STATUS_FACET_PROTOCOL_VERSION, '协议版本必须由真对端认账');

    // 对端读徽标的那条链：getSnapshot → fold → label → renderIcon。
    const fold = facet.fold(facet.getSnapshot(), ['a'], Date.now());
    assert.deepEqual({ count: fold.count, tone: fold.tone, pulse: fold.pulse }, { count: 1, tone: 'info', pulse: false });
    assert.equal(facet.label(fold, { now: Date.now() }), '1 定时任务');
    assert.equal(typeof facet.renderIcon(fold, { now: Date.now() }).type, 'string', 'renderIcon 必须交出元素');
  } finally {
    h.dispose();
  }
});

test('交出的成员清单就是协议那九个：多出来的 settingKey 一律算漂移', { skip: SKIP }, async () => {
  const h = await mount();
  try {
    const facet = h.ours()[0].facet ?? h.ours()[0];
    assert.deepEqual(
      Object.keys(facet).sort(),
      [...HANDED_OVER_MEMBERS].sort(),
      '多一个成员 = 又往旧协议上漂（issue #83 删掉 settingKey 之后，本插件不再给对端任何开关名）',
    );
  } finally {
    h.dispose();
  }
});

test('关掉开关：真对端把它摘掉，并且通知了自己的订阅者（徽标不留残影）', { skip: SKIP }, async () => {
  const h = await mount();
  try {
    const bumpsAfterRegister = h.bumps();
    assert.ok(bumpsAfterRegister >= 1, '登记本身必须惊动订阅者，否则徽标要等下一次重渲染才出现');

    h.scope.save({ showInGroupBadge: false });
    assert.equal(h.ours().length, 0, '关掉后真登记面上不该再有我们那一份');
    assert.ok(h.bumps() > bumpsAfterRegister, '注销必须再 bump 一次：少了这一次，徽标上会挂着一个不再更新的幽灵格');

    h.scope.save({ showInGroupBadge: true });
    assert.equal(h.ours().length, 1, '再打开必须重新登记');

    // 显式 false 起步：一次都不该登记（apply 里那次默认登记会被同一批设置通知立刻注销）。
    const off = await mount({ setting: false });
    try {
      assert.equal(off.ours().length, 0, '设置说关，登记面上就不该有');
    } finally {
      off.dispose();
    }
  } finally {
    h.dispose();
  }
});

test('本插件卸载后不在真对端上留登记', { skip: SKIP }, async () => {
  const h = await mount();
  assert.equal(h.ours().length, 1);
  h.dispose();
  assert.equal(h.ours().length, 0, '卸载要连着把登记注销掉——对端登记面挂在 globalThis 上，比我们的模块活得久');
});
