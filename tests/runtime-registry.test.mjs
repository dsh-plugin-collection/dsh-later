/**
 * runtime 注册表的行为级测试（`no_runtime` 事故的护栏）。
 *
 * 事故形态：提醒能建、dock 能显示，但**到点不触发**；「Send now」报
 * `no_runtime: 该会话尚未挂载用户调度器`。
 *
 * 根因是挂载时机：runtime 只在 `agent/created` 上挂载，而 cordis 重载/热更新、
 * 以及 apply 之后才恢复的会话**都不会重发该事件**。这里用假 agent / 假 runtime
 * 直接验证三条关键行为：
 *
 *   1. **水合**：apply 时已存在的 root agent 必须被挂上（重载后唯一的补挂机会）；
 *   2. **自愈**：表里丢了（模拟重载后清表）时，下一次 drive/ensure 要补挂并生效；
 *   3. **边界**：非 root、teardown 中、attach 失败都不得入表，且必须返回 undefined
 *      —— 让调用方如实报 no_runtime，而不是假装成功；
 *   4. **可撤销**：attach 必须交回 disposer，且 `unmountAll()` 真的执行它 ——
 *      否则重载后旧注册还挂在 agent 上，新实例 attach 会撞内核的同名守卫
 *      （`tool "…" is already registered in this scope`）→ 该会话**永久** no_runtime。
 *      这条是 1.5.0 修完"水合 + 自愈"之后仍然复现 no_runtime 的真因。
 *
 * 这三条若靠"启动宿主点一遍 UI"来验，是测不到的（沙箱里 HMR 不触发，且新会话
 * 天然会收到 created）——这正是该 bug 长期没护栏的原因。
 * @module tests/runtime-registry
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeRegistry } from '../lib/runtime-registry.js';

/** 造一组可观测的依赖。 */
function harness(initialRoots = []) {
  const state = {
    roots: [...initialRoots],
    stopping: false,
    creates: [],
    attachCalls: [],
    /** 已交回的 disposer 被执行的 agent（用于证明"拆的时候真拆了"）。 */
    detachCalls: [],
    driveCalls: [],
    warnings: [],
  };

  const registry = createRuntimeRegistry({
    roots: () => state.roots,
    isStopping: () => state.stopping,
    create: (agent) => {
      state.creates.push(agent.id);
      return { id: agent.id, disposed: false };
    },
    attach: (agent, runtime) => {
      state.attachCalls.push(`${agent.id}:${runtime.id}`);
      return () => {
        state.detachCalls.push(agent.id);
      };
    },
    drive: (runtime) => {
      state.driveCalls.push(runtime.id);
    },
    warn: (message) => {
      state.warnings.push(message);
    },
  });

  return { registry, state };
}

const agent = (id) => ({ id });

test('水合：apply 时已存在的 root agent 全部挂上（重载后唯一的补挂机会）', () => {
  const a = agent('a1');
  const b = agent('a2');
  const { registry, state } = harness([a, b]);

  assert.equal(registry.size(), 0, '水合前表应为空（模拟重载后的 apply）');
  const mounted = registry.hydrate();

  assert.equal(mounted, 2);
  assert.equal(registry.size(), 2);
  assert.deepEqual(state.creates.sort(), ['a1', 'a2']);
  assert.equal(registry.get(a)?.id, 'a1');
});

test('自愈：表被清空（重载）后，下一次 drive 会补挂并真正重驱', async () => {
  const a = agent('a1');
  const { registry, state } = harness([a]);

  registry.hydrate();
  assert.equal(registry.size(), 1);

  // 模拟 teardown/重载：拆掉挂载并清空表，但会话还在（不会重发 agent/created）。
  assert.equal(await registry.unmountAll(), 1, 'unmountAll 应报告拆掉的数量');
  assert.deepEqual(state.detachCalls, ['a1'], 'teardown 必须执行 attach 交回的 disposer');
  assert.equal(registry.size(), 0);

  // 用户此时点「Send now」→ drive → 必须自愈，而不是报 no_runtime。
  const ok = registry.drive(a);

  assert.equal(ok, true, '自愈成功时 drive 必须返回 true');
  assert.equal(registry.size(), 1, '必须重新入表');
  assert.deepEqual(state.creates, ['a1', 'a1'], '应经历一次拆卸后的重新构造');
  assert.deepEqual(state.attachCalls, ['a1:a1', 'a1:a1']);
  assert.deepEqual(state.driveCalls, ['a1'], '补挂后要真的驱动一次');
});

test('边界：非 root agent 不挂载，ensure 返回 undefined（调用方据此报 no_runtime）', () => {
  const root = agent('root');
  const child = agent('child');
  const { registry, state } = harness([root]);

  assert.equal(registry.ensure(child), undefined);
  assert.equal(registry.size(), 0);
  assert.deepEqual(state.creates, [], '非 root 连构造都不该发生');
  assert.equal(registry.drive(child), false, 'drive 失败必须返回 false，不能假装成功');
});

test('幂等：同一 agent 反复 ensure 只构造/接线一次', () => {
  const a = agent('a1');
  const { registry, state } = harness([a]);

  const first = registry.ensure(a);
  const second = registry.ensure(a);

  assert.equal(first, second, '必须返回同一实例');
  assert.deepEqual(state.creates, ['a1']);
  assert.deepEqual(state.attachCalls, ['a1:a1']);
});

test('teardown 守卫：stopping 时拒绝新挂载，复位后可再挂', () => {
  const a = agent('a1');
  const { registry, state } = harness([a]);

  state.stopping = true;
  assert.equal(registry.mount(a), undefined);
  assert.equal(registry.size(), 0, 'teardown 中不得入表');
  assert.deepEqual(state.creates, [], '连构造都不该发生');

  state.stopping = false;
  assert.notEqual(registry.mount(a), undefined);
  assert.equal(registry.size(), 1);
});

test('attach 失败只告警、不入表；下次调用会重试', () => {
  const a = agent('a1');
  const work = harness([a]);
  let fail = true;
  const registry = createRuntimeRegistry({
    roots: () => work.state.roots,
    isStopping: () => work.state.stopping,
    create: (agent) => ({ id: agent.id }),
    attach: () => {
      if (fail) throw new Error('boom');
      return () => {};
    },
    drive: () => {},
    warn: (message) => work.state.warnings.push(message),
  });

  assert.equal(registry.ensure(a), undefined);
  assert.equal(registry.size(), 0, '挂载失败不得留下半成品');
  assert.match(work.state.warnings[0], /a1.*挂载失败.*boom/);

  fail = false;
  assert.notEqual(registry.ensure(a), undefined, '失败后应能重试成功');
  assert.equal(registry.size(), 1);
});

test('forget 只清同一实例：旧 disposer 不能拆掉新挂载', async () => {
  const a = agent('a1');
  const { registry } = harness([a]);

  const oldRuntime = registry.ensure(a);
  await registry.unmountAll();
  const newRuntime = registry.ensure(a);

  assert.notEqual(oldRuntime, newRuntime, '拆卸后应是新实例');
  registry.forget(a, oldRuntime);
  assert.equal(registry.size(), 1, '旧实例的 forget 不得删掉新实例');
  assert.equal(registry.get(a), newRuntime);

  registry.forget(a, newRuntime);
  assert.equal(registry.size(), 0);
});

test('可撤销：模拟内核同名守卫 —— 不先 unmountAll 就再挂，必然失败；先拆则成功', async () => {
  // 这条测试是 `no_runtime` 复发的唯一护栏。它把宿主真实行为搬进假件：
  // 工具注册挂在 agent.ctx 上（跟着 agent 的命），插件重载不会撤掉它，
  // 而内核 NamedEntries.insert 对同名**直接抛错**（dsh-scope/dsh-tools）。
  const registered = new Set();
  const warnings = [];
  const a = agent('a1');
  /** 一次 apply = 一个新注册表实例；`registered` 模拟跨 apply 活着的 agent 注册表。 */
  const applyOnce = () =>
    createRuntimeRegistry({
      roots: () => [a],
      isStopping: () => false,
      create: (agent) => ({ id: agent.id }),
      attach: (agent) => {
        if (registered.has(agent.id)) {
          throw new Error('tool "user_schedule_create" is already registered in this scope');
        }
        registered.add(agent.id);
        return () => registered.delete(agent.id);
      },
      drive: () => {},
      warn: (message) => warnings.push(message),
    });

  const first = applyOnce();
  assert.notEqual(first.mount(a), undefined, '首次挂载应成功');

  // 新 apply：注册表是新建的（旧表随上一次 apply 一起没了），但那份注册**还挂在 agent 上**。
  const second = applyOnce();
  assert.equal(second.mount(a), undefined, '旧注册没拆就重挂，必须撞上同名守卫而失败（= 线上 no_runtime）');
  assert.match(warnings.at(-1) ?? '', /already registered/, '失败要留下可读的告警');

  // 正确姿势：上一次 apply 的 teardown 先 unmountAll，把自己注册的带走。
  assert.equal(await first.unmountAll(), 1);
  assert.notEqual(second.mount(a), undefined, '拆干净后新实例必须能挂上');
});

test('attach 漏交 disposer 会被告警点名（不可撤销 == 重载后必现 no_runtime）', () => {
  const a = agent('a1');
  const warnings = [];
  const registry = createRuntimeRegistry({
    roots: () => [a],
    isStopping: () => false,
    create: (agent) => ({ id: agent.id }),
    // 假件"忘记"返回 disposer —— 类型上不允许，但 JS 调用方/旧测试可能漏。
    attach: () => undefined,
    drive: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.notEqual(registry.mount(a), undefined, '不因此拒绝挂载（那会把能用换成立刻不能用）');
  assert.equal(warnings.length, 1, '但必须喊出来');
  assert.match(warnings[0], /未交回 disposer/);
});

test('roots() 抛错（agents 服务未就绪）按"暂无 root"处理，不向外抛', () => {
  const registry = createRuntimeRegistry({
    roots: () => {
      throw new Error('service not ready');
    },
    isStopping: () => false,
    create: (agent) => ({ id: agent.id }),
    attach: () => () => {},
    drive: () => {},
    warn: () => {},
  });

  assert.equal(registry.hydrate(), 0);
  assert.equal(registry.mount(agent('a1')), undefined);
  assert.equal(registry.size(), 0);
});
