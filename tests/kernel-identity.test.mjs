/**
 * 内核模块同源护栏（issue #57 的「显形」一半）回归测试。
 *
 * 锁三态契约：same / different / **unknown**。unknown 不是「大概 same」——探测
 * 失败必须如实报 unknown，#57 的教训正是把「看起来生效了」当成生效。
 *
 * 夹具全部落在临时目录里（两份不同路径的同名模块副本），不依赖真实 GUI、也不
 * 依赖宿主是否真的装了两份内核。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  HOST_ENTRY_ENV,
  KERNEL_GUARD_ENV,
  aggregateIdentityStatus,
  checkKernelIdentityAtStartup,
  classifyModuleIdentity,
  formatKernelIdentityWarning,
  probeKernelIdentity,
  resetKernelIdentityGuardForTests,
  resolveGuardMode,
  resolveHostAnchor,
} from '../lib/kernel-identity.js';

const FAKE_KERNEL = '@scope/fake-kernel';
const tmpRoots = [];

after(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

/** 新建一个隔离的临时根目录（测试结束统一清理）。 */
function makeRoot(label) {
  const root = mkdtempSync(join(tmpdir(), `dsh-later-kernel-${label}-`));
  tmpRoots.push(root);
  return root;
}

/** 在 root/node_modules 下造一份名为 name 的假内核包；返回包目录。 */
function fakeKernelPackage(root, { name = FAKE_KERNEL, version = '1.0.0' } = {}) {
  const dir = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version, type: 'module', main: './index.js', exports: { '.': './index.js' } }),
  );
  writeFileSync(join(dir, 'index.js'), 'export const knownSessionEventTypes = new Set();\n');
  return dir;
}

/** 造一个「入口文件」，作为 createRequire 的解析基准。 */
function entryFile(root, label) {
  const file = join(root, `${label}.mjs`);
  writeFileSync(file, 'export {};\n');
  return file;
}

/** 按 Node 解析语义从锚点解析 bare specifier，返回 file URL。 */
function resolverFrom(anchorFile) {
  const requireFrom = createRequire(anchorFile);
  return (specifier) => pathToFileURL(requireFrom.resolve(specifier)).href;
}

/** 插件/宿主各持一份副本（不同版本）的夹具：探针参数 + 两侧真实文件。 */
function differentFixture(pluginVersion = '0.2.0-rc.2', hostVersion = '0.2.1-rc.2') {
  const pluginRoot = makeRoot('plugin');
  const hostRoot = makeRoot('host');
  const pluginPkg = fakeKernelPackage(pluginRoot, { version: pluginVersion });
  const hostPkg = fakeKernelPackage(hostRoot, { version: hostVersion });
  const hostAnchor = entryFile(hostRoot, 'host-entry');
  return {
    pluginRoot,
    hostRoot,
    pluginIndex: join(pluginPkg, 'index.js'),
    hostIndex: join(hostPkg, 'index.js'),
    options: {
      specifiers: [FAKE_KERNEL],
      hostAnchor,
      resolvePlugin: resolverFrom(entryFile(pluginRoot, 'plugin-entry')),
      resolveHost: resolverFrom(hostAnchor),
    },
  };
}

/** 捕获 console.warn / console.info（恢复时还原）。 */
function captureConsole() {
  const calls = { warn: [], info: [] };
  const original = { warn: console.warn, info: console.info };
  console.warn = (...args) => calls.warn.push(args.join(' '));
  console.info = (...args) => calls.info.push(args.join(' '));
  return {
    calls,
    restore() {
      console.warn = original.warn;
      console.info = original.info;
    },
  };
}

/** 临时设置/清理环境变量。 */
function withEnv(key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (had) process.env[key] = previous;
    else delete process.env[key];
  }
}

test('两份同名模块副本（不同路径/不同版本）→ different，并记下两侧位置', () => {
  const fixture = differentFixture();
  const report = probeKernelIdentity(fixture.options);

  assert.equal(report.status, 'different');
  assert.equal(report.modules.length, 1);
  const [entry] = report.modules;
  assert.equal(entry.status, 'different');
  assert.equal(entry.pluginPath, fixture.pluginIndex);
  assert.equal(entry.hostPath, fixture.hostIndex);
  assert.equal(entry.pluginVersion, '0.2.0-rc.2');
  assert.equal(entry.hostVersion, '0.2.1-rc.2');
  assert.equal(entry.reason, 'resolved_paths_differ');
});

test('宿主锚点可以是目录（node_modules 所在目录），结果与入口文件一致', () => {
  const fixture = differentFixture();
  const report = probeKernelIdentity({ ...fixture.options, hostAnchor: fixture.hostRoot });
  assert.equal(report.status, 'different');
  assert.equal(report.modules[0].hostPath, fixture.hostIndex);
});

test('同一份模块自比 → same（解析串相同即同一缓存键）', () => {
  const root = makeRoot('self');
  fakeKernelPackage(root);
  const anchor = entryFile(root, 'self-entry');
  const resolve = resolverFrom(anchor);

  const report = probeKernelIdentity({
    specifiers: [FAKE_KERNEL],
    hostAnchor: anchor,
    resolvePlugin: resolve,
    resolveHost: resolve,
  });
  assert.equal(report.status, 'same');
  assert.equal(report.modules[0].status, 'same');
  assert.equal(report.modules[0].reason, 'resolved_urls_equal');
});

test('解析串不同但 realpath 相同（符号链接别名）→ same；preserve-symlinks 下 → unknown', () => {
  const realRoot = makeRoot('real');
  const pkgDir = fakeKernelPackage(realRoot);
  const realIndex = join(pkgDir, 'index.js');

  const aliasRoot = join(makeRoot('alias-parent'), 'alias-link');
  symlinkSync(realRoot, aliasRoot);
  const aliasIndex = join(aliasRoot, 'node_modules', ...FAKE_KERNEL.split('/'), 'index.js');

  const same = classifyModuleIdentity({
    specifier: FAKE_KERNEL,
    pluginUrl: pathToFileURL(aliasIndex).href,
    hostUrl: pathToFileURL(realIndex).href,
  });
  assert.equal(same.status, 'same');
  assert.equal(same.reason, 'same_realpath_via_symlink_alias');

  const preserved = classifyModuleIdentity({
    specifier: FAKE_KERNEL,
    pluginUrl: pathToFileURL(aliasIndex).href,
    hostUrl: pathToFileURL(realIndex).href,
    preserveSymlinks: true,
  });
  assert.equal(preserved.status, 'unknown', '--preserve-symlinks 下同 realpath 不足以证明同实例');
});

test('宿主锚点缺失 → unknown，绝不误判 same', () => {
  const fixture = differentFixture();
  const report = probeKernelIdentity({
    ...fixture.options,
    hostAnchor: null,
  });

  assert.equal(report.status, 'unknown');
  assert.notEqual(report.status, 'same');
  assert.equal(report.modules[0].status, 'unknown');
  assert.match(report.modules[0].reason, /no_host_anchor/);
  assert.equal(report.reason, 'no_host_anchor');
});

test('宿主锚点存在但读不到（路径不存在）→ unknown，绝不误判 same', () => {
  const fixture = differentFixture();
  const report = probeKernelIdentity({
    ...fixture.options,
    hostAnchor: join(fixture.hostRoot, 'does-not-exist.mjs'),
  });

  assert.equal(report.status, 'unknown');
  assert.notEqual(report.status, 'same');
  assert.match(report.modules[0].reason, /host_anchor_unreadable/);
});

test('一侧 bare specifier 解析失败 → unknown，绝不误判 same', () => {
  const fixture = differentFixture();
  const report = probeKernelIdentity({
    ...fixture.options,
    specifiers: ['@scope/not-installed-kernel'],
  });

  assert.equal(report.status, 'unknown');
  assert.notEqual(report.status, 'same');
  assert.match(report.modules[0].reason, /plugin_resolve_failed/);
  assert.match(report.modules[0].reason, /host_resolve_failed/);
});

test('realpath 失败（权限/已删除）→ unknown，绝不误判 same', () => {
  const report = probeKernelIdentity({
    specifiers: [FAKE_KERNEL],
    hostAnchor: entryFile(makeRoot('bad-realpath'), 'host-entry'),
    resolvePlugin: () => 'file:///tmp/dsh-later-gone/plugin/index.js',
    resolveHost: () => 'file:///tmp/dsh-later-gone/host/index.js',
  });

  assert.equal(report.status, 'unknown');
  assert.notEqual(report.status, 'same');
  assert.equal(report.modules[0].status, 'unknown');
  assert.match(report.modules[0].reason, /canonicalize_failed/);
});

test('聚合规则：different 优先；same+unknown → unknown；空集 → unknown', () => {
  const same = { specifier: 'a', status: 'same' };
  const unknown = { specifier: 'b', status: 'unknown' };
  const different = { specifier: 'c', status: 'different' };

  assert.equal(aggregateIdentityStatus([same, different, unknown]), 'different');
  assert.equal(aggregateIdentityStatus([same, same]), 'same');
  assert.equal(aggregateIdentityStatus([same, unknown]), 'unknown');
  assert.equal(aggregateIdentityStatus([unknown]), 'unknown');
  assert.equal(aggregateIdentityStatus([]), 'unknown');
});

test('different 时启动告警一次（不刷屏），文案直指 #57/#58 与两侧文件', () => {
  const fixture = differentFixture();
  const log = captureConsole();
  try {
    resetKernelIdentityGuardForTests();
    checkKernelIdentityAtStartup({ ...fixture.options, mode: 'on' });
    checkKernelIdentityAtStartup({ ...fixture.options, mode: 'on' });
  } finally {
    log.restore();
    resetKernelIdentityGuardForTests();
  }

  assert.equal(log.calls.warn.length, 1, 'cordis 重载再次 apply 时不应重复告警');
  const text = log.calls.warn[0];
  assert.ok(text.includes(fixture.pluginIndex), `告警应含插件侧路径: ${text}`);
  assert.ok(text.includes(fixture.hostIndex), `告警应含宿主侧路径: ${text}`);
  assert.match(text, /0\.2\.0-rc\.2/);
  assert.match(text, /0\.2\.1-rc\.2/);
  assert.match(text, /#57/);
  assert.match(text, /#58/);
  assert.match(text, /owned-event/);
  assert.match(text, /孤岛/);
  assert.match(text, new RegExp(`${KERNEL_GUARD_ENV}=off`));
  assert.deepEqual(log.calls.info, []);
});

test('same / unknown 不告警（unknown 只在本进程首次且 verbose 时打印一次）', () => {
  const fixture = differentFixture();
  const unknownOptions = { ...fixture.options, hostAnchor: null };
  const log = captureConsole();
  try {
    resetKernelIdentityGuardForTests();
    const unknownReport = checkKernelIdentityAtStartup({ mode: 'on', ...unknownOptions });
    assert.equal(unknownReport.status, 'unknown');
    assert.equal(log.calls.warn.length, 0);
    assert.equal(log.calls.info.length, 0);

    resetKernelIdentityGuardForTests();
    const selfRoot = makeRoot('quiet-self');
    fakeKernelPackage(selfRoot);
    const anchor = entryFile(selfRoot, 'self-entry');
    const resolve = resolverFrom(anchor);
    const sameReport2 = checkKernelIdentityAtStartup({
      mode: 'on',
      specifiers: [FAKE_KERNEL],
      hostAnchor: anchor,
      resolvePlugin: resolve,
      resolveHost: resolve,
    });
    assert.equal(sameReport2.status, 'same');
    assert.equal(log.calls.warn.length, 0);

    resetKernelIdentityGuardForTests();
    checkKernelIdentityAtStartup({ mode: 'verbose', ...unknownOptions });
    checkKernelIdentityAtStartup({ mode: 'verbose', ...unknownOptions });
    assert.equal(log.calls.info.length, 1, 'verbose 下 unknown 也只打印一次');
  } finally {
    log.restore();
    resetKernelIdentityGuardForTests();
  }
});

test('开关：off 关闭探测且不告警；模式解析缺省为 on', () => {
  assert.equal(resolveGuardMode(undefined), 'on');
  assert.equal(resolveGuardMode(''), 'on');
  assert.equal(resolveGuardMode('on'), 'on');
  assert.equal(resolveGuardMode('verbose'), 'verbose');
  assert.equal(resolveGuardMode('OFF'), 'off');
  assert.equal(resolveGuardMode('0'), 'off');
  assert.equal(resolveGuardMode('false'), 'off');
  assert.equal(resolveGuardMode('no'), 'off');

  const fixture = differentFixture();
  const log = captureConsole();
  try {
    resetKernelIdentityGuardForTests();
    const report = withEnv(KERNEL_GUARD_ENV, 'off', () =>
      checkKernelIdentityAtStartup(fixture.options),
    );
    assert.equal(report.disabled, true);
    assert.equal(report.status, 'unknown');
    assert.deepEqual(report.modules, []);
    assert.equal(report.reason, 'disabled_by_env');
    assert.equal(log.calls.warn.length, 0);
  } finally {
    log.restore();
    resetKernelIdentityGuardForTests();
  }
});

test('resolveHostAnchor：env 覆盖 argv1，相对路径补 cwd，两者缺失 → null', () => {
  assert.equal(resolveHostAnchor({ env: {}, argv1: '/abs/host-entry.mjs' }), '/abs/host-entry.mjs');
  assert.equal(resolveHostAnchor({ env: {}, argv1: null }), null);
  assert.equal(resolveHostAnchor({ env: {}, argv1: '' }), null);
  assert.equal(
    resolveHostAnchor({ env: { [HOST_ENTRY_ENV]: '/abs/from-env.mjs' }, argv1: '/abs/argv1.mjs' }),
    '/abs/from-env.mjs',
  );
  const relative = resolveHostAnchor({ env: { [HOST_ENTRY_ENV]: 'relative/entry.mjs' }, argv1: null });
  assert.ok(relative !== null && relative.endsWith(join('relative', 'entry.mjs')));
  assert.equal(
    resolveHostAnchor({ env: { [HOST_ENTRY_ENV]: '  /abs/trimmed.mjs  ' }, argv1: null }),
    '/abs/trimmed.mjs',
  );
  // argv1 缺省时回落到真实 process.argv[1]（node --test 下就是本测试文件）。
  assert.equal(resolveHostAnchor({ env: {} }), process.argv[1]);
});

test('告警文案可直接定位：不同源模块逐个列出，超量时截断计数', () => {
  const modules = Array.from({ length: 5 }, (_, index) => ({
    specifier: `@deepseek-ai/dsh-${index}`,
    status: 'different',
    pluginPath: `/plugin/lib/${index}.js`,
    hostPath: `/host/lib/${index}.js`,
    reason: 'resolved_paths_differ',
  }));
  const text = formatKernelIdentityWarning({
    status: 'different',
    modules,
    hostAnchor: '/host/entry.mjs',
    disabled: false,
  });
  assert.match(text, /另有 2 个内核包不同源/);
  assert.ok(text.includes('/plugin/lib/0.js'));
  assert.ok(!text.includes('/host/lib/4.js'), '只展开前 3 个，其余计数');
  assert.match(text, /#57/);
  assert.match(text, /#58/);
});

test('内核探测异常不抛出、折成 unknown（护栏不能弄坏插件加载）', () => {
  const log = captureConsole();
  try {
    resetKernelIdentityGuardForTests();
    const report = checkKernelIdentityAtStartup({
      mode: 'on',
      specifiers: [FAKE_KERNEL],
      hostAnchor: entryFile(makeRoot('boom'), 'host-entry'),
      resolvePlugin: () => {
        throw new Error('boom-plugin');
      },
      resolveHost: () => {
        throw new Error('boom-host');
      },
      readVersion: () => {
        throw new Error('boom-version');
      },
    });
    assert.equal(report.status, 'unknown');
    assert.equal(log.calls.warn.length, 0);
  } finally {
    log.restore();
    resetKernelIdentityGuardForTests();
  }
});

test('真实默认解析面：本仓库 dsh-session 从插件与 tests/ 锚点解析到同一份 → same', () => {
  const report = withEnv(KERNEL_GUARD_ENV, undefined, () =>
    withEnv(HOST_ENTRY_ENV, undefined, () =>
      probeKernelIdentity({ specifiers: ['@deepseek-ai/dsh-session'] }),
    ),
  );

  assert.equal(report.modules.length, 1);
  assert.equal(
    report.status,
    'same',
    `开发态下 tests/ 与 lib/ 共用同一 node_modules；若这里变 different/unknown 说明解析锚点被破坏：${JSON.stringify(report.modules[0])}`,
  );
});
