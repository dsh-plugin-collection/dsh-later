/**
 * 面板的焦点与无障碍合同（Gitea issue #204）。
 *
 * ## 钉住五件事
 *
 * 1. **打开即入面板**：`document.activeElement` 变成面板本身（它不是 Tab 序列的一站，
 *    但必须是可编程焦点目标，否则 `focus()` 是空操作）；
 * 2. **关闭时按需归还**：焦点还在面板里 → 还给触发按钮；焦点已被用户挪走 → **不抢**；
 * 3. **快捷芯片不是单选组**：`role="group"` + 每枚 `aria-pressed`，不再用
 *    `radiogroup`/`radio`——单选语义要求 roving tabindex 与方向键，而这里缺，两个模型
 *    对不上时屏幕阅读器会念「1 of 4」、键盘却只能 Tab 走四站；
 * 4. **组的无障碍名不借用面板标题**（`dialog` 已有同名，读出来是回声），并 8 门齐全；
 * 5. **Esc 不抢键**：兼容层的监听改到冒泡阶段，且上游已 `preventDefault()` 的事件不再处理。
 *
 * ## 为什么焦点用真函数测、a11y 用真渲染测
 *
 * - 焦点逻辑抽在 `src/client/panel-focus.ts`，**纯函数 + 最小元素面**，可以直接喂假元素
 *   断言行为；写进组件的 effect 里就测不到了（组件级假 React 不挂 DOM）。
 * - a11y 形状（role / aria-* / tabIndex）是**渲染产物**，走 `tests/smart-window-settings.test.mjs`
 *   那条真实执行路线：esbuild 现场编译 `SchedPanel.tsx`，mini React 真的渲染，再从树上
 *   读属性。读源码正则对「属性写没写对」只能是同义反复。
 * - Esc 那条必须读**真 bundle 里的实现**：它是模块加载期就从 compat 层拿到的函数，
 *   只能按 `tests/panel-anchor-backends.test.mjs` 的方式重新加载 `lib/client.js`。
 * @module tests/panel-focus-a11y.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync as exists } from 'node:fs';
import { loadTranspiled } from '../scripts/transpile-module.mjs';
import { compileClientModule, findNode, makeHostRequire } from './helpers/settings-render-harness.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const canTranspile = exists(join(repoRoot, 'node_modules/esbuild'));
const skip = canTranspile ? false : 'node_modules/esbuild 不在';

/* ── 1. 焦点：真函数、假元素 ──────────────────────────────────────────────────── */

/**
 * 造一个假 `document`：`activeElement` 可读写，元素带 `focus()` 与 `contains()`。
 *
 * `contains` 按父子引用判（`parentNode` 指向自己就是「在面板内」），不实现整棵树的遍历
 * ——本测只关心「焦点在不在面板里」这一个判据。
 */
function installDocument() {
  const previous = globalThis.document;
  const state = { activeElement: null };
  const doc = {
    get activeElement() {
      return state.activeElement;
    },
    body: { tagName: 'BODY' },
  };
  globalThis.document = doc;
  /** 造元素：`parent` 决定它是否算在面板内。 */
  const el = (name, parent = null) => ({
    name,
    parentNode: parent,
    focused: 0,
    focus() {
      this.focused += 1;
      state.activeElement = this;
    },
    contains(node) {
      let cursor = node;
      while (cursor !== null && cursor !== undefined) {
        if (cursor === this) return true;
        cursor = cursor.parentNode ?? null;
      }
      return false;
    },
  });
  return {
    el,
    state,
    /** 模拟「用户把焦点挪到别处」（不经过 focus()）。 */
    moveFocus(node) {
      state.activeElement = node;
    },
    restore() {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}

test('#204：打开面板后焦点在面板内，关闭时焦点还回触发按钮', { skip }, async () => {
  const dom = installDocument();
  try {
    const { focusIntoPanel, restoreFocusToTrigger } = await loadTranspiled('src/client/panel-focus.ts');
    const trigger = dom.el('button');
    const panel = dom.el('div', null);
    const chip = dom.el('button', panel);
    dom.state.activeElement = trigger;

    focusIntoPanel(panel);
    assert.equal(panel.focused, 1, '打开面板必须真的 focus() 面板本身');
    assert.equal(dom.state.activeElement, panel, `焦点应在面板内，实际在 ${dom.state.activeElement?.name}`);

    // 用户 Tab 进面板里的控件后关掉面板 → 焦点该回按钮。
    dom.state.activeElement = chip;
    assert.equal(restoreFocusToTrigger(panel, trigger), true, '焦点在面板内时应归还');
    assert.equal(dom.state.activeElement, trigger, '焦点应还回触发按钮');
    assert.equal(trigger.focused, 1);
  } finally {
    dom.restore();
  }
});

test('#204：焦点已被用户挪走时不抢回按钮', { skip }, async () => {
  const dom = installDocument();
  try {
    const { restoreFocusToTrigger } = await loadTranspiled('src/client/panel-focus.ts');
    const trigger = dom.el('button');
    const panel = dom.el('div', null);
    const outside = dom.el('input');
    dom.state.activeElement = panel;

    // 用户点了面板外面：焦点已不在面板里。此时归还就是抢焦点——下一次敲键盘会莫名
    // 落回输入框旁。
    dom.moveFocus(outside);
    assert.equal(restoreFocusToTrigger(panel, trigger), false, '焦点不在面板内时不得归还');
    assert.equal(dom.state.activeElement, outside, '焦点必须留在用户放的地方');
    assert.equal(trigger.focused, 0, '触发按钮不得被 focus()');

    // 反向自证：面板里的元素必须认得出「在里面」（否则上一条永远为假）。
    const chip = dom.el('button', panel);
    dom.moveFocus(chip);
    assert.equal(restoreFocusToTrigger(panel, trigger), true, '面板子节点算「在内」');
  } finally {
    dom.restore();
  }
});

test('#204：没有触发按钮（会话已卸载）时不抛错也不动焦点', { skip }, async () => {
  const dom = installDocument();
  try {
    const { restoreFocusToTrigger } = await loadTranspiled('src/client/panel-focus.ts');
    const panel = dom.el('div', null);
    dom.state.activeElement = panel;
    assert.equal(restoreFocusToTrigger(panel, null), false, '没有触发按钮时安静返回');
    assert.equal(dom.state.activeElement, panel);
    // 触发按钮已被卸载（focus 抛错）时不许把异常抛给事件处理。
    const throwing = {
      focus() {
        throw new Error('detached');
      },
      contains: () => true,
    };
    assert.equal(restoreFocusToTrigger(panel, throwing), false, 'trigger.focus() 抛错要吞掉');
  } finally {
    dom.restore();
  }
});

/* ── 2. a11y 形状：真渲染 SchedPanel ──────────────────────────────────────────── */

/** 渲染一次面板，返回它的树。 */
async function renderPanel() {
  // `SchedPanel` 里有一枚每秒 tick 的 `useNow`，mini React 的 effect 会真的把
  // `setInterval` 挂到进程上——本测不验倒计时，且没有卸载钩子，所以把定时器换成
  // 空实现，免得整个 node --test 进程挂在一条 interval 上退不出去。
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => undefined;
  try {
    return await renderPanelInner();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
}

async function renderPanelInner() {
  const hostRequire = makeHostRequire();
  const panelMod = await compileClientModule('client/components/SchedPanel.tsx', hostRequire);
  const react = hostRequire('react');
  // 字典直接给键名：本测只关心 aria 形状，不关心文案。
  const t = new Proxy({}, { get: (_target, key) => String(key) });
  const anchorRef = { current: null };
  const panelRef = { current: null };
  const view = react.__mount(
    react.createElement(panelMod.SchedPanel, {
      defaultPrompt: '喝水',
      schedules: [],
      timeZone: 'Asia/Shanghai',
      busy: false,
      t,
      lang: 'zh',
      onClose: () => {},
      onCreate: async () => {},
      onDelete: () => {},
      bottom: 40,
      anchorRef,
      panelRef,
      smartWindow: undefined,
      promptLimits: undefined,
    }),
  );
  return view.tree;
}

test('#204：面板是 dialog 且可编程聚焦（tabIndex=-1）', { skip }, async () => {
  const tree = await renderPanel();
  const dialog = findNode(tree, (node) => node.props?.role === 'dialog');
  assert.ok(dialog !== null, '面板应有 role="dialog"');
  assert.equal(dialog.props['aria-label'], 'panelTitle', 'dialog 的无障碍名仍是面板标题');
  assert.equal(dialog.props.tabIndex, -1, '面板必须是可编程焦点目标（-1 而不是 0：不进 Tab 序列）');
});

test('#204：快捷芯片降级为切换按钮语义（group + aria-pressed，不留 radio）', { skip }, async () => {
  const tree = await renderPanel();
  const group = findNode(tree, (node) => node.props?.className === 'ss-quick-grid');
  assert.ok(group !== null, '应渲染快捷芯片组');
  assert.equal(group.props.role, 'group', '芯片是动作而不是一组单选值，用 group');
  assert.notEqual(group.props.role, 'radiogroup', '不得再用 radiogroup（缺 roving tabindex 与方向键）');
  assert.equal(
    group.props['aria-label'],
    'quickGroupLabel',
    '组的无障碍名须是专用键，不借用面板标题（dialog 已有同名，读出来是回声）',
  );

  const chips = [];
  const walk = (node) => {
    if (node === null || typeof node !== 'object' || !('type' in node)) return;
    if (node.props?.className?.includes?.('ss-quick-chip')) chips.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  assert.ok(chips.length >= 3, `快捷芯片至少 3 枚，实际 ${chips.length}`);
  for (const chip of chips) {
    assert.equal(chip.props.role, undefined, '芯片不得声明 role="radio"');
    assert.equal(chip.props['aria-checked'], undefined, 'radio 的 aria-checked 要一起撤掉');
    assert.equal(typeof chip.props['aria-pressed'], 'boolean', '切换按钮语义：每枚都要有布尔 aria-pressed');
    assert.equal(chip.props.type, 'button');
  }
  // 恰好一枚处于按下状态（默认 10 分钟后）。
  assert.equal(chips.filter((chip) => chip.props['aria-pressed'] === true).length, 1, '默认应恰好一枚按下');
});

test('#204：quickGroupLabel 在 8 门字典里齐全且不是中文残留', { skip }, async () => {
  const { loadTranspiledTree } = await import('../scripts/transpile-module.mjs');
  const mod = await loadTranspiledTree('src/client/locales/ui.ts');
  const ids = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'];
  for (const id of ids) {
    const dict = mod.dictFor(id);
    assert.equal(typeof dict.quickGroupLabel, 'string', `${id} 缺 quickGroupLabel（tsc 的映射类型会把漏键变成编译错误，这里再兜一次）`);
    assert.ok(dict.quickGroupLabel.trim().length > 0, `${id} 的 quickGroupLabel 不能是空串`);
  }
  /*
   * 非中文语言不能逐字等于中文（机器初翻最常见的漏网就是漏翻、直接抄了 zh）。
   * 判据是「与 zh 逐字相同」，**不是**「不含汉字」——日文里有汉字，那条会把 ja 误判成
   * 漏翻（实际它翻得对，`クイック時刻オプション` 含「時刻」）。
   */
  const zhValue = mod.dictFor('zh').quickGroupLabel;
  for (const id of ids.filter((value) => value !== 'zh')) {
    assert.notEqual(mod.dictFor(id).quickGroupLabel, zhValue, `${id} 的 quickGroupLabel 与 zh 逐字相同，疑似漏翻`);
  }
});

/* ── 3. Esc：真渲染一个探针组件驱动 compat 层的 hook ─────────────────────────── */

test('#204：Esc 在冒泡阶段监听，且不处理已被上游 preventDefault 的事件', { skip }, async () => {
  const hostRequire = makeHostRequire();
  const compatMod = await compileClientModule('client/primitives-compat.ts', hostRequire);
  const react = hostRequire('react');

  // window 桩：记录注册形状（第三参是否 true = 捕获阶段），并允许我们驱动事件。
  const registered = [];
  const previousWindow = globalThis.window;
  const fakeWindow = {
    addEventListener(type, fn, options) {
      registered.push({ type, fn, options });
    },
    removeEventListener() {},
  };
  globalThis.window = fakeWindow;

  let openCalls = 0;
  const setOpen = () => {
    openCalls += 1;
  };
  /**
   * 探针：`useEscapeToClose` 是 hook，必须由渲染器驱动 effect 才会注册监听。
   * 用 settings 夹具那份 mini React（effect 在渲染后立刻跑）。
   */
  const view = react.__mount(react.createElement(function Probe() {
    compatMod.useEscapeToClose(true, setOpen);
    return null;
  }));
  void view.tree;

  try {
    const keydown = registered.filter((entry) => entry.type === 'keydown');
    assert.equal(keydown.length, 1, `应注册恰好 1 个 keydown 监听，实际 ${keydown.length}`);
    assert.notEqual(keydown[0].options, true, '不得在捕获阶段监听：会先于宿主 composer 抢到 Esc');
    assert.equal(keydown[0].options?.capture, undefined, '也不许用 { capture: true } 的写法');

    const onKey = keydown[0].fn;
    // ① 普通 Esc → 关面板。
    onKey({ key: 'Escape', defaultPrevented: false });
    assert.equal(openCalls, 1, '未被拦下的 Esc 应关闭面板');
    // ② 上游已处理（preventDefault）→ 不许再关一次。
    onKey({ key: 'Escape', defaultPrevented: true });
    assert.equal(openCalls, 1, '上游已 preventDefault 的 Esc 必须跳过：一次按键不该关两样东西');
    // ③ 别的键不关。
    onKey({ key: 'Enter', defaultPrevented: false });
    onKey({ key: 'a', defaultPrevented: false });
    assert.equal(openCalls, 1, '只有 Esc 才关面板');
  } finally {
    globalThis.window = previousWindow;
  }
});
