/**
 * 用户调度器挂载的回归测试（`no_runtime` 事故）。
 *
 * 事故形态：提醒创建成功、dock 正常显示，但**到点不触发**；点 dock 的「Send now」
 * 报 `user-schedule-steer-now / no_runtime: 该会话尚未挂载用户调度器`。
 *
 * 根因是挂载时机：
 *   - runtime 只在 `agent/created` 上挂载；
 *   - cordis 重载/热更新（以及 apply 之后才恢复的会话）**不会重发 created**，
 *     于是 runtime 表里没有该 agent；
 *   - 创建路径 `notifyUserChange` 用了可选链 `?.`，缺 runtime 时**静默**跳过武装
 *     （所以"能建、能显示、不触发"），而 steer 路径是硬错误（`no_runtime`）。
 *
 * 修法：挂载收敛成 `mountRuntime` 一份；`apply` 末尾对既有 roots 水合；
 * `notifyUserChange` / `notifyUserSteer` 走 `ensureRuntime` 按需自愈。
 *
 * 本文件锁这四条接线——它们任一丢失，事故形态就会回来（而且**不会变红**：
 * 表现是"安静的到点不响"，正是这个 bug 当初没被发现的原因）。
 * @module tests/runtime-hydration
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

/** 取某函数/箭头函数附近的源码片段（用于断言其内部接线）。 */
function sliceAround(source, marker, span = 1600) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `源码里找不到锚点：${marker}`);
  return source.slice(index, index + span);
}

test('挂载逻辑只有一份：agent/created 委托给 mountRuntime，不再内联', () => {
  const handler = sliceAround(host, "ctx.on('agent/created'", 600);
  assert.match(handler, /mountRuntime\(agent\)/, 'agent/created 必须调用 mountRuntime(agent)');
  assert.doesNotMatch(
    handler,
    /new UserScheduleRuntime\(/,
    'agent/created 里不得再内联构造 runtime —— 挂载逻辑必须只有一份，否则水合/自愈会各写一套',
  );
});

test('apply 末尾对既有 root agent 水合（重载后既有会话不再收到 created）', () => {
  assert.match(
    host,
    /for \(const agent of safeRoots\(\)\) mountRuntime\(agent\);/,
    'apply 末尾必须对既有 roots 逐个 mountRuntime —— 这是插件重载后唯一的补挂机会',
  );
  // 水合必须发生在 apply 内、且在所有 notify*/命令注册之后，不能再有早退挡在前面。
  const lifecycleIndex = host.indexOf("'later.userToolsLifecycle()'");
  const hydrateIndex = host.indexOf('for (const agent of safeRoots()) mountRuntime(agent);');
  assert.ok(lifecycleIndex !== -1 && hydrateIndex > lifecycleIndex, '水合应在生命周期 effect 注册之后');
});

test('创建/插话路径按需自愈：ensureRuntime，而不是裸查表', () => {
  const notifyChange = sliceAround(host, 'const notifyUserChange =', 700);
  assert.match(notifyChange, /ensureRuntime\(agent\)\?\.requestDrive\(\)/, 'notifyUserChange 必须 ensureRuntime 后再 requestDrive');
  assert.doesNotMatch(
    notifyChange,
    /runtimes\.get\(agent\)\?\.requestDrive\(\)/,
    '不允许退回裸查表 —— 那会让"错过 created 的会话"永远不武装定时器（静默不触发）',
  );

  const notifySteer = sliceAround(host, 'const notifyUserSteer =', 900);
  assert.match(notifySteer, /const runtime = ensureRuntime\(agent\);/, 'notifyUserSteer 必须先 ensureRuntime');
});

test('mountRuntime 是幂等且被守卫的（stopping / 已存在 / 非 root 都不得重复挂载）', () => {
  const body = sliceAround(host, 'const mountRuntime =', 2600);
  assert.match(body, /if \(stopping\) return undefined;/, 'teardown 中不得挂载');
  assert.match(body, /const existing = runtimes\.get\(agent\);/, '必须先查已有 runtime');
  assert.match(body, /if \(existing !== undefined\) return existing;/, '必须幂等返回既有实例');
  assert.match(body, /if \(!safeRoots\(\)\.includes\(agent\)\) return undefined;/, '非 root agent（如子 agent）不挂载');
  assert.match(body, /runtimes\.set\(agent, runtime\);/, '挂载成功后必须登记进表');
});

test('no_runtime 仍作为最后一道错误保留（自愈失败才报，不得静默吞掉）', () => {
  const notifySteer = sliceAround(host, 'const notifyUserSteer =', 1200);
  assert.match(notifySteer, /code: 'no_runtime'/, '自愈失败时仍要如实报 no_runtime，不能返回假成功');
  // 命令注册在 commands.ts（index.ts 只注入回调）；名字是客户端 dock 的硬依赖。
  const commands = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  assert.match(commands, /-steer-now/, 'steer-now 命令仍须注册（客户端 dock 依赖该命令名）');
  const dock = readFileSync(new URL('../src/client/components/ScheduleDock.tsx', import.meta.url), 'utf8');
  assert.match(dock, /user-schedule-steer-now/, '客户端 dock 仍按该命令名发插话');
});

test('safeRoots 在服务未就绪时返回空而不是抛错', () => {
  const body = sliceAround(host, 'const safeRoots =', 400);
  assert.match(body, /try \{/, '必须 try 包裹 ctx.agents.roots()');
  assert.match(body, /catch \{\s*return \[\];\s*\}/, '服务未就绪时应返回空数组（apply 早期可能还没有 agents 服务）');
});
