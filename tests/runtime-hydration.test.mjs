/**
 * 调度器挂载的**接线守卫**（`no_runtime` 事故）。
 *
 * 行为本身由 `tests/runtime-registry.test.mjs` 用假件验证；本文件只锁 `index.ts`
 * 必须怎么接——因为接线一旦被"顺手重构"掉，行为测试仍然全绿，而线上又回到
 * "提醒能建、到点不响、Send now 报 no_runtime"。
 *
 * 事故回顾：runtime 只在 `agent/created` 挂载，而重载/热更新与"apply 之后才恢复
 * 的会话"都不会重发 created；创建路径又用可选链静默吞掉缺失，于是故障是**无声的**。
 * @module tests/runtime-hydration
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const commands = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const dock = readFileSync(new URL('../src/client/components/ScheduleDock.tsx', import.meta.url), 'utf8');
const readDict = readFileSync(new URL('../src/strings.ts', import.meta.url), 'utf8');

/** 取锚点后的源码片段。 */
function sliceAround(source, marker, span = 1200) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `源码里找不到锚点：${marker}`);
  return source.slice(index, index + span);
}

test('apply 末尾必须水合既有 root agent（重载后唯一的补挂机会）', () => {
  const hydrateIndex = host.indexOf('runtimeRegistry.hydrate();');
  assert.notEqual(hydrateIndex, -1, 'apply 必须调用 runtimeRegistry.hydrate()');
  const lifecycleIndex = host.indexOf("'later.userToolsLifecycle()'");
  assert.ok(lifecycleIndex !== -1 && hydrateIndex > lifecycleIndex, '水合应在生命周期 effect 注册之后');
});

test('agent/created 只做委托，不得在入口里内联构造 runtime', () => {
  const handler = sliceAround(host, "ctx.on('agent/created'", 400);
  assert.match(handler, /runtimeRegistry\.mount\(agent\)/, 'created 必须委托 runtimeRegistry.mount');

  // 唯一构造点应在注册表的 create 回调里；入口其他地方不得再 new。
  const constructions = host.match(/new UserScheduleRuntime\(/g) ?? [];
  assert.equal(constructions.length, 1, 'new UserScheduleRuntime 只应出现在注册表 create 回调里');
  assert.match(host, /create: \(agent\) => new UserScheduleRuntime\(/, '构造应作为 create 依赖注入');
});

test('创建路径走 drive（自愈），不得退回裸查表 + 可选链', () => {
  const notifyChange = sliceAround(host, 'const notifyUserChange =', 500);
  assert.match(notifyChange, /runtimeRegistry\.drive\(agent\)/, 'notifyUserChange 必须 drive（内含自愈）');
  assert.doesNotMatch(notifyChange, /runtimes\.get\(agent\)\?\./, '不得退回裸查表 —— 那会重新变成"静默不触发"');
});

test('插话路径先 ensure 再决定，自愈失败才报 no_runtime', () => {
  const notifySteer = sliceAround(host, 'const notifyUserSteer =', 900);
  assert.match(notifySteer, /const runtime = runtimeRegistry\.ensure\(agent\);/, 'notifyUserSteer 必须先 ensure（自愈）');
  assert.match(notifySteer, /code: 'no_runtime'/, '自愈失败仍须如实报 no_runtime，不得返回假成功');

  // 命令名是客户端 dock 的硬依赖。
  assert.match(commands, /-steer-now/, 'steer-now 命令仍须注册');
  assert.match(dock, /user-schedule-steer-now/, '客户端 dock 仍按该命令名发插话');
});

test('teardown 走 unmountAll（执行自己交回的 disposer，把 agent 上的注册带走）', () => {
  const lifecycle = sliceAround(host, "const stopCreated = ctx.on('agent/created'", 900);
  assert.match(lifecycle, /stopping = true;/, 'teardown 必须先置 stopping，阻止新挂载');
  assert.match(lifecycle, /await runtimeRegistry\.unmountAll\(\)/, 'teardown 必须 unmountAll —— 只 dispose runtime 不够');
  // 回到"只 dispose runtime"就是本次事故的复发形态：注册留在 agent.ctx 上，
  // 下一次 apply 的 attach 撞内核同名守卫 → 该会话永久 no_runtime。
  assert.doesNotMatch(lifecycle, /runtimeRegistry\.drain\(\)/, '不得退回 drain() + 手工 dispose');
});

test('attach 必须把 agent.ctx.effect 的 disposer 交回，不得丢弃', () => {
  const attach = sliceAround(host, 'attach: (agent, runtime) =>', 1400);
  assert.match(attach, /const disposeMount = agent\.ctx\.effect\(/, 'effect 返回值必须接住');
  assert.match(attach, /return \(\) => disposeMount\(\);/, '必须把 disposer 交回注册表');
  // 反面：直接 `agent.ctx.effect(...)` 不接返回值 == 本次挂载不可撤销。
  assert.doesNotMatch(attach, /^\s*agent\.ctx\.effect\(/m, '不得丢弃 effect disposer');
});

test('创建路径必须把"调度器未挂载"说出来（#71 的病根是安静）', () => {
  const notify = sliceAround(host, 'const notifyUserChange =', 500);
  assert.match(notify, /: boolean =>/, 'notifyUserChange 必须回报是否挂上');

  const tools = sliceAround(host, 'const armScheduler =', 400);
  assert.match(tools, /return onUserChange\(target\)/, '工具侧要有统一的"重驱并回报"入口');
  assert.match(host, /warning: t\.warnSchedulerNotArmed/, 'user_schedule_create 的结果要带 warning');
  assert.match(commands, /notArmed/, '/later 与 /schedule 的成功文案要带上告警');
  assert.match(readDict, /warnSchedulerNotArmed/, '告警文案走双语字典，不硬编码在逻辑里');
});
