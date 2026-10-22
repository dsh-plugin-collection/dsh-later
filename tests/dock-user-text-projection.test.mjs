/**
 * dock 正文走宿主 `conversation.user.text` 投影的源码级锁（dock-alignment.md I13）。
 *
 * 起因：宿主队列行的正文是
 *   renderFactorySlot('conversation.user.text', { text, facts, interactive: false, ellipsis: true })
 * 而我们直接渲染 `item.prompt` 原文。会话引用的**线格式**是
 *   `@[标签](dsh-session:<base64url(sessionId)>)`   ← dsh-session-reference/lib/types/uri.js:45
 * 而 composer 提交时用的正是 clipboard 投影（`input/facade.ts:426` 的
 * `draft: this.projection.clipboardText`，"chips expanded to their clipboard form"），
 * 所以 `/later` 的正文**会**带着这串 base64 进 sidecar —— 不接投影，行里就露出它。
 *
 * 本文件锁四类「回退后没人会立刻看见」的东西：
 *  1. **hooks 位置**：投影必须待在组件里。`renderRow` 是被 `.map()` 调用的普通函数，
 *     把 `useMemo` 内联回去是编译不报错、运行时才炸的写法；
 *  2. **tick 成本**：dock 每秒重渲染每一行，投影必须被 memo，且 deps 只含稳定身份
 *     （宿主 dock 没有 tick，所以它能内联 —— 这是 I9 同一类前提差异）；
 *  3. **三层降级**：prop 缺失 / factory 未注册 / 调用期抛错，任一层都退回原文，不炸行；
 *  4. **facts 取值**：不给 `sessionLabels`（那会让每秒 tick 去读会话标签列表）。
 *
 * 切片一律断言非空：本仓有过教训（dock-attachments 的 sliceFrom 第一版把切片静默
 * 切空，四条断言全绿其实什么都没测）。
 * @module tests/dock-user-text-projection
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/client/components/ScheduleDock.tsx', import.meta.url), 'utf8');

/** 从 marker 切到下一个 `anchor` 之前；断言切片存在且不短。 */
function sliceBetween(marker, anchor, label, min = 120) {
  const start = component.indexOf(marker);
  assert.notEqual(start, -1, `找不到 ${label} 的起点（marker 失配？）`);
  const rest = component.slice(start + marker.length);
  const end = anchor === null ? rest.length : rest.indexOf(anchor);
  assert.notEqual(end, -1, `${label} 的终点锚失配：${anchor}`);
  const body = rest.slice(0, end);
  assert.ok(body.length >= min, `${label} 切片只有 ${body.length} 字符，疑似被静默切空`);
  return body;
}

const prompt = sliceBetween('function DockPrompt({', '\n/* ==========', 'DockPrompt');
const renderRow = sliceBetween('const renderRow = (item: ClientSchedule)', '\n  };\n', 'renderRow');

test('正文不再直接吐原文，改走 DockPrompt', () => {
  assert.doesNotMatch(renderRow, /className="ss-dock-row-prompt"/,
    '行内不得再自己渲染 .ss-dock-row-prompt（那是投影组件的职责）');
  assert.match(renderRow, /<DockPrompt text=\{item\.prompt\} renderFactorySlot=\{renderFactorySlot\} \/>/,
    'renderRow 必须把正文交给 DockPrompt');
});

test('hooks 待在组件里：renderRow 内不得出现 useMemo/useState', () => {
  // renderRow 是被 .map() 调用的普通函数，不是组件——写进去编译不报错、运行时才炸。
  assert.doesNotMatch(renderRow, /use(Memo|State|Effect|Ref|Id|LayoutEffect)\(/,
    'renderRow 里出现 hooks 会直接违反调用顺序规则');
  assert.match(prompt, /const projected = useMemo\(/, '投影在 DockPrompt 内 memo');
});

test('memo 依赖只含稳定身份（dock 每秒 tick，deps 里放对象等于每秒重算）', () => {
  assert.match(prompt, /\}, \[text, renderFactorySlot\]\);/,
    'deps 必须是 [text, renderFactorySlot]：文本是稳定字符串，函数按 entry 身份稳定');
  assert.doesNotMatch(prompt, /\}, \[[^\]]*item\./, 'deps 不得含 item.* （每帧新对象）');
});

test('投影调用形状与宿主一致', () => {
  assert.match(prompt, /renderFactorySlot\('conversation\.user\.text',/,
    '工厂名必须是 conversation.user.text');
  assert.match(prompt, /facts: DOCK_TEXT_FACTS/);
  assert.match(prompt, /interactive: false/);
  assert.match(prompt, /ellipsis: true/);
  // facts 取值照抄宿主 QUEUE_TEXT_FACTS，且刻意不给 sessionLabels。
  const facts = sliceBetween('const DOCK_TEXT_FACTS = ', ';\n', 'DOCK_TEXT_FACTS', 40);
  assert.match(facts, /collapseWhitespace: true/);
  assert.match(facts, /trimWhitespace: true/);
  assert.doesNotMatch(facts, /sessionLabels/,
    '给 sessionLabels 会让每秒 tick 去读会话标签列表，白涨成本；显式线格式本来就能匹配');
});

test('三层降级都在：prop 缺失 / factory 未注册 / 调用期抛错', () => {
  assert.match(prompt, /if \(renderFactorySlot === undefined\) return text;/,
    '① 更老 renderer 不给这个 prop → 原文');
  assert.match(prompt, /\{ fallback: text \}/,
    '② factory 未注册 → 宿主 FactoryOutlet 返回 fallback ?? null，我们传的就是原文');
  assert.match(prompt, /\}\) \?\? text;/, '③ 返回 null/undefined 也退回原文');
  assert.match(prompt, /catch \{\s*return text;/, '④ 调用期抛错（残留闭包）也退回原文');
});

test('props 镜像里 renderFactorySlot 是可选的', () => {
  const props = sliceBetween('export interface ScheduleDockProps extends ScheduleDockInjected {', '\n}', 'ScheduleDockProps');
  assert.match(props, /renderFactorySlot\?:/, '必须声明为可选：缺失要能降级而不是类型报错');
  assert.match(props, /sessionId\?: string;/, '既有字段没被动到');
});

test('title 仍是原文（chip 化后没有别的途径还原整行文本）', () => {
  assert.match(prompt, /title=\{text\}/);
});
