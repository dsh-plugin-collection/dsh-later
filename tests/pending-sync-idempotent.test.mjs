/**
 * `useSchedules` 的 hook 契约与本地暂存幂等（Gitea issue #203）。
 *
 * ## 两条被测行为
 *
 * 1. **hook 槽位恒定**。`useInput` / `useProjection` 在类型上是可选的宿主标准件，
 *    旧实现按「这一帧有没有」分支调用；宿主某帧不给 input 快照，槽位数就从 N 掉到
 *    N-1，React 抛 `Rendered more/fewer hooks than during the previous render`，
 *    按钮与面板整棵子树被卸载（用户看到的是入口直接消失，没有任何报错文案）。
 * 2. **暂存投递幂等**。旧实现把待发队列放进 state 并让它当投递 effect 的依赖：
 *    一条成交 → setState → 重渲染 → cleanup 把 `cancelled` 置真 → 正在 await 的下一条
 *    回来时不 removePending（**但命令已经送达**）→ 恢复网络后又投一遍。
 *
 * ## 做法
 *
 * 走 `tests/smart-window-settings.test.mjs` 那条真实执行路线：esbuild 现场编译
 * `src/client/hooks/useSchedules.ts`（连同它 import 的 local-store / strings /
 * useStableHook 一起打进同一份 bundle），配一个**照搬 React hook 簿记**的迷你运行时
 * （上一轮占用几个槽位、本轮再多要一个就抛 React 那句原话；cleanup 在依赖变化时真的
 * 执行）。不读源码 + 正则——正则对"槽位数随帧变化"这件事天然是瞎的。
 *
 * 迷你运行时不复用 `tests/helpers/settings-render-harness.mjs`：那一份明确写着
 * 「cleanup 丢弃：本夹具不验卸载」，而本条的核心根因恰恰是 **cleanup 真的会跑**。
 * @module tests/pending-sync-idempotent.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const canBuild = existsSync(join(repoRoot, 'node_modules/esbuild'));
const skip = canBuild ? false : 'node_modules/esbuild 不在（本测需要在内存里编译客户端 hook）';

/* ── 1. 迷你 React：hook 簿记照抄 React，effect cleanup 真的执行 ───────────────── */

/**
 * 创建运行时。
 *
 * `claim()` 复刻 React 的判据：上一轮走完的槽位数是 `hookCount`，本轮 cursor 越过它
 * 还在索取 → 抛同一句错误。少了这条，「槽位数随帧变化」就会静默通过。
 *
 * `render(props)` 把 props 交给同一个组件函数并渲染到收敛；`rt.props` 是下一次渲染读到的
 * 注入面（宿主换帧时用它模拟）。
 */
function createRuntime() {
  let rt = null;
  let cur = null;

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
      const hook = { value: typeof initial === 'function' ? initial() : initial, set: null };
      hook.set = (next) => {
        const prev = hook.value;
        const value = typeof next === 'function' ? next(prev) : next;
        // React 的 eager bailout：算出同一个值不重渲染（否则「无需变化时原样返回」的
        // 写法会在这个运行时里自己转起来）。
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
    if (prev === undefined || !depsSame(prev.deps, deps)) {
      const hook = { cleanup: undefined, deps };
      inst.hooks[i] = hook;
      rt.effects.push({
        hook,
        fn,
        // 依赖变化或卸载时真的跑上一轮的 cleanup —— 这正是旧实现「cancelled 自噬」的机制。
        prevCleanup: prev !== undefined && typeof prev.cleanup === 'function' ? prev.cleanup : null,
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

  const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();

  function instanceFor(fn) {
    if (rt.instance === undefined || rt.instance.fn !== fn) {
      rt.instance = { fn, props: null, hooks: [], cursor: 0, hookCount: 0, rendered: false, dirty: false };
    }
    return rt.instance;
  }

  function performRender(inst) {
    inst.cursor = 0;
    const saved = cur;
    cur = inst;
    inst.props = rt.props;
    const result = inst.fn(inst.props);
    cur = saved;
    // React 两个方向都管：多要一个槽位、以及**少要一个**，都会立刻抛错并卸载子树。
    // 旧实现的病根是「按帧求值的 if」，缺这个反向判据时它反而能静默通过。
    if (inst.rendered && inst.cursor < inst.hookCount) {
      throw new Error('Rendered fewer hooks than expected. This may be caused by an accidental early return statement.');
    }
    inst.hookCount = inst.cursor;
    inst.rendered = true;
    inst.dirty = false;
    return result;
  }

  function flushEffects() {
    const queue = rt.effects;
    rt.effects = [];
    for (const eff of queue) {
      if (eff.prevCleanup !== null) eff.prevCleanup();
      eff.hook.cleanup = eff.fn();
    }
  }

  /** 渲染到收敛：effect 里改 state 引发的重渲染会继续跑，直到没人喊脏。 */
  function render(fn) {
    if (rt === null) rt = { instance: undefined, effects: [], props: {} };
    for (let guard = 0; ; guard += 1) {
      const inst = instanceFor(fn);
      performRender(inst);
      flushEffects();
      if (!inst.dirty) break;
      if (guard > 40) throw new Error('渲染未收敛（effect 里无条件 setState？）');
    }
  }

  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
  });

  return {
    react: {
      createElement,
      Fragment: 'Fragment',
      useState,
      useEffect,
      useLayoutEffect: useEffect,
      useRef,
      useCallback,
      useMemo,
      useId: () => ':id',
      useSyncExternalStore,
    },
    jsxRuntime: { jsx: createElement, jsxs: createElement, Fragment: 'Fragment' },
    render,
    /**
     * 设定下一次渲染的注入面。
     *
     * 语义上等价于「宿主这一帧换了 props」：上一次渲染里的 effect 已被跑过，下一帧由
     * `claim()` 检查槽位是否与上一轮一致。
     */
    setProps(props) {
      if (rt === null) rt = { instance: undefined, effects: [], props: {} };
      rt.props = props;
    },
    /** 这一帧的注入面（组件函数里读它就是读 props）。 */
    props() {
      return rt === null ? undefined : rt.props;
    },
  };
}

/* ── 2. 编译 hook（连同它 import 的叶子模块）────────────────────────────────────── */

async function compileHook(runtime) {
  const result = await build({
    entryPoints: ['src/client/hooks/useSchedules.ts'],
    absWorkingDir: repoRoot,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
    external: ['react'],
  });
  const code = result.outputFiles[0].text;
  const module = { exports: {} };
  const require = (id) => {
    if (id === 'react') return runtime.react;
    throw new Error(`unexpected host require: ${id}`);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}

/* ── 3. 环境桩：localStorage + window（'online' 事件）─────────────────────────── */

function installEnv() {
  const saved = { window: globalThis.window, localStorage: globalThis.localStorage };
  const store = new Map();
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const listeners = new Map();
  const win = {
    innerHeight: 800,
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== fn));
    },
  };
  globalThis.window = win;
  globalThis.localStorage = localStorage;
  return {
    store,
    localStorage,
    fire(type) {
      for (const fn of listeners.get(type) ?? []) fn({ type });
    },
    listenerCount: (type) => (listeners.get(type) ?? []).length,
    restore() {
      if (saved.window === undefined) delete globalThis.window;
      else globalThis.window = saved.window;
      if (saved.localStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = saved.localStorage;
    },
  };
}

/** 让出若干轮微任务：投递循环是 async 的。 */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** 读 localStorage 里的待发队列。 */
/**
 * 把「外部事件 + effect 里 setState」这一串推到底。
 *
 * 真实 React 里 `setState` 会自己排队一次重渲染；本运行时只在 `render()` 里检查脏位，
 * 所以**事件驱动的重渲染要显式补一帧**。这不是被测行为的一部分，是夹具的约定——
 * 少了它会得出「online 事件没起效」的假结论（而真实浏览器里它是起效的）。
 */
const pump = async (runtime, Probe) => {
  for (let i = 0; i < 8; i += 1) {
    runtime.render(Probe);
    await settle(2);
  }
};

const pendingOnDisk = (env) => {
  const raw = env.localStorage.getItem('dsh-later:pending');
  return raw === null ? [] : JSON.parse(raw);
};

/* ── 4. 用例 ─────────────────────────────────────────────────────────────────── */

test('#203：宿主某帧不给 input 快照时，hook 槽位数不得变化', { skip }, async () => {
  const runtime = createRuntime();
  const env = installEnv();
  try {
    const { useSchedules } = await compileHook(runtime);
    const commands = [];
    const callCommand = async (_sessionId, line) => {
      commands.push(line);
      return { matched: true };
    };
    let result;
    const Probe = function Probe() {
      result = useSchedules(runtime.props());
      return null;
    };
    /** 组件读渲染入参的唯一入口：把 props 塞到实例上再渲染。 */
    const frame = (props) => {
      runtime.setProps(props);
      runtime.render(Probe);
    };

    // 首帧：宿主给了 useInput。
    // 首帧：宿主给了 useInput，但**没给 owner 快照**（否则 `input.draft` 会短路掉 hook）。
    frame({
      callCommand,
      sessionId: 'sess-1',
      useProjection: () => ({ schedules: [] }),
      useInput: (select) => select({ draft: 'hi' }),
    });
    assert.equal(result.draft, 'hi', '首帧应从 useInput 读到草稿');

    // 第二帧：宿主这一帧没给 useInput。旧实现在这里走 `typeof useInput === 'function'`
    // 的另一支 → 槽位少一个 → 本运行时的 claim() 抛 React 那句原话。
    frame({ callCommand, sessionId: 'sess-1', useProjection: () => ({ schedules: [] }) });
    // 冻结后这一帧仍调用首帧那个 hook，读到它自己闭包着的那份 store（'hi'）——
    // 语义上等价于「宿主不再刷新 input 快照，界面停在最后一次已知值」。要紧的是
    // **没有抛 hook 数错误**，以及槽位数与上一帧一致（claim() 已经在检查）。
    assert.equal(result.draft, 'hi', 'hook 身份冻结：这一帧继续用首帧那个 hook，槽位数不变');
    assert.equal(commands.length, 0, '渲染路径不得投递任何命令');

    // 第三帧：useInput 又回来了（但换了身份）。冻结后仍用首帧那一个，槽位继续恒定。
    frame({
      callCommand,
      sessionId: 'sess-1',
      useProjection: () => ({ schedules: [] }),
      useInput: (select) => select({ draft: 'again' }),
    });
    assert.equal(result.draft, 'hi', '身份冻结：继续用首帧那个 hook（而不是每帧换新的）');

    // 第四帧：连 useProjection 也没了 —— 同样不得改变槽位数。
    frame({ callCommand, sessionId: 'sess-1', input: { draft: 'typed' } });
    assert.equal(result.draft, 'typed', 'owner 快照优先，且 useProjection 缺失时 schedule 列表退化为空');
    assert.deepEqual(result.schedules, []);

    // 反向自证：违规形态必须真的能被这个运行时抓红，否则上面几句是永真断言。
    const offenderRuntime = createRuntime();
    let flag = false;
    const Offender = function Offender() {
      offenderRuntime.react.useState(0);
      if (flag) offenderRuntime.react.useState(1);
      return null;
    };
    offenderRuntime.render(Offender);
    let message = '(未抛错)';
    flag = true;
    try {
      offenderRuntime.render(Offender);
    } catch (error) {
      message = String(error?.message);
    }
    assert.match(message, /Rendered more hooks than during the previous render/, '运行时必须真能抓「多要一个槽位」');
    // 另一头：少要一个槽位同样必须能抓（旧实现正是这一支）。
    const fewerRuntime = createRuntime();
    let fewerFlag = false;
    const Fewer = function Fewer() {
      fewerRuntime.react.useState(0);
      if (fewerFlag) fewerRuntime.react.useState(1);
      return null;
    };
    fewerRuntime.render(Fewer);
    fewerFlag = false;
    // 第二帧把分支关掉 → 槽位少一个。
    let fewerMessage = '(未抛错)';
    try {
      const Fewer2 = function Fewer2() {
        fewerRuntime.react.useState(0);
        if (fewerFlag) fewerRuntime.react.useState(1);
        return null;
      };
      fewerFlag = true;
      fewerRuntime.render(Fewer2);
      fewerFlag = false;
      fewerRuntime.render(Fewer2);
    } catch (error) {
      fewerMessage = String(error?.message);
    }
    assert.match(fewerMessage, /Rendered fewer hooks than expected/, '运行时必须真能抓「少要一个槽位」');
  } finally {
    env.restore();
  }
});

test('#203：断网建 2 条 → 恢复网络 → 宿主只收到 2 条 create，且 localStorage 清空', { skip }, async () => {
  const runtime = createRuntime();
  const env = installEnv();
  try {
    const { useSchedules } = await compileHook(runtime);

    /**
     * 假命令通道：`online === false` 时回 `matched:false`（等效断网 / 宿主异常）。
     * 只统计**被受理**的 create —— 用例要断言的是「送达了几次」，不是「试了几次」。
     */
    let online = false;
    const accepted = [];
    const attempted = [];
    const callCommand = async (_sessionId, line) => {
      attempted.push(line);
      if (!online) return { matched: false };
      accepted.push(line);
      return { matched: true };
    };

    let result;
    const Probe = function Probe() {
      result = useSchedules(runtime.props());
      return null;
    };
    runtime.setProps({ callCommand, sessionId: 'sess-1', input: { draft: 'hi' }, useProjection: () => ({ schedules: [] }) });
    runtime.render(Probe);

    // 断网建两条：未被受理 → 降级写盘并抛稳定令牌。
    for (const prompt of ['第一条', '第二条']) {
      await assert.rejects(() => result.handleCreate({ prompt, after_seconds: 600 }));
    }
    const onDisk = pendingOnDisk(env);
    assert.equal(onDisk.length, 2, `断网时应把 2 条都写进 localStorage，实际 ${onDisk.length}`);
    assert.deepEqual(onDisk.map((item) => item.payload.prompt), ['第一条', '第二条']);
    assert.equal(accepted.length, 0, '断网期间不该有任何一条被受理');

    // 恢复网络：'online' → 投递循环重跑一轮。
    online = true;
    env.fire('online');
    await pump(runtime, Probe);

    assert.equal(accepted.length, 2, `恢复网络后应恰好送达 2 条，实际 ${accepted.length} 条：${accepted.join(' | ')}`);
    assert.equal(pendingOnDisk(env).length, 0, '送达即清盘——旧实现 cleanup 把 cancelled 置真后漏删第二条');
    // 两条内容不同且都送到：不靠「数量对上了」掩盖「同一条投了两遍」。
    assert.equal(new Set(accepted).size, 2, '两条必须是不同的 create，不能是同一条投两遍');

    // 再放一次 'online'：队列已空，不得再投。
    env.fire('online');
    await pump(runtime, Probe);
    assert.equal(accepted.length, 2, '空队列上的 online 事件不得重复投递');
    assert.equal(attempted.length, 4, `断网 2 次 + 恢复后 2 次 = 4 次尝试，实际 ${attempted.length}`);
    assert.equal(env.listenerCount('online'), 1, 'online 监听必须活到卸载（拆开后不该被某轮 cleanup 撤掉）');
  } finally {
    env.restore();
  }
});

test('#203：投递中途被拒时停下并保留剩余队列，下一次 online 继续投', { skip }, async () => {
  const runtime = createRuntime();
  const env = installEnv();
  try {
    const { useSchedules } = await compileHook(runtime);

    /**
     * 命令通道用**一个可变的 `mode`** 描述宿主状态，而不是换 `callCommand` 的实现：
     * `handleCreate` 被 `useCallback` 记住了首帧那个 `callCommand`，事后改 props 不动它
     * （真实 React 里也一样——依赖没变就不重建）。用 mode 才能只改「宿主怎么回」。
     */
    let mode = 'offline';
    const accepted = [];
    const callCommand = async (_sessionId, line) => {
      if (mode === 'offline') return { matched: false };
      if (mode === 'failFirst') {
        mode = 'online'; // 只失败这一次，随后恢复正常
        return { matched: false };
      }
      accepted.push(line);
      return { matched: true };
    };

    let result;
    const Probe = function Probe() {
      result = useSchedules(runtime.props());
      return null;
    };
    runtime.setProps({ callCommand, sessionId: 'sess-1', input: { draft: 'hi' }, useProjection: () => ({ schedules: [] }) });
    runtime.render(Probe);

    // 断网期间建两条：两条都写盘。
    for (const prompt of ['甲', '乙']) {
      await assert.rejects(() => result.handleCreate({ prompt, after_seconds: 600 }));
    }
    assert.equal(pendingOnDisk(env).length, 2, '前置：两条都在盘上');

    // 网络恢复，但**第一条就被拒**：循环必须停下，不能把第二条也试一遍再停。
    mode = 'failFirst';
    env.fire('online');
    await pump(runtime, Probe);
    assert.equal(accepted.length, 0, '第一条被拒时循环必须停下（不许继续试第二条）');
    assert.equal(pendingOnDisk(env).length, 2, '全部失败时队列一条都不该被删');

    // 第二次 online：宿主恢复，两条都送出去。
    mode = 'online';
    env.fire('online');
    await pump(runtime, Probe);
    assert.equal(accepted.length, 2, `恢复后应补投 2 条，实际 ${accepted.length}`);
    assert.equal(new Set(accepted).size, 2, '必须是两条不同的 create（不能同一条投两遍）');
    assert.equal(pendingOnDisk(env).length, 0, '全部送达后盘上应为空');
  } finally {
    env.restore();
  }
});
