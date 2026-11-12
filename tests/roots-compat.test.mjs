/**
 * root agent 判定的跨代契约（0.2.2-rc.2 删掉 `AgentRegistry.roots()` 之后的护栏）。
 *
 * ## 为什么需要这组用例
 *
 * rc.1 的 `roots()` 是 `[...store.values()].filter(e => e.owner === undefined).map(e => e.agent)`
 * ——它读的是**注册表里的运行时关系**（创建时有没有 owner context）。rc.2 的 store entry
 * 只剩 `{id, agent, carrier, announced, announcing, detachRequested}`，owner 关系**不可见**，
 * `roots()` 整个方法也没了，注册表只剩 `get(id)` / `list()`（`list()` 含子代理）。
 *
 * 于是「只认 root」这条判定必须在两代上各有一套可用的判据，且**rc.1 必须逐字保持旧行为**。
 * 本机 devDependencies 是 0.2.1-rc.2（有 `roots()`），rc.2 那条分支**永远不会**在常规回归里
 * 被执行——所以它只能靠这里用假 registry 直接喂两种形状来守。
 *
 * ## 判据的权威依据
 *
 * 替身判据是会话头的 `delegationDepth`。dsh-session 的 `SessionHeader` 文档原文：
 * 「Delegation depth: absent (zero) for a top-level session, parent depth + 1 for a subagent
 * child. Persisted so a recursion budget survives restart and resume」。
 * 同一份文档明确说 `parentSession` **不能**当判据（「Presence alone does not classify a
 * Session as a subagent; use `origin` for that distinction」），所以这里刻意不造
 * 「只有 parentSession、没有 depth」的用例去要求某种结论。
 *
 * 断言的是**行为**，因此 import `lib/`（构建产物）：`npm test` 前跑了 `npm run build`，
 * 而且判据同时被宿主侧（index/runtime）消费，测的应当是它们真正加载的那份。
 * @module tests/roots-compat
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isRootAgent,
  isRootAgentShape,
  liveRootAgents,
  readDelegationDepth,
} from '../lib/upstream-compat.js';

/** 造一个 agent 假件（只带判定会读到的字段）。 */
function makeAgent(id, { depth, origin, runtimeDepth } = {}) {
  const header = {};
  if (depth !== undefined) header.delegationDepth = depth;
  if (origin !== undefined) header.origin = origin;
  const agent = { id, session: { header } };
  if (runtimeDepth !== undefined) agent.options = { subagentDepth: runtimeDepth };
  return agent;
}

// ── 形状 A：0.2.2-rc.1（注册表有 roots()）────────────────────────────────────

/**
 * rc.1 形状的假注册表：`roots()` 只含顶层 agent（对应宿主按 `owner === undefined` 过滤），
 * `list()` 含全部 live agent。owner 关系**只有** `roots()` 说得出来。
 */
function rc1Registry({ roots, all }) {
  const calls = { roots: 0, list: 0 };
  return {
    calls,
    registry: {
      roots: () => {
        calls.roots += 1;
        return roots.slice();
      },
      list: () => {
        calls.list += 1;
        return all.slice();
      },
      get: (id) => all.find((agent) => agent.id === id),
    },
  };
}

test('形状A（rc.1）：有 roots() 时走 roots()，与宿主逐字同义', () => {
  const root = makeAgent('root-a', { depth: 0 });
  const child = makeAgent('child-a', { depth: 1 });
  const { registry, calls } = rc1Registry({ roots: [root], all: [root, child] });

  assert.equal(isRootAgent(registry, root), true);
  assert.equal(isRootAgent(registry, child), false, '子代理不在 roots() 里');
  assert.deepEqual(liveRootAgents(registry), [root]);
  assert.deepEqual(calls.list, 0, '有 roots() 时不得退到 list()');
});

test('形状A（rc.1）：roots() 说了算，不被会话头的 delegationDepth 二次否决', () => {
  // resume 出来的 fork 子会话可以带着 delegationDepth > 0 被重新登记为顶层 root
  // （宿主文档：a resumed fork may still be a root）。rc.1 上若先读深度再问 roots()，
  // 这类会话会被误判成子代理 —— 这条用例钉住「roots() 优先且不回退」。
  const resumed = makeAgent('resumed-fork', { depth: 2 });
  const { registry } = rc1Registry({ roots: [resumed], all: [resumed] });
  assert.equal(isRootAgent(registry, resumed), true);
  assert.deepEqual(liveRootAgents(registry), [resumed]);
});

test('形状A（rc.1）：roots() 抛错时按「不是 root」处理，不向外抛', () => {
  const root = makeAgent('root-a');
  const registry = {
    roots: () => {
      throw new Error('agents 服务未就绪');
    },
    list: () => [root],
  };
  assert.equal(isRootAgent(registry, root), false);
  assert.deepEqual(liveRootAgents(registry), []);
});

// ── 形状 B：0.2.2-rc.2（注册表没有 roots()，只有 get()/list()）──────────────────

/** rc.2 形状的假注册表：**故意不定义 roots**，list() 里 root 与子代理混在一起。 */
function rc2Registry(all) {
  return {
    list: () => all.slice(),
    get: (id) => all.find((agent) => agent.id === id),
  };
}

test('形状B（rc.2）：没有 roots() 时按 delegationDepth 判 root / 子代理', () => {
  const top = makeAgent('top', { depth: undefined }); // 顶层会话：字段可缺席（= 0）
  const zero = makeAgent('zero', { depth: 0 });
  const child = makeAgent('child', { depth: 1 });
  const grandchild = makeAgent('grandchild', { depth: 2 });
  const registry = rc2Registry([top, zero, child, grandchild]);

  assert.equal('roots' in registry, false, '前提：rc.2 形状里没有 roots');
  assert.equal(isRootAgent(registry, top), true, 'absence = zero，是 root');
  assert.equal(isRootAgent(registry, zero), true);
  assert.equal(isRootAgent(registry, child), false);
  assert.equal(isRootAgent(registry, grandchild), false);
});

test('形状B（rc.2）：list() 里 root 与子代理并存时过滤正确（owner 不可见）', () => {
  // 这正是 rc.1 靠 owner 字段能分开、rc.2 只能靠 depth 分开的那个场景。
  const rootA = makeAgent('root-a', { depth: 0 });
  const rootB = makeAgent('root-b', { depth: undefined });
  const child1 = makeAgent('child-1', { depth: 1 });
  const child2 = makeAgent('child-2', { depth: 1 });
  const grandchild = makeAgent('grandchild', { depth: 2 });
  const registry = rc2Registry([rootA, child1, rootB, grandchild, child2]);

  assert.deepEqual(liveRootAgents(registry), [rootA, rootB], '只留顶层，顺序随 list()');
  for (const child of [child1, child2, grandchild]) {
    assert.equal(isRootAgent(registry, child), false, `${child.id} 不该被当成 root`);
  }
});

test('形状B（rc.2）：不在 list() 里的 agent 不是 root（已 disposed / 陌生实例）', () => {
  const root = makeAgent('root-a', { depth: 0 });
  const stranger = makeAgent('stranger', { depth: 0 });
  const registry = rc2Registry([root]);

  assert.equal(isRootAgent(registry, root), true);
  assert.equal(isRootAgent(registry, stranger), false, 'depth 为 0 但不在 live 表里');
});

test('形状B（rc.2）：运行期 options.subagentDepth 与 header 取较大者', () => {
  // 宿主内部有 options.subagentDepth 这个运行期字段（与上游 delegationDepthOf 同义）；
  // 头部还没落盘时它是唯一可读的那个，取值必须保守（任一侧说是子代理就是子代理）。
  const runtimeOnly = makeAgent('runtime-only', { depth: undefined, runtimeDepth: 1 });
  const headerOnly = makeAgent('header-only', { depth: 1 });
  const bothZero = makeAgent('both-zero', { depth: 0, runtimeDepth: 0 });
  const registry = rc2Registry([runtimeOnly, headerOnly, bothZero]);

  assert.equal(readDelegationDepth(runtimeOnly), 1);
  assert.equal(readDelegationDepth(headerOnly), 1);
  assert.equal(readDelegationDepth(bothZero), 0);
  assert.deepEqual(liveRootAgents(registry), [bothZero]);
});

test('形状B（rc.2）：header.origin === "subagent" 时即使 depth 缺席也判非 root', () => {
  // 文档把 origin 定为「是不是子代理」的判据；depth 缺席（老日志 / 未落头）时用它兜底，
  // 避免把一个明确标了 subagent 的会话当成顶层。
  const labeled = makeAgent('labeled', { depth: undefined, origin: 'subagent' });
  const registry = rc2Registry([labeled]);
  assert.equal(isRootAgentShape(labeled), false);
  assert.equal(isRootAgent(registry, labeled), false);
  assert.deepEqual(liveRootAgents(registry), []);
});

test('形状B（rc.2）：非法 depth 一律当 0，不因脏数据把 root 判丢或判错', () => {
  const nan = makeAgent('nan', { depth: Number.NaN });
  const negative = makeAgent('negative', { depth: -1 });
  const stringy = makeAgent('stringy', { depth: '1' });
  const infinity = makeAgent('infinity', { depth: Number.POSITIVE_INFINITY });
  const registry = rc2Registry([nan, negative, stringy, infinity]);

  assert.equal(readDelegationDepth(nan), 0);
  assert.equal(readDelegationDepth(negative), 0);
  assert.equal(readDelegationDepth(stringy), 0);
  assert.equal(readDelegationDepth(infinity), 0);
  assert.deepEqual(liveRootAgents(registry), [nan, negative, stringy, infinity]);
});

test('形状B（rc.2）：delegationDepth 缺失（undefined）必须判 root —— 最易犯的丢 root 坑', () => {
  // `delegationDepth` 是 optional，文档语义是「absent = 0」。任何写成 `depth === 0` 或
  // `depth !== undefined && depth > 0` 之外的严格比较都会让 **undefined !== 0** 成立、
  // 把真正的顶层会话全部丢掉（症状是 rc.2 上一个 root 都挂不上：提醒能建、到点不响）。
  // 这里刻意只造「header 只有 id、连 delegationDepth 键都没有」的形状。
  const bare = { id: 'bare', session: { header: {} } };
  const noHeaderAtAll = { id: 'no-header' };
  const registry = rc2Registry([bare, noHeaderAtAll]);

  assert.equal(readDelegationDepth(bare), 0);
  assert.equal(isRootAgentShape(bare), true);
  assert.equal(isRootAgent(registry, bare), true);
  assert.equal(isRootAgent(registry, noHeaderAtAll), true, '连 session 都没有也按顶层处理');
  assert.deepEqual(liveRootAgents(registry), [bare, noHeaderAtAll]);
});

// ── 两代共同：异常面一律不向外抛 ────────────────────────────────────────────

test('agents 为 undefined / null 时不抛，按「没有 root」处理', () => {
  const agent = makeAgent('root-a', { depth: 0 });
  for (const absent of [undefined, null]) {
    assert.equal(isRootAgent(absent, agent), false);
    assert.deepEqual(liveRootAgents(absent), []);
  }
});

test('agent 为 undefined / null 时不抛', () => {
  const { registry } = rc1Registry({ roots: [], all: [] });
  const rc2 = rc2Registry([]);
  for (const absent of [undefined, null]) {
    assert.equal(isRootAgent(registry, absent), false);
    assert.equal(isRootAgent(rc2, absent), false);
  }
});

test('list() 抛错 / 两代方法都不存在时不抛', () => {
  const agent = makeAgent('root-a', { depth: 0 });
  const throwing = {
    list: () => {
      throw new Error('boom');
    },
  };
  assert.equal(isRootAgent(throwing, agent), false);
  assert.deepEqual(liveRootAgents(throwing), []);

  // 连 list() 都没有（服务形状不符 / 半装配）：只能判否，不能抛。
  assert.equal(isRootAgent({}, agent), false);
  assert.deepEqual(liveRootAgents({}), []);
});

test('读会话头本身抛错时 isRootAgent 不抛出', () => {
  const broken = {
    id: 'broken',
    get session() {
      throw new Error('session getter 炸了');
    },
  };
  const registry = rc2Registry([broken]);
  assert.equal(isRootAgent(registry, broken), false);
  assert.deepEqual(liveRootAgents(registry), []);
});

test('{ roots: 非函数 }（属性存在但不可调用）按没有 roots() 处理', () => {
  // 能力探测必须是 `typeof === 'function'`，不能是 `'roots' in registry`：
  // 上游若哪天把它改成数据属性，`in` 判据会在调用处抛。
  const root = makeAgent('root-a', { depth: 0 });
  const child = makeAgent('child', { depth: 1 });
  const registry = { roots: undefined, list: () => [root, child] };
  assert.deepEqual(liveRootAgents(registry), [root]);
  assert.equal(isRootAgent(registry, child), false);
});
