/**
 * 侧栏 badge 的「时钟图标风格」重画（Gitea issue #200）。
 *
 * ## 钉住的行为
 *
 * `badge.innerHTML = getClockSvg()` 只在**插入那一刻**求值一次（insert 分支里那一行），
 * 对账分支原本只比 `data-state` / `aria-label` / `title`。于是用户把「时钟图标风格」从
 * classic 切到 modern 后，已注入的 badge 永远停在旧 glyph 上，直到页面刷新（React 重渲染
 * 擦掉节点、下一轮扫描重新插入）。这条用例直接钉 DOM 层的**结果**：
 *
 *  1. 插入时把风格写进 `data-icon`（没有这份记忆就无从判断"要不要重画"）；
 *  2. 风格变了 → **同一个节点**的 innerHTML 换成另一份 SVG；
 *  3. 重画之后进度弧要按当前比例重新 apply（`innerHTML` 换掉了整棵 SVG，新弧上的
 *     `stroke-dashoffset` 此时是 SVG 自带的 0% 初值）；
 *  4. 设置保存后靠订阅**立刻**重扫（这是 #200 的用户可见面），但重画判据本身在扫描路径里，
 *     所以任何一次扫描（DOM 变化 / 30s tick）都会纠偏。
 *
 * ## 为什么这么测
 *
 * 走 `tests/hover-card.test.mjs` / `tests/presence-drift.test.mjs` 同一条路：**真调用**
 * `src/client/session-presence.ts` 的 `mountSessionPresence`，配最小 fake DOM。不读源码 + 正则
 * ——那种断言在旧实现上也绿（`innerHTML = getClockSvg()` 那行一直都在），正是 #200 藏了这么久的原因。
 *
 * fake DOM 的 `innerHTML` setter 会**解析出 SVG 里两个 circle**（只有 class 与属性，够
 * `querySelector('.ss-clock-prog')` 与 `style.strokeDashoffset` 断言用）。不解析的话
 * 进度弧永远查不到，第 3 条就测不到，而"重画后忘了 applyProgress"恰恰是最容易漏的一步。
 * @module tests/presence-icon-style.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTranspiledTree } from '../scripts/transpile-module.mjs';

/** 表盘周长：与 `session-presence.ts` 的 `CLOCK_FACE_CIRCUMFERENCE` 同式（测试侧独立算，不引内部常量）。 */
const CIRCUMFERENCE = 2 * Math.PI * 9.5;

/** 最小 DOM：只覆盖 session-presence / mountSessionPresence 用到的 API 面（零依赖）。 */
function createDom() {
  class ClassList {
    constructor(el) {
      this.el = el;
      this.set = new Set();
    }
    add(...names) {
      for (const name of names) this.set.add(name);
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
      this._style = {};
    }
    get classList() {
      return this._classList;
    }
    get className() {
      return this._classList.toString();
    }
    set className(value) {
      this._classList = new ClassList(this);
      for (const name of String(value).split(/\s+/).filter(Boolean)) this._classList.add(name);
    }
    get firstElementChild() {
      return this.children[0] ?? null;
    }
    get lastElementChild() {
      return this.children[this.children.length - 1] ?? null;
    }
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join('');
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
    }
    getAttribute(key) {
      return this.attributes.has(key) ? this.attributes.get(key) : null;
    }
    hasAttribute(key) {
      return this.attributes.has(key);
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
      }
    }
    appendChild(node) {
      this.append(node);
      return node;
    }
    get style() {
      return this._style;
    }
    get innerHTML() {
      return this._html ?? '';
    }
    /**
     * 写 innerHTML 时清空子节点，并把 SVG 里的 `<circle …>` **解析成子元素**。
     *
     * 真 DOM 由解析器建树；这里只保留两件被测面需要的事实：class 与属性值。
     * 少了这一步，`applyProgress` 的 `badge.querySelector('.ss-clock-prog')` 恒为 null，
     * 「重画后重新 apply 进度」就变成测不到的断言（假绿）。
     */
    set innerHTML(value) {
      this._html = String(value);
      this.children = [];
      this._text = '';
      for (const match of this._html.matchAll(/<circle([^>]*)>/g)) {
        const attrs = match[1];
        const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
        if (cls.length === 0) continue;
        const circle = new El('circle');
        circle.className = cls;
        for (const [, key, value2] of attrs.matchAll(/([a-z-]+)="([^"]*)"/g)) {
          circle.setAttribute(key, value2);
        }
        this.append(circle);
      }
    }
    after(node) {
      const parent = this.parentElement;
      if (parent === null) return;
      node.parentElement = parent;
      parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    }
    remove() {
      const parent = this.parentElement;
      if (parent === null) return;
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
      this.parentElement = null;
    }
    /** 选择器支持 subset：`.cls` / `tag` / `[k="v"]` / 空格后代 / `:scope >`。 */
    matches(selector) {
      return matchChain(this, selector.trim().replace(/^:scope\s*>\s*/, '').split(/\s+/));
    }
    querySelector(selector) {
      const parts = selector.replace(/:scope\s*>\s*/, '').split(/\s+/);
      const search = (node) => {
        for (const child of node.children) {
          if (matchChain(child, parts)) return child;
          const deep = search(child);
          if (deep !== null) return deep;
        }
        return null;
      };
      return search(this);
    }
    querySelectorAll(selector) {
      const parts = selector.replace(/:scope\s*>\s*/, '').split(/\s+/);
      const out = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (matchChain(child, parts)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }
  }

  function matchSimple(el, token) {
    const parts = token.match(/\[[^\]]+\]|^[a-zA-Z][\w-]*|\.[\w-]+/g);
    if (parts === null) return false;
    return parts.every((part) => {
      const attr = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (attr !== null) {
        const [, key, value] = attr;
        return value === undefined ? el.hasAttribute(key) : el.getAttribute(key) === value;
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
    documentElement: new El('html'),
    visibilityState: 'visible',
    createElement: (tag) => new El(tag),
    getElementById: () => null,
    querySelector: () => null,
    // 出真查询：badge 注入路径靠它找会话行，常量 [] 会让整条用例空跑。
    querySelectorAll(selector) {
      return this.body.querySelectorAll(selector);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return { doc, El };
}

/** 会话行：`[role="treeitem"]` + fiber 上挂 `node.id`（可枚举，与真 React 一致）。 */
function makeRow(El, sessionId) {
  const row = new El('div');
  row.setAttribute('role', 'treeitem');
  row.append(new El('span'));
  row['__reactFiber$test'] = { memoizedProps: { node: { id: sessionId } } };
  return row;
}

/** 设置订阅发布器（两代设置轨道的 `subscribe` 形状子集）。 */
function createPublisher() {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      for (const listener of [...listeners]) listener();
    },
  };
}

const SESSION = 'session-abc';

/**
 * 起一个真实挂载：真 DOM 桩 + 固定摘要（一条 30 分钟窗口过半的提醒）+ 可选设置订阅。
 *
 * @param {object} opts
 * @param {() => string} opts.styleOf - 现读风格的函数（测试里换它的返回值）。
 * @param {boolean} [opts.withSettings] - 是否传入 settings 订阅面。
 */
async function mountHarness(opts) {
  const { doc, El } = createDom();
  const saved = {
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    HTMLElement: globalThis.HTMLElement,
  };
  globalThis.document = doc;
  let moCallback;
  globalThis.MutationObserver = class {
    constructor(callback) {
      moCallback = callback;
    }
    observe() {}
    disconnect() {
      moCallback = undefined;
    }
  };
  globalThis.HTMLElement = El;

  const row = makeRow(El, SESSION);
  doc.body.append(row);

  /**
   * 一条窗口 1h、还有 30 分钟到点的提醒：进度 ≈ 50%。
   *
   * ⚠️ 基准必须是**真实当下**而不是写死的时间戳：`applyBadge` 内部用 `Date.now()` 算进度，
   * 拿一个过去的固定时刻当基准会让比例恒为 0（clamp 到 0），于是「重画后重新 apply」
   * 与「根本没 apply」在数值上不可区分——正是本条用例要分辨的那一步。
   */
  const now = Date.now();
  const entry = {
    count: 1,
    pausedCount: 0,
    nextAt: now + 1_800_000,
    progressFrom: now - 1_800_000,
    state: 'scheduled',
  };
  const summary = {
    reload() {},
    getSnapshot: () => new Map([[SESSION, entry]]),
    subscribe: () => () => {},
    dispose() {},
  };

  const publisher = opts.withSettings === false ? undefined : createPublisher();
  const { mountSessionPresence } = await loadTranspiledTree('src/client/session-presence.ts');
  const dispose = mountSessionPresence({
    summary,
    getClockIconStyle: opts.styleOf,
    ...(publisher === undefined ? {} : { settings: publisher }),
  });

  const settle = async () => {
    // scan 走 60ms 去抖（MutationObserver / 设置订阅同一条路径）。
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  return {
    row,
    publisher,
    settle,
    /** 等效宿主 DOM 变更驱动的重扫（不走设置订阅）。 */
    async rescan() {
      moCallback?.();
      await settle();
    },
    dispose,
  };
}

const badgeOf = (row) => row.querySelector('.ss-presence');

test('#200：切 classic → modern 后，同一个 badge 节点的 innerHTML 重画', async () => {
  let style = 'modern';
  const h = await mountHarness({ styleOf: () => style });
  try {
    await h.settle();
    const badge = badgeOf(h.row);
    assert.ok(badge, '有提醒的会话行必须注入 badge');
    assert.equal(badge.dataset.icon, 'modern', '插入时要记下这份 innerHTML 是哪一档风格');
    assert.match(badge.innerHTML, /ss-clock-prog/, 'modern 档带进度弧');

    // 旧实现到这里就结束了：innerHTML 只在插入时求值一次，此后永远停在 modern。
    style = 'classic';
    h.publisher.notify();
    await h.settle();

    assert.equal(badge.dataset.icon, 'classic', '对账分支必须发现风格变了');
    assert.match(badge.innerHTML, /ss-presence-ring/, 'classic 档是点阵环');
    assert.doesNotMatch(badge.innerHTML, /ss-clock-prog/, 'classic 档没有进度弧');
    assert.equal(badgeOf(h.row), badge, '要就地重画，不是删掉重插（后者会让节点身份也变）');
    assert.equal(h.row.querySelectorAll('.ss-presence').length, 1, '重画不得留下第二份 badge');

    // 切回 modern：innerHTML 换掉整棵 SVG，进度弧是新节点，必须按当前比例重新 apply。
    style = 'modern';
    h.publisher.notify();
    await h.settle();
    const arc = badge.querySelector('.ss-clock-prog');
    assert.ok(arc, '切回 modern 后应有进度弧');
    const offset = Number.parseFloat(String(arc.style.strokeDashoffset ?? ''));
    assert.ok(Number.isFinite(offset), '重画之后必须重新 applyProgress（否则新弧停在 SVG 自带的初值上）');
    // SVG 自带 0% 初值 = 周长；真比例约 50%，两者相差一个量级，断言不必卡死具体毫秒。
    assert.ok(offset < CIRCUMFERENCE * 0.9, `进度弧应反映真实比例，实际 offset=${offset}`);
    assert.ok(offset >= 0, 'offset 不得为负');
  } finally {
    h.dispose();
  }
});

test('#200：重画判据在扫描路径里——没有设置订阅，DOM 变化触发的重扫也会纠偏', async () => {
  // 这一条钉的是「重画不是绑在设置订阅上的特例」：谁触发扫描（DOM 变化 / 30s tick）都纠偏。
  // 反过来说，没有对账分支时（旧实现）即便 `data-icon` 也没写、这里也一定红。
  let style = 'modern';
  const h = await mountHarness({ styleOf: () => style, withSettings: false });
  try {
    await h.settle();
    const badge = badgeOf(h.row);
    assert.ok(badge, '前置：badge 已注入');
    assert.match(badge.innerHTML, /ss-clock-prog/);

    style = 'classic';
    await h.rescan();
    assert.equal(badge.dataset.icon, 'classic', '扫描路径自身要比对风格');
    assert.doesNotMatch(badge.innerHTML, /ss-clock-prog/, '扫描发现风格变了就地重画');
  } finally {
    h.dispose();
  }
});

test('#200：风格没变时不做无谓重画（innerHTML 逐字不变）', async () => {
  // 重画是有代价的：换 innerHTML 会重建 SVG、丢掉弧上的动画状态。判据必须是「变了才画」，
  // 不能是「每次扫描都重画」——后者在 30s tick 上表现为进度弧周期性重置。
  const h = await mountHarness({ styleOf: () => 'modern' });
  try {
    await h.settle();
    const badge = badgeOf(h.row);
    const before = badge.innerHTML;
    const arcBefore = badge.querySelector('.ss-clock-prog');
    assert.ok(arcBefore, '前置：modern 档有进度弧');

    h.publisher.notify();
    await h.settle();
    assert.equal(badge.innerHTML, before, '风格未变不得重画');
    assert.equal(badge.querySelector('.ss-clock-prog'), arcBefore, '弧节点也不该被重建');

    // 反向自证：判据不是永真。把 data-icon 改成另一档（等效「DOM 里记着的风格与当前设置
    // 不一致」），扫描必须就地重画——现代与经典两份 SVG 是不同的 DOM，弧节点会被重建。
    // 用**节点身份**而不是 innerHTML 字符串判：同一档重画产出的字节完全相同，
    // 拿字符串比会得出「没重画」的假结论。
    const h2 = await mountHarness({ styleOf: () => 'modern' });
    try {
      await h2.settle();
      const badge2 = badgeOf(h2.row);
      const arcBefore2 = badge2.querySelector('.ss-clock-prog');
      assert.ok(arcBefore2, '前置：modern 档有进度弧');
      badge2.dataset.icon = 'classic';
      await h2.rescan();
      assert.notEqual(badge2.querySelector('.ss-clock-prog'), arcBefore2, 'data-icon 变化必须导致重画');
      assert.equal(badge2.dataset.icon, 'modern', '重画后要把 data-icon 回写成当前风格');
    } finally {
      h2.dispose();
    }
  } finally {
    h.dispose();
  }
});
