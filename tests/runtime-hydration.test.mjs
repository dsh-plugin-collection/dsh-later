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

test('teardown 走 drain（清表并交给调用方 dispose）', () => {
  const lifecycle = sliceAround(host, "const stopCreated = ctx.on('agent/created'", 900);
  assert.match(lifecycle, /stopping = true;/, 'teardown 必须先置 stopping，阻止新挂载');
  assert.match(lifecycle, /runtimeRegistry\.drain\(\)/, 'teardown 必须 drain 注册表');
  assert.match(lifecycle, /Promise\.allSettled/, '逐个 dispose 且不因单个失败中断');
});
