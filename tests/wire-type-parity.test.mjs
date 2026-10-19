/**
 * host ↔ client 手写镜像的类型对等锁（Gitea issue #37）。
 *
 * 本仓 host 与 client 两侧故意**不共用类型**（客户端不反向依赖宿主模块），
 * 于是 `UserScheduleWireItem` ↔ `ClientSchedule`、`WireAttachment` ↔
 * `ClientAttachment` 是两对手写镜像。手写镜像没有编译器兜着：host 加了字段而
 * client 忘了跟，TS 不会报错，只会在运行时表现为「字段永远 undefined」。
 *
 * 这正是本次事故的形态——附件在 host 侧的 sidecar 里存在已久，GUI 一侧从来
 * 没人取过，也没有任何断言能发现。所以这里做**源码级**的成员名集合对等：
 * 不依赖编译产物（`lib/**` 由 Lead 在集成时统一重建），改一边忘另一边立刻变红。
 *
 * 只比成员**名字集合**，不比修饰符与顺序：可选性差异会由 typecheck 与
 * wire schema 测试分别兜住，这里要防的是"漏了一个字段"。
 * @module tests/wire-type-parity
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/**
 * 从 TS 源文件里抠出一个 interface 的成员名集合。
 *
 * 闭合按 `\n}` 判定（interface 体内的成员行都有缩进，收尾的 `}` 顶格），
 * 不用 `};` 之类易变写法。
 */
function interfaceMembers(source, name, label) {
  const start = source.indexOf(`export interface ${name} {`);
  assert.notEqual(start, -1, `${label} 里应能找到 interface ${name}`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${label} 的 interface ${name} 未正常闭合`);
  const body = source.slice(start, end);
  const members = [...body.matchAll(/^\s+readonly\s+([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/gm)].map((m) => m[1]);
  assert.ok(members.length > 0, `${label} 的 interface ${name} 没解析到任何成员（正则失配？）`);
  return new Set(members);
}

/** 两侧都有的成员做集合比较；返回差异描述。 */
function diff(a, b) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  return { onlyA, onlyB, equal: onlyA.length === 0 && onlyB.length === 0 };
}

const host = read('src/domain.ts');
const client = read('src/client/types.ts');

test('WireAttachment ↔ ClientAttachment 成员名集合完全相等（#37）', () => {
  const a = interfaceMembers(host, 'WireAttachment', 'src/domain.ts');
  const b = interfaceMembers(client, 'ClientAttachment', 'src/client/types.ts');
  const { onlyA, onlyB, equal } = diff(a, b);
  assert.ok(
    equal,
    `host/client 附件类型分叉：仅 host 有 [${onlyA.join(', ')}]，仅 client 有 [${onlyB.join(', ')}]。`
      + ' 手写镜像必须同步改，否则客户端读到 undefined 且 typecheck 不报错。',
  );
});

test('UserScheduleWireItem ↔ ClientSchedule 成员名集合完全相等（#37）', () => {
  const a = interfaceMembers(host, 'UserScheduleWireItem', 'src/domain.ts');
  const b = interfaceMembers(client, 'ClientSchedule', 'src/client/types.ts');
  const { onlyA, onlyB, equal } = diff(a, b);
  assert.ok(
    equal,
    `投影 wire 与客户端类型分叉：仅 host 有 [${onlyA.join(', ')}]，仅 client 有 [${onlyB.join(', ')}]。`,
  );
});

test('两侧都带交叉引用注释，防止后来者不知道另一头存在', () => {
  assert.match(host, /ClientAttachment/, 'src/domain.ts 的 WireAttachment 注释应指向客户端镜像名');
  assert.match(client, /WireAttachment/, 'src/client/types.ts 的 ClientAttachment 注释应指回 host 镜像名');
  assert.match(client, /wire-type-parity/, '客户端注释应点明由本测试锁住');
});
