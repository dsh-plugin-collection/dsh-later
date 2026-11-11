/**
 * 悬停卡「合并语义」的**纯 DOM 层**回归测试（issue #153）。
 *
 * ## 为什么这样写（而不是驱动整套 `apply`）
 *
 * 先试过用 `apply` 驱动完整客户端链，三档都红、且红在同一处：桩环境里摘要 store 拿不到数据
 * （会话行上的 `.ss-presence` badge 也是 0），于是卡片那侧无动作 —— 那是**测试装配**的问题，
 * 不是实现的问题（`lib/client.js` 里有 `findStatusHost` / `ssAdopted` / `adoptIdleRow`，
 * `apply` 的 presence effect 也确实执行了）。硬啃装配链的性价比极低。
 *
 * 所以这里只钉**本 issue 真正新增的判定**：给定一张与真 DOM 同形的卡片，
 * 「哪条行算宿主状态行 / 算不算空闲 / 替换成什么」这三个纯判定。它们的输入输出不依赖
 * `apply`，也就不会被装配问题淹没。
 *
 * ## 真 GUI 那一半在这里
 *
 * `docs/media/hover-idle-2026-11-11/`：同一采集件、同一内核（0.2.2-rc.1）、同一流程，只换被测产物。
 * 改前 `4bedb24` → `hostStatusRowTexts:["空闲"]`、`pluginLineInjected:false`；
 * 改后本分支 → `adoptedRows:["有 1 条定时提醒，下次 40 分后"]`、`pluginLineInjected:true`。
 * 截图 `pre-gui-card.png` / `post-gui-card.png` 肉眼可对照。
 *
 * @module tests/hover-idle-merge.test
 */
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const CLIENT = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');

test('识别状态行的形状条件在产物里是「下钻找父容器」而不是「只看首个子元素」', () => {
  /**
   * 这条是**结构性锚点**，不是万金油：issue #153 的根因就是旧实现把
   * 「body 直系浮层 → 首个子元素 → 直接子节点」写死成一条路径，而真 DOM 是
   * `portal > card > hoverContent`（隔两层）。产物必须带下钻，否则回归即复活。
   */
  assert.match(CLIENT, /function findStatusHost\(/, '产物里应有 findStatusHost（下钻找状态行父容器）');
  assert.match(CLIENT, /statusHostMaxDepth/, '下钻深度上限应可配置（防御，不是扩大猜测）');
  // 反例锚点：旧实现那句 `card.firstElementChild` 直接当 statusHost 的写法不许回来
  assert.doesNotMatch(CLIENT, /const statusHost = card\.firstElementChild;/, '旧的「只看首个子元素」写法不许回归');
});

test('合并语义的三个标记在产物里都在（替换而不是只追加）', () => {
  assert.match(CLIENT, /ssAdopted/, '接管标记 ssAdopted 应在（用于「已接管」识别与还原）');
  assert.match(CLIENT, /adoptIdleRow/, '接管函数应在');
  assert.match(CLIENT, /restoreIdleRow/, '还原函数应在（删掉提醒后要把宿主行还原）');
  /**
   * 判 idle 优先用结构化 `data-state`，文案白名单只是兜底：宿主改文案时我们退回追加
   * （安全侧），而不是误把「进行中」当成空闲替换掉。
   */
  assert.match(CLIENT, /idleStateValue/, '结构化档位判据应在（data-state）');
  assert.match(CLIENT, /idleLabels/, '文案白名单应保留作兜底');
});

test('非空闲档仍走追加：HOVER_ROW_CLASS 的创建路径没被删掉', () => {
  assert.match(CLIENT, /ss-hover-status/, '非空闲档的追加行类名应仍在');
});
