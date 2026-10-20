/**
 * 附件图片失败分类（`/later` 带图提醒在发送前显示「图片不可用」的事故）。
 *
 * 事故形态：给 `/later` 带一张图，dock 上图片位显示「图片不可用 42KB」，看起来像附件丢了。
 * 实机抓到的宿主拒绝原因是：
 *
 *   session/attachment-invalid: Image is not referenced by this session.
 *
 * 而到点之后图片会正常随消息发出（已实测）。也就是说：**发送前读不到是预期状态**
 * （附件的字节只有在被会话事件引用后才对会话作用域可读），与真正的损坏是两回事。
 * 这个分类抽在 `src/attachment-failure.ts`，本文件锁住它的判定边界。
 * @module tests/attachment-failure
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyAttachmentFailure } from '../lib/attachment-failure.js';

test('宿主「未被本会话引用」→ pending-send（待发送提醒的预期状态）', () => {
  assert.equal(
    classifyAttachmentFailure(new Error('session/attachment-invalid: Image is not referenced by this session.')),
    'pending-send',
  );
  // 宿主错误文本可能只给 message，不带 code 前缀。
  assert.equal(
    classifyAttachmentFailure(new Error('Image is not referenced by this session')),
    'pending-send',
  );
});

test('其它读取失败仍是 unavailable（真异常不能伪装成"待发送"）', () => {
  assert.equal(classifyAttachmentFailure(new Error('ui-conversation: unknown session "s1"')), 'unavailable');
  assert.equal(classifyAttachmentFailure(new Error('ui-conversation image cache was disposed before loading completed')), 'unavailable');
  assert.equal(classifyAttachmentFailure(new Error('boom')), 'unavailable');
});

test('非 Error 输入也要能分类（不抛）', () => {
  assert.equal(classifyAttachmentFailure(undefined), 'unavailable');
  assert.equal(classifyAttachmentFailure(null), 'unavailable');
  assert.equal(classifyAttachmentFailure('session/attachment-invalid'), 'pending-send');
  assert.equal(classifyAttachmentFailure({ code: 'session/attachment-invalid' }), 'unavailable',
    '对象形态不解析 code —— 宿主抛的是 Error，不要为假想输入放宽匹配');
});
