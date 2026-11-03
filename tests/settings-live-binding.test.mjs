/**
 * 设置「允许长文本 / 上限」的实时绑定接线回归测试（GitHub issue #9）。
 *
 * ## 这条缝为什么以前量不到
 *
 * 现象：设置页打开「允许长文本」并把上限改成 10000 后，`/later` 发 1204 字仍被拒
 * 「提醒内容不能超过 1000 字符。」，而工具路径能收。
 *
 * 根因不在校验逻辑（`user-tools.ts` 的 `resolvePromptLimits` 一直是对的），而在
 * **宿主入口的装配时序**：`src/index.ts` 里 `getSettings` 原本是一个会被重新赋值的
 * `let`。cordis 的 `ctx.effect` **同步**执行 body、而 `ctx.inject(['settings'], cb)` 的
 * 回调延后一个微任务（`fiber.ts` 的 `_reload()` 先 `await Promise.resolve()` 再
 * `_execute`）。于是 effect 里读到并**按值传进三个注册点**的，永远是那一刻的
 * `() => startSettings`——设置服务到位后重新赋值追不回来。三个捕获点：
 *   1. `:757` `registerUserScheduleCommands(ctx, getSettings, …)`（斜杠命令，报告人只发现这一处）
 *   2. `:692` `create: (agent) => new UserScheduleRuntime(ctx, agent, getSettings)`
 *   3. `:703` `registerUserScheduleTools(ctx, agent.ctx, agent, getSettings, …)`
 * 其中 :692/:703 只在**插件 apply 时已存在、走 `hydrate()` 挂载**的会话上触发；后果被
 * 放大：`src/runtime.ts:183` 把该 getter 存成实例字段，投递口径（steerDelivery /
 * confirmDelivery / onUnconfirmed）连会话一起冻结。
 *
 * 修法是「稳定入口」：`const getSettings = () => readLive()`，函数身份永不变，注入路径
 * 只更新内部 `readLive`；三处调用点一行不改。
 *
 * ## 本文件测什么、怎么测
 *
 * 这是本仓**第一次驱动真实装配**的测试：用真 `@deepseek-ai/cordis` 的 `Context` + 真
 * `lib/` 起一个假宿主（provide 顶层 inject 要求的 5 个服务），`ctx.plugin(...)` 走完整
 * `apply()`，让 `ctx.inject(['settings'])` 回调真的执行（靠 `flush` 让出微任务），再在
 * **注册之后**改设置，读回注册出来的命令 / 工具 / runtime 实际拿到的那个 getter。
 * 现有的命令面测试都把数字/getter **直接**塞进 `userScheduleCommands` 工厂，绕过了
 * apply()，所以全绿也抓不到这条缝——本文件用正向断言（读到更新后的值）写成反证：
 * 把改动 revert 回 `let getSettings` 时，注册点冻结成 `() => startSettings`，
 * 1204 字会被拒、runtime 投递口径不会变，本文件即挂。
 *
 * 覆盖：
 *  - 轨道 1（0.2.0+ `describe()` + `settings/document-updated`）的 `applies:'live'` 热改语义；
 *  - 轨道 2（0.1.5 及更早 `settings.yaml` 体系）的 `scope.get()` 语义；
 *  - settings 服务**先于 / 后于**插件就绪两种时序；
 *  - 三个捕获点：命令（:757）、工具（:703）、runtime（:709，投递口径）。
 *
 * 没覆盖（诚实标注）：
 *  - 工具 description 不再插值注册时刻的 `maxChars`（改由文案说明上限随设置变化，见 fix/tool-desc-no-stale-limit）；
 *    所以这里断言的是工具 `execute` 在**调用时**读的实时校验口径，不是那条写死的描述。
 *  - 真 `dsh` 冷启动（完整内核树）由 `scripts/verify-across-kernels.mjs` 负责，不在单测里。
 * @module tests/settings-live-binding
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import * as plugin from '../lib/index.js';
import { UserScheduleRuntime } from '../lib/runtime.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

/** 让微任务（含 cordis `_reload` 的 `await Promise.resolve()`）与已 unref 的定时器各跑一轮。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

/** 1204 字：> 默认 1000、<= 设置页可填的 10000。 */
const LONG = 'x'.repeat(1204);
/** 触发长度闸门的报错文案片段（默认上限 1000）。 */
const TOO_LONG = /不能超过 1000 字符/;

/**
 * 捕获 `apply()` 在 :709 经 `runtimeRegistry.create` 构造的 `UserScheduleRuntime` 实例。
 * 注册表是 apply 的局部量、不外露；这里改 prototype 的 `requestDrive`（attach 里同步调用）
 * 把 `this` 记下来，再读其软私有字段 `getSettings`（编译后是普通属性 `this.getSettings`）。
 */
const runtimes = [];
{
  const proto = UserScheduleRuntime.prototype;
  if (!proto.__liveBindingCaptureInstalled) {
    const original = proto.requestDrive;
    proto.requestDrive = function patched() {
      runtimes.push(this);
      return original.call(this);
    };
    proto.__liveBindingCaptureInstalled = true;
  }
}

/** 造一个可被 hydrate 挂载的假 root agent：attach 需要 agent.ctx.effect/on/tools。 */
function makeAgent(toolsSvc) {
  const agent = {
    id: `agent-${Math.random().toString(36).slice(2, 8)}`,
    session: {
      header: { id: `sess-${Math.random().toString(36).slice(2, 8)}` },
      events: [],
      append(type, data) {
        this.events.push({ type, data });
      },
    },
    whenIdle: async () => undefined,
  };
  agent.ctx = {
    // 与 cordis ctx.effect 同形：body 同步执行、交回 disposer。
    effect(execute) {
      const ret = execute();
      return () => {
        if (typeof ret === 'function') return ret();
        return undefined;
      };
    },
    on: () => () => undefined,
    tools: toolsSvc,
  };
  return agent;
}

/** 轨道 1 假 settings（0.2.0+ SettingsForms）：只有 describe()，值来自可变 raw。 */
const track1Service = (raw) => ({
  describe: () => [{ ns: 'later', value: { ...raw } }],
});

/** 轨道 2 假 settings（0.1.5 settings.yaml）：register() 返回 scope.get()，无 describe()。 */
const track2Service = (raw) => ({
  register: () => ({ get: () => ({ ...raw }) }),
});

const pluginObj = {
  apply: plugin.apply,
  inject: plugin.inject,
  name: plugin.name,
  Config: plugin.Config,
};

/**
 * 起一次真装配。
 * @param settingsService - 假的 ctx.settings 服务（决定走哪条轨道）。
 * @param settingsFirst - true：settings 先于插件就绪；false：插件先 pending，settings 后到。
 * @returns 注册出来的命令/工具表、假 agent、fiber、根 ctx。
 */
async function bootAssembly(settingsService, settingsFirst) {
  const defs = new Map();
  const commandsSvc = {
    register(definition) {
      defs.set(definition.name, definition);
      return () => defs.delete(definition.name);
    },
  };
  const toolsSvc = {
    register(tool) {
      defs.set(`tool:${tool.name}`, tool);
      return () => defs.delete(`tool:${tool.name}`);
    },
  };
  const agent = makeAgent(toolsSvc);

  const ctx = new Context();
  ctx.provide('agents', { roots: () => [agent], get: () => agent });
  ctx.provide('sessions', { flush: async () => true });
  ctx.provide('tools', toolsSvc);
  ctx.provide('commands', commandsSvc);

  runtimes.length = 0;
  let fiber;
  if (settingsFirst) {
    ctx.provide('settings', settingsService);
    fiber = await ctx.plugin(pluginObj, {});
  } else {
    // 故意不给 settings：顶层 inject 门控让入口停在 PENDING、apply 根本不跑。
    fiber = ctx.plugin(pluginObj, {});
    await flush();
    ctx.provide('settings', settingsService); // 现在才到齐 → 激活 → apply → hydrate → attach
    await fiber;
  }
  // 让 ctx.inject(['settings']) 回调（微任务）真的执行完，readLive 才被重新绑定。
  await flush();
  return { ctx, defs, agent, fiber };
}

/** 通过注册出来的 /later 命令发一条长内容，返回命令结果。 */
async function runLater(defs, agent, text) {
  return defs.get('later').handler({
    commandId: 'cmd-live-binding',
    agent,
    rawInput: `+5m ${text}`,
    attachments: [],
    signal: new AbortController().signal,
  });
}

// ── 1. 轨道 1 · settings 先到 ────────────────────────────────────────────────

test('轨道1·settings先到：注册后把上限改成 10000，/later 1204 字应被收（反证冻结 getter 会拒）', async () => {
  freshOwnershipDir();
  const raw = { maxSchedules: 20, allowLongPrompts: false, maxPromptChars: 1000 };
  const { defs, agent, fiber } = await bootAssembly(track1Service(raw), true);
  try {
    // 注册时刻读到的是默认 1000：此时 1204 字**必须**被拒——证明闸门真的读设置，而非写死 10000。
    const before = await runLater(defs, agent, LONG);
    assert.equal(before.kind, 'error', '未开长文本时 1204 字应被拒');
    assert.match(String(before.text), TOO_LONG);

    // 用户现在才去设置页打开开关、填 10000（发生在注册**之后**，正是 bug 的触发窗口）。
    raw.allowLongPrompts = true;
    raw.maxPromptChars = 10000;
    const after = await runLater(defs, agent, LONG);
    assert.equal(after.kind, 'success', `注册后就地改设置，命令必须读到更新后的 maxPromptChars：${String(after.text).slice(0, 80)}`);

    // :709 的 runtime 实例也读到更新后的投递口径（报告人没发现的、被一起冻结的那条）。
    raw.steerDelivery = 'steer';
    raw.onUnconfirmed = 'discard';
    const runtime = runtimes[0];
    assert.ok(runtime, 'hydrate 应经 runtimeRegistry.create 构造过 runtime');
    assert.equal(runtime.getSettings().steerDelivery, 'steer', 'runtime 投递口径必须实时');
    assert.equal(runtime.getSettings().onUnconfirmed, 'discard', 'runtime 未确认处理必须实时');
  } finally {
    await fiber.dispose();
  }
});

// ── 2. 轨道 1 · settings 后到 ────────────────────────────────────────────────

test('轨道1·settings后到：晚到的设置服务一样绑定到注册出来的命令上', async () => {
  freshOwnershipDir();
  const raw = { maxSchedules: 20, allowLongPrompts: true, maxPromptChars: 10000 };
  const { defs, agent, fiber } = await bootAssembly(track1Service(raw), false);
  try {
    // 门控：插件先 pending，settings 后到时 apply 才跑；inject 回调再晚一个微任务才绑 readLive。
    // 走到这里 inject 已跑完（flush 过），故注册点拿到的稳定入口应读到 10000。
    const res = await runLater(defs, agent, LONG);
    assert.equal(res.kind, 'success', `晚到的设置也应实时生效：${String(res.text).slice(0, 80)}`);
  } finally {
    await fiber.dispose();
  }
});

// ── 3. 工具捕获点 :703（真 attach 注册的 user_schedule_create）────────────────

test('工具注册（:703）：注册后就地放开长文本，user_schedule_create 的 execute 收到 1204 字', async () => {
  freshOwnershipDir();
  const raw = { maxSchedules: 20, allowLongPrompts: false, maxPromptChars: 1000 };
  const { defs, agent, fiber } = await bootAssembly(track1Service(raw), true);
  try {
    const tool = defs.get('tool:user_schedule_create');
    assert.ok(tool, 'hydrate 挂载 root agent 时应注册 user_schedule_create');

    // 调用时读实时：先证明默认闸门按设置拒绝。
    const rejected = JSON.parse(await tool.execute({ prompt: LONG, after_seconds: 300 }, { agent }));
    assert.equal(rejected.ok, false);
    assert.match(String(rejected.message), TOO_LONG);

    // 注册后改设置 → 工具 execute 读到 10000 → 收。
    raw.allowLongPrompts = true;
    raw.maxPromptChars = 10000;
    const accepted = JSON.parse(await tool.execute({ prompt: LONG, after_seconds: 300 }, { agent }));
    assert.equal(accepted.ok, true, `工具 execute 必须读更新后的 maxPromptChars：${JSON.stringify(accepted).slice(0, 100)}`);
  } finally {
    await fiber.dispose();
  }
});

// ── 4. 轨道 2 · 0.1.5 settings.yaml（scope.get）──────────────────────────────

test('轨道2·scope.get：register() 体系下注册后就地改设置，命令读到更新后的 maxPromptChars', async () => {
  freshOwnershipDir();
  const raw = { maxSchedules: 20, allowLongPrompts: false, maxPromptChars: 1000 };
  const { defs, agent, fiber } = await bootAssembly(track2Service(raw), true);
  try {
    const before = await runLater(defs, agent, LONG);
    assert.match(String(before.text), TOO_LONG, '轨道2 默认上限也应拒绝 1204 字');

    raw.allowLongPrompts = true;
    raw.maxPromptChars = 10000;
    const after = await runLater(defs, agent, LONG);
    assert.equal(after.kind, 'success', `轨道2 的 scope.get() 语义必须保住：${String(after.text).slice(0, 80)}`);
  } finally {
    await fiber.dispose();
  }
});

// ── 5. 轨道 1 · document-updated 热改订阅 ────────────────────────────────────

test('轨道1·settings/document-updated：document 更新事件重新绑定后仍是实时读取', async () => {
  freshOwnershipDir();
  const raw = { maxSchedules: 20, allowLongPrompts: false, maxPromptChars: 1000 };
  const { ctx, defs, agent, fiber } = await bootAssembly(track1Service(raw), true);
  try {
    // 宿主在 describe 检测到变化时发该事件；这里模拟用户改设置并触发事件。
    raw.allowLongPrompts = true;
    raw.maxPromptChars = 10000;
    ctx.emit('settings/document-updated', 'later');
    await flush();
    const res = await runLater(defs, agent, LONG);
    assert.equal(res.kind, 'success', `document-updated 后热改语义须在：${String(res.text).slice(0, 80)}`);
  } finally {
    await fiber.dispose();
  }
});

// ── 6. 稳定入口的形状不变式（防回归到 let 重新赋值）───────────────────────────

test('稳定入口：同一个 apply 里注册出来的命令与工具，读取的是同一份实时设置（非注册时刻快照）', async () => {
  freshOwnershipDir();
  const raw = { maxSchedules: 20, allowLongPrompts: false, maxPromptChars: 1000 };
  const { defs, agent, fiber } = await bootAssembly(track1Service(raw), true);
  try {
    // 改到边界值：maxPromptChars=1204，恰好收得下 LONG（1204 <= 1204）。
    raw.allowLongPrompts = true;
    raw.maxPromptChars = LONG.length;
    const cmd = await runLater(defs, agent, LONG);
    const tool = JSON.parse(await defs.get('tool:user_schedule_create').execute({ prompt: LONG, after_seconds: 300 }, { agent }));
    assert.equal(cmd.kind, 'success', '命令读到更新后的边界值');
    assert.equal(tool.ok, true, '工具读到同一份更新后的边界值');
    // LONG+1 仍应拒：证明读到的是 1204 这个**更新值**，而不是「开长文本=无上限」。
    const over = await runLater(defs, agent, 'x'.repeat(LONG.length + 1));
    assert.equal(over.kind, 'error', '超过更新后的 maxPromptChars 应拒');
  } finally {
    await fiber.dispose();
  }
});

// ── 7. 工具描述不再带注册时刻的硬编码上限（fix/tool-desc-no-stale-limit）──────

test('注册出来的 user_schedule_create 描述里不含注册时刻的数字上限', async () => {
  freshOwnershipDir();
  // 注册时设置是「关长文本、1000」，注册后就地放开到 10000：
  // 若描述仍是注册时刻快照，模型会看到「≤1000 字符」而实际能收 10000。
  const raw = { maxSchedules: 20, allowLongPrompts: false, maxPromptChars: 1000 };
  const { defs, agent, fiber } = await bootAssembly(track1Service(raw), true);
  try {
    raw.allowLongPrompts = true;
    raw.maxPromptChars = 10000;
    const tool = defs.get('tool:user_schedule_create');
    assert.ok(tool, '工具应已注册');
    const promptDesc = String(tool.parameters?.properties?.prompt?.description ?? '');
    const text = `${String(tool.description ?? '')} ${promptDesc}`;
    assert.ok(text.length > 0, '描述不应为空');
    assert.doesNotMatch(text, /\{\s*maxChars\s*\}/, '描述里不应残留未插值的 {maxChars} 占位符');
    assert.doesNotMatch(text, /[≤<>]=?\s*\d+\s*(字符|characters)/i, '描述不应把注册时刻的数字当成当前硬上限');
    assert.match(promptDesc, /设置|允许长文本|allow long|plugin setting/i, '应说明上限随插件设置变化');
  } finally {
    await fiber.dispose();
  }
});
