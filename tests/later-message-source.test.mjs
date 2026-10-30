/**
 * `/later` 代发消息的来源标记（issue #112）。
 *
 * ## 这个文件在防什么
 *
 * 客户端认不出「哪条用户消息是定时发的」：投递时 `source` 只有 `{kind:'user'}`，
 * 与手动发送完全一致。标记（`source.later`）是整条呈现链路唯一的判据，所以写侧形状
 * 与读侧容错都要钉死：
 *  - 写侧字段名/取值漂了，客户端会静默不画钟；
 *  - 读侧过严（例如要求 `v === 1`），未来加字段就整条失效；
 *  - 读侧过松（`{}` 也算），普通消息会被误标。
 * @module tests/later-message-source
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LATER_SOURCE_VERSION,
  laterUserSource,
  readLaterMarker,
} from '../lib/later-message-source.js';

test('写侧：一次性 1 条', () => {
  assert.equal(LATER_SOURCE_VERSION, 1);
  assert.deepEqual(laterUserSource({ delivery: 'one-shot', count: 1 }), {
    kind: 'user',
    later: { v: 1, delivery: 'one-shot', count: 1 },
  });
});

test('写侧：固定间隔 3 条', () => {
  assert.deepEqual(laterUserSource({ delivery: 'every', count: 3 }), {
    kind: 'user',
    later: { v: 1, delivery: 'every', count: 3 },
  });
});

test('写侧：count 归一到 >=1 的整数', () => {
  const countOf = (count) => laterUserSource({ delivery: 'one-shot', count }).later.count;
  assert.equal(countOf(0), 1);
  assert.equal(countOf(-3), 1);
  assert.equal(countOf(Number.NaN), 1);
  assert.equal(countOf(2.7), 2);
  assert.equal(countOf(5), 5);
});

test('写侧：未知 delivery 回落 one-shot', () => {
  const source = laterUserSource({ delivery: 'other', count: 1 });
  assert.equal(source.later.delivery, 'one-shot');
});

test('读侧：完整形状', () => {
  const marker = readLaterMarker({
    kind: 'user',
    later: { v: 1, delivery: 'every', count: 4 },
  });
  assert.deepEqual(marker, { v: 1, delivery: 'every', count: 4 });
});

test('读侧：版本更高仍识别为定时消息（前向兼容）', () => {
  const marker = readLaterMarker({ kind: 'user', later: { v: 2, delivery: 'one-shot', count: 1 } });
  assert.equal(marker?.v, 2);
});

test('读侧：非对象/缺字段一律 undefined', () => {
  for (const bad of [undefined, null, 'later', 42, {}, { later: null }, { later: 5 }, { later: {} }]) {
    assert.equal(readLaterMarker(bad), undefined, JSON.stringify(bad));
  }
});

test('读侧：坏版本不识别', () => {
  assert.equal(readLaterMarker({ later: { v: 0, count: 1 } }), undefined);
  assert.equal(readLaterMarker({ later: { v: Number.NaN, count: 1 } }), undefined);
  assert.equal(readLaterMarker({ later: { v: '1', count: 1 } }), undefined);
});

test('读侧：坏 count / 未知 delivery 回落', () => {
  assert.equal(readLaterMarker({ later: { v: 1, count: 0 } })?.count, 1);
  assert.equal(readLaterMarker({ later: { v: 1, count: 'x' } })?.count, 1);
  assert.equal(readLaterMarker({ later: { v: 1, delivery: 'weird', count: 1 } })?.delivery, 'one-shot');
});

test('写读往返', () => {
  const source = laterUserSource({ delivery: 'every', count: 2 });
  assert.deepEqual(readLaterMarker(source), { v: 1, delivery: 'every', count: 2 });
});
