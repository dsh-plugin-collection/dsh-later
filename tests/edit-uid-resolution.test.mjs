/**
 * issue #44：dock 行内编辑必须接受 uid。
 *
 * 事故形态：投影有意把 uid 当作 `id` 暴露给客户端（`projection.ts:179`
 * `id: uid ?? record.id`），所以 dock 传 uid 是对的；host 侧要用
 * `resolveActiveScheduleId()` 换算。`userScheduleDelete` 与 `userSchedulePause`
 * 都调了它，**唯独 `userScheduleEditPrompt` 漏了** —— 于是同一个 uid
 * 删除能成功、改文案却静默失败（报 schedule_not_found）。
 *
 * 为什么现有 337 个测试没抓到：`user-tools.test.mjs` 的编辑用例传的是
 * `created.id`（真 schedule id）与字面量 `'schedule-past'`，**从没传过 uid**。
 * 本文件补的就是这条从未被走过的路径。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_MAX_SCHEDULES,
  userScheduleCreate,
  userScheduleEditPrompt,
  userSchedulePause,
} from '../lib/user-tools.js';
import { getOwnership } from '../lib/ownership-store.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

let seq = 0;
class FakeSession {
  constructor(id) { this.header = { id, seedLength: 0 }; this.events = []; }
  append(type, data) {
    const event = { type, seq: this.events.length, time: Date.now(), data };
    this.events.push(event);
    return event;
  }
}
function fakeAgent() {
  return { id: 'agent-test', session: new FakeSession(`session-uid-edit-${++seq}`), ctx: {} };
}
const fakeCtx = { sessions: { flush: async () => true } };

/**
 * 建一条 after 提醒。**返回同一个 agent** —— 后续编辑/暂停必须在同一会话上跑，
 * 因为 `foldUserState` 是从该 session 的事件里读 schedule 的。
 */
async function createOne(prompt = '稍后替我说') {
  const agent = fakeAgent();
  const created = await userScheduleCreate(
    { prompt, after_seconds: 600 },
    agent,
    fakeCtx,
    DEFAULT_MAX_SCHEDULES,
    { trustedDelivery: 'user' },
  );
  assert.ok(created.ok, `create 失败：${JSON.stringify(created)}`);
  const sessionId = agent.session.header.id;
  const uid = getOwnership(sessionId, created.id)?.uid;
  assert.ok(typeof uid === 'string' && uid.length > 0, 'sidecar 里应有 uid');
  return { agent, sessionId, scheduleId: created.id, uid };
}

test('编辑接受 uid（issue #44 的复现路径）', async () => {
  freshOwnershipDir();
  const { agent, sessionId, scheduleId, uid } = await createOne();

  // 修复前：这里返回 schedule_not_found —— 编辑路径拿 uid 直接比 record.id
  const edited = await userScheduleEditPrompt(uid, '改个说法', agent, fakeCtx);
  assert.ok(edited.ok, `用 uid 编辑应成功，实际：${JSON.stringify(edited)}`);
  assert.equal(edited.prompt, '改个说法');

  // 删旧建新：旧 schedule id 的所有权应被撤销
  assert.equal(getOwnership(sessionId, scheduleId), undefined, '旧 id 所有权已撤销');
  // uid 跨编辑保留（否则 dock 行认不回这条任务）
  assert.equal(getOwnership(sessionId, edited.id)?.uid, uid, '新 id 沿用同一 uid');
});

test('编辑仍接受真 schedule id（不回归既有调用方）', async () => {
  freshOwnershipDir();
  const { agent, scheduleId } = await createOne();
  const edited = await userScheduleEditPrompt(scheduleId, '用真 id 改', agent, fakeCtx);
  assert.ok(edited.ok, `真 schedule id 应继续可用：${JSON.stringify(edited)}`);
  assert.equal(edited.prompt, '用真 id 改');
});

test('暂停项仍按 uid 编辑成功（换算不得污染 paused 查找）', async () => {
  freshOwnershipDir();
  const { agent, uid } = await createOne('暂停后再改');
  const paused = await userSchedulePause(uid, agent, fakeCtx);
  assert.ok(paused.ok, `pause 应成功：${JSON.stringify(paused)}`);

  // paused 表以 uid 为键。若编辑路径先换成 scheduleId 再查 paused，这里就会失败
  // —— 那等于把一个 bug 换成另一个（暂停项反而改不了文案）。
  const edited = await userScheduleEditPrompt(uid, '暂停态改文案', agent, fakeCtx);
  assert.ok(edited.ok, `暂停项按 uid 编辑应成功：${JSON.stringify(edited)}`);
});

test('查不到时报错回显调用方传入的 id（而非换算后的值）', async () => {
  freshOwnershipDir();
  const r = await userScheduleEditPrompt('schedule-does-not-exist', 'x', fakeAgent(), fakeCtx);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'schedule_not_found');
  assert.match(r.message, /schedule-does-not-exist/, '报错应含调用方手里那个 id');
});

test('结构守卫：编辑必须走 resolver，且 paused 查找必须用原始 id', () => {
  const src = readFileSync(new URL('../src/user-tools.ts', import.meta.url), 'utf8');
  const start = src.indexOf('export async function userScheduleEditPrompt');
  const end = src.indexOf('/** 把 wire/命令里的 id 解析为当前 active');
  assert.ok(start > 0 && end > start, '未截取到 userScheduleEditPrompt 函数体');
  const fn = src.slice(start, end);

  // 正向：必须调 resolver
  assert.match(fn, /resolveActiveScheduleId\(sessionId, id\)/, '编辑路径必须做 uid→scheduleId 换算');
  // 反向：paused 查找不得被换算污染（该表以 uid 为键）
  assert.match(fn, /getPaused\(sessionId, id\)/, 'paused 查找必须用原始 id');
  assert.doesNotMatch(fn, /getPaused\(sessionId, scheduleId\)/, 'paused 查找不得改用换算后的 scheduleId');

  // 三个用户操作现在应全部经过 resolver —— 漏一处就是本次的 bug 形态
  for (const name of ['userScheduleDelete', 'userSchedulePause', 'userScheduleEditPrompt']) {
    const body = src.slice(src.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 3500), /resolveActiveScheduleId/, `${name} 应调用 resolveActiveScheduleId`);
  }
});
