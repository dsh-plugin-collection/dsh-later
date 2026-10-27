/**
 * 随插件分发的 `SKILL.md` 与其 provider 的回归测试。
 *
 * 这个功能的全部风险都在于「把可选面写成必需面」：skill 只是给模型的一个曝光位，宿主的
 * 装配里可以没有它。历史上本插件把不该进激活门控的服务列进顶层 `inject`，导致整个入口
 * 永久 pending、`/later` 与 `/schedule` 集体消失，所以这里既测「真 registry 上注册得上」，
 * 也测「服务缺席时炸不了、且门控没被污染」。
 *
 * 覆盖面：
 *   1. `SKILL.md` frontmatter 解析与各种坏形状（含 BOM）；
 *   2. provider `list()`/`get()` 的契约形状（内核会逐项 validate）；
 *   3. **provider 永不抛**：读不到/解析坏了一律退化成「本 skill 缺席 + 一条 warn」，并用
 *      真内核 registry 证 `snapshot().complete` 不被我们拖成 false（那是全宿主降质的开关）；
 *   4. 双语按 locale 选文件，且语言在 `list()` 一次定死（防「中文描述点开是英文正文」）；
 *   5. `registerBundledSkill` 的退化路径，含 cordis 异步 apply 下**回调体内**的抛错；
 *   6. `skills` 不得进 host 顶层 inject；
 *   7. description 的词数预算与中英一致；
 *   8. 正文不得复述工具 schema 的参数规则（两处漂移护栏）；
 *   9. 与真内核对得上：rank 常量同值，真 `SkillRegistry` 能收进 catalog 并取回正文。
 *      本机装了几代就跑几代；没装时显式 diagnostic 跳过，不做无声的 green。老代次可用
 *      `DSH_LATER_SKILL_PKG=<该代的 lib/index.js>` 指认进来（命令见 `findKernelSkillEntries`）。
 * @module tests/skill-provider
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  SKILL_NAME,
  SKILL_PROVIDER,
  parseSkill,
  laterSkillProvider,
  resolveSkillLocale,
  registerBundledSkill,
  skillFilePaths,
} from '../lib/skill.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const SKILL_ZH = read('SKILL.md');
const SKILL_EN = read('SKILL.en.md');

/** frontmatter 里的 description。 */
const descOf = (raw) => parseSkill(raw).description;

/** 英文词数（按空白切分，标点附着不拆词）。 */
const enWords = (text) => text.split(/\s+/).filter(Boolean).length;

/** 中文字符数（CJK 统一表意文字，不含 ASCII 与标点）。 */
const zhChars = (text) => (text.match(/[一-鿿]/g) ?? []).length;

// ---------------------------------------------------------------- 1. 解析

test('parseSkill：切出 description 与正文，正文从 frontmatter 之后开始', () => {
  const parsed = parseSkill(SKILL_ZH, 'SKILL.md');
  assert.ok(parsed.description.length > 0);
  // 正文不得残留 frontmatter 的任何一角。
  assert.ok(!parsed.content.includes('name: later-reminders'));
  assert.ok(parsed.content.startsWith('\n# '), '正文应以标题起（frontmatter 后被完整剥掉）');
});

test('parseSkill：CRLF 文件与 LF 文件解析结果一致', () => {
  const crlf = SKILL_ZH.replace(/\n/g, '\r\n');
  assert.deepEqual(parseSkill(crlf), parseSkill(SKILL_ZH));
});

test('parseSkill：坏形状一律抛错并带上文件名（坏装不能变成静默的空 skill）', () => {
  const cases = [
    ['没有 frontmatter', '# 只有正文\n'],
    ['只有开栏没有闭栏', '---\ndescription: "x"\n'],
    ['frontmatter 里没有 description', '---\nname: foo\n---\n正文\n'],
    ['description 为空串', '---\ndescription: ""\n---\n正文\n'],
    ['双引号未闭合', '---\ndescription: "未闭合\n---\n正文\n'],
  ];
  for (const [label, raw] of cases) {
    assert.throws(() => parseSkill(raw, 'SKILL.md'), /SKILL\.md/, `${label}：错误里要有文件名`);
  }
});

test('parseSkill：双引号内的转义按 JSON 解码', () => {
  // 文件内容里的 description 是 "他说\"好\""（首尾各有一个未转义的闭合引号）。
  const raw = '---\nname: t\ndescription: "他说\\"好\\""\n---\n正文\n';
  assert.equal(descOf(raw), '他说"好"');
});

// ---------------------------------------------------------------- 2. 契约形状

test('provider.list() 的形状过得了内核 validateCandidate 的每一条', async () => {
  const provider = laterSkillProvider(() => 'zh');
  const [candidate] = await provider.list({});
  assert.equal(provider.name, SKILL_PROVIDER, 'provider 名要进内核日志，得可定位');
  assert.equal(candidate.name, SKILL_NAME);
  assert.match(candidate.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, '内核按 kebab-case 校验名字');
  assert.equal(candidate.provider, SKILL_PROVIDER, 'provider 字段必须等于 provider.name');
  assert.equal(candidate.source, 'bundled', '随包分发归 bundled 来源桶');
  assert.equal(typeof candidate.description, 'string');
  assert.ok(candidate.description.length > 0, '空 description 会被内核拒绝');
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true });
  assert.equal(typeof candidate.path, 'string');
  assert.equal(candidate.resourceBase.kind, 'directory');
  // resourceBase 指向 SKILL.md 所在目录（包根），相对资源要按它解析。
  assert.equal(candidate.resourceBase.path, dirname(skillFilePaths().zh));
});

test('provider.get() 返回正文，且 name 与 candidate 一致', async () => {
  const provider = laterSkillProvider(() => 'zh');
  const [candidate] = await provider.list({});
  const definition = await provider.get(candidate);
  // 内核拿 definition.name 与 candidate.name 比对，不等就判失效并返回 undefined。
  assert.equal(definition.name, candidate.name);
  assert.equal(definition.description, candidate.description);
  assert.ok(definition.content.includes('# '), '正文要有内容，不能返回空壳');
  assert.equal(definition.provider, SKILL_PROVIDER);
});

test('load-on-call：改盘上的 SKILL.md，provider 下一次调用就读到新值', async () => {
  // 用临时目录里的夹具，验证「不重建也读到新文案」。注意生效节奏仍受内核的
  // revision 缓存支配（见 skill.ts 纪律 2），这条只证 provider 这一层没有缓存。
  const dir = await mkdtemp(join(tmpdir(), 'dsh-later-skill-'));
  try {
    const path = join(dir, 'SKILL.md');
    const write = (description) => {
      writeFileSync(path, `---\nname: later-reminders\ndescription: "${description}"\n---\n# 正文\n`);
    };
    write('第一版');
    const provider = laterSkillProvider(() => 'zh', { zh: path, en: path });
    assert.equal((await provider.list({}))[0].description, '第一版');
    write('第二版');
    assert.equal((await provider.list({}))[0].description, '第二版');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('读不到文件时 provider 永不抛：list 退化成空数组 + warn，get 退化成 undefined', async () => {
  // 这条是本模块最硬的不变式。代价不是「我们少一行曝光」：list() 一抛，内核置
  // cacheable=false，catalog 永不缓存且 snapshot().complete 变 false，而 dsh-tool-skill
  // 在 agent/pre-step 里遇到 incomplete 就整轮不发布 catalog（所有插件的所有 skill 一起
  // 看不见）；get() 一抛更是直接冒给模型/用户，内核 SkillRegistry.get() 没有 try/catch。
  const dir = await mkdtemp(join(tmpdir(), 'dsh-later-skill-'));
  try {
    const missing = join(dir, 'SKILL.md');
    const warns = [];
    const provider = laterSkillProvider(() => 'zh', { zh: missing, en: missing }, (m) => warns.push(m));
    /** 断言「这一步恰好新增一条 warn」，累计条数随调用序列变，不做判据。 */
    const once = (label, before) => {
      assert.equal(warns.length, before + 1, `${label}：应新增且只新增一条 warn`);
      return warns.length;
    };

    // 缺席要说得出原因，不要静默：静默是这个仓里最贵的一种失败。
    let seen = warns.length;
    assert.deepEqual(await provider.list({}), [], 'list 必须返回空数组（裸数组即 complete:true）');
    seen = once('文件缺失的 list', seen);
    assert.match(warns[seen - 1], /later: 跳过 later-reminders/);
    assert.match(warns[seen - 1], /其余功能不受影响/);

    // get() 抛出去会直达模型与用户，所以必须走契约内的 undefined（内核据此作废条目）。
    assert.equal(await provider.get({ name: 'later-reminders', locator: { path: missing } }), undefined);
    seen = once('文件缺失的 get', seen);

    // 坏内容（不只是没文件）同一条路：写坏再读。
    writeFileSync(missing, '---\nname: later-reminders\n---\n# 没有 description\n');
    assert.deepEqual(await provider.list({}), []);
    once('坏 frontmatter 的 list', seen);
    assert.match(warns[warns.length - 1], /没有 description/, '要说得出坏在哪，便于现场定位');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BOM 不毁形状：带 U+FEFF 的 SKILL.md 照常解析', () => {
  // 现实触发面是 Windows 编辑器与某些落盘路径；一旦当成坏形状，整份 skill 就缺席。
  const withBom = '﻿' + '---\nname: later-reminders\ndescription: "带 BOM"\n---\n# 正文\n';
  assert.equal(descOf(withBom), '带 BOM');
});

test('真内核 registry：provider 失败时 catalog 照常发布（别的 skill 不陪葬）', async (t) => {
  // 这条把上面那条不变式**放到内核那一侧**去证：只有真 SkillRegistry + 真
  // snapshot() 才能证明「incomplete 会不会被触发」，而这正是整台宿主降质的开关。
  const installed = findKernelSkillEntries();
  if (installed.length === 0) {
    t.diagnostic('本机没有 @deepseek-ai/dsh-skill 安装，跳过 incomplete 判据');
    return;
  }
  const { Context } = await import('@deepseek-ai/cordis');
  const { SkillRegistry } = await import(installed[0].url.href);
  const dir = await mkdtemp(join(tmpdir(), 'dsh-later-skill-'));
  try {
    const registry = new SkillRegistry(new Context());
    // 一个健康 provider（代表宿主自带的别的 skill）+ 我们坏掉的 provider。
    registry.registerProvider(() => ({
      name: 'healthy-provider',
      list: async () => [
        {
          name: 'healthy-skill',
          description: 'healthy',
          invocation: { modelInvocable: true, userInvocable: false },
          source: 'bundled',
          provider: 'healthy-provider',
          rank: 600,
          locator: null,
        },
      ],
      get: async () => undefined,
    }));
    const missing = join(dir, 'SKILL.md');
    registry.registerProvider(() => laterSkillProvider(() => 'zh', { zh: missing, en: missing }, () => undefined));

    const snapshot = await registry.snapshot({});
    assert.equal(snapshot.complete, true, '我们的 provider 失败不得把整张 catalog 变成 incomplete');
    assert.deepEqual(
      snapshot.skills.map((skill) => skill.name),
      ['healthy-skill'],
      '只该少了我们自己那一行',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- 3. 双语

test('双语文件路径都落在包根（不是 lib/，构建形态不能挪走它）', () => {
  const paths = skillFilePaths();
  for (const [locale, path] of Object.entries(paths)) {
    assert.ok(!path.includes('/lib/'), `${locale} 的 SKILL.md 不应指向构建产物目录`);
    assert.doesNotThrow(() => readFileSync(path, 'utf8'), `${locale} 的文件必须随包存在`);
  }
});

test('两份文件的 frontmatter name 就是 provider 注册的那个名字', () => {
  // provider 只把 SKILL_NAME 常量交给内核，文件里那行 `name:` 从来不被读。
  // 不同步的话，它就是一句谎话（用户照它去 /skill 调用会调不到）。
  for (const [label, raw] of [['SKILL.md', SKILL_ZH], ['SKILL.en.md', SKILL_EN]]) {
    const front = raw.slice(4, raw.indexOf('\n---\n', 4));
    const name = /^name:[ \t]*(\S+)[ \t]*$/m.exec(front)?.[1];
    assert.equal(name, SKILL_NAME, `${label} 的 frontmatter name 与常量不一致`);
  }
});

test('locale=en 取英文文件，其余取中文文件（注意 host 平面今天恒拿不到 locale）', () => {
  // `locale` 是 client 侧服务，src/index.ts 的顶层 inject 注释把这条写死了：host 上
  // ctx.get('locale') 恒为 undefined，所以生产路径实际恒走中文那份，SKILL.en.md 是给
  // 语言源一旦可达时准备的（也供测试与手工换语言验证）。这里断言的是**选文件规则**本身。
  assert.equal(resolveSkillLocale('en'), 'en');
  assert.equal(resolveSkillLocale('zh'), 'zh');
  assert.equal(resolveSkillLocale(undefined), 'zh', 'host 平面通常拿不到 locale，必须回退中文');
  assert.equal(resolveSkillLocale('fr'), 'zh', '未收录的 id 同样回退中文');
});

test('provider 按 locale 选文件：两种语言给出的 description 各自来自各自文件', async () => {
  const zhDesc = descOf(SKILL_ZH);
  const enDesc = descOf(SKILL_EN);
  assert.notEqual(zhDesc, enDesc, '双语必须真是两份文本');
  for (const [locale, expected] of [['zh', zhDesc], ['en', enDesc], [undefined, zhDesc]]) {
    const [candidate] = await laterSkillProvider(() => locale).list({});
    assert.equal(candidate.description, expected, `locale=${String(locale)}`);
  }
});

test('语言在 list() 定死并写进 locator：中途切语言也不会「中文描述点开是英文正文」', async () => {
  let locale = 'zh';
  const provider = laterSkillProvider(() => locale);
  const [candidate] = await provider.list({});
  locale = 'en'; // 用户在 catalog 刷新之间切了语言
  const definition = await provider.get(candidate);
  assert.equal(definition.description, candidate.description, 'get 与 list 必须同源');
  assert.ok(definition.content.includes('定时提醒'), '正文应仍是中文那一份');
});

// ---------------------------------------------------------------- 4. fail-safe

/** 造一个只实现 skill 注册所需成员的假宿主；`inject` 不传则宿主根本没有该成员。 */
function fakeHost({ inject, logger = { warn: () => undefined } } = {}) {
  const calls = [];
  const defaultInject = (deps, callback) => {
    calls.push(deps);
    callback({ skills: { registerProvider: () => () => undefined } });
    return () => undefined;
  };
  return { host: { inject: inject ?? defaultInject, logger }, calls };
}

test('有 skills 服务：注册进 registerProvider，deps 恰为 [skills]', () => {
  const registered = [];
  const skillsCtx = { skills: { registerProvider: (create) => registered.push(create({})) } };
  const { host, calls } = fakeHost({
    inject: (deps, callback) => {
      calls.push(deps);
      callback(skillsCtx);
      return () => undefined;
    },
  });
  registerBundledSkill(host, () => 'zh');
  assert.deepEqual(calls, [['skills']], '只注入 skills 一个服务');
  assert.equal(registered.length, 1, 'provider 应注册一次');
  assert.equal(registered[0].name, SKILL_PROVIDER);
});

test('宿主根本没有 inject 成员 → 不抛、不注册，其余功能不受影响', () => {
  const warns = [];
  registerBundledSkill({ logger: { warn: (m) => warns.push(m) } }, () => 'zh');
  // 装配形态不符（没有注入点）属于预期的静默路径，不该报警，更不该抛。
  assert.equal(warns.length, 0, '没有注入点是预期缺席，不该报警');
});

test('注入的 ctx 里 skills 缺席或形状不符 → 静默跳过，不抛', () => {
  for (const skillCtx of [{}, { skills: {} }, { skills: null }, undefined]) {
    const warns = [];
    const { host } = fakeHost({
      inject: (_deps, callback) => callback(skillCtx),
      logger: { warn: (m) => warns.push(m) },
    });
    assert.doesNotThrow(() => registerBundledSkill(host, () => 'zh'), JSON.stringify(skillCtx ?? null));
    assert.equal(warns.length, 0, 'provider 缺席属于静默跳过');
  }
});

test('inject 当场抛错 → 收敛成一条 warn，不让插件起不来', () => {
  const warns = [];
  const { host } = fakeHost({
    inject: () => {
      throw new Error('boom');
    },
    logger: { warn: (m) => warns.push(m) },
  });
  registerBundledSkill(host, () => 'zh');
  assert.equal(warns.length, 1, `应记一条 warn，实测 ${warns.length} 条`);
  assert.match(warns[0], /skill 注入失败/);
});

test('回调是异步跑的：registerProvider 在回调里抛时，仍要由我们自己兜住并 warn', async () => {
  // 这条补的是上一条评论区没覆盖到的那半边：cordis 的子 fiber 由 `_reload` 触发，而
  // `_reload` 先 `await Promise.resolve()` 才执行 apply，所以回调体里的抛错**到不了**
  // registerBundledSkill 外层那个 try/catch。真宿主下如果只依赖外层，抛错只会让子 fiber
  // 静默 FAILED，我们那句 warn 永远打不出来（现实触发：同层重名、或撞保留名 runtime）。
  const warns = [];
  let pending;
  const { host } = fakeHost({
    inject: (_deps, callback) => {
      pending = callback;
      return () => undefined;
    },
    logger: { warn: (m) => warns.push(m) },
  });
  registerBundledSkill(host, () => 'zh');
  assert.equal(warns.length, 0, '注册动作还没发生');

  // 让出微任务，按 cordis 的实际时序再跑回调。
  await Promise.resolve();
  assert.doesNotThrow(
    () =>
      pending({
        skills: {
          registerProvider: () => {
            throw new Error('skill provider "dsh-later" already registered');
          },
        },
      }),
    '回调体内的抛错必须被回调自己的 catch 吃掉',
  );
  assert.equal(warns.length, 1, `应有且只有一条 warn，实测 ${warns.length} 条`);
  assert.match(warns[0], /provider 注册失败/);
  assert.match(warns[0], /already registered/, '原始信息要带出来，否则现场无法定位');
});

test('宿主连 logger 都没有时也不能抛（可选面就要真的可选）', () => {
  const { host } = fakeHost({
    inject: () => {
      throw new Error('boom');
    },
  });
  delete host.logger;
  assert.doesNotThrow(() => registerBundledSkill(host, () => 'zh'));
});

// ---------------------------------------------------------------- 5. 门控边界

test('skills 不得进 host 顶层 inject（可选面进了门控，服务不来就整插件 pending）', () => {
  const source = read('src/index.ts');
  const match = /(?:export )?const inject = \[([^\]]*)\]/.exec(source);
  assert.notEqual(match, null, 'src/index.ts 必须有模块级 inject = [...]');
  const names = [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  assert.ok(!names.includes('skills'), 'skills 只能走 ctx.inject 子 fiber，不能进激活门控');
  // 顺带确认该列的还在，避免「为加曝光位顺手删依赖」。
  for (const required of ['agents', 'sessions', 'tools', 'commands', 'settings']) {
    assert.ok(names.includes(required), `顶层 inject 应保留 '${required}'`);
  }
});

test('SKILL.md 与 SKILL.en.md 随包分发（package.json files 是发布白名单）', () => {
  const files = JSON.parse(read('package.json')).files;
  for (const entry of ['SKILL.md', 'SKILL.en.md']) {
    assert.ok(files.includes(entry), `files 缺 ${entry}：npm 安装副本会读不到文件`);
  }
});

test('host 入口真的挂上了注册调用（不是写完没接线的死代码）', () => {
  // 源码层与产物层各查一次：tsc 逐文件 emit 会把未使用的 import 整条删掉，
  // 只读 src 证明不了 shipped 的 lib/index.js 里还有这一步。
  const source = read('src/index.ts');
  assert.match(source, /registerBundledSkill\(/, 'src/index.ts 应调用注册入口');
  const artifact = read('lib/index.js');
  assert.match(artifact, /from ['"]\.\/skill\.js['"]/, '产物应保留对 skill 模块的导入');
  assert.match(artifact, /registerBundledSkill\(/, '产物应保留注册调用');
});

// ---------------------------------------------------------------- 6. 文案预算

test('description 在词数预算内（catalog 每轮常驻，是常驻 token 成本）', () => {
  const en = descOf(SKILL_EN);
  assert.ok(enWords(en) <= 80, `英文 ${enWords(en)} 词，超 80`);
  assert.ok(enWords(en) >= 60, `英文 ${enWords(en)} 词，低于口径下限 60，短到不足以路由`);
  const zh = descOf(SKILL_ZH);
  // 中文按字计：一个汉字约 1 token，80 个英文词约 100~110 token，取同量级预算。
  assert.ok(zhChars(zh) <= 130, `中文 ${zhChars(zh)} 字，超预算`);
  assert.ok(zhChars(zh) >= 60, `中文 ${zhChars(zh)} 字，短到不足以路由`);
});

test('中英两版承载同一组路由事实（不是互相意译丢信息）', () => {
  const pairs = [
    ['本方工具名', /user_schedule_create/, /user_schedule_create/],
    ['官方工具名（要区分的那个）', /schedule_create/, /schedule_create/],
    ['主动触发场景', /还在跑/, /still running/],
    ['日历式重复交回官方（本插件只有固定间隔）', /每天九点/, /every day at 9/],
    ['不该建重复的', /已经挂过同一条/, /duplicates already pending/],
    ['建完要告知', /一句话/, /one line/],
    ['可在面板取消', /面板/, /panel/],
  ];
  for (const [label, zhRe, enRe] of pairs) {
    assert.match(SKILL_ZH, zhRe, `中文版缺「${label}」`);
    assert.match(SKILL_EN, enRe, `英文版缺「${label}」`);
  }
});

test('正文与 description 都不许出现破折号族（项目文风硬规）', () => {
  for (const [label, text] of [['SKILL.md', SKILL_ZH], ['SKILL.en.md', SKILL_EN]]) {
    for (const banned of ['—', '–', ' -- ']) {
      assert.ok(!text.includes(banned), `${label} 含 ${JSON.stringify(banned)}`);
    }
  }
});

// ---------------------------------------------------------------- 7. 防双处漂移

test('SKILL 不复述工具 schema 的参数规则（同一事实只该有一处）', () => {
  // 这些是 strings.ts 里 toolCreateDesc / 参数 description 的原话要点。
  const duplicated = [
    '至少 300',
    '只能提供一个',
    '非空',
    '字符上限',
    '缺省用会话检测时区',
    '逐条调用本工具',
  ];
  for (const text of [SKILL_ZH, SKILL_EN]) {
    for (const phrase of duplicated) {
      assert.ok(!text.includes(phrase), `参数规则「${phrase}」进了 SKILL，会与 schema 漂移`);
    }
  }
});

// ---------------------------------------------------------------- 8. 与真内核对接

/**
 * 列出本机装有的 skills 包 `lib/index.js`（可能不止一代）。
 *
 * 本插件不依赖 `@deepseek-ai/dsh-skill`，所以它不在 `node_modules` 顶层，直接
 * `require.resolve` 必然 MODULE_NOT_FOUND。真相同它在 pnpm 的实际安装目录里：宿主装了
 * skills 包就一定能在 `.pnpm` 下找到。跨代次验证（`verify:kernels` 那套换线树）会往这里
 * 装进多个代次，所以全部收进来逐个跑，而不是只挑最新那份。
 */
function findKernelSkillEntries() {
  const base = new URL('../node_modules/.pnpm/', import.meta.url);
  let entries = [];
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    /* 连 node_modules 都没有（未安装的仓）：仍然接受下面显式指认的外包。 */
  }
  const found = [];
  for (const dir of entries
    .filter((e) => e.isDirectory() && e.name.startsWith('@deepseek-ai+dsh-skill@'))
    .map((e) => e.name)
    .sort()) {
    const url = new URL(`${dir}/node_modules/@deepseek-ai/dsh-skill/lib/index.js`, base);
    try {
      readFileSync(url, 'utf8');
      found.push({ url, dir });
    } catch {
      /* 该目录形态不符，跳过 */
    }
  }
  // 换线树（`verify:kernels`）之外，还允许把任意一代**指认**进来，好让「另一代也跑得通」
  // 这句话能被复现而不是只能相信。例：
  //   npm i --prefix /tmp/skill-old @deepseek-ai/dsh-skill@0.1.2-rc.1
  //   DSH_LATER_SKILL_PKG=/tmp/skill-old/node_modules/@deepseek-ai/dsh-skill/lib/index.js npm test
  const extra = process.env.DSH_LATER_SKILL_PKG;
  if (extra !== undefined && extra !== '') {
    try {
      const url = new URL(`file://${resolve(extra)}`);
      readFileSync(url, 'utf8');
      if (!found.some((entry) => entry.url.href === url.href)) {
        found.push({ url, dir: `env:${extra}` });
      }
    } catch (error) {
      throw new Error(`DSH_LATER_SKILL_PKG 指向的文件读不到：${extra}（${error.message}）`);
    }
  }
  return found;
}

test('BUNDLED_SKILL_RANK 与内核常量同值（否则同名竞争会输给宿主 bundled 根）', (t) => {
  const installed = findKernelSkillEntries();
  if (installed.length === 0) {
    // 明写跳过：一条什么都不核对的 green 比一条红更危险。
    t.diagnostic('本机没有 @deepseek-ai/dsh-skill 安装，跳过 rank 比对');
    return;
  }
  const ours = /BUNDLED_SKILL_RANK = (\d+)/.exec(read('lib/skill.js'))?.[1];
  for (const { url, dir } of installed) {
    const kernelRank = /BUNDLED_SKILL_RANK = (\d+)/.exec(readFileSync(url, 'utf8'))?.[1];
    assert.notEqual(kernelRank, undefined, `${dir}：应能读到 BUNDLED_SKILL_RANK 常量`);
    assert.equal(ours, kernelRank, `${dir}`);
  }
  t.diagnostic(`已比对 ${installed.length} 代 skills 包`);
});

test('真内核 SkillRegistry 收得下这个 provider：进 catalog 且能取回正文', async (t) => {
  // 上面几条按内核 validateCandidate 的清单逐条对过；这条直接用**真 registry** 跑一遍，
  // 覆盖的是「我们对契约的理解本身有没有错」那一层。装了几个代次就跑几遍。
  const installed = findKernelSkillEntries();
  if (installed.length === 0) {
    t.diagnostic('本机没有 @deepseek-ai/dsh-skill 安装，跳过真 registry 集成');
    return;
  }
  const { Context } = await import('@deepseek-ai/cordis');
  for (const { url, dir } of installed) {
    const { SkillRegistry } = await import(url.href);
    for (const locale of ['zh', 'en']) {
      const registry = new SkillRegistry(new Context());
      registry.registerProvider(() => laterSkillProvider(() => locale));

      const summary = (await registry.list({})).find((skill) => skill.name === SKILL_NAME);
      assert.notEqual(
        summary,
        undefined,
        `${dir}/${locale}：catalog 里没有 ${SKILL_NAME}（${(await registry.list({})).map((s) => s.name).join(', ')}）`,
      );
      assert.equal(summary.source, 'bundled', dir);
      assert.equal(summary.provider, SKILL_PROVIDER, dir);
      assert.deepEqual(summary.invocation, { modelInvocable: true, userInvocable: true }, dir);
      assert.equal(summary.description, locale === 'en' ? descOf(SKILL_EN) : descOf(SKILL_ZH), `${dir}/${locale}`);

      // get() 走的是内核的「按 name 取胜出候选再回调 provider」这条路。
      const definition = await registry.get(SKILL_NAME, {});
      assert.notEqual(definition, undefined, `${dir}/${locale}：get() 返回 undefined 说明契约校验没过`);
      assert.ok(definition.content.includes('# '), `${dir}/${locale}：正文应完整送达`);
      assert.equal(definition.resourceBase.kind, 'directory', dir);
    }
  }
  t.diagnostic(`真 registry 集成已跑 ${installed.length} 代 × zh/en`);
});
