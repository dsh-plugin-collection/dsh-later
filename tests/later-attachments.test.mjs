/**
 * `/later` 附件支持：带图提交 → 准入块落 sidecar → 到点代发时拼进消息 content。
 *
 * 回归背景：`/later` 未声明 `input.attachments` 时，带图提交被内核三层拦截
 * （输入框提交机 / 命令仲裁 / 宿主注册表），表现为「有图片时 /later 无法发送」。
 * 本组测试锁住修复后的行为面：
 *  1. 命令定义声明（/later 有、/schedule 无）；
 *  2. quick handler 透传 invocation.attachments → sidecar + 成功文案；
 *  3. 原始载荷夹带 attachments 字段无效（P0-1 注入防护不变式）；
 *  4. runtime 到期代发 / 暂停项插话的消息 content 含附件块；
 *  5. pause→resume / edit 跨生命周期保留附件；
 *  6. sidecar 读路径对不可信块的收窄（sanitizeAttachments）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { userScheduleCommands } from '../lib/commands.js';
import {
  userScheduleCreate,
  userScheduleEditPrompt,
  userSchedulePause,
  userScheduleResume,
} from '../lib/user-tools.js';
import { UserScheduleRuntime } from '../lib/runtime.js';
import {
  getOwnership,
  getPaused,
  recordOwnership,
  recordPaused,
  resetCacheForTests,
  sanitizeAttachments,
} from '../lib/ownership-store.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

/** 造一个宿主准入后的图片块（形状同 dsh-commands admitCommandAttachments 产物）。 */
const IMG = (id = 'att-img-1') => ({
  type: 'image',
  attachment: { attachmentId: id, mediaType: 'image/png', bytes: 128, width: 4, height: 4 },
});

/** 造一个文件块。 */
const FILE = (id = 'att-file-1') => ({
  type: 'file',
  attachment: { attachmentId: id, name: 'note.txt', bytes: 5 },
});

// ── 假件（与 runtime.test.mjs / pause.test.mjs 同构）─────────────────────────

let fakeSessionSeq = 0;

class FakeSession {
  constructor(seed = []) {
    this.header = { id: `session-later-attach-${++fakeSessionSeq}`, seedLength: 0 };
    this.events = seed.map((event, index) => ({ seq: index, time: 0, ...event }));
    this.appended = [];
  }

  append(type, data) {
    const seq = this.events.length;
    const event = { type, seq, time: Date.now(), data };
    this.events.push(event);
    this.appended.push(event);
    return event;
  }
}

/** 假 Agent：投递时回写 user/message（送达确认需要）。 */
class FakeAgent {
  constructor(session) {
    this.id = 'agent-later-attach';
    this.session = session;
    this.messages = [];
    this.steered = [];
  }

  #echo(message) {
    this.session.append('user/message', {
      content: message.content,
      source: { kind: 'user' },
      role: 'user',
      id: message.id,
    });
  }

  followup(message) {
    this.messages.push(message);
    this.#echo(message);
  }

  steer(message) {
    this.steered.push(message);
    this.#echo(message);
  }

  async whenIdle() {}

  async runMaintenance(job) {
    return job();
  }
}

function fakeAgent(session = new FakeSession()) {
  return new FakeAgent(session);
}

const fakeCtxOf = (agent) => ({
  sessions: { flush: async () => true },
  agents: { get: () => agent, roots: () => [agent] },
  logger: { warn: () => undefined },
});

const toolCtx = { sessions: { flush: async () => true } };

const settingsOf = () => ({
  steerDelivery: 'followup',
  confirmDelivery: true,
  onUnconfirmed: 'keep',
});

/** 命令工厂的假 ctx（handler 内部只用到 sessions.flush）。 */
const commandCtx = { sessions: { flush: async () => true } };

/** 找到 /later 命令定义。 */
function laterDef(defs) {
  return defs.find((d) => d.name === 'later');
}

function scheduleDef(defs) {
  return defs.find((d) => d.name === 'schedule');
}

// ── 1. 命令定义声明 ─────────────────────────────────────────────────────────

test('命令定义：/later 声明 input.attachments=true，/schedule 不声明', () => {
  const defs = userScheduleCommands(commandCtx, 100, () => {});
  const later = laterDef(defs);
  assert.ok(later, '/later 应在命令表中');
  assert.equal(later.input?.attachments, true, '/later 必须声明接受附件（否则带图提交被内核拒绝）');
  const schedule = scheduleDef(defs);
  assert.ok(schedule, '/schedule 应在命令表中');
  assert.notEqual(schedule.input?.attachments, true, '/schedule（context 注入通道）不接受附件');
});

// ── 2. quick handler 透传附件 ───────────────────────────────────────────────

test('/later handler：附件落 sidecar，成功文案含附件数', async () => {
  freshOwnershipDir();
  const agent = fakeAgent();
  const defs = userScheduleCommands(commandCtx, 100, () => {});
  const result = await laterDef(defs).handler({
    commandId: 'cmd-1',
    agent,
    rawInput: '+5m 看这个图',
    attachments: [IMG(), FILE('att-file-2')],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /（含 2 个附件）/);

  const createEvent = agent.session.appended.find(
    (e) => e.type === 'schedule/change' && e.data.operation === 'create',
  );
  assert.ok(createEvent, '应写入 schedule/change create');
  const entry = getOwnership(agent.session.header.id, createEvent.data.schedule.id);
  assert.ok(entry, 'sidecar 应有所有权条目');
  assert.equal(entry.delivery, 'user');
  assert.equal(entry.attachments?.length, 2);
  assert.equal(entry.attachments[0].type, 'image');
  assert.equal(entry.attachments[1].type, 'file');
});

test('/later handler：无附件时文案不带附件注记、sidecar 无 attachments 字段', async () => {
  freshOwnershipDir();
  const agent = fakeAgent();
  const defs = userScheduleCommands(commandCtx, 100, () => {});
  const result = await laterDef(defs).handler({
    commandId: 'cmd-2',
    agent,
    rawInput: '+5m 纯文字',
    attachments: [],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'success');
  assert.doesNotMatch(result.text, /附件/);
  const createEvent = agent.session.appended.find(
    (e) => e.type === 'schedule/change' && e.data.operation === 'create',
  );
  const entry = getOwnership(agent.session.header.id, createEvent.data.schedule.id);
  assert.equal(entry.attachments, undefined);
});

test('/later handler：只有图片没有文字仍拒绝（内容非空校验不被附件绕过）', async () => {
  freshOwnershipDir();
  const agent = fakeAgent();
  const defs = userScheduleCommands(commandCtx, 100, () => {});
  const result = await laterDef(defs).handler({
    commandId: 'cmd-3',
    agent,
    rawInput: '+5m ',
    attachments: [IMG()],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /提醒内容不能为空/);
  assert.equal(agent.session.appended.length, 0, '拒绝时不得写会话事件');
});

// ── 3. P0-1 注入防护：载荷夹带无效 ──────────────────────────────────────────

test('create：原始载荷夹带 attachments 字段无效，只有 options（可信通道）生效', async () => {
  freshOwnershipDir();
  const agent = fakeAgent();
  const result = await userScheduleCreate(
    {
      prompt: '夹带测试',
      after_seconds: 600,
      time_zone: 'Asia/Shanghai',
      // 模型/载荷试图夹带未准入对象——必须被忽略
      attachments: [{ type: 'image', attachment: { attachmentId: 'spoof' } }],
    },
    agent,
    toolCtx,
  );
  assert.ok(result.ok);
  const entry = getOwnership(agent.session.header.id, result.id);
  assert.equal(entry?.attachments, undefined, '载荷里的 attachments 不得进入 sidecar');
});

// ── 4. runtime 到期代发拼附件 ───────────────────────────────────────────────

test('runtime 到期：user 代发消息 content = [text, 附件块…]', async () => {
  freshOwnershipDir();
  const overdueAt = new Date(Date.now() - 1000).toISOString();
  const record = {
    id: 'schedule-attach-1',
    kind: 'at',
    prompt: '看图说话',
    scheduledAt: overdueAt,
  };
  const session = new FakeSession([
    { type: 'schedule/change', data: { version: 1, operation: 'create', schedule: record } },
  ]);
  recordOwnership(session.header.id, record.id, 'user', 'uid-attach-1', undefined, [
    IMG('att-rt-1'),
    IMG('att-rt-2'),
  ]);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtxOf(agent), agent, settingsOf);
  runtime.requestDrive();
  await new Promise((r) => setTimeout(r, 300));
  await runtime.dispose();

  assert.equal(agent.messages.length, 1);
  const content = agent.messages[0].content;
  assert.equal(content.length, 3, '文本块 + 两个图片块');
  assert.equal(content[0].type, 'text');
  assert.equal(content[0].text, '看图说话');
  assert.equal(content[1].type, 'image');
  assert.equal(content[1].attachment.attachmentId, 'att-rt-1');
  assert.equal(content[2].type, 'image');
  assert.equal(content[2].attachment.attachmentId, 'att-rt-2');
  assert.equal(agent.messages[0].source?.kind, 'user');
  // 派发后出列（fold 不再 active）
  const dispatch = session.events.filter(
    (e) => e.type === 'schedule/change' && e.data.operation === 'dispatch',
  );
  assert.equal(dispatch.length, 1);
});

test('runtime 到期：context 注入路径不受影响（无附件、带防护 framing）', async () => {
  freshOwnershipDir();
  const overdueAt = new Date(Date.now() - 1000).toISOString();
  const record = {
    id: 'schedule-attach-ctx',
    kind: 'at',
    prompt: '普通提醒',
    scheduledAt: overdueAt,
  };
  const session = new FakeSession([
    { type: 'schedule/change', data: { version: 1, operation: 'create', schedule: record } },
  ]);
  recordOwnership(session.header.id, record.id, 'context', 'uid-attach-ctx');
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtxOf(agent), agent, settingsOf);
  runtime.requestDrive();
  await new Promise((r) => setTimeout(r, 300));
  await runtime.dispose();

  assert.equal(agent.messages.length, 1);
  assert.equal(agent.messages[0].content.length, 1, 'context 注入只有文本块');
  assert.match(agent.messages[0].content[0].text, /\[SCHEDULE REMINDER\]/);
});

test('暂停项插话：user 留档带附件时拼回消息 content', async () => {
  freshOwnershipDir();
  const session = new FakeSession([]);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtxOf(agent), agent, settingsOf);
  recordPaused(session.header.id, {
    uid: 'uid-paused-attach',
    prompt: '暂停中的图',
    delivery: 'user',
    kind: 'after',
    remainingSeconds: 30,
    originalScheduledAt: new Date(Date.now() + 30_000).toISOString(),
    originalAfterSeconds: 60,
    lastScheduleId: 'schedule-pa-1',
    pausedAt: Date.now(),
    attachments: [IMG('att-pa-1')],
  });

  const result = await runtime.steerById('uid-paused-attach');
  assert.deepEqual(result, { ok: true, id: 'uid-paused-attach', steered: true });
  assert.equal(agent.messages.length, 1);
  const content = agent.messages[0].content;
  assert.equal(content.length, 2);
  assert.equal(content[0].text, '暂停中的图');
  assert.equal(content[1].attachment.attachmentId, 'att-pa-1');
  await runtime.dispose();
});

// ── 5. pause → resume / edit 生命周期保留 ───────────────────────────────────

test('pause→resume：附件随留档冻结并带回新条目', async () => {
  freshOwnershipDir();
  const agent = fakeAgent();
  const created = await userScheduleCreate(
    { prompt: '十分钟后的图', after_seconds: 600, time_zone: 'Asia/Shanghai' },
    agent,
    toolCtx,
    100,
    { trustedDelivery: 'user', attachments: [IMG('att-life-1')] },
  );
  assert.ok(created.ok);
  if (!created.ok) return;

  const paused = await userSchedulePause(created.id, agent, toolCtx);
  assert.ok(paused.ok);
  if (!paused.ok) return;
  const pausedEntry = getPaused(agent.session.header.id, paused.uid);
  assert.equal(pausedEntry?.attachments?.[0]?.attachment?.attachmentId, 'att-life-1');

  const resumed = await userScheduleResume(paused.uid, agent, toolCtx);
  assert.ok(resumed.ok);
  if (!resumed.ok) return;
  const entry = getOwnership(agent.session.header.id, resumed.schedule_id);
  assert.equal(entry?.attachments?.[0]?.attachment?.attachmentId, 'att-life-1');
});

test('edit：跨「删旧建新」保留附件', async () => {
  freshOwnershipDir();
  const agent = fakeAgent();
  const created = await userScheduleCreate(
    { prompt: '原文案', after_seconds: 600, time_zone: 'Asia/Shanghai' },
    agent,
    toolCtx,
    100,
    { trustedDelivery: 'user', attachments: [FILE('att-edit-1')] },
  );
  assert.ok(created.ok);
  if (!created.ok) return;

  const edited = await userScheduleEditPrompt(created.id, '新文案', agent, toolCtx);
  assert.ok(edited.ok);
  if (!edited.ok) return;
  assert.notEqual(edited.id, created.id, '编辑走删旧建新，id 应变化');
  const oldEntry = getOwnership(agent.session.header.id, created.id);
  assert.equal(oldEntry, undefined, '旧条目已撤销');
  const entry = getOwnership(agent.session.header.id, edited.id);
  assert.equal(entry?.attachments?.[0]?.attachment?.attachmentId, 'att-edit-1');
});

// ── 6. sidecar 读路径收窄（不可信输入防护）─────────────────────────────────

test('sanitizeAttachments：只放行 image/file 块，其余丢弃', () => {
  assert.equal(sanitizeAttachments(undefined), undefined);
  assert.equal(sanitizeAttachments([]), undefined);
  assert.equal(sanitizeAttachments('nope'), undefined);
  assert.equal(sanitizeAttachments([IMG()]).length, 1);
  assert.equal(
    sanitizeAttachments([
      IMG(),
      { type: 'image' }, // 缺 attachment
      { type: 'text', text: 'x' }, // 非附件块
      { type: 'file', attachment: { attachmentId: 42 } }, // attachmentId 非字符串
      null,
      'junk',
      FILE(),
    ]).length,
    2,
    '合法 image+file 保留，非法块全部滤除',
  );
});

test('sidecar 磁盘损坏的附件字段：读路径收窄，不抛错、不放行垃圾', () => {
  freshOwnershipDir();
  const sessionId = 'session-corrupt-attach';
  const dir = process.env.DSH_LATER_STATE_DIR;
  writeFileSync(
    join(dir, `${sessionId}.json`),
    JSON.stringify({
      version: 2,
      entries: {
        'schedule-c1': {
          delivery: 'user',
          createdAt: 1,
          attachments: [{ type: 'evil', payload: 'x' }, IMG('att-ok')],
        },
      },
      paused: {},
    }),
    'utf8',
  );
  resetCacheForTests();
  const entry = getOwnership(sessionId, 'schedule-c1');
  assert.ok(entry);
  assert.equal(entry.attachments.length, 1, '非法块被滤除');
  assert.equal(entry.attachments[0].attachment.attachmentId, 'att-ok');
  // 文件仍可被完整读取（改回干净内容避免影响其他用例）
  const raw = JSON.parse(readFileSync(join(dir, `${sessionId}.json`), 'utf8'));
  assert.equal(raw.entries['schedule-c1'].delivery, 'user');
});
