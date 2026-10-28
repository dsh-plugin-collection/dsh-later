/**
 * 侧栏 presence 的宿主 DOM 漂移自检单测（task-3）。
 *
 * 被测行为在 `src/client/session-presence.ts`：`mountSessionPresence` 靠结构探测
 * 将 badge 注入宿主会话行，**探测不到就安静跳过**。这个策略本身是对的（绝不误标），
 * 但代价是宿主改版时 badge 整块消失、且没有任何信号——看起来与「用户就是没有提醒」
 * 无法区分。本测锁住用来区分两者的判据：
 *
 *   一次 scan 里 `index.size > 0`（本插件确实有带提醒的会话）**且**
 *   会话行 treeitem 查询命中 0 行 → 告警一次（`console.warn`）。
 *
 * 做法沿用 `tests/hover-card.test.mjs`：**真调用** `lib/client.js` 的 `apply`
 * 驱动真实的 mount/scan 路径，配最小 fake DOM；不做「读源码 + 正则」那种脆断言。
 * fake DOM 复制而非共享：本任务的写范围只有本文件（提取 tests/helpers 里的共用
 * 假 DOM 是后续单独一条活儿，见给 lead 的报告）。
 *
 * 覆盖：
 *  1. 有提醒 + 0 行 → 恰好一条告警，且不影响渲染路径（不抛错、不误插节点）；
 *  2. 无提醒 + 0 行 → 不告警（判据的前置条件必须是「确实有带提醒的会话」）；
 *  3. 连续多次 scan → 只告警一次（scan 由 60ms 去抖的 MutationObserver 驱动）；
 *  4. 命中过行即复位 → 下一轮漂移再告警一次（恢复条件，不是进程级只报一次）；
 *  5. 选择器集中（HOST_DOM 搬家）后匹配语义不变：`aria-expanded` 的工作区行仍被
 *     排除、会话行照常标注、有命中时不告警；
 *  6. 已知盲区的特征化断言：只命中工作区行时按现判据**不**告警。
 * @module tests/presence-drift.test
 */
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

/**
 * 最小 DOM 实现：只覆盖 session-presence / apply 用到的 API 面（零依赖，同
 * hover-card.test.mjs；与真实 DOM 的差异之处已标注——假实现比真浏览器宽松）。
 */
function createDom() {
  class ClassList {
    constructor(el) {
      this.el = el;
      this.set = new Set();
    }
    add(...names) {
      for (const n of names) this.set.add(n);
    }
    contains(name) {
      return this.set.has(name);
    }
    toString() {
      return [...this.set].join(' ');
    }
  }

  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attributes = new Map();
      this.dataset = {};
      this.parentElement = null;
      this._classList = new ClassList(this);
      this._text = '';
    }
    get classList() {
      return this._classList;
    }
    get className() {
      return this._classList.toString();
    }
    set className(v) {
      this._classList = new ClassList(this);
      for (const n of String(v).split(/\s+/).filter(Boolean)) this._classList.add(n);
    }
    get firstElementChild() {
      return this.children[0] ?? null;
    }
    get lastElementChild() {
      return this.children[this.children.length - 1] ?? null;
    }
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      this._text = String(v);
      this.children = [];
    }
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
    }
    getAttribute(k) {
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }
    hasAttribute(k) {
      return this.attributes.has(k);
    }
    append(...nodes) {
      for (const n of nodes) {
        n.parentElement = this;
        this.children.push(n);
      }
    }
    // apply 的 injectStyles 走 document.head.appendChild，必须给（同 hover-card）。
    appendChild(node) {
      this.append(node);
      return node;
    }
    get innerHTML() {
      return this._html ?? '';
    }
    set innerHTML(v) {
      this._html = String(v);
      this.children = [];
      this._text = '';
    }
    get style() {
      this._style = this._style ?? {};
      return this._style;
    }
    after(node) {
      const p = this.parentElement;
      if (p === null) return;
      node.parentElement = p;
      p.children.splice(p.children.indexOf(this) + 1, 0, node);
    }
    remove() {
      const p = this.parentElement;
      if (p === null) return;
      const i = p.children.indexOf(this);
      if (i >= 0) p.children.splice(i, 1);
      this.parentElement = null;
    }
    /** 选择器支持 subset：`.cls` / `tag` / `[k="v"]` / 空格后代 / `:scope >`。 */
    matches(sel) {
      const parts = sel.trim().replace(/^:scope\s*>\s*/, '').split(/\s+/);
      return matchChain(this, parts);
    }
    querySelector(sel) {
      const cleaned = sel.replace(/:scope\s*>\s*/, '');
      const search = (node) => {
        for (const c of node.children) {
          if (matchChain(c, cleaned.split(/\s+/))) return c;
          const deep = search(c);
          if (deep !== null) return deep;
        }
        return null;
      };
      return search(this);
    }
    querySelectorAll(sel) {
      const out = [];
      const cleaned = sel.replace(/:scope\s*>\s*/, '');
      const parts = cleaned.split(/\s+/);
      const walk = (node) => {
        for (const c of node.children) {
          if (matchChain(c, parts)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
  }

  function matchSimple(el, token) {
    // 支持复合简单选择器（如 [role="treeitem"][draggable="true"] 或 div.cls）。
    const parts = token.match(/\[[^\]]+\]|^[a-zA-Z][\w-]*|\.[\w-]+/g);
    if (parts === null) return false;
    return parts.every((part) => {
      const attr = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (attr !== null) {
        const [, k, v] = attr;
        return v === undefined ? el.hasAttribute(k) : el.getAttribute(k) === v;
      }
      if (part.startsWith('.')) return el.classList.contains(part.slice(1));
      return el.tagName === part.toUpperCase();
    });
  }

  function matchChain(el, parts) {
    if (parts.length === 0) return false;
    if (!matchSimple(el, parts[parts.length - 1])) return false;
    let node = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      let ok = false;
      while (node !== null) {
        if (matchSimple(node, parts[i])) {
          ok = true;
          node = node.parentElement;
          break;
        }
        node = node.parentElement;
      }
      if (!ok) return false;
    }
    return true;
  }

  const doc = {
    body: new El('body'),
    head: new El('head'),
    visibilityState: 'visible',
    documentElement: new El('html'),
    createElement: (tag) => new El(tag),
    getElementById: () => null,
    querySelector: () => null,
    // 与 hover-card.test.mjs 的关键差异：这里必须是**真查询**——漂移判据正是
    // 「treeitem 命中几行」，返回常量 [] 会让判据永远成立、测不出任何区别。
    querySelectorAll: (sel) => doc.body.querySelectorAll(sel),
    addEventListener() {},
    removeEventListener() {},
  };
  return { doc, El };
}

/** 让 bundle 内的 `instanceof HTMLElement` 判定对我们 fake El 生效。 */
function installHtmlElementGlobal(El) {
  const saved = globalThis.HTMLElement;
  globalThis.HTMLElement = El;
  return () => {
    if (saved === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = saved;
  };
}

/**
 * 构造会话行（`[role="treeitem"][draggable="true"]` + fiber 上挂 node.id）。
 * 真实 React 挂的 `__reactFiber$*` 是可枚举属性（插件用 Object.keys 查找），
 * 因此这里必须是可枚举的，否则与生产行为不符。
 * @param opts.workspace - true 时带上 `aria-expanded`，即宿主的工作区行。
 */
function makeRow(El, sessionId, opts = {}) {
  const row = new El('div');
  row.setAttribute('role', 'treeitem');
  row.setAttribute('draggable', 'true');
  if (opts.workspace === true) row.setAttribute('aria-expanded', 'false');
  const slot = new El('span');
  row.append(slot);
  row['__reactFiber$test'] = { memoizedProps: { node: { id: sessionId } } };
  return row;
}

/** 装载客户端 bundle：bundle 是浏览器模块加载器格式，这里提供最小 shim。 */
async function loadClientBundle() {
  const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let captured;
  globalThis.window = globalThis.window ?? {};
  globalThis.window.__ModuleLoader__ = {
    load: (def) => {
      captured = def;
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('window', src)(globalThis.window);
  if (captured === undefined) throw new Error('bundle did not register a module');
  const require = (id) => {
    // 本测只驱动 session-presence 的 DOM 层；React 组件不参与渲染，给最小桩。
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
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      const hooks = {
        useAnchoredPosition: () => ({ left: '0px', top: '0px' }),
        useDismissOnOutsidePointer: () => {},
      };
      return new Proxy({}, {
        get: (_target, name) => {
          if (typeof name === 'string' && name.startsWith('Icon')) return () => null;
          if (typeof name === 'string' && name in hooks) return hooks[name];
          throw new Error(`unexpected primitives export: ${String(name)}`);
        },
      });
    }
    throw new Error(`unexpected host require: ${id}`);
  };
  // 每次 factory 调用都会重跑 bundle 体 → 模块级状态（含漂移告警标志）天然重置，
  // 因此一个测试一个 harness，用例之间互不污染。
  return captured.factory(require);
}

/**
 * 起一个真实挂载：装 bundle → 打桩 document/MutationObserver/window → 收
 * `console.warn` → `mod.apply(ctx)`。返回显式驱动 scan 的工具与清理函数。
 * @param opts.schedulesInStore - 摘要里要有几条带提醒的会话（0 = 用户确实没提醒）。
 */
async function mountPresenceHarness(opts = {}) {
  const remindedCount = opts.schedulesInStore ?? 1;
  const { doc, El } = createDom();
  const savedDoc = globalThis.document;
  const savedMO = globalThis.MutationObserver;
  const savedWin = globalThis.window;
  const savedWarn = console.warn;

  /** 捕获到的告警文本（本测唯一的可观测出口：客户端没有宿主 logger）。 */
  const warnings = [];
  globalThis.document = doc;
  // MO 桩：记录回调，供测试显式触发（等效真实 DOM 变更驱动的重扫）。
  let moCallback;
  globalThis.MutationObserver = class {
    constructor(cb) {
      moCallback = cb;
    }
    observe() {}
    disconnect() {
      moCallback = undefined;
    }
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const restoreHTMLElement = installHtmlElementGlobal(El);
  console.warn = (...args) => warnings.push(args.map(String).join(' '));

  const byId = {};
  for (let i = 0; i < remindedCount; i += 1) {
    byId[`session-reminded-${i}`] = {
      projectionValues: {
        userSchedules: { schedules: [{ scheduled_at: new Date(Date.now() + 3600_000).toISOString() }] },
      },
    };
  }
  const stores = { byId };
  const sessions = {
    list: { getSnapshot: () => stores, subscribe: () => () => {} },
    refresh: async () => {},
  };

  const disposers = [];
  const ctx = {
    get: (name) => {
      if (name === 'slots') return { register: () => () => {}, inject: () => {}, subscribe: () => () => {}, entries: () => [], entriesOfSlot: () => [] };
      if (name === 'sessions') return sessions;
      if (name === 'locale') return { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {}, register: () => () => {}, bind: () => (key) => key };
      return undefined;
    },
    effect: (fn) => {
      // apply 的 effect 返回清理函数；必须收集并在结束时执行，否则挂起的
      // setInterval 会让 node --test 不退出。
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return () => {};
    },
    on: () => () => {},
    inject: (names, callback) => callback(ctx),
  };
  ctx.slots = ctx.get('slots');

  const mod = await loadClientBundle();
  mod.apply(ctx);

  // scan 是 60ms 去抖的：等过一个去抖窗口即完成一次完整扫描。
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 150));
  };

  return {
    doc,
    El,
    warnings,
    settle,
    /** 触发一次重扫（等效宿主 DOM 变更 → MutationObserver → scheduleScan）。 */
    rescan: async () => {
      moCallback?.();
      await settle();
    },
    dispose: () => {
      for (const d of disposers) d();
      console.warn = savedWarn;
      restoreHTMLElement();
      globalThis.document = savedDoc;
      globalThis.MutationObserver = savedMO;
      globalThis.window = savedWin;
    },
  };
}

test('漂移判据：有提醒 + 会话行命中 0 行 → 告警一次，且不影响渲染路径', async () => {
  const h = await mountPresenceHarness({ schedulesInStore: 1 });
  try {
    // 宿主侧栏此刻一个 treeitem 都没有（改版后的形态，或尚未挂载）。
    await h.settle();

    assert.equal(h.warnings.length, 1, '有提醒却一个会话行都没命中，必须告警一次');
    const text = h.warnings.join('\n');
    // 措辞要能指向根因：点名选择器 + 「宿主 DOM 可能已变」，而不是泛泛的 failed。
    assert.match(text, /\[role="treeitem"\]\[draggable="true"\]/, '告警应带出行选择器，便于直接核对');
    assert.match(text, /命中 0 行/, '告警应说明命中 0 行这一观测');
    assert.match(text, /宿主/, '告警应把根因指向宿主 DOM');
    // 判据的可读性关键：告警必须明说「不是用户侧没提醒」，并给出排查落点。
    assert.match(text, /排查/, '告警应给出排查落点');
    // fail-open：告警不改用会抛错的探测，也不新增任何 DOM 副作用。
    assert.equal(h.doc.querySelectorAll('.ss-presence').length, 0, '告警路径不得插入节点');
  } finally {
    h.dispose();
  }
});

test('反例：摘要里没有提醒（index.size===0）→ 不告警', async () => {
  const h = await mountPresenceHarness({ schedulesInStore: 0 });
  try {
    await h.settle();
    await h.rescan();
    assert.equal(h.warnings.length, 0, '「用户确实没有活动提醒」不得被报成宿主漂移');
  } finally {
    h.dispose();
  }
});

test('只告警一次：连续多次 scan 不再刷屏', async () => {
  const h = await mountPresenceHarness({ schedulesInStore: 2 });
  try {
    await h.settle();
    assert.equal(h.warnings.length, 1, '首次扫描即告警');
    // scan 由 60ms 去抖的 MutationObserver 驱动：真实场景每秒能跑十几次，
    // 每次都刷会打死控制台并淹掉真问题。
    for (let i = 0; i < 5; i += 1) await h.rescan();
    assert.equal(h.warnings.length, 1, '同一轮漂移只告警一次');
  } finally {
    h.dispose();
  }
});

test('恢复条件：命中过会话行即复位，下一轮漂移还能告出来', async () => {
  const h = await mountPresenceHarness({ schedulesInStore: 1 });
  try {
    await h.settle();
    assert.equal(h.warnings.length, 1, '先告警一轮');

    // 宿主回来了（或维护者改对了选择器）：命中行 → badge 正常注入 + 标志复位。
    const row = makeRow(h.El, 'session-reminded-0');
    h.doc.body.append(row);
    await h.rescan();
    assert.ok(row.querySelector('.ss-presence') !== null, '命中后应恢复注入 badge');
    assert.equal(h.warnings.length, 1, '命中期间不得重复告警');

    // 再次漂移：行消失 → 若标志没有复位，这一轮就会重新变成静默失效。
    row.remove();
    await h.rescan();
    assert.equal(h.warnings.length, 2, '复位后下一轮漂移必须还能告警（不是进程级只报一次）');
  } finally {
    h.dispose();
  }
});

test('HOST_DOM 搬家后语义不变：aria-expanded 的工作区行仍被排除、会话行仍标注', async () => {
  const h = await mountPresenceHarness({ schedulesInStore: 1 });
  try {
    const sessionRow = makeRow(h.El, 'session-reminded-0');
    // 工作区行同样命中 treeitem 选择器，且它的 fiber 也能反查到**有提醒的**会话
    // ——靠 aria-expanded 排除，这条规则一字未改，必须有断言钉住。
    const workspaceRow = makeRow(h.El, 'session-reminded-0', { workspace: true });
    h.doc.body.append(workspaceRow, sessionRow);

    await h.settle();
    await h.rescan();

    assert.ok(sessionRow.querySelector('.ss-presence') !== null, '会话行应注入 badge');
    assert.equal(workspaceRow.querySelector('.ss-presence'), null, '工作区行（带 aria-expanded）绝不注入');
    assert.equal(h.warnings.length, 0, '查询有命中就不是漂移，不得告警');
  } finally {
    h.dispose();
  }
});

test('特征化断言（已记录盲区）：只命中工作区行时按现判据不告警', async () => {
  const h = await mountPresenceHarness({ schedulesInStore: 1 });
  try {
    // 判据是「treeitem 查询命中 0 行」，取的是**过滤前**的行数：工作区行也算命中。
    // 于是「会话行丢了 draggable、工作区行还在」这一类漂移不会告警——本测把该
    // 取舍固定下来，避免后来者以为是漏写。收紧成「过滤后再判」需同步改这里。
    const workspaceRow = makeRow(h.El, 'session-reminded-0', { workspace: true });
    h.doc.body.append(workspaceRow);

    await h.settle();
    await h.rescan();
    assert.equal(h.warnings.length, 0, '命中 ≥1 行（含工作区行）时现判据不告警');
    assert.equal(workspaceRow.querySelector('.ss-presence'), null, '工作区行仍然绝不注入');
  } finally {
    h.dispose();
  }
});
