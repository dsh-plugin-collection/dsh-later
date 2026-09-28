/**
 * 插话投递策略测试：投递队列选择 + 送达确认 + 未确认时的出列行为。
 *
 * 背景（实测复现）：`agent.steer()` 入 `next-step`，若插话恰好撞上 `turn/start`，
 * 核心 `inbox.claim('next-step', …)` 会把整批取走交给一个请求上下文已定的 step，
 * 消息落进 surface 却不进实际请求 —— **静默丢失**。且旧实现在 steer 后**无条件**
 * 写 dispatch，导致「提醒消失但消息没到」且不可重试。
 *
 * 本文件锁住修复后的三条不变量：
 *  1. 默认走 `followup`（独立成轮，结构上无竞态）；
 *  2. 未确认且 `onUnconfirmed='keep'` 时**不写 dispatch**（条目保留可重试）；
 *  3. 确认送达 / 关闭确认 / `discard` 时才写 dispatch。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserScheduleRuntime } from '../lib/runtime.js';
import { hasMessageInLog, messageIdOf, DELIVERY_CONFIRM_TIMEOUT_MS } from '../lib/delivery.js';
import { foldScheduleEvents } from '@deepseek-ai/dsh-schedule';
import { recordOwnership } from '../lib/ownership-store.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

freshOwnershipDir();

/** 假 Session：`append` 会**回写 events**（这是确认逻辑能观测到的前提）。 */
class FakeSession {
  constructor(seed = []) {
    this.header = { seedLength: 0 };
    this.events = seed;
    this.sessionId = 'session-delivery';
  }
  ownEvents() {
    return this.events;
  }
  append(type, data) {
    const seq = this.events.length;
    this.events.push({ type, seq, time: Date.now(), data });
  }
}

/**
 * 假 Agent，三种投递各自记账。
 *
 * `echoes: true` 时投递会写一条 `user/message`（模拟「真的进了日志」）；
 * 否则只记账不写日志（模拟「投出去了但没落到日志」= 未确认）。
 * `echoDelayMs > 0` 时延迟写入，用来把确认窗口拉长、以检验并发不变量。
 */
class FakeAgent {
  constructor(session, { echoes = true, echoDelayMs = 0 } = {}) {
    this.id = 'agent-delivery';
    this.session = session;
    this.echoes = echoes;
    this.echoDelayMs = echoDelayMs;
    this.followups = [];
    this.steers = [];
  }
  followup(message) {
    this.followups.push(message);
    this.#echo(message);
  }
  steer(message) {
    this.steers.push(message);
    this.#echo(message);
  }
  #echo(message) {
    if (!this.echoes) return;
    const write = () =>
      this.session.append('user/message', {
        content: message.content,
        source: { kind: 'user' },
        role: 'user',
        id: message.id,
      });
    if (this.echoDelayMs > 0) setTimeout(write, this.echoDelayMs);
    else write();
  }
}

function fakeCtx(agent) {
  return {
    sessions: { flush: async () => true },
    agents: { get: () => agent, roots: () => [agent] },
    logger: { warn: () => undefined },
  };
}

function settingsOf(over = {}) {
  return { steerDelivery: 'followup', confirmDelivery: true, onUnconfirmed: 'keep', ...over };
}

/** 造一个含单条活动的用户提醒的会话，返回 { session, agent, id, uid }。 */
function setup({ echoes = true, settings = {} } = {}) {
  const sessionId = 'session-delivery';
  const uid = 'uid-delivery-1';
  const record = {
    id: 'schedule-1',
    kind: 'after',
    prompt: '投递测试',
    afterSeconds: 600,
    scheduledAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const session = new FakeSession([
    { type: 'schedule/change', seq: 0, time: 0, data: { version: 1, operation: 'create', schedule: record } },
  ]);
  session.header.id = sessionId;
  recordOwnership(sessionId, record.id, 'user', uid);
  const agent = new FakeAgent(session, { echoes });
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, () => settingsOf(settings));
  return { session, agent, runtime, uid };
}

const dispatches = (session) =>
  session.events.filter((e) => e.type === 'schedule/change' && e.data.operation === 'dispatch');

test('delivery：hasMessageInLog 能按 message id 命中日志', () => {
  const session = new FakeSession([
    { type: 'user/message', seq: 0, time: 0, data: { content: [], source: { kind: 'user' }, role: 'user', id: 'm1' } },
  ]);
  assert.equal(hasMessageInLog(session, 'm1'), true);
  assert.equal(hasMessageInLog(session, 'm2'), false);
});

test('delivery：messageIdOf 对缺失 id 返回空串', () => {
  assert.equal(messageIdOf({ id: 'x' }), 'x');
  assert.equal(messageIdOf({}), '');
  assert.equal(messageIdOf({ id: 42 }), '');
});

test('插话：默认走 followup（不入 next-step，结构上避开 turn/start 竞态）', async () => {
  const { agent, runtime, uid } = setup();
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(agent.followups.length, 1);
  assert.equal(agent.steers.length, 0, '默认不得使用 steer');
});

test('插话：steerDelivery=steer 时才走 agent.steer', async () => {
  const { agent, runtime, uid } = setup({ settings: { steerDelivery: 'steer' } });
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(agent.steers.length, 1);
  assert.equal(agent.followups.length, 0);
});

test('插话：确认送达后写出列标记（dispatch）', async () => {
  const { session, runtime, uid } = setup({ echoes: true });
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(dispatches(session).length, 1);
  // 出列后 fold 不再活动
  assert.equal(foldScheduleEvents(session.events, 0).active.length, 0);
});

test('插话：未确认 + keep → 不写 dispatch，提醒保留可重试（核心回归）', async () => {
  const { session, runtime, uid } = setup({ echoes: false, settings: { onUnconfirmed: 'keep' } });
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'delivery_unconfirmed');
  assert.equal(dispatches(session).length, 0, '未确认时绝不能写出列标记');
  // 关键：条目仍在 active —— 这正是「不再静默丢失」的判据
  assert.equal(foldScheduleEvents(session.events, 0).active.length, 1);
});

test('插话：未确认 + discard → 保持旧语义写出列标记', async () => {
  const { session, runtime, uid } = setup({ echoes: false, settings: { onUnconfirmed: 'discard' } });
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(dispatches(session).length, 1);
  assert.equal(foldScheduleEvents(session.events, 0).active.length, 0);
});

test('插话：关闭确认 → 不核对日志，直接出列（fire-and-forget）', async () => {
  const { session, runtime, uid } = setup({ echoes: false, settings: { confirmDelivery: false } });
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(dispatches(session).length, 1);
});

test('插话：未知 id 仍报 schedule_not_found（回归保护）', async () => {
  const { runtime } = setup();
  const result = await runtime.steerById('不存在的-uid');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'schedule_not_found');
});

test('插话：确认预算为正且足够小（避免 UI 长时间挂起）', () => {
  assert.ok(DELIVERY_CONFIRM_TIMEOUT_MS > 0);
  assert.ok(DELIVERY_CONFIRM_TIMEOUT_MS <= 5000);
});

/**
 * 确认是 `await` 的，因此「投递」与「写 dispatch」之间**不再是同一个同步块** ——
 * 这给 auto-driver 留出了插入窗口（旧实现在同一同步块内 append，JS 单线程下
 * 不可能被打断）。这里锁住不变量：即便在确认窗口内反复重驱，也不得双投递。
 *
 * 该测试的**实际敏感点**是 `schedule/change: dispatch` 这个互斥标记（已实测：
 * 去掉标记写入后本用例失败）。它**不**对 `steerById` 里那次重 fold 守卫敏感
 * （去掉守卫本用例仍通过）—— 因为单线程下 `driveOnce` 要 `await flush()` 才会
 * fold，插话总有机会先写完 dispatch。保留该守卫仍是对的（防御未来的调度变化），
 * 但不要误以为本测试覆盖了它。
 */
test('插话：确认窗口内反复重驱也不双投递（dispatch 互斥回归）', async () => {
  const sessionId = 'session-race';
  const uid = 'uid-race-1';
  const record = {
    id: 'schedule-1',
    kind: 'after',
    prompt: '竞态测试',
    afterSeconds: 60,
    // 已到点：auto-driver 一旦跑到 fold 就会想派发它
    scheduledAt: new Date(Date.now() - 5000).toISOString(),
  };
  const session = new FakeSession([
    { type: 'schedule/change', seq: 0, time: 0, data: { version: 1, operation: 'create', schedule: record } },
  ]);
  session.header.id = sessionId;
  recordOwnership(sessionId, record.id, 'user', uid);

  // echo 延迟，让确认窗口足够长，给重驱留出插入机会
  const agent = new FakeAgent(session, { echoes: true, echoDelayMs: 60 });
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, () => settingsOf());

  const pending = runtime.steerById(uid);
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 15));
    runtime.requestDrive();
  }
  const result = await pending;
  await new Promise((r) => setTimeout(r, 200));
  await runtime.dispose();

  assert.equal(result.ok, true);
  const userMessages = session.events.filter((e) => e.type === 'user/message');
  assert.equal(userMessages.length, 1, '同一提醒只能投递一次');
  assert.equal(dispatches(session).length, 1, 'dispatch 只能写一次');
  assert.equal(foldScheduleEvents(session.events, 0).active.length, 0);
});
