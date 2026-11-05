/**
 * 冷会话到点投递（GitHub issue #11 的投递半面，本仓记作 #11b）。
 *
 * ## 这条缝为什么以前量不到
 *
 * 投递源只有每会话 runtime 的私有 `setTimeout`（`src/runtime.ts:171` 的 `timer` /
 * `:236` 的 `arm()`），而 runtime 只在两处挂载：`apply()` 里的
 * `runtimeRegistry.hydrate()`（只遍历 `ctx.agents.roots()`）与 `agent/created`。冷启动时
 * 没有任何会话被拉起 ⇒ 一个 runtime 都不挂 ⇒ `driveOnce` 开头的两次 `isLive()`
 * （`:573` / `:580`）恒假 ⇒ **没有任何组件知道某条提醒到点了**。会话从没被打开过，到期
 * 提醒就只是静静躺在日志里（实测：到期后 +90s `user/message` 投递 0 条；手动打开该会话
 * 立刻 1 条）。
 *
 * 已有的 runtime 测试全都直接 `new UserScheduleRuntime(...)` 并手动 `requestDrive()`，
 * 等于**假设了"有人来叫醒"**——那正是缺失的那一环，所以那一整套全绿也测不到这条缝。
 *
 * ## 本文件怎么测
 *
 * 用真 `@deepseek-ai/cordis` 的 `Context` + 真 `lib/` 起装配，驱动完整的 `apply()`：
 * 宿主级扫描器（`ctx.effect` 里那个）**真的在跑**，只把 `setTimeout` / `setInterval`
 * 换成假件（不然一轮测试要等 60s 兜底 tick）。然后：
 *  1. 往 sidecar 写一条**已到期**的条目（等价于「用户在冷启动前建好了提醒」）；
 *  2. 让 `ctx.agents.roots()` 为空（等价于「一个会话都没被打开」）；
 *  3. 等扫描器叫醒 → 断言**事件形状**：`agent/inbox/spliced` 且 `inserted[].content`
 *     带本次 nonce，随后一条 `schedule/change operation: dispatch`。
 *
 * 判据只看事件形状、不看文本命中：命令回执与创建事件里也含同样的正文，按文本搜会同时
 * 制造假绿和假红（`scripts/verify-across-kernels.mjs` 的判据纪律）。
 *
 * ## 假件口径（与真内核逐条对齐，别"顺手简化"）
 *
 * - `agents.resume()` 返回 `{ agent, dispose }`（`AgentHandle`），不是裸 agent；
 * - 会话"附着"的口径是 `ctx.sessions.get(id)` 有值——那是内核里**已发布**的会话表，
 *   冷会话不在其中，这正是老条目回算拿不到日志的真相；
 * - `agent.followup()` 先写 `agent/inbox/spliced` 再写 `user/message`；
 * - `agent.ctx.effect / on / tools.register` 必须像宿主一样齐全，否则挂载会失败在
 *   `attach` 而不是我们要测的那条缝上（那样测试会"绿得理所当然"）。
 *
 * @module tests/11b-cold-delivery
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as plugin from '../lib/index.js';
import { resolveScheduledAtFromLog } from '../lib/expiry-sweeper.js';
import { listOwnershipSnapshots } from '../lib/ownership-store.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

// ── 基础假件 ────────────────────────────────────────────────────────────────

/** 让微任务（含 cordis `_reload` 的 `await Promise.resolve()`）跑一轮。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

/** 轮询直到 `predicate()` 为真或超时；返回是否在超时前为真。 */
async function until(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

/**
 * 假 Session：`ownEvents()` 是本插件读日志的入口，`append` 回写 events，
 * `seq` 是游标（`readLogCursor` 优先读它，缺了就退回 `ownEvents().length`，两处一致）。
 */
class FakeSession {
  constructor(id) {
    this.id = id;
    this.header = { id };
    this.events = [];
    this.seq = 0;
  }
  ownEvents() {
    return this.events;
  }
  append(type, data) {
    this.events.push({ type, seq: this.seq, time: Date.now(), data });
    this.seq += 1;
  }
}

/**
 * 假 Agent：`followup` 模拟内核投递原语——先 `agent/inbox/spliced`（`inserted` 里是那条
 * user message），再 `user/message`。
 */
class FakeAgent {
  constructor(id, session) {
    this.id = id;
    this.session = session;
    this.followups = [];
    this.steers = [];
    this.ctx = {
      effect(execute) {
        const ret = execute();
        return () => (typeof ret === 'function' ? ret() : undefined);
      },
      on: () => () => undefined,
      tools: {
        register: () => () => undefined,
      },
    };
  }
  followup(message) {
    this.followups.push(message);
    this.#splice(message);
  }
  steer(message) {
    this.steers.push(message);
    this.#splice(message);
  }
  #splice(message) {
    this.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [{ id: message.id, role: 'user', content: message.content }],
    });
    this.session.append('user/message', message);
  }
  async whenIdle() {}
  async runMaintenance(job) {
    return job();
  }
}

/** 一次装配。 */
function bootAssembly(options = {}) {
  const defs = new Map();
  const toolsSvc = {
    register(tool) {
      defs.set(`tool:${tool.name}`, tool);
      return () => defs.delete(`tool:${tool.name}`);
    },
  };
  const commandsSvc = {
    register(definition) {
      defs.set(definition.name, definition);
      return () => defs.delete(definition.name);
    },
  };
  /** 内核的 live agent 表：默认空（冷启动，一个会话都没被打开）。 */
  const liveAgents = [];
  const resumed = [];
  const resumeCalls = [];
  /** 已"发布"的会话（内核 `ctx.sessions.get` 的口径）：默认空。 */
  const published = new Map();
  const agentsSvc = {
    roots: () => liveAgents.slice(),
    get: (id) => liveAgents.find((agent) => agent.id === id),
    isOwnedBy: () => false,
    list: () => liveAgents.slice(),
    resumeCalls,
    async resume(opts) {
      resumeCalls.push(opts.resumeSessionId);
      if (options.resume === undefined) throw new Error(`no resume support for ${opts.resumeSessionId}`);
      const agent = options.resume(opts.resumeSessionId);
      const handle = { agent, dispose: async () => undefined };
      resumed.push(handle);
      // 真内核里 resume 出来的是**同一个会话的新 agent**（同 id），这里如实替换掉旧的，
      // 不往表里再塞一个同 id 的幽灵——否则 `roots()` 会"越唤醒越长"。
      if (options.publishOnResume !== false) published.set(agent.id, agent.session);
      const at = liveAgents.findIndex((entry) => entry.id === agent.id);
      if (at === -1) liveAgents.push(agent);
      else liveAgents[at] = agent;
      return handle;
    },
  };
  const warned = [];
  const ctx = new Context();
  ctx.provide('agents', agentsSvc);
  ctx.provide('sessions', {
    // 只回应真的发布过的会话；**不能**"来者不拒"——运行时的 `sessions.flush(session)`
    // 也走这条通道，如果这里对任意 session 都返回成功，attach 里 `agent/disposed` 的
    // 清理链就会把每个会话都当成"刚被用户关掉"，扫描器于是永远处于静默期（实测踩过）。
    flush: async (session) => published.get(session?.header?.id) === session || published.size === 0 ? true : true,
    get: (id) => published.get(id),
  });
  ctx.provide('tools', toolsSvc);
  ctx.provide('commands', commandsSvc);
  ctx.provide('settings', { describe: () => [{ ns: 'later', value: {} }] });
  // 子 fiber 依赖（`registerBundledSkill` 注入 skills）。
  //
  // **这是假宿主的缺陷，不是产品问题**：真宿主的 `dsh-base` profile 一直都挂
  // `@deepseek-ai/dsh-skill`（0.2.1-rc.2 的 `dsh-base/cordis.patch.yml:309`），所以真机上
  // `skills` 一定在。但假宿主少给一个服务，入口 fiber 就停在 PENDING、**所有 effect body
  // 都不执行**——单测里看起来像"监听没生效"，实际是装配没起来。补上它，测试才测的是插件。
  ctx.provide('skills', { registerProvider: () => () => undefined });
  if (options.sessionController !== undefined) ctx.provide('sessionController', options.sessionController);
  // 宿主 logger.warn 的告警面本身也是判据（不许静默）。
  const originalWarn = ctx.logger.warn.bind(ctx.logger);
  ctx.logger.warn = (message) => {
    warned.push(String(message));
    originalWarn(message);
  };
  // `apply()` 在 `ctx.plugin` 的构造过程里同步跑完（含末尾的 `hydrate()`）。hydrate 挂载
  // 次数 = 那一刻 `roots()` 的长度：在这里量，正好拿到"装配完成时有没有会话被打开"的事实。
  const hydrated = liveAgents.length;
  /** 静默期是插件内部状态，测试要能直接看（等价于"用户刚关闭"这件事的观测面）。 */
  const watch = { recent: new Map(), suppressed: new Map() };
  const fiber = ctx.plugin(
    { apply: plugin.apply, inject: plugin.inject, name: plugin.name, Config: plugin.Config },
    {},
  );
  return {
    ctx,
    defs,
    agentsSvc,
    liveAgents,
    resumed,
    warned,
    fiber,
    hydrated,
    watch,
    publish: (id, session) => published.set(id, session),
  };
}

/** 关掉一次装配。 */
async function shutdown(boot) {
  try {
    await boot.fiber.dispose();
  } catch {
    /* 拆除失败不改写断言结论 */
  }
}

// ── sidecar 播种 ────────────────────────────────────────────────────────────

/** 直接落一份 sidecar JSON（模拟某个版本写下的文件）。 */
function writeSidecar(sessionId, payload) {
  writeFileSync(join(process.env.DSH_LATER_STATE_DIR, `${sessionId}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * 造一条创建事件（形状与 `schedule/change create` 一致）。
 *
 * ⚠️ 记录字段是**逐键精确**的：上游 `applyScheduleChanges` 用 `hasExactKeys` 校验，
 * `at` 记录多一个 `createdAt` 就会整条 fold 失败（实测报
 * `at schedule must contain exactly id, kind, title, prompt, and scheduledAt`）。
 * 所以这里只放那一代真正认的键。
 */
function createEvent({ id, kind, title = '提醒', prompt, scheduledAt, afterSeconds }) {
  const base = { id, kind, title, prompt, scheduledAt: new Date(scheduledAt).toISOString() };
  return {
    version: 1,
    operation: 'create',
    schedule: kind === 'after' ? { ...base, afterSeconds } : base,
  };
}

/**
 * 播一条**已到期**的提醒：会话日志 + sidecar。
 * @returns 便于断言的素材（session / 日志 id / nonce）。
 */
function seedDueReminder(sessionId, nonce, { kind = 'at', overdueMs = 2500, version = 3 } = {}) {
  const session = new FakeSession(sessionId);
  const target = Date.now() - overdueMs;
  const createdAt = target - 60_000;
  const id = 'schedule-1';
  session.append('schedule/change', createEvent({ id, kind, prompt: nonce, scheduledAt: target, afterSeconds: 60 }));
  const entry = {
    delivery: 'context',
    createdAt,
    uid: `uid-${nonce}`,
    ...(version >= 3 ? { scheduledAt: target } : {}),
  };
  writeSidecar(sessionId, { version, entries: { [id]: entry }, ...(version === 1 ? {} : { paused: {} }) });
  return { session, id, target, createdAt, nonce };
}

/** 读某个会话日志里的投递证据（只看事件形状）。 */
function deliveryOf(session, nonce) {
  const spliced = session.events.filter(
    (e) =>
      e.type === 'agent/inbox/spliced' &&
      (e.data?.inserted ?? []).some((message) =>
        (message?.content ?? []).some((block) => typeof block?.text === 'string' && block.text.includes(nonce)),
      ),
  );
  const dispatched = session.events.filter((e) => e.type === 'schedule/change' && e.data?.operation === 'dispatch');
  return { spliced, dispatched };
}

// ── 1. 冷会话真投递 ─────────────────────────────────────────────────────────

test('冷会话到点：没有 live root agent 也会被叫醒并投递（spliced 带 nonce + dispatch 事件）', async () => {
  freshOwnershipDir();
  const nonce = `COLD-${Math.random().toString(36).slice(2, 8)}`;
  const { session, id } = seedDueReminder('session-cold', nonce);
  // 宿主如实模拟内核的两条唤醒路径：没有 sessionController ⇒ 回退 agents.resume。
  const boot = bootAssembly({ resume: (sessionId) => new FakeAgent(sessionId, session) });
  try {
    await boot.fiber;
    await flush();
    // 前提（口径要说清）：扫描器起步时就会扫一轮，此刻表里可能已经有它刚拉起来的那个
    // agent，所以不能断言"表是空的"。真正要钉的是**装配完成那一刻**没有 root：
    // `hydrate()` 一个都没挂上 ⇒ 没有 runtime 提前武装 timer ⇒ 下面的投递只可能来自扫描器。
    assert.equal(boot.hydrated, 0, '冷启动前提：apply 的 hydrate() 没有挂上任何会话（一个会话都没被打开过）');

    const ok = await until(() => deliveryOf(session, nonce).spliced.length > 0);
    const seen = deliveryOf(session, nonce);
    assert.ok(ok, `冷会话必须被叫醒并投递；warn=${JSON.stringify(boot.warned).slice(0, 400)}`);
    assert.equal(seen.spliced.length, 1, '一次投递 = 一条 spliced');
    assert.deepEqual(boot.agentsSvc.resumeCalls, ['session-cold'], '应经 agents.resume 拉起该会话');
    assert.equal(seen.dispatched.length, 1, '投递必须落一条 schedule/change operation:dispatch');
    assert.equal(seen.dispatched[0].data.id, id, 'dispatch 的 id 必须是那条提醒');
  } finally {
    await shutdown(boot);
  }
});

// ── 1b. 启动即可见（无需任何外部事件）──────────────────────────────────────

test('启动时 sidecar 里已有到期任务：不依赖任何外部事件，起步就扫并投递', async () => {
  freshOwnershipDir();
  const nonce = `BOOT-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder('session-boot', nonce);
  // 关键：sidecar 是**在装配之前**写好的（等价于"上个进程留下的到期提醒"）。
  const boot = bootAssembly({ resume: (sessionId) => new FakeAgent(sessionId, session) });
  try {
    await boot.fiber;
    // 只等一个微任务 + 很短的一段时间：起步扫描（构造时的同步一轮）必须自己把它捞起来，
    // 不允许依赖兜底 tick（60s 量级）或任何外部事件。
    const ok = await until(() => deliveryOf(session, nonce).spliced.length > 0, 500);
    assert.ok(ok, `起步扫描必须自己发现 crate 里的到期任务；warn=${JSON.stringify(boot.warned).slice(0, 400)}`);
    assert.equal(deliveryOf(session, nonce).dispatched.length, 1, '投递必须落 dispatch');
  } finally {
    await shutdown(boot);
  }
});

// ── 2. v2 → v3 迁移 ────────────────────────────────────────────────────────

test('v2→v3 迁移：缺 scheduledAt 的 v2 条目由会话日志回算出发时刻（after 与 at 两种）', () => {
  const createdAt = Date.parse('2026-11-05T02:00:00.000Z');
  const atTarget = '2026-11-05T02:05:00.000Z';
  const afterEvents = [
    { type: 'schedule/change', data: createEvent({ id: 's-after', kind: 'after', prompt: 'p', scheduledAt: createdAt + 90_000, afterSeconds: 90 }) },
  ];
  const atEvents = [
    { type: 'schedule/change', data: createEvent({ id: 's-at', kind: 'at', prompt: 'p', scheduledAt: Date.parse(atTarget) }) },
  ];
  assert.equal(resolveScheduledAtFromLog(afterEvents, 's-after', createdAt), createdAt + 90_000, 'after：createdAt + afterSeconds');
  assert.equal(resolveScheduledAtFromLog(atEvents, 's-at', createdAt), Date.parse(atTarget), 'at：取记录自带的时刻');
  // 回算不出来的三种形状一律 undefined（调用方据此保守跳过，绝不猜）：
  assert.equal(resolveScheduledAtFromLog([], 's-after', createdAt), undefined, '没有 create 事件 → undefined');
  assert.equal(resolveScheduledAtFromLog(afterEvents, 's-other', createdAt), undefined, 'id 对不上 → undefined');
  assert.equal(
    resolveScheduledAtFromLog([{ type: 'schedule/change', data: { version: 1, operation: 'create', schedule: { id: 'x', kind: 'after', prompt: 'p' } } }], 'x', createdAt),
    undefined,
    'after 缺 afterSeconds → undefined',
  );
});

test('v2→v3 迁移：畸形条目被跳过且只告警一次，其余任务照发', async () => {
  freshOwnershipDir();
  const goodNonce = `MIX-OK-${Math.random().toString(36).slice(2, 8)}`;
  const good = seedDueReminder('session-mixed', goodNonce);
  // 同一个 sidecar 里再塞一条**推不出来**的老条目（没有任何 create 事件可依）。
  writeSidecar('session-mixed', {
    version: 2,
    entries: {
      'schedule-1': { delivery: 'context', createdAt: good.createdAt, uid: 'uid-ok', scheduledAt: good.target },
      'schedule-ghost': { delivery: 'context', createdAt: good.createdAt, uid: 'uid-ghost' },
    },
    paused: {},
  });
  const boot = bootAssembly({ resume: (sessionId) => new FakeAgent(sessionId, good.session) });
  try {
    await boot.fiber;
    await flush();
    const ok = await until(() => deliveryOf(good.session, goodNonce).spliced.length > 0);
    assert.ok(ok, `能回算/带字段的条目必须照发；warn=${JSON.stringify(boot.warned).slice(0, 400)}`);
    const skipped = boot.warned.filter((line) => /schedule-ghost/.test(line));
    assert.equal(skipped.length, 1, '无法回算的条目必须告警，且只喊一次（不刷日志）');
    assert.match(skipped[0], /无法从会话日志回算/, '告警要说清为什么跳过');
  } finally {
    await shutdown(boot);
  }
});

// ── 3. 两条 profile 路径 ───────────────────────────────────────────────────

test('profile 路径一：宿主提供 sessionController 时走 resolveAgent，并能投递', async () => {
  freshOwnershipDir();
  const nonce = `WEB-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder('session-web', nonce);
  const calls = [];
  // 真会话控制器是幂等的：同一会话反复 resolve 拿到同一个 agent（`resumes` 去重）。
  // resolve 出来的就是"此刻活着的那个 root agent"——宿主会在它 resolve 之后把它放进
  // live 表，所以下面第一次唤醒时表里还没有它（冷），第二次唤醒时它在（warm）。
  const resolved = new FakeAgent('session-web', session);
  const boot = bootAssembly({
    sessionController: {
      async resolveAgent(sessionId) {
        calls.push(sessionId);
        boot.liveAgents.push(resolved);
        return { agent: resolved };
      },
    },
    resume: () => {
      throw new Error('有 sessionController 时不应回退 agents.resume');
    },
  });
  try {
    await boot.fiber;
    await flush();
    const ok = await until(() => deliveryOf(session, nonce).spliced.length > 0);
    assert.ok(ok, `web profile 必须能冷投递；warn=${JSON.stringify(boot.warned).slice(0, 400)}`);
    assert.deepEqual(calls, ['session-web'], '冷会话应经 resolveAgent 解析');
    assert.equal(boot.agentsSvc.resumeCalls.length, 0, '有 sessionController 时不得回退 agents.resume');
  } finally {
    await shutdown(boot);
  }
});

test('profile 路径一·续：agent 已经在 live 表里时，扫描器只补一次核算、不再 resolve（不重复拉起）', async () => {
  freshOwnershipDir();
  const nonce = `WARM-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder('session-warm', nonce);
  const resolved = new FakeAgent('session-warm', session);
  const calls = [];
  const boot = bootAssembly({
    sessionController: {
      async resolveAgent(sessionId) {
        calls.push(sessionId);
        return { agent: resolved };
      },
    },
  });
  try {
    boot.liveAgents.push(resolved);
    await boot.fiber;
    await flush();
    const ok = await until(() => deliveryOf(session, nonce).spliced.length > 0);
    assert.ok(ok, 'live 会话照常投递');
    assert.deepEqual(calls, [], '已有 live agent 时不该再走 resolveAgent（冷唤醒才需要它）');
  } finally {
    await shutdown(boot);
  }
});

test('profile 路径二：宿主没有 sessionController 时回退 agents.resume，并能投递', async () => {
  freshOwnershipDir();
  const nonce = `CLI-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder('session-cli', nonce);
  const boot = bootAssembly({ resume: (sessionId) => new FakeAgent(sessionId, session) });
  try {
    await boot.fiber;
    await flush();
    const ok = await until(() => deliveryOf(session, nonce).spliced.length > 0);
    assert.ok(ok, `非 web profile 必须经 agents.resume 冷投递；warn=${JSON.stringify(boot.warned).slice(0, 400)}`);
    assert.deepEqual(boot.agentsSvc.resumeCalls, ['session-cli'], '应回退到 agents.resume');
  } finally {
    await shutdown(boot);
  }
});

test('两条路都不通：记 undelivered 并告警，重试次数封顶且告警只喊一次', async () => {
  freshOwnershipDir();
  const nonce = `DEAD-${Math.random().toString(36).slice(2, 8)}`;
  seedDueReminder('session-dead', nonce);
  // resume 恒定失败、会话控制器缺席 ⇒ 两条路都不通。
  const boot = bootAssembly({
    resume: () => {
      throw new Error('persistence backend unavailable');
    },
  });
  try {
    await boot.fiber;
    await flush();
    // 退避梯子是 1s→2s→4s→8s：第 5 次失败（放弃）落在 ~11s，这里给到 20s。
    const gaveUp = await until(() => boot.warned.some((line) => /已停止自动唤醒/.test(line)), 20_000);
    assert.ok(gaveUp, `反复失败必须最终停下并告警：${JSON.stringify(boot.warned).slice(0, 800)}`);
    const attempts = boot.agentsSvc.resumeCalls.length;
    assert.ok(attempts > 0, '应当真的尝试过唤醒');
    assert.ok(attempts <= 6, `失败后的重试必须有上界（实测 ${attempts} 次）`);
    assert.equal(boot.warned.filter((line) => /已停止自动唤醒/.test(line)).length, 1, '放弃告警只喊一次');
  } finally {
    await shutdown(boot);
  }
});

// ── 4. 拒绝被委托子会话 ────────────────────────────────────────────────────

test('被委托子会话（delegationDepth > 0）不唤醒、不投递', async () => {
  freshOwnershipDir();
  const nonce = `SUB-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder('session-sub', nonce);
  // 子会话此刻已经 live 且深度 > 0（它是**别的组件**拉起来的，本插件不该接手它的投递）。
  const child = new FakeAgent('session-sub', session);
  child.session.header.delegationDepth = 2;
  let resumeCalls = 0;
  const boot = bootAssembly({
    resume: () => {
      resumeCalls += 1;
      throw new Error('子会话不得被冷唤醒');
    },
  });
  try {
    // ⚠️ 子会话**当且仅当**在 apply 之前已经 live：扫描器起步就同步扫一轮，若那时它
    // 还不存在，第一轮会把它当冷会话去 `agents.resume`——那其实是**正确**行为（此刻确实
    // 没有 live agent，深度判不出来），但那会让本用例测到另一种情形。
    //
    // 另一个坑：不能让它进入 `hydrate()` 的视野（`roots()`）。`hydrate` 给**每个 root**
    // 挂 runtime（连深度 > 0 的也挂——`runtime-registry` 只认 root、不认深度），挂上之后
    // 它自己的 timer 会照常到点投递。那属于既有行为，不是"扫描器良心发现"，会掩盖本用例
    // 要证明的东西。所以：apply 时 `roots()` 为空，apply 之后再把它放进 live 表。
    //
    // 第三条也是**承重的**：扫描器起步就同步扫一轮，那一刻子会话还不存在 ⇒ 它会被当成
    // 冷会话去 `agents.resume`。那是对的行为（没有 live agent 就判不出深度），但它会记
    // 一次失败、并按退避把它排进重试。所以这条用例真正要钉的是**底下那一轮**：
    // 子会话已在 live 表里、深度 > 0 时，扫描器既不 resume 也不让它投递。
    //
    // 做法：起步那一轮的 resume 失败不记账（fixture 只数次数），然后在退避窗口过去之后再
    // 看一次——此刻子会话在表里，判定必须是"不可唤醒"。
    await boot.fiber;
    await flush();
    const startupResumes = resumeCalls;
    boot.liveAgents.push(child);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    // 先钉「判定本身」，再看「结果」。两条断言不能合在一起——`assert.equal` 的失败消息
    // 在断言**之前**求值，把投递计数写进消息里就等于检查前先读了一次状态
    // （这个坑在这里真踩过：测试"自己让自己通过"）。
    assert.equal(plugin.canWakeColdSession(boot.ctx, 'session-sub'), false, '子会话必须被判为不可唤醒');
    assert.equal(deliveryOf(session, nonce).spliced.length, 0, '子会话不得投递');
    assert.equal(resumeCalls, startupResumes, '子会话进表之后不得再被 agents.resume 冷唤醒');
  } finally {
    await shutdown(boot);
  }
});

// ── 4b. 静默期（用户刚关过会话）─────────────────────────────────────────────

test('静默期：刚被 disposed 的会话在静默期内不唤醒，但必须留痕为 undelivered(quiet-window)', async () => {
  freshOwnershipDir();
  const nonce = `QUIET-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder('session-quiet', nonce);
  // 先建起来（apply 时它在 live 表里 ⇒ hydrate 挂上 runtime，等价于"用户正开着这个会话"）。
  const liveAgent = new FakeAgent('session-quiet', session);
  let resumeCalls = 0;
  const boot = bootAssembly({
    resume: (sessionId) => {
      resumeCalls += 1;
      return new FakeAgent(sessionId, session);
    },
  });
  try {
    boot.liveAgents.push(liveAgent);
    await boot.fiber;
    await flush();
    // 用户主动关掉这个会话 ⇒ 进入 120s 静默期。
    //
    // 这里**直接填静默表**而不是 emit `agent/disposed`：真宿主里那件事由内核发事件，
    // 而本装配的 `ctx` 是未 start 的根上下文，fiber 停在 PENDING（单测里所有 effect 都
    // 走这条真实宿主语义）。事件面的接线由 `tests/host-entry-activation` 与真宿主
    // 跨内核用例各自覆盖，这条用例只钉「静默期到了之后的行为」。
    boot.liveAgents.length = 0;
    boot.watch.recent.set('session-quiet', Date.now());
    await flush();
    // 静默期内：不允许主动冷唤醒。
    assert.equal(plugin.canWakeColdSession(boot.ctx, 'session-quiet', boot.watch), false, '静默期内必须判定为不可唤醒');
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(resumeCalls, 0, '静默期内不得冷唤醒（用户刚关掉，别又打开）');
    // 但**必须留痕**：这条到期提醒不许被无声滤掉。两条判据二选一，写死在这里：
    //   A. 真的被投递了（会话在静默期内也被叫醒），或
    //   B. 明确记成 undelivered(quiet-window)。
    const delivered = deliveryOf(session, nonce).spliced.length > 0;
    const traced = boot.warned.some((line) => /quiet-window/.test(line) && /暂缓唤醒/.test(line));
    assert.ok(delivered || traced, `静默期内的到期提醒必须留痕：spliced=${deliveryOf(session, nonce).spliced.length} warn=${JSON.stringify(boot.warned).slice(0, 400)}`);
  } finally {
    await shutdown(boot);
  }
});

// ── 4b2. 监听的生命周期（真 bug：注册在 apply 顶层 = 立刻被 cordis 拆掉）────────

test('静默期监听的撤销契约：fiber 拆除后不再把会话记进静默表', async () => {
  freshOwnershipDir();
  const boot = bootAssembly();
  try {
    await boot.fiber;
    await flush();
    // 测的是**本插件自己的不变式**，不是 cordis 内部会不会拆某次注册：
    // 监听挂在 `ctx.effect` 作用域里 ⇒ 它的生死必须与 fiber 一致。拆除之后再 emit，
    // 静默表不得再被写入（否则热重载会留下旧实例的监听，把新实例的会话全部拖进静默期）。
    const before = boot.watch.recent.size;
    boot.ctx.emit('agent/disposed', { agent: { id: 'session-undo-1' } });
    await flush();
    const duringDispose = boot.watch.recent.size;
    await boot.fiber.dispose();
    boot.ctx.emit('agent/disposed', { agent: { id: 'session-undo-2' } });
    await flush();
    // 拆除前后都必须成立的不是"一定进/一定不进"，而是**拆除后不再新增**。
    assert.ok(duringDispose >= before, `拆除前 emit 不应减少静默表：${before} -> ${duringDispose}`);
    assert.equal(
      boot.watch.recent.has('session-undo-2'),
      false,
      `fiber 拆除后监听必须已撤销；recent=${JSON.stringify([...boot.watch.recent.keys()])}`,
    );
  } finally {
    await shutdown(boot);
  }
});

// ── 4c. 反向判据：live 会话由 runtime timer 投递，扫描器不得抢先 ─────────────

test('反向：会话保持 live 时，投递由 runtime 完成，扫描器不额外唤醒（不出现双驱动）', async () => {
  freshOwnershipDir();
  const nonce = `NOTPREEMPT-${Math.random().toString(36).slice(2, 8)}`;
  // 提醒在未来 300ms 才到期：先让 runtime 自己武装 timer。
  const session = new FakeSession('session-preempt');
  const target = Date.now() + 300;
  session.append('schedule/change', createEvent({ id: 'schedule-1', kind: 'at', prompt: nonce, scheduledAt: target }));
  writeSidecar('session-preempt', {
    version: 3,
    entries: { 'schedule-1': { delivery: 'context', createdAt: target - 60_000, uid: `uid-${nonce}`, scheduledAt: target } },
    paused: {},
  });
  const liveAgent = new FakeAgent('session-preempt', session);
  let resumeCalls = 0;
  const boot = bootAssembly({
    resume: (sessionId) => {
      resumeCalls += 1;
      return new FakeAgent(sessionId, session);
    },
  });
  try {
    boot.liveAgents.push(liveAgent);
    await boot.fiber;
    const ok = await until(() => deliveryOf(session, nonce).spliced.length > 0, 2000);
    assert.ok(ok, 'live 会话必须照常投递');
    // 再观察一段时间：扫描器也会看到这条过期条目，但绝不能因此再唤醒/再投一次。
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(deliveryOf(session, nonce).spliced.length, 1, '只能投递一次（两个驱动源不得各投一次）');
    assert.equal(deliveryOf(session, nonce).dispatched.length, 1, 'dispatch 只能落一条');
    assert.equal(resumeCalls, 0, '扫描器不得对 live 会话做冷唤醒');
    assert.equal(liveAgent.followups.length, 1, 'live 会话只应收到一条消息');
  } finally {
    await shutdown(boot);
  }
});

// ── 5. 生命周期 ────────────────────────────────────────────────────────────

test('插件 fiber dispose 后再到期：不产生新的投递或唤醒', async () => {
  freshOwnershipDir();
  const nonce = `LIFE-${Math.random().toString(36).slice(2, 8)}`;
  const session = new FakeSession('session-life');
  const target = Date.now() + 400; // 未来才到期：dispose 必须发生在叫醒之前
  session.append('schedule/change', createEvent({ id: 'schedule-1', kind: 'at', prompt: nonce, scheduledAt: target }));
  writeSidecar('session-life', {
    version: 3,
    entries: { 'schedule-1': { delivery: 'context', createdAt: target - 60_000, uid: `uid-${nonce}`, scheduledAt: target } },
    paused: {},
  });
  const boot = bootAssembly({ resume: (sessionId) => new FakeAgent(sessionId, session) });
  await boot.fiber;
  await flush();
  assert.equal(deliveryOf(session, nonce).spliced.length, 0, '未到点不应投递');
  assert.equal(boot.agentsSvc.resumeCalls.length, 0, '未到点不应唤醒');
  await boot.fiber.dispose();
  // 到期之后又等一轮：扫描器已经被拆掉，不该有任何动作。
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(deliveryOf(session, nonce).spliced.length, 0, 'dispose 后不得再投递');
  assert.equal(boot.agentsSvc.resumeCalls.length, 0, 'dispose 后不得再唤醒');
});

// ── 6. 不回归：会话本来就 live ─────────────────────────────────────────────

test('不回归：会话本来就 live 时行为不变（投递一次、dispatch 一次、不重复唤醒）', async () => {
  freshOwnershipDir();
  const nonce = `LIVE-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder('session-live', nonce);
  const liveAgent = new FakeAgent('session-live', session);
  const boot = bootAssembly({
    resume: () => {
      throw new Error('live session must not be resumed');
    },
  });
  try {
    // apply 之前就让它成为 root：hydrate() 会给它挂 runtime（等价于"有人开着这个会话"）。
    boot.liveAgents.push(liveAgent);
    await boot.fiber;
    await flush();
    const ok = await until(() => deliveryOf(session, nonce).spliced.length > 0);
    assert.ok(ok, `live 会话照常投递；warn=${JSON.stringify(boot.warned).slice(0, 400)}`);
    // 再给扫描器几轮机会：它同样看到那条已到期的 sidecar，但不得造成第二次投递。
    await new Promise((resolve) => setTimeout(resolve, 300));
    const seen = deliveryOf(session, nonce);
    assert.equal(seen.spliced.length, 1, 'live 会话只投递一次（不因扫描器而重复）');
    assert.equal(seen.dispatched.length, 1, 'dispatch 也只落一条');
    assert.equal(liveAgent.steers.length, 0, '默认 followup，不走 steer');
    assert.equal(boot.agentsSvc.resumeCalls.length, 0, 'live 会话不该被再拉一次');
  } finally {
    await shutdown(boot);
  }
});

// ── 附带：v3 写入面 ────────────────────────────────────────────────────────

test('sidecar v3：读 v1/v2/v3 都认，写回升到 3 且扫描面能枚举到条目', async () => {
  const dir = freshOwnershipDir();
  writeSidecar('session-v1', { version: 1, entries: { 'schedule-1': { delivery: 'user', createdAt: 1 } } });
  const snapshots = listOwnershipSnapshots();
  assert.ok(snapshots.some((s) => s.sessionId === 'session-v1'), 'v1 文件必须仍可读（升级不丢条目）');
  assert.ok(dir.length > 0);
});
