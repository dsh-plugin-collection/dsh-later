/**
 * 气泡标记的纯决策（issue #112）：档位解析与注册决策表。
 *
 * ## 这个文件在防什么
 *
 * 「`off` 就不注册」是这套方案唯一的总开关：注册条目等于接管官方 `user` / `steering`
 * 渲染器，任何「off 也照注册、只是不画」的实现都会让普通消息白白走一遍我们的组件。
 * 同理，0.2.0 及更早没有用户内容工厂（用它的子槽 `conversation.chat.user.images`
 * 当探针），在那里注册会把官方气泡换成兜底气泡。这两条都在决策表里，用假状态直接测。
 * @module tests/bubble-marker
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBubbleMarker, resolveBubbleMarker } from '../lib/bubble-marker.js';

test('解析：四档原样返回', () => {
  for (const style of ['off', 'left', 'meta', 'hover']) {
    assert.equal(resolveBubbleMarker({ status: 'ready', value: { bubbleMarker: style } }), style);
  }
});

test('解析：缺失/非法回 left（与 host default 同源）', () => {
  assert.equal(resolveBubbleMarker({ status: 'ready', value: {} }), 'left');
  assert.equal(resolveBubbleMarker({ status: 'ready', value: { bubbleMarker: 'weird' } }), 'left');
  assert.equal(resolveBubbleMarker({ status: 'ready', value: { bubbleMarker: 1 } }), 'left');
  assert.equal(resolveBubbleMarker({ status: 'ready', value: null }), 'left');
  assert.equal(resolveBubbleMarker({ status: 'ready' }), 'left');
});

test('解析：未就绪也是 left（注册与否不由这里决定）', () => {
  assert.equal(resolveBubbleMarker({ status: 'loading', value: { bubbleMarker: 'off' } }), 'left');
  assert.equal(resolveBubbleMarker({ status: 'unavailable' }), 'left');
});

test('决策：off 一律销毁', () => {
  assert.equal(
    planBubbleMarker({ style: 'off', nodeReady: true, contentReady: true, registered: true }),
    'off',
  );
  assert.equal(
    planBubbleMarker({ style: 'off', nodeReady: false, contentReady: false, registered: false }),
    'off',
  );
});

test('决策：槽或工厂探针未就绪先等', () => {
  assert.equal(
    planBubbleMarker({ style: 'left', nodeReady: false, contentReady: true, registered: false }),
    'wait',
  );
  assert.equal(
    planBubbleMarker({ style: 'left', nodeReady: true, contentReady: false, registered: false }),
    'wait',
  );
});

test('决策：节点槽不是 keyed 时永不注册（老代次）', () => {
  assert.equal(
    planBubbleMarker({
      style: 'left',
      nodeReady: true,
      contentReady: true,
      registered: false,
      nodeSlotKind: 'single',
    }),
    'wait',
  );
});

test('决策：已注册不重复注册', () => {
  assert.equal(
    planBubbleMarker({ style: 'meta', nodeReady: true, contentReady: true, registered: true }),
    'wait',
  );
});

test('决策：条件齐备才注册', () => {
  assert.equal(
    planBubbleMarker({ style: 'hover', nodeReady: true, contentReady: true, registered: false }),
    'register',
  );
  assert.equal(
    planBubbleMarker({
      style: 'left',
      nodeReady: true,
      contentReady: true,
      registered: false,
      nodeSlotKind: 'keyed',
    }),
    'register',
  );
});
