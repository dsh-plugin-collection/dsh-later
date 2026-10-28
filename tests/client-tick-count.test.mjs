/**
 * 客户端秒级 tick 的计数守护（issue #12 的第一半）。
 *
 * ## 钉住什么
 *
 *  1. **dock 没有提醒可显示时不注册 interval**：`ScheduleDock` 的秒级 tick 现在由
 *     `useNow(门控)` 提供，门控与该组件「整体返回 null」的早退同条件。用户一条提醒都没有
 *     时，过去仍然每秒建一个 interval、每秒重渲染一棵恒为 null 的树。
 *  2. **有提醒时恰好 1 个 interval**（不是 2 个）：`useSchedules` 里那行裸的 `useNow` 曾让
 *     消费方 `SchedButton` 也每秒 tick 一次，与面板自己的 tick 相位不同 → 面板开着时整棵树
 *     每秒被渲染两遍。删掉它之后，面板打开的全树只剩 `SchedPanel` 那一个 tick。
 *  3. **停摆后重新启用要先把 `now` 对齐**：门控引入的唯一新风险是「停摆期间 `now` 不再推进」，
 *     于是「长时间没有提醒 → 刚建了第一条」那一帧会拿着旧时刻算倒计时。用例用**假时钟**把
 *     它量化：不接线就必然显形为 `11:00`，或把一条本该 overdue 的提醒画成「还剩 09:30」。
 *  4. **`useNow` 的停摆信号是 `0` 而不是 `undefined`**：`useRemaining` 靠省略实参拿默认每秒
 *     tick（`now: number | undefined = useNow()`），把 `undefined` 当停摆会连那条路径一起停掉。
 *  5. **门控在两帧之间来回时 hook 序列恒定**：这正是本仓刚在设置卡上修过的违规类别，
 *     顺手把「运行时确实抓得到这种违规」做成反例，免得守护退化成永真断言。
 *
 * ## 为什么这么测（而不是读源码 + 正则）
 *
 * 本仓有一类已知债务是 `readFileSync` + `assert.match(src, /…/)` 的源码文本断言——它守住的
 * 是写法，不是行为。这里走 `tests/hover-card.test.mjs` / `tests/presence-drift.test.mjs`
 * 那条**真调用**路线，但要解决一个仓库里还没人碰过的问题：被测对象是 **React 组件里的
 * effect**，而仓库没有 react/react-dom 测试依赖（`react` 在客户端 bundle 里是 external，
 * 运行时由宿主提供）。
 *
 * 两件配套做法：
 *  - **不读 `lib/client.js`**，改用仓库自带的 esbuild 以 `build-client.mjs` 的同一组选项在
 *    内存里打一份 bundle（`write:false`，不落盘）。理由：读 `lib/` 的测试拿到的是**上次构建
 *    的产物**，一旦有人改了 `src/` 而没人重建 lib，守护会安静地测旧代码——比「测不到」更糟的
 *    假绿。内存构建保证测的永远是当前 src，也不污染 `lib/`（本测全程不写盘）。
 *  - **自带最小 React 运行时**：只实现客户端用到的 hook，但**照搬 React 的 hook 簿记**
 *    （按实例记上一轮占用的槽位数，本轮走完还要再索取就抛 React 那句原话），并让 effect
 *    真正执行、setState 真正触发重渲染。于是 `setInterval` 可以被**数出来**，且注册归属于
 *    哪个组件由运行时在 flush effect 时记录。
 *
 * ## 这个运行时**不**建模什么（别把这里的绿读成以下结论）
 *
 *  - 不建模浏览器渲染：真机上的重绘时机、进度条 CSS 动画相位、折叠/悬停观感仍要 GUI 复核。
 *  - 不建模真实时间流逝：interval 回理由测试显式触发，所以「每 1000ms 推进一次」只断言到
 *    `setInterval(fn, 1000)` 的间隔参数与回调效果，不验证浏览器时钟真的到点。
 *  - 不建模 fiber 协调：函数组件按位置展平，位置变了就重挂载（React 靠 key/type 区分；
 *    本文件的用例不涉列表重排）。假 DOM 也只在 bundle 装载期用一次，组件渲染走的是纯对象。
 * @module tests/client-tick-count
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const canBuild = existsSync(join(repoRoot, 'node_modules/esbuild'));
const skip = canBuild ? false : 'node_modules/esbuild 不在（本测需要在内存里打客户端 bundle）';

// ── 1. 最小 React 运行时 ──────────────────────────────────────────────────────────

/**
 * 创建 hook 运行时。返回的 `react` / `jsxRuntime` 充当 bundle 的 `require('react')`。
 * 定时器注册事件的归属（哪个组件的 effect 注册的）由 `currentOwner()` 暴露给计数器。
 */
function createRuntime() {
  const ELEMENT = Symbol('tickguard.element');
  const Fragment = Symbol('tickguard.fragment');
  /** 当前这棵树的实例池；`render` 之外全部走闭包内的 `rt`。 */
  let rt = null;
  /** 正在渲染的实例（hook 的归属）。 */
  let cur = null;

  /** React 的判据：上一轮的槽位链表已走完，本轮却又索取一个。 */
  function claim(inst) {
    if (inst.rendered && inst.cursor >= inst.hookCount) {
      throw new Error('Rendered more hooks than during the previous render.');
    }
  }
  const depsSame = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

  function useState(initial) {
    const inst = cur;
    claim(inst);
    const i = inst.cursor++;
    if (inst.hooks[i] === undefined) {
      const hook = {
        value: typeof initial === 'function' ? initial() : initial,
        set: null,
      };
      hook.set = (next) => {
        const prev = hook.value;
        const value = typeof next === 'function' ? next(prev) : next;
        // React 的 eager bailout：算出来还是同一个值就不重渲染。少了这条，凡是
        // 「setState(prev => 无需变化时原样返回 prev)」的写法（本仓 dock 里就有）
        // 在这个运行时里会变成无限续渲染。
        if (Object.is(value, prev)) return;
        hook.value = value;
        inst.dirty = true;
      };
      inst.hooks[i] = hook;
    }
    return [inst.hooks[i].value, inst.hooks[i].set];
  }

  function useEffect(fn, deps) {
    const inst = cur;
    claim(inst);
    const i = inst.cursor++;
    const prev = inst.hooks[i];
    // 首挂载、以及 deps 变化，都要重跑；deps 未变则原样留着（含 cleanup 句柄）。
    if (prev === undefined || !depsSame(prev.deps, deps)) {
      const hook = { cleanup: undefined, deps };
      inst.hooks[i] = hook;
      rt.effects.push({
        hook,
        fn,
        prevCleanup: prev !== undefined && typeof prev.cleanup === 'function' ? prev.cleanup : null,
        owner: inst.name,
      });
      return;
    }
    inst.hooks[i] = { cleanup: prev.cleanup, deps };
  }

  function useRef(initial) {
    const inst = cur;
    claim(inst);
    const i = inst.cursor++;
    if (inst.hooks[i] === undefined) inst.hooks[i] = { current: initial };
    return inst.hooks[i];
  }

  function useCallback(fn, deps) {
    const inst = cur;
    claim(inst);
    const i = inst.cursor++;
    const prev = inst.hooks[i];
    if (prev !== undefined && depsSame(prev.deps, deps)) return prev.value;
    inst.hooks[i] = { deps, value: fn };
    return fn;
  }

  function useMemo(factory, deps) {
    const inst = cur;
    claim(inst);
    const i = inst.cursor++;
    const prev = inst.hooks[i];
    if (prev !== undefined && depsSame(prev.deps, deps)) return prev.value;
    const value = factory();
    inst.hooks[i] = { deps, value };
    return value;
  }

  function useId() {
    const inst = cur;
    claim(inst);
    const i = inst.cursor++;
    if (inst.hooks[i] === undefined) inst.hooks[i] = { value: `:tg${rt.idSeq++}` };
    return inst.hooks[i].value;
  }

  function useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  }

  function createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) };
    if (children.length > 0) merged.children = children.length === 1 ? children[0] : children;
    return { $$typeof: ELEMENT, type, props: merged, key: merged.key ?? null };
  }

  function jsx(type, props, key) {
    return { $$typeof: ELEMENT, type, props: props ?? {}, key: key === undefined ? null : key };
  }

  const isElement = (v) => v !== null && typeof v === 'object' && v.$$typeof === ELEMENT;

  function instanceFor(path, fn) {
    let inst = rt.instances.get(path);
    if (inst === undefined) {
      inst = {
        path,
        fn,
        name: fn.name || 'Anonymous',
        props: null,
        hooks: [],
        cursor: 0,
        hookCount: 0,
        rendered: false,
        dirty: false,
        renders: 0,
      };
      rt.instances.set(path, inst);
    }
    return inst;
  }

  function performRender(inst) {
    inst.cursor = 0;
    const saved = cur;
    cur = inst;
    const tree = inst.fn(inst.props);
    cur = saved;
    inst.hookCount = inst.cursor;
    inst.rendered = true;
    inst.renders += 1;
    inst.dirty = false;
    return tree;
  }

  /** 把数组子节点摊平成节点列表，并丢掉「什么都不渲染」的占位。 */
  function asNodes(v) {
    if (Array.isArray(v)) return v.flat(Infinity).filter((n) => n.type !== '#empty');
    return v.type === '#empty' ? [] : [v];
  }

  /** 展开函数组件（就地渲染，像 React 的渲染阶段），收集宿主元素。 */
  function walk(node, path) {
    if (node === null || node === undefined || typeof node === 'boolean') return { type: '#empty' };
    if (typeof node === 'string' || typeof node === 'number') return { type: '#text', text: String(node) };
    if (Array.isArray(node)) return node.map((child, i) => walk(child, `${path}[${i}]`));
    if (!isElement(node)) return { type: '#empty' };
    if (node.type === Fragment) {
      const kids = node.props.children;
      return { type: '#frag', children: kids === undefined ? [] : asNodes(walk(kids, `${path}#f`)) };
    }
    if (typeof node.type === 'function') {
      const saved = cur;
      const inst = instanceFor(`${path}>${node.type.name}`, node.type);
      inst.props = node.props;
      const inner = walk(performRender(inst), `${path}>${node.type.name}`);
      cur = saved;
      return inner;
    }
    return {
      type: node.type,
      props: node.props,
      key: node.key,
      children: node.props.children === undefined ? [] : asNodes(walk(node.props.children, `${path}#c`)),
    };
  }

  function flushEffects() {
    const queue = rt.effects;
    rt.effects = [];
    if (queue.length === 0) return false;
    for (const eff of queue) {
      if (eff.prevCleanup !== null) eff.prevCleanup();
      const saved = rt.owner;
      rt.owner = eff.owner;
      eff.hook.cleanup = eff.fn();
      rt.owner = saved;
    }
    return true;
  }

  /** 渲染一棵树并跑完 effect，直到 effect 引发的 setState 收敛。 */
  function render(Component, props) {
    if (rt === null) newPool();
    if (rt.rootFn !== Component) {
      // 换了根组件 = 换了一棵树，实例池不能沿用（否则 hook 槽位会串到别的组件上）。
      newPool();
      rt.rootFn = Component;
    }
    const root = instanceFor('root', Component);
    root.props = props;
    let tree = null;
    for (let guard = 0; ; guard += 1) {
      tree = walk(performRender(root), 'root');
      // effect 每轮都可能有得跑（本测的假 useProjection 每次返回新对象，deps 必然变化），
      // 但**只有 effect 里真的改了 state 才需要再渲染一次**——React 就是这个判据。
      flushEffects();
      const dirty = [...rt.instances.values()].some((i) => i.dirty);
      if (!dirty) break;
      if (guard > 40) {
        const counts = Object.entries(
          Object.fromEntries([...rt.instances.values()].map((i) => [i.name, i.renders])),
        )
          .sort((a, b) => b[1] - a[1])
          .map(([n, r]) => `${n}=${r}`)
          .join(', ');
        throw new Error(`渲染未收敛（effect 里无条件 setState 之类）。各组件渲染次数：${counts}`);
      }
    }
    return tree;
  }

  function newPool() {
    rt = { instances: new Map(), effects: [], owner: null, idSeq: 0, rootFn: null };
  }

  newPool();

  return {
    react: {
      createElement,
      Fragment,
      useState,
      useEffect,
      useLayoutEffect: useEffect,
      useRef,
      useCallback,
      useMemo,
      useId,
      useSyncExternalStore,
    },
    jsxRuntime: { jsx, jsxs: jsx, Fragment },
    render,
    reset() {
      newPool();
    },
    currentOwner: () => rt.owner,
    /** 每个组件被渲染的次数（「同一棵树每秒被渲染两遍」这类判据用得上）。 */
    renderCounts() {
      const out = {};
      for (const inst of rt.instances.values()) out[inst.name] = (out[inst.name] ?? 0) + inst.renders;
      return out;
    },
  };
}

// ── 2. 树查找、假定时器、假时钟 ───────────────────────────────────────────────────

/** 子树全部文本。 */
function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node === null || typeof node !== 'object') return '';
  if (node.type === '#text') return node.text;
  return (node.children ?? []).map(textOf).join('');
}

/** 深度遍历宿主元素。 */
function* elements(node) {
  if (Array.isArray(node)) {
    for (const c of node) yield* elements(c);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  // 伪节点（#frag / #text / #empty）没有 props，不能当宿主元素发出去。
  if (typeof node.type === 'string' && !node.type.startsWith('#')) yield node;
  for (const c of node.children ?? []) yield* elements(c);
}

/** 按 className 找第一个宿主元素。 */
function findByClass(tree, cls) {
  for (const el of elements(tree)) {
    const cn = typeof el.props.className === 'string' ? el.props.className : '';
    if (cn.split(/\s+/).includes(cls)) return el;
  }
  return undefined;
}

/**
 * 假 interval 计数面：替换 `globalThis.setInterval/clearInterval`，记录注册时刻的**归属组件**、
 * 间隔参数与存活状态。`setTimeout` 保持真实但 unref，避免挂住 `node --test` 进程。
 */
function installTimerProbe(runtime) {
  const real = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout };
  const live = new Map();
  const events = [];
  let nextId = 1;
  globalThis.setInterval = (fn, ms) => {
    const id = nextId;
    nextId += 1;
    const owner = runtime.currentOwner();
    live.set(id, { id, ms, fn, owner });
    events.push({ kind: 'set', id, ms, owner });
    return id;
  };
  globalThis.clearInterval = (id) => {
    const entry = live.get(id);
    live.delete(id);
    if (entry !== undefined) events.push({ kind: 'clear', id, owner: entry.owner });
  };
  globalThis.setTimeout = (fn, ms, ...args) => {
    const handle = real.setTimeout(fn, ms, ...args);
    handle?.unref?.();
    return handle;
  };
  return {
    live,
    events,
    ownedBy: (name) => [...live.values()].filter((t) => t.owner === name),
    /** 显式触发某个 interval 的回调（等效浏览器到点）。 */
    fire: (id) => live.get(id)?.fn(),
    /** 归属为空的存活项（用于「一个都不该有」的报错文案）。 */
    dump: () => [...live.values()].map((t) => ({ owner: t.owner, ms: t.ms })),
    restore() {
      globalThis.setInterval = real.setInterval;
      globalThis.clearInterval = real.clearInterval;
      globalThis.setTimeout = real.setTimeout;
    },
  };
}

/** 假时钟：让「停摆期间时间流逝」这件事可以被量化。 */
function installFakeClock(startMs) {
  const real = Date.now;
  let t = startMs;
  Date.now = () => t;
  return {
    get now() {
      return t;
    },
    advance(ms) {
      t += ms;
    },
    restore() {
      Date.now = real;
    },
  };
}

// ── 3. 在内存里打 bundle 并装载 ───────────────────────────────────────────────────

/**
 * 与 `build.mjs` 第 2 步同一组选项。
 *
 * external 用**插件按形状匹配**而不是照抄那份字符串数组：`build.mjs` 的理由写在它自己的
 * 注释里（react* 由宿主提供；`@deepseek-ai/dsh-client-ui-primitives` 是宿主 seed 模块表
 * 基线，内联会复制一份官方组件实例 → 模块身份/主题漂移）。照抄数组的风险是漂移后本测
 * 会**静默把宿主包内联进来**，测的就不是线上那份形态了；用插件匹配 + 装载侧对未预期的
 * require 一律抛错，漂移就当场判红。
 */
const HOST_SEED_PATTERN = /^(react|react-dom)(\/.*)?$|^@deepseek-ai\/dsh-client-ui-primitives$/;

const hostExternals = {
  name: 'host-seed-externals',
  setup(api) {
    api.onResolve({ filter: /^(@deepseek-ai\/|react)/ }, (args) =>
      HOST_SEED_PATTERN.test(args.path) ? { path: args.path, external: true } : undefined,
    );
  },
};

async function buildClientBundle() {
  const result = await build({
    entryPoints: ['src/client/index.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    jsx: 'automatic',
    plugins: [hostExternals],
    absWorkingDir: repoRoot,
  });
  return result.outputFiles[0].text;
}

/**
 * 装载 bundle：宿主浏览器模块加载器的最小 shim + 各 external 的桩。
 * `primitives` 走 Proxy，未预期的导出**照旧响亮失败**（与运行时一致），只给出本用例需要的
 * `Tooltip` 与两个定位 hook。返回的 `restore()` 用来收掉全局环境面。
 */
async function loadClient(runtime) {
  const body = await buildClientBundle();
  const src = `window.__ModuleLoader__.load({ id: "dsh-later", factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
${body}
    return module.exports; } });`;
  const fakeElement = () => ({
    style: {},
    dataset: {},
    textContent: '',
    setAttribute() {},
    appendChild() {},
    append() {},
    remove() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add() {}, contains: () => false },
  });
  // 只覆盖 src/client 实际碰到的 DOM 面（document.baseURI / body / head / createElement /
  // querySelector(All)）；组件渲染走的是运行时的纯对象树，不经过这里。
  const doc = {
    documentElement: fakeElement(),
    head: fakeElement(),
    body: fakeElement(),
    createElement: fakeElement,
    baseURI: 'http://127.0.0.1:3080/',
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    matchMedia: globalThis.matchMedia,
  };
  const win = {
    __ModuleLoader__: { load: (def) => (win.__captured = def) },
    addEventListener() {},
    removeEventListener() {},
    innerHeight: 800,
    innerWidth: 1280,
    setTimeout: (fn, ms, ...args) => setTimeout(fn, ms, ...args),
    clearTimeout: (handle) => clearTimeout(handle),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    document: doc,
    localStorage,
  };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = localStorage;
  globalThis.matchMedia = win.matchMedia;
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', src)(win);
  } catch (error) {
    restore();
    throw error;
  }
  function restore() {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
  if (win.__captured === undefined) throw new Error('bundle 没有注册模块');
  const require = (id) => {
    if (id === 'react') return runtime.react;
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return runtime.jsxRuntime;
    if (id === 'react-dom' || id === 'react-dom/client') {
      return { createPortal: (node) => node, createRoot: () => ({ render() {}, unmount() {} }) };
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      const tooltip = (props) => runtime.jsxRuntime.jsx('span', { 'data-tg-tooltip': true, children: props.children });
      const hooks = {
        useAnchoredPosition: () => ({ left: '0px', top: '0px' }),
        useDismissOnOutsidePointer: () => {},
      };
      return new Proxy(
        {},
        {
          get: (_t, name) => {
            if (typeof name === 'string' && name.startsWith('Icon')) return () => null;
            if (name === 'Tooltip') return tooltip;
            if (typeof name === 'string' && name in hooks) return hooks[name];
            throw new Error(`unexpected primitives export: ${String(name)}`);
          },
        },
      );
    }
    throw new Error(`unexpected host require: ${id}`);
  };
  return { mod: win.__captured.factory(require), restore };
}

/** 驱动 `apply`，从插槽注册里抓到 dock 与输入框按钮两个组件。 */
function applyAndCapture(mod) {
  const scopeSnap = { status: 'ready', value: {}, base: {}, user: undefined, writable: true };
  const scope = {
    getSnapshot: () => scopeSnap,
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  };
  const registered = [];
  const ctx = {
    get: (name) => {
      if (name === 'slots') {
        return {
          register: (decl, component) => {
            registered.push({ decl, component });
            return () => {};
          },
          inject: (_hole, fn) => {
            try {
              fn();
            } catch {
              /* 本测只驱动 dock 与输入框按钮，其它插槽的副作用不是被测面 */
            }
          },
          subscribe: () => () => {},
          entries: () => [],
          entriesOfSlot: () => [],
        };
      }
      if (name === 'sessions') {
        return { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} }, refresh: async () => {} };
      }
      if (name === 'locale') {
        return {
          getSnapshot: () => ({ active: 'zh' }),
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
      return typeof dispose === 'function' ? dispose : () => {};
    },
    on: () => () => {},
    inject: (_names, callback) => callback(ctx),
  };
  ctx.slots = ctx.get('slots');
  mod.apply(ctx);
  const pick = (needle) => registered.find((r) => String(r.decl.name).includes(needle));
  return { dock: pick('dock'), button: pick('input.right'), names: registered.map((r) => r.decl.name) };
}

/** 投影容器：改内容后重渲染，组件即看到新的 schedules。 */
function createProjection(initial) {
  const holder = { value: initial };
  return {
    holder,
    useProjection: () => ({ schedules: holder.value }),
    set(next) {
      holder.value = next;
    },
  };
}

const scheduleAt = (epoch) => ({
  id: `s-${epoch}`,
  prompt: '喝水',
  kind: 'after',
  status: 'active',
  scheduled_at: new Date(epoch).toISOString(),
});

/** dock 的渲染入参：插槽声明的 inject + 宿主标准件里本测要用到的几项。 */
function dockProps(captured, proj) {
  return { ...captured.dock.decl.inject(), useProjection: proj.useProjection, sessionId: 'sess-1', t: (k) => k };
}

// ── 4. 用例 ───────────────────────────────────────────────────────────────────────

test('dock：没有提醒时 0 个 interval；有 1 条时恰好 1 个且间隔 1000', { skip }, async () => {
  const runtime = createRuntime();
  const timers = installTimerProbe(runtime);
  const clock = installFakeClock(1_700_000_000_000);
  let env = null;
  try {
    env = await loadClient(runtime);
    const captured = applyAndCapture(env.mod);
    assert.ok(captured.dock, `apply 后应能抓到 dock 插槽，实际注册：${captured.names.join(', ')}`);
    const proj = createProjection([]);
    const props = dockProps(captured, proj);

    // ① 没有提醒 → 渲染空，且一个 interval 都不该有。
    const treeEmpty = runtime.render(captured.dock.component, props);
    assert.equal(textOf(treeEmpty), '', '无提醒时 dock 必须什么都不渲染');
    assert.equal(timers.ownedBy('ScheduleDock').length, 0, `无提醒时不该注册 interval，实际存活：${JSON.stringify(timers.dump())}`);

    // ② 建一条提醒 → 同一个实例上重新启用 tick，恰好 1 个。
    proj.set([scheduleAt(clock.now + 60_000)]);
    runtime.render(captured.dock.component, props);
    const mine = timers.ownedBy('ScheduleDock');
    assert.equal(mine.length, 1, `有提醒时应恰好 1 个 tick interval，实际：${JSON.stringify(timers.dump())}`);
    assert.equal(mine[0].ms, 1000, 'tick 间隔仍是 1000ms');

    // ③ 删回空 → interval 必须被注销，不留悬空定时器。
    proj.set([]);
    runtime.render(captured.dock.component, props);
    assert.equal(timers.ownedBy('ScheduleDock').length, 0, '回到无提醒后 tick interval 必须被 clear');
    assert.deepEqual(
      timers.events.filter((e) => e.owner === 'ScheduleDock').map((e) => e.kind),
      ['set', 'clear'],
      '注册与注销必须一一对应（多一次 set 或漏一次 clear 都在这里显形）',
    );
  } finally {
    timers.restore();
    clock.restore();
    env?.restore();
  }
});

test('dock：停摆后重新启用，倒计时按当下时刻算（不吃陈旧 now）', { skip }, async () => {
  const runtime = createRuntime();
  const timers = installTimerProbe(runtime);
  const clock = installFakeClock(1_700_000_000_000);
  let env = null;
  try {
    env = await loadClient(runtime);
    const captured = applyAndCapture(env.mod);
    const proj = createProjection([]);
    const props = dockProps(captured, proj);

    // 挂载时没有提醒 → tick 停摆；假时钟推进 10 分钟（真世界里就是「闲置十分钟」）。
    runtime.render(captured.dock.component, props);
    clock.advance(600_000);
    assert.equal(timers.ownedBy('ScheduleDock').length, 0, '前置条件：停摆中');

    // 这十分钟里没有任何东西刷新过 now。现在建一条 60 秒后到点的提醒：
    proj.set([scheduleAt(clock.now + 60_000)]);
    let tree = runtime.render(captured.dock.component, props);
    const cd = findByClass(tree, 'ss-dock-row-countdown');
    assert.ok(cd, '单条提醒会强制展开，倒计时节点应在树上');
    // 只取时间串本身：前缀「剩」来自本地字典，改文案不该把这条守护打红。
    const shown = textOf(cd).match(/\d{1,2}:\d{2}(?::\d{2})?\s*$/)?.[0].trim();
    assert.equal(
      shown,
      '01:00',
      `启用后倒计时应是 01:00（拿停摆前的旧 now 算会得 11:00），实际：${JSON.stringify(textOf(cd))}`,
    );

    // 到点：显式触发 interval 回调（等效浏览器 1s 后回调）→ now 推进，界面无需求。
    const mine = timers.ownedBy('ScheduleDock')[0];
    proj.set([scheduleAt(clock.now - 30_000)]);
    timers.fire(mine.id);
    runtime.render(captured.dock.component, props);
    // overdue 判据用类名（`ss-due` 只在 state === 'overdue' 时挂上），不用文案：
    // 这条 `t` 走的是 strings.ts 的本地字典，改一个字就红的断言守不住行为。
    const due = findByClass(runtime.render(captured.dock.component, props), 'ss-dock-row-countdown');
    assert.ok(due, '倒计时节点应在树上');
    assert.match(
      String(due.props.className),
      /ss-due/,
      `已过点的提醒必须画成 overdue（拿旧 now 算就会停在 scheduled + 09:30），实际 class：${due.props.className}`,
    );
    assert.doesNotMatch(textOf(due), /09:30/, '不得用旧 now 把已 overdue 的提醒画成「还剩 09:30」');
  } finally {
    timers.restore();
    clock.restore();
    env?.restore();
  }
});

test('dock：null 分支与渲染分支来回切换，hook 序列恒定', { skip }, async () => {
  const runtime = createRuntime();
  const timers = installTimerProbe(runtime);
  const clock = installFakeClock(1_700_000_000_000);
  let env = null;
  try {
    env = await loadClient(runtime);
    const captured = applyAndCapture(env.mod);
    const proj = createProjection([]);
    const props = dockProps(captured, proj);
    const flip = (list) => {
      proj.set(list);
      // 运行时的 claim() 会在「本轮比上一轮多索取槽位」时抛 React 那句原话。
      runtime.render(captured.dock.component, props);
    };
    // 门控在两帧之间切 0 ↔ 1000，useNow 的内部 hook 数不能跟着变。
    flip([scheduleAt(clock.now + 60_000)]);
    flip([]);
    flip([scheduleAt(clock.now + 120_000)]);
    flip([]);

    // 反向自证：违规形态必须真的能被同一条运行时抓红，否则上面那句是永真断言。
    const r2 = createRuntime();
    const { useState } = r2.react;
    const offender = function Offender({ flag }) {
      useState(0);
      if (flag) useState(1); // 分支里多一个槽位 —— React 会抛
      return null;
    };
    r2.render(offender, { flag: false });
    let message = '(未抛错)';
    try {
      r2.render(offender, { flag: true });
    } catch (error) {
      message = String(error?.message);
    }
    assert.match(message, /Rendered more hooks than during the previous render/, '运行时必须真能抓「分支改变 hook 序列」');
  } finally {
    timers.restore();
    clock.restore();
    env?.restore();
  }
});

test('dock：有提醒时倒计时逐秒推进，且 tick 不重复注册', { skip }, async () => {
  const runtime = createRuntime();
  const timers = installTimerProbe(runtime);
  const clock = installFakeClock(1_700_000_000_000);
  let env = null;
  try {
    env = await loadClient(runtime);
    const captured = applyAndCapture(env.mod);
    const proj = createProjection([scheduleAt(clock.now + 600_000)]);
    const props = dockProps(captured, proj);
    let tree = runtime.render(captured.dock.component, props);
    const mine = timers.ownedBy('ScheduleDock');
    assert.equal(mine.length, 1, '前置：恰好 1 个 tick interval');
    const shown = () => {
      const node = findByClass(tree, 'ss-dock-row-countdown');
      return textOf(node).match(/\d{1,2}:\d{2}(?::\d{2})?\s*$/)?.[0].trim();
    };
    assert.equal(shown(), '10:00', `首帧倒计时 ${JSON.stringify(textOf(findByClass(tree, 'ss-dock-row-countdown')))}`);

    // 显式触发两次 interval 回调（等效浏览器两次到点），每次倒计时少一秒。
    const steps = ['09:59', '09:58'];
    for (const expect of steps) {
      clock.advance(1000);
      timers.fire(mine[0].id);
      tree = runtime.render(captured.dock.component, props);
      assert.equal(shown(), expect, `到点一次应让倒计时前进一秒（实际：${JSON.stringify(textOf(findByClass(tree, 'ss-dock-row-countdown')))})`);
    }
    // 门控在持续启用期间不该反复重建定时器（那会让每秒回调变成每秒若干次）。
    assert.equal(
      timers.events.filter((e) => e.owner === 'ScheduleDock' && e.kind === 'set').length,
      1,
      `启用期间 tick 只应注册一次，实际事件序列：${JSON.stringify(timers.events.filter((e) => e.owner === 'ScheduleDock').map((e) => e.kind))}`,
    );
    assert.equal(timers.ownedBy('ScheduleDock').length, 1, '仍是同一个存活的 tick');
  } finally {
    timers.restore();
    clock.restore();
    env?.restore();
  }
});

test('输入框按钮：面板关闭 0 个 tick，面板打开后全树恰好 1 个（归属 SchedPanel）', { skip }, async () => {
  const runtime = createRuntime();
  const timers = installTimerProbe(runtime);
  const clock = installFakeClock(1_700_000_000_000);
  let env = null;
  try {
    env = await loadClient(runtime);
    const captured = applyAndCapture(env.mod);
    assert.ok(captured.button, `apply 后应能抓到输入框按钮插槽，实际注册：${captured.names.join(', ')}`);
    const proj = createProjection([scheduleAt(clock.now + 60_000)]);
    const props = {
      ...captured.button.decl.inject(),
      useProjection: proj.useProjection,
      input: { draft: '写周报' },
      sessionId: 'sess-1',
    };
    const tree = runtime.render(captured.button.component, props);
    // 只看**秒级 tick**的归属：过程里还有摘要 store 的 30s/60s 定时器，那是另一回事。
    assert.equal(
      timers.ownedBy('SchedButton').length,
      0,
      `面板关闭时按钮这一支不该有秒级 tick（useSchedules 里那行重复 tick 没删的话，这里会出现 1 个归属 SchedButton 的 interval），实际：${JSON.stringify(timers.dump())}`,
    );
    assert.equal(timers.dump().filter((t) => t.ms === 1000).length, 0, '关闭态全树都不该有 1000ms 的 tick');

    // 打开面板：全树只能有 1 个 interval，且归属面板自己的 tick。
    const trigger = findByClass(tree, 'ss-sched-btn');
    assert.ok(trigger, '应渲染出定时按钮');
    trigger.props.onClick();
    runtime.render(captured.button.component, props);
    const ticks = timers.dump().filter((t) => t.ms === 1000);
    assert.equal(ticks.length, 1, `面板打开后全树应恰好 1 个秒级 tick（重复 tick 未删时是 2 个：SchedButton + SchedPanel，相位还不同），实际：${JSON.stringify(ticks)}`);
    assert.equal(ticks[0].owner, 'SchedPanel', '那个 tick 必须属于面板自己的 useNow，而不是按钮那一支');
    assert.equal(timers.ownedBy('SchedButton').length, 0, '按钮那一支仍不得有 tick');
  } finally {
    timers.restore();
    clock.restore();
    env?.restore();
  }
});

test('useNow：停摆信号是 0；省略实参仍每秒 tick（useRemaining 的默认参数路径不受影响）', { skip }, async () => {
  // 这条直接测 useCountdown 本体：单独打一份 ESM，避免只靠组件间接验证。
  const result = await build({
    entryPoints: ['src/client/useCountdown.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    loader: { '.ts': 'ts' },
    external: ['react', 'react/jsx-runtime'],
    absWorkingDir: repoRoot,
  });
  const code = result.outputFiles[0].text;
  const runtime = createRuntime();
  const timers = installTimerProbe(runtime);
  const clock = installFakeClock(1_700_000_000_000);
  const savedReact = globalThis.__TICKGUARD_REACT__;
  try {
    // 把 external 的 `react` 说明符改写成 data: URL 桩，桩体从 globalThis 取本运行的 hook。
    const shim = Buffer.from(
      `const r = globalThis.__TICKGUARD_REACT__;
       export const useState=r.useState, useEffect=r.useEffect, useRef=r.useRef, useCallback=r.useCallback,
       useMemo=r.useMemo, useId=r.useId, useLayoutEffect=r.useLayoutEffect,
       useSyncExternalStore=r.useSyncExternalStore, createElement=r.createElement, Fragment=r.Fragment;`,
    ).toString('base64');
    const patched = code.replace(/from\s*["']react["']/g, `from "data:text/javascript;base64,${shim}"`);
    assert.notEqual(patched, code, 'useCountdown 应含对 react 的 import（改写没命中说明桩失效）');
    globalThis.__TICKGUARD_REACT__ = runtime.react;
    const mod = await import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
    const { useNow } = mod;

    /** 挂一个只调 useNow 的消费者，返回它注册的 interval 列表。 */
    const probe = (intervalArg) => {
      timers.live.clear();
      runtime.reset();
      runtime.render(function TickConsumer() {
        useNow(intervalArg);
        return null;
      }, {});
      return timers.dump();
    };

    assert.deepEqual(probe(undefined).map((t) => t.ms), [1000], '省略实参：默认仍每秒 tick（useRemaining 靠的就是这条）');
    assert.deepEqual(probe(1000).map((t) => t.ms), [1000], '显式 1000：每秒 tick');
    assert.deepEqual(probe(0), [], '0：完全停摆，不注册 interval');
    assert.deepEqual(probe(-1), [], '负数同样停摆（不得退成 setInterval(fn, -1) 这种误用）');

    // 停摆 → 启用 的切换必须重新注册（门控打开后倒计时要立刻可用）。
    // 注意根组件必须用**同一个函数身份**：换函数就等于换一棵树，实例池会重建，
    // 「同一个组件从停摆切回启用」这一条就没在测了。
    timers.live.clear();
    runtime.reset();
    const holder = { ms: 0 };
    const Switcher = function Switcher() {
      useNow(holder.ms);
      return null;
    };
    runtime.render(Switcher, {});
    assert.equal(timers.live.size, 0, '起始停摆');
    const before = clock.now;
    clock.advance(600_000);
    holder.ms = 1000;
    runtime.render(Switcher, {});
    assert.equal(timers.live.size, 1, '切回启用后重新注册 1 个 interval');
    assert.notEqual(before, clock.now, '前置：假时钟确实推进过（否则这条切换断言是空跑）');
  } finally {
    if (savedReact === undefined) delete globalThis.__TICKGUARD_REACT__;
    else globalThis.__TICKGUARD_REACT__ = savedReact;
    timers.restore();
    clock.restore();
  }
});
