/**
 * 设置卡 / 设置 hook 的**真实执行**夹具（issue #19）。
 *
 * ## 为什么要有这个文件
 *
 * 本仓已有的设置面测试几乎全是 `readFileSync + 正则`：它们能钉住「某行代码还在」，
 * 钉不住「渲染出来到底有哪些可写字段」——`SchedulerSettingsSchema` 少声明五个 HH:mm
 * 字段这件事，正则测试全绿了三周（issue #19）。这一份走另一条路：**真的把组件渲染出来**、
 * **真的把 hook 跑一遍**，断言拿到的都是执行结果。
 *
 * ## 三条不变量
 *  1. 被测代码是 `src/` 里的**真**组件/真 hook，由 esbuild 现场编译（与 `build.mjs`
 *     同一份 esbuild、同一组 external），不复制、不改写、不 mock 组件本身。
 *  2. 只 mock **宿主环境**：react（mini hooks 运行时，见下）、primitives 图标、DOM。
 *  3. 不依赖 `lib/client.js` 是否新鲜：产物由 src 现算，所以「改了 src 没重建 lib」
 *     不会让这里的断言假绿（`lib/` 新鲜度另由 build 门禁管）。
 *
 * ## mini React 的取舍
 *
 * 只需要跑到「一次交互能改变渲染结果」这个程度：
 *  - `useState` 的 setter **同步**触发本实例重渲染（真实 React 在事件后批处理，但对
 *    「点一下 → 保存按钮从 disabled 变 enabled」这类判据，同步与批处理等价）；
 *  - `Object.is` 相同值不重渲染（与 React 的 bailout 同语义，否则 `setFailed(false)`
 *    这种幂等写入会把自己写进死循环）；
 *  - hook 按调用序存槽位，槽位数与上一次不一致就**立刻报错**——这正是
 *    SchedulerSettingsCard 拆分注释里那条「hooks 必须同序同数」的纪律，在这里免费得到守护。
 */
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const REQUIRE = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 与 build.mjs 的 client 步骤保持一致的 external 集合。 */
const EXTERNAL = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'];

/**
 * 现场编译 `src/<relPath>` 为一个可 require 的模块。
 * @param {string} relPath - 相对 `src/` 的路径，例如 `client/components/SchedulerSettingsCard.tsx`。
 * @param {(id: string) => unknown} hostRequire - 宿主模块桩的解析函数（见 {@link makeHostRequire}）。
 * @returns {Promise<Record<string, unknown>>} 模块 exports。
 */
export async function compileClientModule(relPath, hostRequire) {
  const result = await build({
    entryPoints: [`${ROOT}src/${relPath}`],
    absWorkingDir: ROOT,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    jsx: 'automatic',
    external: EXTERNAL,
  });
  const code = result.outputFiles[0].text;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  const run = new Function('require', 'module', 'exports', `${code}\n//# sourceURL=dsh-later-test/${relPath}`);
  run(hostRequire, module, module.exports);
  return module.exports;
}

/** 渲染出的一段元素：{ type, props, children } 或文本/数字。 */

/**
 * 造一个「宿主模块」解析器：react 用下面的 mini 运行时，其余给最小桩。
 * @param {object} [options]
 * @param {(node: object) => void} [options.onRender] 每次组件函数被真正调用时回调（可选）。
 */
export function makeHostRequire(options = {}) {
  const react = makeMiniReact(options);
  const iconCache = new Map();
  const primitives = new Proxy(
    {},
    {
      ownKeys: () => ['useAnchoredPosition', 'useDismissOnOutsidePointer'],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      get: (_t, name) => {
        if (typeof name !== 'string') return undefined;
        if (name === 'useAnchoredPosition' || name === 'useDismissOnOutsidePointer') return () => undefined;
        if (name.startsWith('Icon')) {
          if (!iconCache.has(name)) iconCache.set(name, function IconStub() { return null; });
          return iconCache.get(name);
        }
        throw new Error(`unexpected primitives export: ${name}`);
      },
    },
  );
  const require = (id) => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return react.__jsxRuntime;
    if (id === 'react-dom' || id === 'react-dom/client') return { createPortal: (n) => n, createRoot: () => ({ render() {}, unmount() {} }) };
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error(`unexpected host require: ${id}`);
  };
  require.__react = react;
  return require;
}

/**
 * mini React：hooks 运行时 + 元素树 + 递归渲染函数组件。
 *
 * 元素工厂（createElement / jsx）只**记录**，不执行；组件函数由 {@link renderTree} 驱动，
 * 于是 `SchedulerSettingsCard`（外壳）→ `SchedulerSettingsForm`（主体）这条真实的
 * 组件层级会被真正跑到底，界面上有哪些可写控件才是执行结果而不是源码猜测。
 */
function makeMiniReact({ onRender }) {
  /** @type {{ hooks: unknown[], index: number, props: Record<string, unknown>, node: object|null, dirty: boolean, running: boolean }[]} */
  const instances = [];
  let current = null;

  const same = (a, b) => Object.is(a, b);

  /** 把「children 里嵌 children」展平：`{list.map(...)}` 交出的是数组套数组。 */
  const flatChildren = (value) => {
    if (value === undefined || value === null) return [];
    return (Array.isArray(value) ? value : [value]).flat(Infinity);
  };

  function element(type, props, children) {
    // esbuild 的 automatic runtime 把 children 放进 `props.children`（单个值或数组，
    // `{list.map()}` 还是数组套数组），`createElement` 则放在后续实参里。两种都要
    // **展平**成同一形状，否则 `{SECTIONS.map(...)}` 整段会在树里变成一个数组节点，
    // 遍历看不见它的孩子——表现为「保存按钮找得到、字段一个都没有」的假渲染。
    const propsRest = { ...(props ?? {}) };
    delete propsRest.children;
    return { type, props: propsRest, children: flatChildren(children) };
  }

  function createElement(type, props, ...children) {
    return element(type, props, children);
  }

  const jsx = (type, props) => element(type, props, props?.children);
  const jsxs = jsx;

  function useState(initial) {
    const inst = current;
    const index = inst.index++;
    if (inst.hooks.length <= index) {
      inst.hooks.push({ value: typeof initial === 'function' ? initial() : initial });
    }
    const slot = inst.hooks[index];
    const set = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next;
      // 与 React 同语义：同值不改变状态（`setFailed(false)` 这种幂等写入不该让 UI 抖动）。
      if (same(value, slot.value)) return;
      slot.value = value;
    };
    return [slot.value, set];
  }

  /** 依赖数组浅比较（与 React 的 `Object.is` 逐项比较同语义）。 */
  function depsChanged(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next)) return true;
    if (prev.length !== next.length) return true;
    return prev.some((value, i) => !same(value, next[i]));
  }

  function useMemo(factory, deps) {
    const inst = current;
    const index = inst.index++;
    if (inst.hooks.length <= index) inst.hooks.push({ deps: undefined, value: undefined });
    const slot = inst.hooks[index];
    if (slot.deps === undefined || depsChanged(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value;
  }

  const useCallback = (fn, deps) => useMemo(() => fn, deps);

  /** effect 在渲染完成后立刻跑一次（依赖变化时再跑），cleanup 丢弃：本夹具不验卸载。 */
  function useEffect(fn, deps) {
    const inst = current;
    const index = inst.index++;
    if (inst.hooks.length <= index) inst.hooks.push({ deps: undefined, cleanup: undefined, first: true });
    const slot = inst.hooks[index];
    if (slot.first || depsChanged(slot.deps, deps)) {
      slot.first = false;
      slot.deps = deps;
      inst.pendingEffects.push(() => {
        const cleanup = fn();
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      });
    }
  }

  const useLayoutEffect = useEffect;
  const useRef = (initial) => useMemo(() => ({ current: initial }), []);
  const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();
  const useId = () => '«id»';

  function invoke(inst) {
    const previous = current;
    current = inst;
    inst.index = 0;
    inst.pendingEffects = [];
    inst.running = true;
    let rendered;
    try {
      rendered = inst.component(inst.props);
      // effect 在 running 仍为 true 时跑：真实 React 里 effect 里的 setState 是「下一次
      // 渲染」的事，不是当场重入。这里同语义——值写进槽位，由调用方的 refresh()/下一轮
      // 展开读到；否则「effect → setState → 同步重渲染 → effect」会自己转起来。
      for (const effect of inst.pendingEffects.splice(0)) effect();
    } finally {
      inst.running = false;
      current = previous;
    }
    return rendered;
  }

  /**
   * 递归渲染：函数组件的真实树在这里被展开。
   * @param {object} node - 元素。
   * @param {WeakMap} cache - 组件类型 → 实例（同一位置同一实例，跨渲染复用 hooks 槽位）。
   */
  function expand(node, cache, keyPath) {
    if (node === null || node === undefined || typeof node !== 'object' || !('type' in node)) return node;
    const { type, props, children } = node;
    if (typeof type === 'function') {
      const slotKey = `${keyPath}|${type.name}`;
      let inst = cache.get(slotKey);
      if (inst === undefined || inst.component !== type) {
        inst = { component: type, props, hooks: [], index: 0, node: null, dirty: false, running: false, pendingEffects: [], slotKey };
        cache.set(slotKey, inst);
        instances.push(inst);
      } else {
        inst.props = props;
      }
      if (onRender) onRender(type);
      const rendered = invoke(inst);
      inst.node = expand(rendered, cache, slotKey);
      return inst.node;
    }
    return {
      type,
      props,
      children: flatChildren(children)
        .map((child, i) => expand(child, cache, `${keyPath}/${String(type)}/${i}`))
        .filter((child) => child !== null && child !== undefined && child !== false && child !== true),
    };
  }

  /**
   * 渲染一棵树。
   *
   * `tree` 每次读取都从根重新展开一遍（不缓存）：组件的 hook 槽位存在按位置复用的实例里，
   * 所以「点了输入框 → `pending` 写进槽位 → 再读 tree」拿到的就是更新后的 UI，
   * 不需要自己实现 React 的调度。代价是每次展开都跑一遍组件函数，对断言无害，
   * 换来的是**不存在**「读到了上一轮的树」这种假绿。
   * @param {object} rootElement - `createElement(Comp, props)` 的产物。
   */
  function mount(rootElement) {
    const cache = new Map();
    return {
      get tree() {
        return expand(rootElement, cache, 'root');
      },
      instances,
    };
  }

  const mini = {
    createElement,
    cloneElement: (node, props, ...children) => createElement(node.type, { ...node.props, ...props }, ...children),
    Fragment: 'Fragment',
    useState,
    useEffect,
    useLayoutEffect,
    useMemo,
    useCallback,
    useRef,
    useSyncExternalStore,
    useId,
    __jsxRuntime: { jsx, jsxs, Fragment: 'Fragment' },
    __mount: mount,
  };
  return mini;
}

/**
 * 把一棵渲染树里**可写字段控件**的 key 取出来。
 *
 * 判据是执行结果，不是源码：
 *  - 控件元素 = `input` / `select` / `button[role=switch]`（卡片里布尔项就是 switch 按钮）；
 *  - 且 `id` 形如 `ss-<字段 key>`，字段 key 全为驼峰不含连字符；卡片里非字段元素的 id
 *    （`ss-show-settings` / `ss-help-*` / `ss-gate-*` / `ss-window-order`）都带连字符，
 *    因而天然被排除——这条约定由卡片里的注释钉住。
 * @param {object} tree - {@link mount} 之后的树。
 * @returns {string[]} 字段 key（按渲染顺序，去重）。
 */
export function writableFieldKeys(tree) {
  const FIELD_ID = /^ss-([A-Za-z][A-Za-z0-9]*)$/;
  const keys = [];
  const walk = (node) => {
    if (node === null || typeof node !== 'object' || !('type' in node)) return;
    const { type, props, children } = node;
    if (type === 'input' || type === 'select' || (type === 'button' && props?.role === 'switch')) {
      const match = FIELD_ID.exec(String(props?.id ?? ''));
      if (match !== null && !keys.includes(match[1])) keys.push(match[1]);
    }
    for (const child of children ?? []) walk(child);
  };
  walk(tree);
  return keys;
}

/**
 * 在树里找满足条件的元素。
 * @param {object} tree
 * @param {(node: object) => boolean} predicate
 */
export function findNode(tree, predicate) {
  let found = null;
  const walk = (node) => {
    if (found !== null) return;
    if (node === null || typeof node !== 'object' || !('type' in node)) return;
    if (predicate(node)) {
      found = node;
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return found;
}

/** 找某个字段的输入控件（按卡片 id 约定）。 */
export function fieldControl(tree, key) {
  return findNode(tree, (node) => String(node.props?.id ?? '') === `ss-${key}` && (node.type === 'input' || node.type === 'select' || node.props?.role === 'switch'));
}

/**
 * 跑一遍客户端 `apply()`，把它注册进宿主 locale 服务的**那份真字典**捞出来。
 *
 * 为什么要捞字典而不是 grep 源码：设置卡的词条注册在 `src/client/index.tsx` 的
 * `locale.register(NS, {zh, en})` 里，且必须**单次合并注册**（同 NS 二次 register 宿主直接抛，
 * 见该处注释）。要判断「卡片要的这些 key 到底有没有双语」，只有让那段注册真的跑一遍才算数——
 * 正则数 `key:` 出现两次，既数不清嵌套对象，也挡不住有人把两条写进同一个语言块。
 *
 * @returns {Promise<{ dicts: {zh: Record<string,string>, en: Record<string,string>}, ns: string, dispose: () => void }>}
 */
export async function captureClientDicts() {
  let registered;
  const hostRequire = makeHostRequire();
  const mod = await compileClientModule('client/index.tsx', (id) => {
    // 可选对端：本夹具不测 facet，给一份最小登记面让 apply 走完整路径。
    if (id === 'dsh-group-status/client') {
      return { GROUP_STATUS_FACET_PROTOCOL_VERSION: 1, registerGroupStatusFacet: () => () => undefined };
    }
    return hostRequire(id);
  });

  const slots = {
    register: () => () => undefined,
    inject: (_hole, fn) => {
      try {
        fn();
      } catch {
        /* 插槽渲染不参与本夹具 */
      }
    },
    subscribe: () => () => undefined,
    entries: () => [],
    entriesOfSlot: () => [],
  };
  const disposers = [];
  const ctx = {
    slots,
    logger: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
    get: (name) => {
      if (name === 'slots') return slots;
      if (name === 'sessions') {
        return {
          list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => undefined },
          refresh: async () => undefined,
          subscribe: () => () => undefined,
        };
      }
      if (name === 'conversation') return { register: () => () => undefined };
      if (name === 'locale') {
        return {
          getSnapshot: () => ({ active: 'zh', revision: 1 }),
          subscribe: () => () => undefined,
          register: (ns, dicts) => {
            registered = { ns, dicts };
            return () => undefined;
          },
          bind: () => (key) => key,
        };
      }
      return undefined;
    },
    effect: (fn) => {
      try {
        const dispose = fn();
        if (typeof dispose === 'function') disposers.push(dispose);
      } catch {
        /* 副作用夹具不参与本断言 */
      }
      return () => undefined;
    },
    on: () => () => undefined,
    inject: (_names, callback) => {
      try {
        callback(ctx);
      } catch {
        /* 同上 */
      }
    },
  };
  mod.apply(ctx, {});
  if (registered === undefined) throw new Error('客户端 apply() 没有注册 locale 字典（dsh-later 词条从哪儿来的？）');
  // 客户端会起 30s tick 之类的定时器，夹具必须自己关掉，否则 `node --test` 收不了工。
  return { ...registered, dispose: () => { for (const dispose of disposers.splice(0)) dispose(); } };
}
