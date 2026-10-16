/**
 * 「允许长文本提醒」设置行的静态契约（补齐 §6.3 的既有缺口）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = () => readFileSync(new URL('../src/client/components/SchedulerSettingsCard.tsx', import.meta.url), 'utf8');
const host = () => readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const client = () => readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
const hook = () => readFileSync(new URL('../src/client/hooks/useSchedulerSettings.ts', import.meta.url), 'utf8');

test('host schema 与 client 类型都声明两字段（三处齐全的第一、二处）', () => {
  const h = host();
  assert.match(h, /allowLongPrompts: s\.boolean\(\)\.default\(false\)/);
  assert.match(h, /maxPromptChars: s\.number\(\)\.step\(1\)\.min\(1\)\.default\(DEFAULT_MAX_PROMPT_CHARS\)/);
  const c = card();
  assert.match(c, /allowLongPrompts\?: boolean/);
  assert.match(c, /maxPromptChars\?: number/);
});

test('设置卡 SECTIONS 渲染两字段（第三处；缺它则 README 指引不可达）', () => {
  const c = card();
  assert.match(c, /key: 'allowLongPrompts'/);
  assert.match(c, /key: 'maxPromptChars'/);
});

test('布尔缺省按字段声明的 defaultValue 判定，不写死 true', () => {
  /**
   * 断言**代码**而非注释：文件里有一段注释原样引用了旧写法（解释为什么不能用它），
   * 直接对全文做 doesNotMatch 会被自己的注释打挂。先剥掉 `//` 行注释再判。
   */
  const code = card()
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  assert.doesNotMatch(code, /=== false \? 'false' : 'true'/, '布尔渲染仍写死缺省为 true');
  const occurrences = code.match(/\(v \?\? field\.defaultValue\) \? 'true' : 'false'/g) ?? [];
  assert.equal(occurrences.length, 2, 'displayValue/baselineValue 应都按 defaultValue 兜底');
});

test('allowLongPrompts 的卡片默认值与 host schema 同源（false）', () => {
  const c = card();
  const block = c.slice(c.indexOf("key: 'allowLongPrompts'"));
  assert.match(block.slice(0, 400), /defaultValue: false/);
});

test('maxPromptChars 声明联动依赖，且默认值与 host 一致（1000）', () => {
  const c = card();
  const block = c.slice(c.indexOf("key: 'maxPromptChars'"));
  assert.match(block.slice(0, 400), /requiresEnabled: 'allowLongPrompts'/);
  assert.match(block.slice(0, 400), /defaultValue: 1000/);
});

test('§6.3 联动：开关关闭时输入框禁用，且不自动改数值', () => {
  const c = card();
  assert.match(c, /disabled=\{!writable \|\| saving \|\| gateLocked\}/);
  assert.match(c, /const gateLocked = isGateLocked\(field\)/);
  assert.doesNotMatch(c, /setFieldPending\('maxPromptChars'/, '切换开关不应顺带改写 maxPromptChars');
});

test('锁住字段的非法草稿：不锁死保存按钮，但也不写入宿主', () => {
  const c = card();
  const invalid = c.slice(c.indexOf('const invalidField'), c.indexOf('const anyInvalid'));
  assert.match(invalid, /if \(isGateLocked\(field\)\) return null/);
  const save = c.slice(c.indexOf('const handleSave'), c.indexOf('const invalidField'));
  assert.match(save, /isGateLocked\(field\) && validate\(field, p\.value\) !== null\) continue/);
});

test('联动说明常驻显示（disabled 控件上的 title 不可靠）', () => {
  const c = card();
  assert.match(c, /className="ss-card-gate"/);
  assert.match(c, /aria-describedby=\{gateLocked/);
  assert.doesNotMatch(c, /title=\{gateLocked/, '不该退回 title 提示');
});

test('gate 相关常量声明早于其使用点（TDZ 会让整卡白屏）', () => {
  const c = card();
  const declared = c.indexOf('const allowLongEnabled');
  const usedInSave = c.indexOf('const handleSave');
  const usedInInvalid = c.indexOf('const invalidField');
  // 先确认三者都存在：indexOf 找不到会返回 -1，而 -1 < x 恒真，
  // 不显式排除的话这条断言会在「常量被整个删掉」时假通过。
  assert.ok(declared > 0, 'allowLongEnabled 未声明');
  assert.ok(usedInSave > 0, 'handleSave 未找到');
  assert.ok(usedInInvalid > 0, 'invalidField 未找到');
  assert.ok(declared < usedInSave, 'allowLongEnabled 必须声明在 handleSave 之前');
  assert.ok(declared < usedInInvalid, 'allowLongEnabled 必须声明在 invalidField 之前');
});

test('两字段文案 key 双语齐全', () => {
  const s = client();
  for (const key of [
    'allowLongPromptsLabel',
    'allowLongPromptsHint',
    'maxPromptCharsLabel',
    'maxPromptCharsHint',
    'maxPromptCharsLockedHint',
  ]) {
    const hits = s.match(new RegExp(`\\b${key}:`, 'g')) ?? [];
    assert.ok(hits.length >= 2, `${key} 缺 zh/en 之一`);
  }
});

test('客户端读取管线仍与卡片同源（promptLimits 语义未被改动破坏）', () => {
  const h = hook();
  assert.match(h, /value\['allowLongPrompts'\] === true/);
  assert.match(h, /if \(allowLong && valid\) return \{ allowLong: true, maxChars: raw \};/);
});
