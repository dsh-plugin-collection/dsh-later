/**
 * 待发附件缩略图的第二条取图通道：内核把耐久图片引用换算成宿主绝对路径（`host_path`），
 * 客户端据此走宿主一等公民的 `GET /api/file` 出图。
 *
 * 为什么需要这条通道（不是把 #38 推翻，而是补上它读不到的那一类）：
 * 宿主的 `session.readAttachment` 只允许读**已被本会话事件引用**的附件
 * （`referencedImage` 只扫 `user/message` / `tool/result` 等第一方事件类型），
 * 而代发前的提醒故意不进日志（附件存 sidecar）。所以「发送后可见」chip 是那条
 * 通道的**必然结果**，不是可以修好的 bug —— 能修的是换一条通道。
 *
 * 因此本文件锁的是三件事：
 *  1. **推导而非存储**：`host_path` 由解析器现算，sidecar 里没有这个字段，
 *     改写 sidecar 造不出假路径；
 *  2. **失败必须收敛**：解析器抛错 / 返回 undefined / 返回空串，一律「整个键不出现」，
 *     绝不让一张缩略图的读取问题升级成整份投影拒读；
 *  3. **两面同规则**：活动项与暂停项共用同一映射（历史分叉的根因就是各写各的）。
 *
 * 另附一条源码级护栏：`attachments` 不得进模块级 inject —— 那是 #34 那类事故
 * （服务不来 → 整个插件永久 pending → `/later` 集体消失）的复发防线。
 * @module tests/attachment-host-path
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyUserScheduleProjection,
  initUserScheduleProjection,
  setImageHostPathResolver,
  userSchedulesSchema,
  viewUserScheduleProjection,
} from '../lib/projection.js';
import { recordOwnership, recordPaused } from '../lib/ownership-store.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

const atSchedule = {
  id: 'schedule-1',
  kind: 'at',
  prompt: '检查构建结果',
  scheduledAt: '2999-01-01T06:00:00.000Z',
};

const imageBlock = (n) => ({
  type: 'image',
  attachment: { attachmentId: `img-${n}`, mediaType: 'image/png', bytes: 1200 + n, width: 8, height: 8 },
});
const fileBlock = (n) => ({
  type: 'file',
  attachment: { attachmentId: `file-${n}`, name: `log-${n}.txt`, bytes: 2048 + n },
});

/** 建一个「用户拥有 schedule-1 且带指定附件」的投影状态，返回其唯一活动项 wire。 */
function activeItem(sessionId, blocks) {
  recordOwnership(sessionId, 'schedule-1', 'user', undefined, undefined, blocks);
  let state = initUserScheduleProjection({ id: sessionId });
  state = applyUserScheduleProjection(state, {
    type: 'schedule/change',
    seq: 0,
    time: 0,
    data: { version: 1, operation: 'create', schedule: atSchedule },
  });
  return viewUserScheduleProjection(state).schedules[0];
}

/** 每条测试后清掉解析器，避免模块级状态在文件内串味。 */
function withResolver(resolver, run) {
  setImageHostPathResolver(resolver);
  try {
    run();
  } finally {
    setImageHostPathResolver(undefined);
  }
}

test('未注入解析器时行为与改动前逐字一致（不带 host_path）', () => {
  freshOwnershipDir();
  const item = activeItem('session-hp-default', [imageBlock(1), fileBlock(1)]);
  assert.deepEqual(item.attachments, [
    { kind: 'image', attachment_id: 'img-1', media_type: 'image/png', bytes: 1201, width: 8, height: 8 },
    { kind: 'file', attachment_id: 'file-1', name: 'log-1.txt', bytes: 2049 },
  ]);
});

test('注入后：image 带 host_path，file 永远不带（宿主只有 imageHostPath）', () => {
  freshOwnershipDir();
  withResolver((ref) => `/dsh/attachments/objects/${ref.attachmentId.slice(0, 2)}/${ref.attachmentId}`, () => {
    const item = activeItem('session-hp-image', [imageBlock(7), fileBlock(7)]);
    assert.equal(item.attachments[0].host_path, '/dsh/attachments/objects/im/img-7');
    assert.equal('host_path' in item.attachments[1], false, 'file 块不得带 host_path');
  });
});

test('解析器收到的是图片引用本身（attachmentId 逐块对应，不是块对象）', () => {
  freshOwnershipDir();
  const seen = [];
  withResolver((ref) => {
    seen.push(ref.attachmentId);
    return '/x';
  }, () => {
    activeItem('session-hp-arg', [imageBlock(1), fileBlock(2), imageBlock(3)]);
  });
  assert.deepEqual(seen, ['img-1', 'img-3'], '只该为 image 块调用，且拿到各自的引用');
});

test('解析器抛错（非法引用）只让那张图降级，不拖垮整份投影', () => {
  freshOwnershipDir();
  // 真实形态：宿主 imageHostPath 对非 sha256 的 attachmentId 抛 AttachmentError。
  withResolver((ref) => {
    if (ref.attachmentId === 'img-1') throw new Error('Attachment reference is invalid.');
    return '/ok/img-2';
  }, () => {
    const item = activeItem('session-hp-throw', [imageBlock(1), imageBlock(2)]);
    assert.equal('host_path' in item.attachments[0], false, '抛错的那块不带键');
    assert.equal(item.attachments[1].host_path, '/ok/img-2', '同带其它块不受影响');
    assert.doesNotThrow(() => userSchedulesSchema.parse({ schedules: [item] }));
  });
});

test('非文件后端（undefined）与空串都收敛成「键不出现」', () => {
  freshOwnershipDir();
  for (const [value, label] of [[undefined, 'undefined'], ['', '空串'], [null, 'null'], [42, '非字符串']]) {
    withResolver(() => value, () => {
      const item = activeItem(`session-hp-empty-${label}`, [imageBlock(1)]);
      assert.equal('host_path' in item.attachments[0], false, `${label} 时整个键必须不出现`);
    });
  }
});

test('暂停项与活动项同一规则（两面分叉是本仓的老病）', () => {
  freshOwnershipDir();
  const sessionId = 'session-hp-paused';
  withResolver((ref) => `/p/${ref.attachmentId}`, () => {
    recordPaused(sessionId, {
      uid: 'uid-p1',
      prompt: atSchedule.prompt,
      delivery: 'user',
      kind: 'after',
      remainingSeconds: 300,
      originalScheduledAt: atSchedule.scheduledAt,
      originalAfterSeconds: 900,
      lastScheduleId: 'schedule-1',
      pausedAt: 1700000000000,
      attachments: [imageBlock(1), fileBlock(1)],
    });
    const paused = viewUserScheduleProjection(initUserScheduleProjection({ id: sessionId }))
      .schedules.find((s) => s.status === 'paused');
    assert.ok(paused, 'sidecar 里的暂停项应出现在视图内');
    assert.equal(paused.attachments[0].host_path, '/p/img-1');
    assert.equal('host_path' in paused.attachments[1], false);
  });
});

test('host_path 能通过 wire viewSchema（.strict() 那一环不炸）', () => {
  freshOwnershipDir();
  withResolver((ref) => `/p/${ref.attachmentId}`, () => {
    const item = activeItem('session-hp-schema', [imageBlock(1), fileBlock(1)]);
    assert.doesNotThrow(() => userSchedulesSchema.parse({ schedules: [item] }));
  });
});

test('护栏：attachments 不进模块级 inject，只走可选 ctx.get（#34 同类防线）', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const decl = /export const inject = \[([^\]]*)\]/.exec(source);
  assert.ok(decl !== null, 'index.ts 必须有模块级 inject 声明');
  const names = [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(!names.includes('attachments'),
    '顶层 inject 是激活门控：附件存储缺席时投影必须照常工作，只少一张缩略图');
  assert.match(source, /ctx\.get\('attachments'\)/, '必须用可选 get 取该服务');
  assert.match(source, /setImageHostPathResolver\(\(ref\) =>/, '解析器必须在 apply 时注入');
});
