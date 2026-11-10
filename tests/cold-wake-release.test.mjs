/**
 * 冷唤醒之后释放会话句柄（GitHub issue #140，#128 三条硬约束里的第 ③ 条）。
 *
 * ## 缺口本体
 *
 * `wakeColdSession` 原先把 `agents.resume(...)` 的返回值拆完 agent 之后**把句柄丢掉**，
 * 全仓没有任何一处释放被叫醒的会话。内核那边的语义是明确的（`dsh-agent` 的
 * `AgentHandle`）：句柄是**能力型**的——只有持有者能让这个 agent 倒下；而 `resume` 会
 * **以写者身份**打开那份持久会话。所以不释放有两个可观察后果：
 *  - 被叫醒过的会话在宿主重启前永久常驻 `ctx.agents`（原本它是冷的、不占 agent 资源），
 *    数量只增不减；
 *  - 那条会话被本插件占着写者位，web profile 的 `sessionController.resolveAgent` 对
 *    「写者持有」直接拒绝——用户反而打不开自己那条被"帮忙"叫醒过的会话。
 *
 * ## 这个文件钉的四件事
 *
 *  1. **投递收敛 ⇒ 释放**：断言会话不再是 live root（`ctx.agents.get` 空）且句柄的
 *     `dispose()` 真的被调用过；
 *  2. **收敛之前不释放**（"宁热不丢"）：agent 还在跑 turn 时绝不拆——拆早了就是
 *     `driveOnce` 的维护事务被连根端掉，用户那条提醒不会进会话。代价只是一份内存；
 *  3. **路径一不释放**：`sessionController` 交回的 agent 归会话控制器所有，本插件没有
 *     句柄、也就没有拆它的资格（那会拆掉用户正看着的会话）；
 *  4. **释放之后同会话第二条到期仍能再被叫醒并投递**（序列测试）。这条同时覆盖
 *     #139 的「第二条」路径：修复前第一条投完就把那个会话攒进 `gaveUp`，第二条根本
 *     醒不来；而如果释放做得不对（比如把静默期标记留着、或释放后索引没消化），
 *     这条也会红。所以它是 #140 与 #139 的交点，不该拆成两个各测一半的断言。
 *
 * 判据一律是**事件形状**：`agent/inbox/spliced` 且 `inserted[].content` 带本次 nonce，
 * 随后 `schedule/change operation:dispatch`。文本命中在本仓是明令禁止的假判据。
 *
 * ## 未判定（写清楚，别当绿）
 *
 * `COLD_WAKE_RELEASE_WAIT_MS`（30s）那条「超时故意留热 + 告警」的分支本文件**没驱动**：
 * 单测不真等 30s。用例 2 用「busy ⇒ 不释放，转 idle ⇒ 释放」覆盖同一判据的可达部分，
 * 上限本身由代码里的常量与那条 warn 承担，属推断而非实测。
 *
 * @module tests/cold-wake-release
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as plugin from '../lib/index.js';
import { getOwnership } from '../lib/ownership-store.js';
import { readDueIndex } from '../lib/due.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(20);
  }
  return predicate();
}

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
 * 假 agent：`followup` 按内核原语的形状先写 `agent/inbox/spliced` 再写 `user/message`；
 * `status` 是**生命周期镜像**——释放判据读的就是它（`running` ⇒ 这轮 turn 还没完）。
 */
class FakeAgent {
  constructor(id, session, defs) {
    this.id = id;
    this.session = session;
    this.status = 'idle';
    this.ctx = {
      effect(execute) {
        const ret = execute();
        return () => (typeof ret === 'function' ? ret() : undefined);
      },
      on: () => () => undefined,
      tools: {
        register: (tool) => {
          const sink = defs ?? new Map();
          sink.set(`tool:${tool.name}`, tool);
          return () => sink.delete(`tool:${tool.name}`);
        },
      },
    };
  }
  followup(message) {
    this.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [{ id: message.id, role: 'user', content: message.content }],
    });
    this.session.append('user/message', message);
  }
  steer(message) {
    this.followup(message);
  }
  async whenIdle() {}
  async runMaintenance(job) {
    return job();
  }
}

/**
 * 一次装配。`options.onDispose` 记录句柄被拆的时刻；`options.busyWhileDelivering`
 * 让假 agent 在投递那一刻进入 `running`，用来钉「收敛之前不许拆」。
 */
function bootAssembly(options = {}) {
  const defs = new Map();
  const liveAgents = [];
  const published = new Map();
  const resumeCalls = [];
  const disposed = [];
  const handles = [];
  const agentsSvc = {
    roots: () => liveAgents.slice(),
    get: (id) => liveAgents.find((agent) => agent.id === id),
    isOwnedBy: () => false,
    list: () => liveAgents.slice(),
    async resume(opts) {
      resumeCalls.push(opts.resumeSessionId);
      if (options.resume === undefined) throw new Error(`no resume support for ${opts.resumeSessionId}`);
      const agent = options.resume(opts.resumeSessionId, defs);
      const handle = {
        agent,
        dispose: async () => {
          // 真内核 `dispose()`：停 loop → 注销 agent → **从 store 移除它的 session** → 拆 scope。
          disposed.push(agent.id);
          const at = liveAgents.findIndex((entry) => entry.id === agent.id);
          if (at !== -1) liveAgents.splice(at, 1);
          if (published.get(agent.id) === agent.session) published.delete(agent.id);
          options.onDispose?.(agent);
        },
      };
      handles.push(handle);
      published.set(agent.id, agent.session);
      const at = liveAgents.findIndex((entry) => entry.id === agent.id);
      if (at === -1) liveAgents.push(agent);
      else liveAgents[at] = agent;
      return handle;
    },
  };
  const warned = [];
  const ctx = new Context();
  ctx.provide('agents', agentsSvc);
  ctx.provide('sessions', { flush: async () => true, get: (id) => published.get(id) });
  ctx.provide('tools', {
    register(tool) {
      defs.set(`tool:${tool.name}`, tool);
      return () => defs.delete(`tool:${tool.name}`);
    },
  });
  ctx.provide('commands', {
    register(definition) {
      defs.set(definition.name, definition);
      return () => defs.delete(definition.name);
    },
  });
  ctx.provide('settings', { describe: () => [{ ns: 'later', value: {} }] });
  ctx.provide('skills', { registerProvider: () => () => undefined });
  if (options.sessionController !== undefined) ctx.provide('sessionController', options.sessionController);
  const originalWarn = ctx.logger.warn.bind(ctx.logger);
  ctx.logger.warn = (message) => {
    warned.push(String(message));
    originalWarn(message);
  };
  const fiber = ctx.plugin(
    { apply: plugin.apply, inject: plugin.inject, name: plugin.name, Config: plugin.Config },
    {},
  );
  return { ctx, defs, agentsSvc, liveAgents, published, resumeCalls, handles, disposed, warned, fiber };
}

async function shutdown(boot) {
  try {
    await boot.fiber.dispose();
  } catch {
    /* 拆除失败不改写断言结论 */
  }
}

function writeSidecar(sessionId, payload) {
  writeFileSync(join(process.env.DSH_LATER_STATE_DIR, `${sessionId}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function createEvent({ id, kind, title = '提醒', prompt, scheduledAt, afterSeconds }) {
  const base = { id, kind, title, prompt, scheduledAt: new Date(scheduledAt).toISOString() };
  return { version: 1, operation: 'create', schedule: kind === 'after' ? { ...base, afterSeconds } : base };
}

/** 播一条已到期的提醒（日志 create + sidecar v3 条目）。 */
function seedDueReminder(sessionId, nonce, { overdueMs = 2500 } = {}) {
  const session = new FakeSession(sessionId);
  const target = Date.now() - overdueMs;
  session.append('schedule/change', createEvent({ id: 'schedule-1', kind: 'at', prompt: nonce, scheduledAt: target }));
  writeSidecar(sessionId, {
    version: 3,
    entries: { 'schedule-1': { delivery: 'context', createdAt: target - 60_000, uid: `uid-${nonce}`, scheduledAt: target } },
    paused: {},
  });
  return { session, id: 'schedule-1', target, nonce };
}

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

// ── 1. 收敛即释放 ───────────────────────────────────────────────────────────

test('冷唤醒 → 投递收敛 → 句柄被释放，该会话不再是 live root', async () => {
  freshOwnershipDir();
  const sessionId = 'session-release';
  const nonce = `REL-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder(sessionId, nonce);
  const boot = bootAssembly({ resume: (id, defs) => new FakeAgent(id, session, defs) });
  try {
    await boot.fiber;
    // 前置：真的被叫醒过、真的投出去了（事件形状）。
    const delivered = await until(() => deliveryOf(session, nonce).spliced.length === 1);
    assert.ok(delivered, `投递没发生：${JSON.stringify(boot.warned).slice(0, 300)}`);
    assert.equal(deliveryOf(session, nonce).dispatched.length >= 1, true, '必须有 dispatch 记账');
    assert.equal(boot.resumeCalls.length, 1);

    // 释放是投递收敛**之后**的收尾，异步进行；先确认索引已经消化，才谈得上收敛。
    const consumed = await until(() => readDueIndex(getOwnership(sessionId, 'schedule-1')) .kind === 'consumed');
    assert.ok(consumed, '收敛判据读的是索引面，条目必须先被镜像成已消化');
    const released = await until(() => boot.disposed.includes(sessionId));
    assert.ok(released, `句柄必须被释放（实测 dispose 记录：${JSON.stringify(boot.disposed)}）`);
    assert.equal(boot.agentsSvc.get(sessionId), undefined, '释放之后该会话不再是 live root');
    assert.equal(boot.ctx.sessions.get(sessionId), undefined, '内核 dispose 会把 session 从 store 移除');
  } finally {
    await shutdown(boot);
  }
});

// ── 2. 收敛之前不许拆（"宁热不丢"）─────────────────────────────────────────

test('turn 还在跑的时候不释放；转空闲之后才释放', async () => {
  freshOwnershipDir();
  const sessionId = 'session-busy';
  const nonce = `BUSY-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder(sessionId, nonce);
  let made = null;
  const boot = bootAssembly({
    resume: (id, defs) => {
      const agent = new FakeAgent(id, session, defs);
      // 模拟"这一轮模型回合还没完"：投递已经落进日志，但 turn 还在跑。
      agent.status = 'running';
      made = agent;
      return agent;
    },
  });
  try {
    await boot.fiber;
    assert.ok(await until(() => deliveryOf(session, nonce).spliced.length === 1), '前置：投递发生');
    await until(() => readDueIndex(getOwnership(sessionId, 'schedule-1')).kind === 'consumed');
    // 收敛判据的另一半还没成立 ⇒ 不许拆。拆了就是端掉一个正在跑的 turn。
    await sleep(400);
    assert.equal(boot.disposed.includes(sessionId), false, 'turn 未结束就释放，会把用户的提醒回合一起拆掉');
    assert.notEqual(boot.agentsSvc.get(sessionId), undefined, '未收敛时会话应当留着（这是**故意保留**，不是漏做）');
    // 空闲之后立刻被释放——保留是有出口的，不是永久常驻。
    made.status = 'idle';
    assert.ok(await until(() => boot.disposed.includes(sessionId), 4000), '转空闲之后应当补上释放');
    assert.equal(boot.agentsSvc.get(sessionId), undefined);
  } finally {
    await shutdown(boot);
  }
});

// ── 3. 路径一（会话控制器持有的 agent）不释放 ──────────────────────────────

test('走 sessionController 叫醒的会话不由本插件释放（句柄不是我们的）', async () => {
  freshOwnershipDir();
  const sessionId = 'session-controller-path';
  const nonce = `CTL-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder(sessionId, nonce);
  const agent = new FakeAgent(sessionId, session, undefined);
  const boot = bootAssembly({
    // 路径一：web profile 的会话控制器。它交回的 agent 是**控制器自己已经附着好**的
    // （放进 live 表 + 发布 session），本插件只借来投递；所以假件必须如实模拟"附着"这一步，
    // 否则 `runtimeRegistry.mount` 因为 `roots()` 里没有它而拒绝挂载——那测的是假件的洞，
    // 不是产品。交回的形状里**没有 dispose**：句柄不归本插件。
    sessionController: {
      resolveAgent: async () => {
        if (!boot.liveAgents.includes(agent)) boot.liveAgents.push(agent);
        boot.published.set(sessionId, session);
        return { agent };
      },
    },
    resume: () => {
      throw new Error('路径一命中时不该走 agents.resume');
    },
  });
  try {
    await boot.fiber;
    assert.ok(await until(() => deliveryOf(session, nonce).spliced.length === 1), '前置：路径一也要能投递');
    await until(() => readDueIndex(getOwnership(sessionId, 'schedule-1')).kind === 'consumed');
    await sleep(400);
    assert.equal(boot.disposed.length, 0, '控制器持有的 agent 不许被本插件拆掉');
  } finally {
    await shutdown(boot);
  }
});

// ── 4. 序列：释放之后第二条仍能冷唤醒（#140 与 #139 的交点）────────────────

test('冷唤醒 → 投递 → 释放 → 同会话第二条到期 → 再被唤醒并投递（事件形状）', async () => {
  freshOwnershipDir();
  const sessionId = 'session-sequence';
  const first = `SEQ1-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder(sessionId, first);
  const boot = bootAssembly({ resume: (id, defs) => new FakeAgent(id, session, defs) });
  try {
    await boot.fiber;
    // 第一条：投递 + 释放，会话重新变冷。
    assert.ok(await until(() => deliveryOf(session, first).spliced.length === 1), `第一条要投出去：${JSON.stringify(boot.warned).slice(0, 300)}`);
    assert.ok(await until(() => boot.disposed.includes(sessionId)), '第一条投完应当被释放');
    const callsAfterFirst = boot.resumeCalls.length;
    assert.equal(boot.agentsSvc.get(sessionId), undefined, '第二条开始前，会话必须是冷的（否则测的不是冷唤醒）');

    // 第二条走**真工具路径**创建：用第一条那轮挂载好的 agent（工具注册在 attach 上）。
    // 释放之后 agent 已从 live 表里摘掉，但 `defs` 里的工具句柄仍指向那次挂载注册的闭包。
    const createTool = boot.defs.get('tool:user_schedule_create');
    assert.ok(createTool, '前置：挂载时注册出来的 user_schedule_create 应当还在');
    const second = `SEQ2-${Math.random().toString(36).slice(2, 8)}`;
    const created = JSON.parse(await createTool.execute({ prompt: second, after_seconds: 1 }, { agent: boot.handles[0].agent }));
    assert.equal(created.ok, true, `第二条应当建起来：${JSON.stringify(created).slice(0, 200)}`);

    // 判据：第二条被**冷**唤醒并投递（新一次 resume + spliced 带本次 nonce + dispatch 记账）。
    const gotSecond = await until(() => deliveryOf(session, second).spliced.length === 1, 6000);
    assert.ok(
      gotSecond,
      `第二条必须仍能被冷唤醒投递（实测 spliced=${deliveryOf(session, second).spliced.length}、` +
        `resume ${boot.resumeCalls.length} 次、告警 ${JSON.stringify(boot.warned).slice(0, 400)}）`,
    );
    assert.ok(
      boot.resumeCalls.length > callsAfterFirst,
      `第二条应当产生新的一次唤醒（实测 ${boot.resumeCalls.length} vs ${callsAfterFirst}）`,
    );
    const dispatchedForSecond = deliveryOf(session, second);
    assert.equal(dispatchedForSecond.dispatched.length >= 2, true, '两条提醒各有一条 dispatch 记账');
    // 第二轮同样要收敛掉：释放不是一次性的，是每次唤醒的收尾。
    assert.ok(await until(() => boot.disposed.filter((id) => id === sessionId).length >= 2), '第二条投完也应当再释放一次');
    assert.equal(boot.warned.filter((w) => /已停止自动唤醒/.test(w)).length, 0, '整个序列里不该出现假失败导致的放弃');
  } finally {
    await shutdown(boot);
  }
});
