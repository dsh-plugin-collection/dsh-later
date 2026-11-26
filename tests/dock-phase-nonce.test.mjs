/**
 * dock 进度条相位在「收起 → 展开」后必须重取（Gitea issue #202）。
 *
 * ## 被测行为
 *
 * 列表常驻 DOM（`hidden` 控可见，为了让 `aria-controls` 永远指向真实目标），所以收起/展开
 * **不会**卸载行。而 `MultiBar` 的动画相位是在挂载那一刻冻结的（每次 tick 重算
 * `--ss-bar-delay` 会让播放头每秒多走一秒，见 `bar-geometry.ts` 的实测数字）。两个事实
 * 相撞：「收起 → 等十分钟 → 展开」，进度条还停在收起那一刻。
 *
 * 修法有两类：
 *  1. 在列表上写 `key={expanded ? 'open' : 'closed'}`，靠 React 的**整列重建**重置相位；
 *  2. 显式相位版本号：展开边沿 +1，`MultiBar` 在 effect 里据此重取相位（不需要重建）。
 *
 * ## 为什么这条用例能区分两者
 *
 * 本夹具的渲染器**不实现 `key` 的重挂载语义**——组件实例只按「位置 + 组件类型」复用。
 * 这不是省事，而是判据本身：正确性不该依赖「React 会不会在 key 变化时把子树拆了重来」
 * 这种框架内部行为。断言落在最终产物上——展开之后 `--ss-bar-delay` 必须对应**当下**
 * 相位，而在收起期间（只有 tick、没有展开）它必须**保持不变**。前者是缺陷本身，后者是
 * 那条不能回退的契约。
 *
 * 走真实执行：esbuild 现场编译 `ScheduleDock.tsx`（连同它 import 的几何/文案/兼容层），
 * 配 `tests/helpers/settings-render-harness.mjs` 的 mini React 真的渲染，再从渲染树里读
 * 进度条的内联样式。没有一处是读源码正则。
 * @module tests/dock-phase-nonce.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileClientModule, findNode, makeHostRequire } from './helpers/settings-render-harness.mjs';
import { loadTranspiled } from '../scripts/transpile-module.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const canBuild = existsSync(join(repoRoot, 'node_modules/esbuild'));
const skip = canBuild ? false : 'node_modules/esbuild 不在（本测需要在内存里编译客户端组件）';

/**
 * 时间轴：挂载时刻 `T0` 正好是窗口起点，所以挂载时的相位是 0；
 * 收起十分钟后展开，相位应当是 -600000ms。两个值差得很开，断言不会含糊。
 */
const T0 = 1_700_000_000_000;
const WINDOW_MS = 3_600_000; // 1 小时窗口（与 `bar-geometry` 的 BAR_UNIT_MS 一致）
const SCHEDULED_AT = T0 + WINDOW_MS;

/**
 * 宿主模块桩：react 用 settings 夹具那份 mini React，primitives 给一组图标/工具桩。
 * @returns {(id: string) => unknown} require 实现（另挂 `__react` 供测试取用）。
 */
function makeRequire() {
  const base = makeHostRequire();
  const iconStub = function IconStub() {
    return null;
  };
  const primitives = new Proxy(
    {},
    {
      ownKeys: () => ['useAnchoredPosition', 'useDismissOnOutsidePointer'],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      get: (_target, name) => {
        if (typeof name !== 'string') return undefined;
        if (name === 'useAnchoredPosition') return () => ({ left: '0px', top: '0px' });
        if (name === 'useDismissOnOutsidePointer') return () => undefined;
        if (name === 'Tooltip') {
          // 官方 Tooltip 用 cloneElement 把 ref 与 handler 注到子元素自身；本测只关心进度条，
          // 渲染成一个透明容器即可（不额外插包装节点这点对进度条无关）。
          return function TooltipStub(props) {
            return props.children ?? null;
          };
        }
        if (name === 'fileSizeText') return () => '1 KB';
        if (name === 'tooltipPortalProps') return {};
        if (name.startsWith('Icon') || name === 'FileTypeIcon') return iconStub;
        throw new Error(`unexpected primitives export: ${name}`);
      },
    },
  );
  const require = (id) => {
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    return base(id);
  };
  require.__react = base.__react;
  return require;
}

/**
 * 装环境：假时钟、可驱动的 interval、可切换的 matchMedia。
 * @returns {{ advance(ms: number): void, tick(): void, restore(): void }}
 */
function installEnvironment() {
  const saved = {
    now: Date.now,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    matchMedia: globalThis.matchMedia,
    window: globalThis.window,
  };
  let clock = T0;
  const intervals = new Map();
  let seq = 0;

  Date.now = () => clock;
  globalThis.setInterval = (fn) => {
    seq += 1;
    intervals.set(seq, fn);
    return seq;
  };
  globalThis.clearInterval = (id) => {
    intervals.delete(id);
  };
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  globalThis.window = { innerHeight: 800, setTimeout: () => 0, clearTimeout: () => undefined };

  return {
    advance(ms) {
      clock += ms;
    },
    /** 把当前所有 interval 回调各跑一次（= 过去一秒的 tick）。 */
    tick() {
      for (const fn of [...intervals.values()]) fn();
    },
    restore() {
      Date.now = saved.now;
      globalThis.setInterval = saved.setInterval;
      globalThis.clearInterval = saved.clearInterval;
      if (saved.matchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = saved.matchMedia;
      if (saved.window === undefined) delete globalThis.window;
      else globalThis.window = saved.window;
    },
  };
}

/** 造两条提醒（都够长，能算出相位的窗口）。 */
function createSchedules() {
  const one = {
    id: 'a',
    prompt: '喝水',
    kind: 'after',
    status: 'active',
    scheduled_at: new Date(SCHEDULED_AT).toISOString(),
    created_at: new Date(SCHEDULED_AT - WINDOW_MS).toISOString(),
    window_seconds: WINDOW_MS / 1000,
  };
  const two = {
    ...one,
    id: 'b',
    prompt: '站起来',
    scheduled_at: new Date(SCHEDULED_AT + 1_800_000).toISOString(),
    created_at: new Date(SCHEDULED_AT + 1_800_000 - WINDOW_MS).toISOString(),
  };
  return [one, two];
}

/**
 * 把渲染推到收敛。
 *
 * 夹具的 `view.tree` 每次读取都从根重新展开一遍，而 effect 在**同一次展开中**是「先跑
 * 组件函数、后跑 effect」——所以 effect 里 setState 的结果要等到下一次展开才出现在树上
 * （真实 React 里也一样，只是它自己会补一次重渲染）。展开边沿至少要两趟：
 * 一趟让 `phaseNonce` 落地，一趟让 `MultiBar` 的相位按新版本号重取。
 */
function settle(view, rounds = 4) {
  for (let i = 0; i < rounds; i += 1) void view.tree;
}

/** 从渲染树里取进度条填充块的内联样式（找不到就判红，别让断言空转）。 */
function barStyle(tree) {
  const fill = findNode(tree, (node) => node.props?.className === 'ss-dock-bar-fill');
  assert.ok(fill !== null, '渲染树里应能找到 .ss-dock-bar-fill');
  return fill.props.style;
}

/** 取 `--ss-bar-delay` 的毫秒数。 */
const delayOf = (style) => {
  const raw = style['--ss-bar-delay'];
  assert.equal(typeof raw, 'string', `填充块应注入 --ss-bar-delay，实际 ${JSON.stringify(style)}`);
  return Number(String(raw).replace('ms', ''));
};

test('#202：收起期间 tick 不重算相位，展开后相位按当下时刻重取', { skip }, async () => {
  const env = installEnvironment();
  try {
    const require = makeRequire();
    const mod = await compileClientModule('client/components/ScheduleDock.tsx', require);
    const react = require.__react;
    const { planBarAnimation } = await loadTranspiled('src/client/bar-geometry.ts');

    const schedules = createSchedules();
    const view = react.__mount(
      react.createElement(mod.ScheduleDock, {
        callCommand: async () => ({ matched: true }),
        sessionId: 'sess-1',
        useProjection: () => ({ schedules }),
        t: (key) => key,
      }),
    );

    // ① 挂载：多条 → 默认收起。读一次树，effect 落地后 phaseAt 已是挂载时刻 T0。
    settle(view);
    const delayAtMount = delayOf(barStyle(view.tree));
    const expected = (now) => {
      const end = Date.parse(schedules[0].scheduled_at);
      const totalMs = WINDOW_MS;
      const start = end - totalMs;
      const plan = planBarAnimation(totalMs, now - start);
      assert.ok(plan !== undefined, `前置：${now} 时刻应有可算的动画计划`);
      return plan.delayMs;
    };
    assert.equal(delayAtMount, expected(T0), '挂载时的相位应由挂载时刻算出');

    // ② 收起状态下过去十分钟、跑十次 tick：相位**必须**保持不变。
    //    这是「不能每次渲染都用 now 重算 delay」那条契约（否则动画每秒多走一秒）。
    const collapsedDock = findNode(view.tree, (node) => node.props?.className === 'ss-dock-header');
    assert.ok(collapsedDock !== null, '多条时应有折叠头');
    for (let i = 0; i < 10; i += 1) {
      env.advance(60_000);
      env.tick();
      settle(view, 2);
      assert.equal(delayOf(barStyle(view.tree)), delayAtMount, `第 ${i + 1} 次 tick 后相位不得变化`);
    }
    assert.equal(delayOf(barStyle(view.tree)), expected(T0), '十次 tick 之后相位仍等于挂载时刻的相位');

    // ③ 点折叠头展开：相位必须按**当下**时刻（T0 + 10min）重取，而不是停在挂载时刻。
    collapsedDock.props.onClick();
    // 展开边沿 → phaseNonce+1 → MultiBar 的 effect 重取相位，两趟展开才落到位。
    settle(view);
    const expandedTree = view.tree;
    const delayAfterExpand = delayOf(barStyle(expandedTree));
    const expectedNow = expected(T0 + 600_000);
    assert.equal(
      delayAfterExpand,
      expectedNow,
      `展开后相位应重取为当下时刻的相位（期望 ${expectedNow}ms，实际 ${delayAfterExpand}ms；`
        + `挂载时的值是 ${delayAtMount}ms——相等就说明相位还停在收起那一刻）`,
    );
    assert.notEqual(delayAfterExpand, delayAtMount, '展开后的相位必须与挂载时不同（否则重取没发生）');

    // ④ 展开之后继续 tick：相位再次冻结（重取只发生在展开这一次）。
    env.advance(60_000);
    env.tick();
    settle(view);
    assert.equal(delayOf(barStyle(view.tree)), expectedNow, '展开后的 tick 不得继续推进相位');
  } finally {
    env.restore();
  }
});

test('#202：展开不重建每一行（MultiBar 组件实例被复用，不是整列重挂载）', { skip }, async () => {
  const env = installEnvironment();
  try {
    const require = makeRequire();
    const mod = await compileClientModule('client/components/ScheduleDock.tsx', require);
    const react = require.__react;
    const schedules = createSchedules();
    const view = react.__mount(
      react.createElement(mod.ScheduleDock, {
        callCommand: async () => ({ matched: true }),
        sessionId: 'sess-1',
        useProjection: () => ({ schedules }),
        t: (key) => key,
      }),
    );

    /** 夹具里 MultiBar 的实例（每行一个）。 */
    const bars = () => view.instances.filter((instance) => instance.component?.name === 'MultiBar');
    settle(view);
    const before = bars();
    assert.equal(before.length, 2, `前置：两条提醒应各有 1 个 MultiBar，实际 ${before.length}`);

    const header = findNode(view.tree, (node) => node.props?.className === 'ss-dock-header');
    assert.ok(header !== null, '前置：多条时应有折叠头');
    header.props.onClick();
    settle(view);

    const after = bars();
    assert.equal(after.length, 2, `展开后仍应只有 2 个 MultiBar，实际 ${after.length}`);
    // 实例对象本身被复用 = React 没有把这一列拆了重建。`key` 变化会走到
    // 「新位置 → 新实例」那条路，这里就会看到一批新对象（数量对得上、身份换掉了）。
    for (const instance of before) {
      assert.ok(after.includes(instance), '展开必须复用原有的行实例（整列重挂载会换掉它们）');
    }
  } finally {
    env.restore();
  }
});
