/**
 * host 入口的激活门控回归测试（/later 消失事故）。
 *
 * 事故形态：`src/index.ts` 的模块级 `inject` 里列了 `'locale'`。cordis 把顶层
 * inject 当**激活门控**——服务不来，整个入口就永久 `pending`，于是
 * `ctx.commands.register` 一次都没执行，`/later`、`/schedule`、`/user-schedule-*`
 * 集体消失。宿主日志的表现是：
 *
 *   dsh: warning: 1 entry did not activate
 *   later (dsh-later): pending (waiting for service: locale)
 *
 * `locale` 是 client 侧服务（`@deepseek-ai/dsh-client-locale`），host 平面永远没有，
 * 所以它绝不能出现在这份清单里。引入方是 commit b7fc4b7（host 侧文案 i18n）。
 *
 * 本文件锁三件事：
 *  1. host 顶层 inject 不含任何 client 平面服务；
 *  2. locale 的三处消费点保持可选链——去掉门控后拿不到语言必须**静默走默认值**，
 *     而不是抛错（否则等于把事故换成另一个事故）；
 *  3. client 入口**可以**列 `locale`（那里它真实存在），两代平面是有意不对称的，
 *     防止有人"统一两边"把它加回 host。
 * @module tests/host-entry-activation
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const host = read('src/index.ts');
const client = read('src/client/index.tsx');

/**
 * 取模块级 inject 的字符串成员。
 * 两代入口的写法不同：host 是 `export const inject`，client 是 `const inject`
 * （由文件底部 `export { apply, inject, name }` 汇出）——两种都要认。
 */
function topLevelInject(source, label) {
  const match = /(?:export )?const inject = \[([^\]]*)\]/.exec(source);
  assert.ok(match !== null, `${label} 必须有模块级 inject = [...]`);
  return [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
}

/** client 平面独有、host 平面上永远不出现的服务名。 */
const CLIENT_ONLY_SERVICES = ['locale', 'slots', 'conversation', 'uiConversation', 'configForms', 'settingsScope'];

test('host 入口的顶层 inject 不得列 client 平面服务（/later 消失的根因）', () => {
  const names = topLevelInject(host, 'src/index.ts');
  const offenders = names.filter((name) => CLIENT_ONLY_SERVICES.includes(name));
  assert.deepEqual(offenders, [], `host 顶层 inject 含 client 服务 ${offenders.join(', ')} → 入口永久 pending`);
  // 顺带确认该列的还在，避免"为修 bug 把依赖删光"让插件静默退化。
  for (const required of ['agents', 'sessions', 'tools', 'commands', 'settings']) {
    assert.ok(names.includes(required), `host 顶层 inject 应保留 '${required}'`);
  }
});

test('locale 的消费点保持可选链（缺服务时走默认语言而非抛错）', () => {
  const uses = [...host.matchAll(/ctx\.get\('locale'\)(\??)/g)];
  assert.ok(uses.length >= 1, 'host 侧应仍有读取 locale 的地方（issue #1 的文案 i18n）');
  for (const use of uses) {
    assert.equal(use[1], '?', "ctx.get('locale') 必须带可选链 ?. —— 它在 host 平面拿不到");
  }
});

test('两代平面有意不对称：client 入口可以列 locale', () => {
  const names = topLevelInject(client, 'src/client/index.tsx');
  assert.ok(names.includes('locale'), 'client 平面的 locale 服务真实存在，列它是正确的');
});
