/**
 * Issue #10：`/user-schedule-*` 七条命令在输入框手敲时的载荷认领与裸 id 容错。
 *
 * 回归背景：内核客户端命令机 `@deepseek-ai/dsh-client-ui-commands/lib/client.js`
 * 的 `matchEnter()`（0.2.1-rc.5 约 :1661-1665）只在 `desc.input !== void 0` 时才
 * 认领整行——「带参数但没声明 input」直接 `return void 0`，整行被当普通聊天消息
 * 发给模型（实测抓到 `POST /api/session/prompt`）；裸命令虽然会执行，但走的是
 * 不含参数的通道，于是表现为「带参不执行、空参报『缺少 JSON 载荷。』」。
 * `/schedule`、`/later` 声明了 `input`，所以一直是好的——七条 dock 命令漏了。
 *
 * 本文件钉三件事：
 *  1. 工厂产出的七条 `user-schedule-*` 定义都带 `input.hint`（认领开关）；
 *  2. `coercePayload` 四种输入的行为（空 / 合法 JSON 对象 / 裸 schedule id / 坏 JSON）；
 *  3. `-list` 不引入任何载荷要求：它的 hint 明说「无需载荷」，且 handler 对
 *     空参数与带参数都不报错（实现照旧完全忽略 rawInput，与修复前一致）。
 *     ——之所以仍给它 `input`，是为了让 `/user-schedule-list 随便什么` 这一行
 *     也被命令认领而不是发给模型；这是认领面的修复，不是载荷语义的改动。
 *
 * 另外补一条端到端：经 `-create` 建一条，再用**裸 id** 调 `-pause`，验证容错
 * 真的接进了 handler（不只是纯函数单测）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userScheduleCommands, coercePayload } from '../lib/commands.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

const SEVEN = [
  'user-schedule-create',
  'user-schedule-list',
  'user-schedule-delete',
  'user-schedule-edit',
  'user-schedule-pause',
  'user-schedule-resume',
  'user-schedule-steer-now',
];

/** 命令工厂的假 ctx（handler 内部只用到 sessions.flush）。 */
const commandCtx = { sessions: { flush: async () => true }, logger: { warn: () => undefined } };

function defs() {
  return userScheduleCommands(commandCtx, 100, () => {});
}

function defOf(name) {
  return defs().find((d) => d.name === name);
}

// ── 1. 七条都声明 input.hint ────────────────────────────────────────────────

test('#10 七条 user-schedule-* 命令都带 input.hint（内核 matchEnter 认领开关）', () => {
  for (const name of SEVEN) {
    const def = defOf(name);
    assert.ok(def, `${name} 应在命令表中`);
    assert.equal(
      typeof def.input?.hint,
      'string',
      `${name} 必须声明 input.hint，否则带参手敲整行会被当普通聊天消息发给模型`,
    );
    assert.ok(def.input.hint.length > 0, `${name} 的 hint 不能是空串`);
  }
});

test('#10 载荷类命令的 hint 说清 JSON 形状（不与 /schedule /later 的写法冲突）', () => {
  // 六条走 coercePayload 的命令里，除 -create（载荷是提醒定义）外都以 id 为主键，
  // hint 必须同时给出「JSON 载荷」与「裸 id」两种写法；-edit 需要 prompt，只给 JSON。
  for (const name of ['user-schedule-delete', 'user-schedule-pause', 'user-schedule-resume', 'user-schedule-steer-now']) {
    const hint = defOf(name).input.hint;
    assert.match(hint, /JSON 载荷/, `${name} 的 hint 要写明是 JSON 载荷`);
    assert.match(hint, /裸 id/, `${name} 的 hint 要写明也接受裸 id`);
  }
  assert.match(defOf('user-schedule-create').input.hint, /JSON 载荷/);
  assert.match(defOf('user-schedule-edit').input.hint, /JSON 载荷/);
});

// ── 2. coercePayload 的四种输入 ─────────────────────────────────────────────

test('#10 coercePayload：空串保留原「缺少 JSON 载荷。」', () => {
  for (const raw of ['', '   ', '\n']) {
    const r = coercePayload(raw);
    assert.equal(r.ok, false);
    assert.equal(r.text, '缺少 JSON 载荷。');
  }
});

test('#10 coercePayload：合法 JSON 对象原样通过', () => {
  const r = coercePayload('{"id":"schedule-abc"}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { id: 'schedule-abc' });
});

test('#10 coercePayload：裸 schedule id 归一化成 { id }', () => {
  const r = coercePayload('schedule-3f2a-1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { id: 'schedule-3f2a-1' });
  const spaced = coercePayload('  schedule-00000000-0000-4000-8000-000000000000  ');
  assert.equal(spaced.ok, true);
  assert.deepEqual(spaced.value, { id: 'schedule-00000000-0000-4000-8000-000000000000' });
});

test('#10 coercePayload：坏 JSON / 非对象 / 不像 id 的裸串仍报错，不吞成成功', () => {
  const cases = [
    ['{"id":}', 'JSON 载荷解析失败。'],
    ['[1,2]', 'JSON 载荷必须是一个对象。'],
    ['null', 'JSON 载荷必须是一个对象。'],
    ['42', 'JSON 载荷必须是一个对象。'],
    ['schedule-', 'JSON 载荷解析失败。'], // 前缀后没东西，不是合法 id 形状
    ['not-a-payload', 'JSON 载荷解析失败。'],
  ];
  for (const [raw, text] of cases) {
    const r = coercePayload(raw);
    assert.equal(r.ok, false, `${raw} 必须失败`);
    assert.equal(r.text, text, `${raw} 走原有错误文案`);
  }
});

// ── 3. -list 不引入载荷要求 ─────────────────────────────────────────────────

test('#10 -list：hint 声明无需载荷，空参数与带参数都不报错（语义未变）', async () => {
  freshOwnershipDir();
  const list = defOf('user-schedule-list');
  assert.match(list.input.hint, /无需载荷/);

  const session = new FakeSession();
  const agent = fakeAgent(session);
  const invocation = (rawInput) => ({
    commandId: 'cmd-list',
    agent,
    rawInput,
    signal: new AbortController().signal,
  });

  const empty = await list.handler(invocation(''));
  assert.equal(empty.kind, 'success', '空参数照旧列出（修复前后都不报「缺少 JSON 载荷」）');
  assert.deepEqual(JSON.parse(empty.text), []);

  const withArgs = await list.handler(invocation('随便写点什么'));
  assert.equal(withArgs.kind, 'success', '-list 完全忽略 rawInput，不解析载荷');
  assert.deepEqual(JSON.parse(withArgs.text), []);
});

// ── 4. 端到端：裸 id 真接进了 handler ───────────────────────────────────────

test('#10 -create 走 JSON 载荷建成，-pause 用裸 id 暂停成功', async () => {
  freshOwnershipDir();
  const session = new FakeSession();
  const agent = fakeAgent(session);
  const invocation = (rawInput, commandId) => ({
    commandId,
    agent,
    rawInput,
    signal: new AbortController().signal,
  });

  const created = await defOf('user-schedule-create').handler(
    invocation('{"prompt":"起来喝水","after_seconds":300}', 'cmd-create'),
  );
  assert.equal(created.kind, 'success', `创建应成功，实得 ${created.text}`);
  const id = JSON.parse(created.text).id;
  assert.ok(typeof id === 'string' && id.startsWith('schedule-'), `id 应是 schedule- 前缀，实得 ${id}`);

  const paused = await defOf('user-schedule-pause').handler(invocation(id, 'cmd-pause'));
  assert.equal(paused.kind, 'success', `裸 id 应被归一化成 { id } 并暂停成功，实得 ${paused.text}`);
});

test('#10 -delete 空参数仍报「缺少 JSON 载荷。」（不因为认领而变哑）', async () => {
  freshOwnershipDir();
  const session = new FakeSession();
  const agent = fakeAgent(session);
  const result = await defOf('user-schedule-delete').handler({
    commandId: 'cmd-del',
    agent,
    rawInput: '',
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'error');
  assert.equal(result.text, '缺少 JSON 载荷。');
});

// ── 假件（与 later-attachments.test.mjs 同构，只保留本文件需要的部分）───────

let fakeSessionSeq = 0;

class FakeSession {
  constructor(seed = []) {
    this.header = { id: `session-slash-input-${++fakeSessionSeq}`, seedLength: 0 };
    this.events = seed.map((event, index) => ({ seq: index, time: 0, ...event }));
    this.appended = [];
  }

  append(type, data) {
    const event = { type, seq: this.events.length, time: Date.now(), data };
    this.events.push(event);
    this.appended.push(event);
    return event;
  }
}

class FakeAgent {
  constructor(session) {
    this.id = 'agent-slash-input';
    this.session = session;
    this.messages = [];
    this.steered = [];
  }

  followup(message) {
    this.messages.push(message);
  }

  steer(message) {
    this.steered.push(message);
  }

  async whenIdle() {}

  async runMaintenance(job) {
    return job();
  }
}

function fakeAgent(session = new FakeSession()) {
  return new FakeAgent(session);
}
