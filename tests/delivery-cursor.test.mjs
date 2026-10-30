/**
 * `confirmDelivery` 的游标扫描回归测试。
 *
 * 旧实现每 25ms 重跑一遍 `hasMessageInLog`，每轮都是**全量**遍历；叠上 fork 会话
 * `ownEvents()` 每次返回新拷贝，一次插话最坏要拷 80 份全量日志。现在改为：第一枪
 * 全量扫（消息常常在同一个宏任务里就已落盘，只按游标往前扫会把它跳过），之后每轮
 * 只扫新增段。
 *
 * 所以这里要同时钉住两件相反的事，缺一不可：
 *  - **不漏**：投递先于 confirmDelivery 落盘的、以及落在轮询中途的，都要认出来；
 *  - **不重复扫**：轮询期间不得再读整份日志（用 `ownEvents()` 的调用次数当尺子）。
 * @module tests/delivery-cursor
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmDelivery } from '../lib/delivery.js';

let n = 0;

/** 现代形状的最小假 Session：`seq` + `eventAt` + 每次新数组的 `ownEvents`。 */
class FakeLog {
  constructor() {
    this.header = { id: `session-delivery-${++n}` };
    this.inheritedEventCount = 0;
    this.log = [];
    this.ownEventsCalls = 0;
    this.eventAtCalls = 0;
  }

  get seq() {
    return this.log.length;
  }

  ownEvents() {
    this.ownEventsCalls += 1;
    return Object.freeze(this.log.slice(this.inheritedEventCount));
  }

  eventAt(at) {
    this.eventAtCalls += 1;
    return this.log[at];
  }

  /** 模拟宿主把一条 user/message 落进日志。 */
  pushMessage(messageId) {
    const event = { type: 'user/message', seq: this.log.length, time: Date.now(), data: { id: messageId } };
    this.log.push(event);
    return event;
  }
}

test('消息在 confirmDelivery 之前就已落盘：必须第一枪就认出来', async () => {
  const session = new FakeLog();
  session.pushMessage('msg-early');

  assert.equal(await confirmDelivery(session, 'msg-early', 1000), true, '已落盘的消息判成未确认');
});

test('消息落在轮询中途：游标必须向前追上它', async () => {
  const session = new FakeLog();
  // 先塞一段无关历史，确保「扫新增段」真的需要往前移动位点。
  for (let i = 0; i < 20; i += 1) session.pushMessage(`unrelated-${i}`);

  const target = 'msg-late';
  const timer = setTimeout(() => session.pushMessage(target), 60);
  try {
    assert.equal(await confirmDelivery(session, target, 1500), true, '轮询期间落盘的消息没被追上');
  } finally {
    clearTimeout(timer);
  }
});

test('日志没长时轮询是零成本：只允许开头那一次全量扫', async () => {
  const session = new FakeLog();
  for (let i = 0; i < 50; i += 1) session.pushMessage(`history-${i}`);

  // 目标不存在，且期间日志一条都不新增 → 走满超时。
  const found = await confirmDelivery(session, 'msg-never', 200);
  assert.equal(found, false, '不存在的消息不该被判成已确认');

  // 旧口径：约 8 轮 × 每轮全量 50 条 = 400 次读取 + 8 次整表拷贝。
  // 现口径：开头一次全量扫，之后每轮只看「有没有新增」，没有新增就连一次都不读。
  assert.equal(session.ownEventsCalls, 1, '轮询期间又全量读了日志');
  assert.equal(session.eventAtCalls, 0, '日志未新增却仍在逐条读事件');
});

test('日志在轮询期间增长：只有新增段被读，整表不再重读', async () => {
  const session = new FakeLog();
  for (let i = 0; i < 50; i += 1) session.pushMessage(`history-${i}`);

  const target = 'msg-late2';
  const timer = setTimeout(() => {
    for (let i = 0; i < 5; i += 1) session.pushMessage(i === 4 ? target : `noise-${i}`);
  }, 60);
  try {
    assert.equal(await confirmDelivery(session, target, 1500), true);
  } finally {
    clearTimeout(timer);
  }

  // 50 条历史只在开头那次全量扫里被读一遍；追上目标靠的是新增的 5 条。
  assert.equal(session.ownEventsCalls, 1, '增长期间又全量读了日志');
  assert.ok(
    session.eventAtCalls < 50,
    `eventAt 读取次数 ${session.eventAtCalls} 与「新增段」不同阶，说明在按轮重扫全表`,
  );
});

test('嵌套形态（data.message.id）在增量路径上同样认得出', async () => {
  const session = new FakeLog();
  const target = 'msg-nested';
  const timer = setTimeout(() => {
    session.log.push({
      type: 'assistant/step',
      seq: session.log.length,
      time: Date.now(),
      data: { message: { id: target } },
    });
  }, 50);
  try {
    assert.equal(await confirmDelivery(session, target, 1500), true, '包裹形态漏判');
  } finally {
    clearTimeout(timer);
  }
});
