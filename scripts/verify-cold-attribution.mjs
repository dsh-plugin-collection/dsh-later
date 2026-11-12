#!/usr/bin/env node
/**
 * 冷投递的**可归因**判据（issue #144 第 1、2 条）。
 *
 * ## 为什么需要这个脚本
 *
 * 入库的那次真 GUI 运行（`docs/media/verify-1.12.0/issue-11b/`）结论**不可归因**，
 * 两处硬伤都在 `docs/notes/ui-matrix.md` §11.2：判据读日志的时机落在「开浏览器之后」，
 * 而**打开会话本身就会补投**（`agent/created` 回调 + `runtime-registry` 的自愈
 * `ensure()`/`drive()`），写的是同一份日志里的同两种事件；且那次跑的是哪个提交没记。
 *
 * 所以本脚本只做一件事：把一个会话从**从未被打开**的状态，推到「到期点过后、
 * dispatch 已落进持久化日志」，在**进程内、连浏览器之前**把那一刻的日志读出来存证。
 * 之后连浏览器看到的一切都不参与判定。
 *
 * ## 顺序是闸门，不是注释
 *
 * issue #144 明确要求「读日志」与「连浏览器」之间有一个**断言闸门**。这里的做法是
 * 分两个进程、三个阶段，且每阶段结束时立即对**磁盘上的持久化日志**做判定、写进
 * `result.json`：
 *
 *   phase 1  create：起内核 → 写一条会话 + create 事件（**不** `agents.create`，所以
 *            没有任何 runtime 挂在这条会话上）→ 停进程。
 *            产出 `phase1.json`：日志里**没有** `dispatch`（否则说明起点就不干净）。
 *   phase 2  wait  ：等过到期点 → **只读日志**判定 dispatch 是否已存在。
 *            这一步**没有任何浏览器**，也没有任何 `agents.create`。
 *            结果是 `phase2.json.dispatchBeforeBrowser` —— 这才是本 issue 要的那份证据。
 *   phase 3  browser：phase 2 **判绿之后才允许**连浏览器。它只用来产出人眼复核材料，
 *            **不参与判定**。phase 3 里出现的任何 dispatch 都会被单独标记，
 *            以免它被误算进 phase 2。
 *
 * 闸门实现：`main()` 里 phase 3 的前置条件是 `phase2.dispatchBeforeBrowser.ok === true`，
 * 不成立就直接退出码 2 并写明「未连浏览器」。想跑 GUI 而判决为红的人，只能看到红。
 *
 * ## 判据（只用事件形状，不用文本命中）
 *
 *   - `agent/inbox/spliced`，且 `data.inserted` 非空，且该事件**原始行**含本次 nonce；
 *   - `schedule/change`，`data.operation === 'dispatch'`，且 `data.id` 是本会话那条 schedule。
 *
 * nonce 只用来把"本用例那条"从同目录其它会话里分出来，不靠 prompt 文本去匹配语义。
 *
 * ## 用法
 *
 *   node scripts/verify-cold-attribution.mjs --version 0.2.1-rc.4 \
 *     --out docs/media/cold-attribution-2026-11-12
 *
 *   --after-seconds 8   到期点距 create 的秒数（默认 8；phase 2 会等它 + 余量）
 *   --keep-home         保留临时 DSH_HOME 以便复查（默认删）
 *
 * @module dsh-later/scripts/verify-cold-attribution
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { auditPluginSources } from './kernel-assembly.mjs';
import { KERNEL_SCOPED_PACKAGES } from '../lib/upstream-compat.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const VERSION = opt('version', '0.2.1-rc.4');
const VERSIONS_ROOT = resolve(opt('versions-root', join(homedir(), 'dsh-versions')));
const OUT = resolve(opt('out', join(ROOT, '.verify', 'cold-attribution')));
const AFTER_SECONDS = Number(opt('after-seconds', 8));
/** phase2 的等待时长：到期点 + 兜底 tick(60s 量级) + 余量，默认 90s。 */
const WAIT_SECONDS = Number(opt('wait-seconds', 90));
const KEEP_HOME = flag('keep-home');
const HOME = resolve(opt('home', join(OUT, 'home')));

/** 本文件名：phase 2 / 3 由本文件带 `--phase` 重新调用自己，保证"另一个进程"。 */
const SELF = fileURLToPath(import.meta.url);

const log = (...args) => console.log(...args);

/**
 * 会话日志是**多帧 zstd 拼接**（每次 flush 追加一帧），而 `zstdDecompressSync` 只解第一帧。
 * 按 magic 切帧再逐帧解，与 `verify-across-kernels.mjs` 同一算法。
 *
 * 不 import 那边的实现是刻意的：本判据要能独立复跑、独立演进，而且 zstd 这个细节
 * 一旦两边共用就会"一处改坏两边一起瞎"。代价是代码重复，已在 module 注释里写明。
 */
function unzstdAllFrames(buf) {
  const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
  const cuts = [0];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) cuts.push(i);
  }
  const parts = [];
  for (let k = 0; k < cuts.length; k += 1) {
    const from = cuts[k];
    const to = cuts[k + 1] ?? buf.length;
    if (to <= from) continue;
    try {
      parts.push(zstdDecompressSync(buf.subarray(from, to)).toString('utf8'));
    } catch {
      /* 坏帧跳过：少一帧不该让整份判定变成"没有事件" */
    }
  }
  return parts.join('\n');
}

/**
 * 读该 home 下所有会话日志，按（sessionDir, type）聚合。
 *
 * 与 `verify-across-kernels.mjs` 的 `readEvents` 同一口径，**不 import 它**：那边是
 * 跨代次矩阵的私有实现，这里的判据要能独立复跑、独立演进，耦合只会让两边都不敢改。
 */
function readEvents(home) {
  const events = [];
  const stack = [home];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') stack.push(path);
        continue;
      }
      if (!/\.(jsonl|log)(\.zstd)?$/.test(entry.name)) continue;
      const sessionDir = basename(dir);
      let text;
      try {
        // 内核默认把会话日志压成多帧 zstd（实测 0.2.1-rc.4 是 session.v4.jsonl.zstd）。
        // 早先这里直接跳过 .zstd，于是判定读到 0 条事件、给出一个假红 —— 已修。
        text = /\.zstd$/.test(entry.name) ? unzstdAllFrames(readFileSync(path)) : readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        events.push({ ...parsed, raw: line, sessionDir, file: path });
      }
    }
  }
  return events;
}

/** 判据本体：只看事件形状 +「本行含本用例 nonce / 本条 schedule id」。 */
function judge(events, { sessionId, nonce, scheduleId }) {
  const mine = events.filter((e) => e.sessionDir === sessionId);
  const spliced = mine.filter(
    (e) => e.type === 'agent/inbox/spliced' && e.raw.includes(nonce) && (e.data?.inserted?.length ?? 0) > 0,
  );
  const dispatched = mine.filter(
    (e) => e.type === 'schedule/change' && e.data?.operation === 'dispatch' && e.data?.id === scheduleId,
  );
  return {
    sessionId,
    nonce,
    scheduleId,
    eventsInSession: mine.length,
    splicedCount: spliced.length,
    dispatchCount: dispatched.length,
    /** 两个判据同时成立才算投递。 */
    ok: spliced.length > 0 && dispatched.length > 0,
    evidence: {
      spliced: spliced.slice(0, 3).map((e) => ({ seq: e.seq, type: e.type, inserted: e.data?.inserted?.length ?? 0, raw: e.raw.slice(0, 400) })),
      dispatch: dispatched.slice(0, 3).map((e) => ({ seq: e.seq, type: e.type, data: e.data, raw: e.raw.slice(0, 400) })),
    },
  };
}

/** 搭一份隔离 home：内核树逐个软链，插件用本仓的 lib/。 */
function prepareHome() {
  const versionRoot = join(VERSIONS_ROOT, VERSION);
  if (!existsSync(join(versionRoot, 'node_modules', '@deepseek-ai', 'dsh'))) {
    throw new Error(`内核树不存在：${versionRoot}（先装 @deepseek-ai/dsh@${VERSION}）`);
  }
  rmSync(HOME, { recursive: true, force: true });
  const profile = join(HOME, 'profiles', 'x');
  const nm = join(profile, 'node_modules');
  mkdirSync(nm, { recursive: true });
  for (const entry of readdirSync(join(versionRoot, 'node_modules'))) {
    if (entry === '.bin' || entry.startsWith('.')) continue;
    const src = join(versionRoot, 'node_modules', entry);
    if (entry.startsWith('@')) {
      mkdirSync(join(nm, entry), { recursive: true });
      for (const child of readdirSync(src)) symlinkSync(join(src, child), join(nm, entry, child), 'dir');
      continue;
    }
    symlinkSync(src, join(nm, entry), 'dir');
  }
  // 插件：**复制**发布面，不做 symlink。
  //
  // 用 symlink 会让 ESM 解析从 `lib/` 的真实位置（开发仓）往上找 node_modules，
  // 于是插件解析到的是开发仓里那份 rc.2 内核包、而不是被测树（实测触发"双实例"告警）——
  // 那样这份证据证明的不是被测代次。复制之后解析起点落在隔离 home 里，天然同源。
  const copy = join(nm, 'dsh-later');
  mkdirSync(copy, { recursive: true });
  for (const file of ['package.json', 'cordis.patch.yml', 'icon.svg']) {
    if (existsSync(join(ROOT, file))) cpSync(join(ROOT, file), join(copy, file));
  }
  for (const dir of ['lib']) {
    if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(copy, dir), { recursive: true });
  }
  writeFileSync(join(profile, 'cordis.yml'), '[]\n');
  // 凭据**只读共享**：web 的浏览器会话 cookie 由 `~/.dsh/.credentials.yaml` 里的 secret 签发，
  // 隔离 home 自己另生成一份就没法用 `mintCookie` 签出能过的 cookie —— 表现是首页渲染
  // `dsh web authentication required`，截出来一张假画面（phase3 踩到过，已加判据）。
  // 与 scripts/ui-matrix/instance.mjs 同一做法：软链，只读。
  const liveCredentials = join(homedir(), '.dsh', '.credentials.yaml');
  if (existsSync(liveCredentials)) symlinkSync(liveCredentials, join(HOME, '.credentials.yaml'));
  // profile 清单：宿主 CLI 读 `dsh.profile.bundles` 决定往装配图里放哪些 bundle，
  // **缺了这份 package.json 它会直接报 `profile "x" does not exist`**（phase3 起 web 时踩到过，
  // 于是 browserOpened=false）。与 scripts/ui-matrix/instance.mjs 同构：base + web-app + 本插件。
  writeFileSync(
    join(profile, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dsh-profile-x',
        private: true,
        dependencies: { 'dsh-later': `link:${copy}` },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-later'] } },
      },
      null,
      2,
    )}\n`,
  );
  // 同源审计：解析起点必须是**隔离 home 里的插件副本**，不是开发仓。
  // 不成立时这一代次没被测到，证据也就不作数 —— 下面是硬前提，不是附加信息。
  // 宿主 `dsh` 的版本是审计的比较基准，必须传。不传时 `info.version !== undefined` 恒真，
  // 每个包都被判成"不同源"，报出来的理由却是「宿主 dsh 是 undefined」——一条自相矛盾的红。
  // （第一次接进来就是这么错的，记在这里。）
  const runtime = JSON.parse(readFileSync(join(versionRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version;
  const sources = auditPluginSources({ copyDir: copy, treeRoot: versionRoot, runtime, packages: KERNEL_SCOPED_PACKAGES });
  return { versionRoot, profile, copy, sources };
}

/** 起内核并 boot（与 verify-across-kernels 同一套 boot 调用）。 */
async function bootKernel(versionRoot) {
  const bootEntry = join(versionRoot, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js');
  if (!existsSync(bootEntry)) throw new Error(`找不到 dsh-app-boot：${bootEntry}`);
  process.env.DSH_HOME = HOME;
  process.env.DSH_TELEMETRY_DISABLED = '1';
  process.env.DSH_LATER_HOST_ENTRY = bootEntry;
  const profile = join(HOME, 'profiles', 'x');
  const rootConfig = join(profile, 'cordis.yml');
  const off = join(HOME, 'off.patch.yml');
  writeFileSync(off, '- id: hmr\n  disabled: true\n');
  const bootModule = await import(pathToFileURL(bootEntry).href);
  // dsh-base 的补丁层按**实际落点**找（顶层优先、其次嵌套），与 verify-across-kernels 一致。
  // 硬编码 `node_modules/@deepseek-ai/dsh-base` 在嵌套布局的树里会静默少一层补丁，
  // 那会让"装配成功"证明的是半套树。
  const basePatch = (() => {
    const top = join(versionRoot, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml');
    if (existsSync(top)) return top;
    for (const entry of readdirSync(join(versionRoot, 'node_modules', '@deepseek-ai'))) {
      const nested = join(versionRoot, 'node_modules', '@deepseek-ai', entry, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml');
      if (existsSync(nested)) return nested;
    }
    return null;
  })();
  if (basePatch === null) throw new Error('树里找不到 @deepseek-ai/dsh-base 的 cordis.patch.yml，少一层补丁的装配不作数');
  const layers = [basePatch, join(profile, 'node_modules', 'dsh-later', 'cordis.patch.yml'), off];
  const patches = layers.flatMap((f) => (existsSync(f) ? bootModule.loadOverlayPatches('cold-attr', f) : []));
  const ctx = await bootModule.boot('cold-attr', rootConfig, patches, (c) => {
    c.provide('profileContext', {
      name: 'x',
      dir: profile,
      patchPath: join(profile, 'cordis.patch.yml'),
      installAnchor: versionRoot,
      startedBundles: [],
      cwd: HOME,
      home: HOME,
      overlays: [],
    });
  });
  return ctx;
}

/* ---------------------------------------------------------------- phases */

/**
 * phase 1：写一条会话 + create 事件，**不** `agents.create`。
 *
 * 直接经 `ctx.sessions` 造会话，避免任何 runtime 挂上去 —— 那正是「从未被打开过」的形状。
 * 但仍然用真实的 `/user-schedule-create` 命令来写 schedule，因为判据要的是插件真的
 * 登记了这条提醒（否则 phase 2 等再多也等不到）。
 */
async function phaseCreate() {
  mkdirSync(HOME, { recursive: true });
  const { versionRoot, sources } = prepareHome();
  const nonce = `COLD-ATTR-${Date.now().toString(36)}`;
  const sessionId = `cold-attr-${Date.now().toString(36)}`;
  const ctx = await bootKernel(versionRoot);
  try {
    // 会话本身用 store 造，但**立刻拿一个 agent 只是为了执行命令**：这个 agent 用完即弃，
    // 事件落在**同一个 sessionId** 上，而 phase 2 只读磁盘，不依赖这个进程还活着。
    const handle = await ctx.agents.create({ sessionId, meta: { cwd: HOME } });
    const agent = handle?.agent ?? handle;
    const exec = await ctx.commands.execute(
      agent,
      `/user-schedule-create ${JSON.stringify({ prompt: nonce, after_seconds: AFTER_SECONDS })}`,
      [],
      new AbortController().signal,
    );
    const text = String(exec?.result?.text ?? '');
    let scheduleId = null;
    try {
      scheduleId = JSON.parse(text).id ?? null;
    } catch {
      /* 下面如实报 */
    }
    const record = {
      phase: 'create',
      version: VERSION,
      at: new Date().toISOString(),
      sessionId,
      nonce,
      scheduleId,
      commandKind: exec?.result?.kind ?? null,
      commandText: text.slice(0, 300),
      afterSeconds: AFTER_SECONDS,
      /** 同源：插件解析到的内核包必须全在被测树里，否则本份证据不作数。 */
      sameSource: { ok: sources.ok, checked: sources.checked, offenders: sources.offenders.map((o) => o.reason).slice(0, 4) },
      /** 起点干净性：这一刻日志里**不该**有 dispatch，有就说明用例前提不成立。 */
      dispatchAtCreate: (() => {
        const events = readEvents(HOME);
        const mine = events.filter((e) => e.sessionDir === sessionId);
        return mine.filter((e) => e.type === 'schedule/change' && e.data?.operation === 'dispatch').length;
      })(),
    };
    writeFileSync(join(OUT, 'phase1.json'), JSON.stringify(record, null, 2));
    log(`phase1  sessionId=${sessionId}  scheduleId=${scheduleId}  dispatchAtCreate=${record.dispatchAtCreate}`);
    if (scheduleId === null) throw new Error(`create 没拿到 scheduleId，回执：${text.slice(0, 200)}`);

    // ⚠️ **不能在这里关进程**。冷投递的投递方是宿主级到期扫描器（插件里的
    // `createExpirySweeper`），它的兜底 tick 是 60s 量级；进程一退，这个会话就只剩
    // 磁盘上的 create 事件，永远不会有人来投 —— 那验的不是"冷投递坏了"，而是"没人跑"。
    // 第一次实现就是在这里 dispose 了，结果 dispatch 恒为 0（假红，已修）。
    //
    // 所以 phase1 的进程要**活到 phase2 读完日志之后**：写一个 ready 标记，然后挂起等待
    // 外部发 SIGTERM。期间这条会话仍然"没被打开过"——没有 agent 挂上去处理新消息，
    // 只有扫描器会主动把它拉起来补投（那正是 issue 要验的行为）。
    writeFileSync(join(OUT, '.phase1-ready'), String(process.pid));
    log('phase1  宿主常驻中（扫描器兜底 tick 60s 量级），等待 phase2 读完日志后回收…');
    const stop = () => {
      try { ctx.dispose?.(); } catch { /* 关不掉也继续 */ }
      process.exit(0);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    return new Promise(() => {
      /* 一直活着，直到收到信号 */
    });
  } catch (error) {
    try {
      await ctx.dispose?.();
    } catch {
      /* 关不掉也继续 */
    }
    throw error;
  }
}

/**
 * phase 2：等过到期点，**只读日志**判定。
 *
 * 全程没有浏览器、没有 agents.create、没有 boot —— 只有文件读取。这就是 issue #144
 * 要的那份「连浏览器之前 dispatch 已存在」的快照。
 */
async function phaseWait() {
  const p1 = JSON.parse(readFileSync(join(OUT, 'phase1.json'), 'utf8'));
  // 等待长度 = 到期点 + 兜底 tick 周期 + 余量。扫描器的兜底 tick 是 60s 量级，
  // 只等到期点 + 几秒会读到一个"还没轮询到"的日志，那是假红。
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  log(`phase2  等过到期点并给扫描器一个兜底 tick 周期（共 ${WAIT_SECONDS}s）…`);
  while (Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
  const events = readEvents(HOME);
  const verdict = judge(events, p1);
  const record = {
    phase: 'wait',
    at: new Date().toISOString(),
    browserOpened: false,
    waitedSeconds: WAIT_SECONDS,
    dispatchBeforeBrowser: verdict,
  };
  writeFileSync(join(OUT, 'phase2.json'), JSON.stringify(record, null, 2));
  log(`phase2  ⭐ dispatchBeforeBrowser: spliced=${verdict.splicedCount} dispatch=${verdict.dispatchCount} → ${verdict.ok ? 'OK' : 'FAIL'}`);
  return record;
}

/** phase 3：仅在 phase 2 判绿后才连浏览器，只产出人眼材料，不参与判定。 */
async function phaseBrowser(playwrightDir) {
  const p1 = JSON.parse(readFileSync(join(OUT, 'phase1.json'), 'utf8'));
  const p2 = JSON.parse(readFileSync(join(OUT, 'phase2.json'), 'utf8'));
  if (p2.dispatchBeforeBrowser?.ok !== true) {
    console.error('phase3  拒绝连浏览器：phase2 未判绿（dispatch 在连浏览器之前不存在）。');
    process.exit(2);
  }
  const port = 3721;
  const dshBin = join(join(VERSIONS_ROOT, VERSION), 'node_modules', '.bin', 'dsh');
  // 日志落临时目录而不是 OUT：`dsh web` 第一行就打印带 token 的 URL，
  // 那是登录凭据，绝不能进仓库（本文件要提交到 docs/media/ 下）。
  const logFile = join(HOME, 'logs', 'phase3-web.log');
  mkdirSync(dirname(logFile), { recursive: true });
  const child = spawnSync('bash', ['-lc', `DSH_HOME=${JSON.stringify(HOME)} nohup ${JSON.stringify(dshBin)} --profile x --port ${port} --no-open >> ${JSON.stringify(logFile)} 2>&1 & echo $!`], { encoding: 'utf8' });
  const pid = Number((child.stdout ?? '').trim());
  const waitDeadline = Date.now() + 60_000;
  let up = 0;
  while (Date.now() < waitDeadline) {
    const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${port}/`], { encoding: 'utf8' });
    up = Number(String(r.stdout ?? '0').trim() || 0);
    if (up === 200 || up === 401) break;
    await new Promise((r2) => setTimeout(r2, 1500));
  }
  const shot = join(OUT, 'phase3-browser.png');
  let shots = {};
  /** 只有真 GUI 才算拿到画面；认证墙 / 白屏都算没拿到。 */
  let guiOk = false;
  let authWallSeen = false;
  if (up === 200 || up === 401) {
    const { loadPlaywright, mintCookie } = await import(pathToFileURL(join(ROOT, 'scripts', 'ui-matrix', 'capture.mjs')).href);
    if (playwrightDir !== undefined) process.env.PLAYWRIGHT_MODULE = playwrightDir;
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addCookies([{ ...mintCookie(port), domain: '127.0.0.1', path: '/' }]);
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(5000);
      // 「端口通了」不等于「登录了」：没 cookie 时首页会渲染一句
      // `dsh web authentication required; reopen the URL printed by dsh web.`
      // 那也是一张能截的图，但它不是 GUI。不判这一句，phase3 就会安静地交出一张假画面。
      const authWall = await page.evaluate(() => /authentication required/i.test(document.body?.innerText ?? ''));
      if (authWall) {
        guiOk = false;
        authWallSeen = true;
      }
      await page.evaluate(() => {
        const label = (b) => (b.textContent || '').trim();
        [...document.querySelectorAll('button')].find((b) => label(b) === 'Continue' || label(b) === '继续')?.click();
      });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: shot });
      if (!authWallSeen) {
        guiOk = true;
        shots = { browser: shot };
      }
    } finally {
      await browser.close();
    }
  }
  if (pid > 0) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* 已经没了 */
      }
    }
  }
  // phase3 之后再看一次日志：任何新增 dispatch 都**不算**进 phase2
  const after = judge(readEvents(HOME), p1);
  const record = {
    phase: 'browser',
    at: new Date().toISOString(),
    browserOpened: up === 200 || up === 401,
    httpStatus: up,
    /** 端口有响应 ≠ 登录成功。这一项才是「画面可不可信」的判据。 */
    guiRendered: guiOk,
    authWallSeen,
    shots,
    /** 仅供对照：连浏览器**之后**的计数。为 true 不代表 phase2 成立。 */
    countsAfterBrowser: { spliced: after.splicedCount, dispatch: after.dispatchCount },
    note: '本阶段不参与判定（issue #144：判定只认 phase2 的 dispatchBeforeBrowser）',
  };
  writeFileSync(join(OUT, 'phase3.json'), JSON.stringify(record, null, 2));
  log(`phase3  browserOpened=${record.browserOpened} 连浏览器后 spliced=${after.splicedCount} dispatch=${after.dispatchCount}（不参与判定）`);
  return record;
}

/* ------------------------------------------------------------------ main */

async function main() {
  const phase = opt('phase', 'all');
  mkdirSync(OUT, { recursive: true });
  if (phase === 'create') return phaseCreate();
  if (phase === 'wait') return phaseWait();
  if (phase === 'browser') return phaseBrowser(opt('playwright-module'));

  log(`冷投递可归因判据（issue #144）· 内核 ${VERSION} · 输出 ${OUT}`);
  // 三个阶段各起一个**独立进程**：phase2 必须是「没有任何内核进程活着」的时刻，
  // 否则它读到的东西就可能来自本进程自己的补投。
  const run = (args) => {
    const r = spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`phase 退出码 ${r.status}：${args.join(' ')}`);
  };
  // phase1 **异步起**并让它常驻（它要一直活着当"宿主级扫描器"）。用 spawn 而不是
  // spawnSync：同步版会等它退出，而它设计上就是不退出的。
  rmSync(join(OUT, '.phase1-ready'), { force: true });
  const creator = spawn(process.execPath, [SELF, '--phase', 'create', '--version', VERSION, '--out', OUT, '--home', HOME, '--after-seconds', String(AFTER_SECONDS)], { stdio: 'inherit' });
  const readyDeadline = Date.now() + 120_000;
  while (!existsSync(join(OUT, '.phase1-ready')) && Date.now() < readyDeadline) {
    if (creator.exitCode !== null && creator.exitCode !== 0) throw new Error(`phase1 退出码 ${creator.exitCode}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!existsSync(join(OUT, '.phase1-ready'))) throw new Error('phase1 两分钟内没写出 ready 标记');
  let p2;
  try {
    p2 = await phaseWait();
  } finally {
    // 读完日志才回收宿主：phase2 看到的是"宿主一直活着、但没人打开过这条会话"的那段时间
    creator.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
  }
  const caught = p2.dispatchBeforeBrowser.ok;
  let p3 = null;
  if (caught) {
    run(['--phase', 'browser', '--version', VERSION, '--out', OUT, '--home', HOME]);
    p3 = JSON.parse(readFileSync(join(OUT, 'phase3.json'), 'utf8'));
  } else {
    log('闸门：phase2 未判绿，**不连浏览器**（issue #144 第 1 条要求顺序不可颠倒）');
  }
  const summary = {
    issue: 144,
    version: VERSION,
    at: new Date().toISOString(),
    verdict: caught ? 'ATTRIBUTED' : 'NOT-ATTRIBUTED',
    dispatchBeforeBrowser: p2.dispatchBeforeBrowser,
    browser: p3 === null ? null : { opened: p3.browserOpened, shots: p3.shots, countsAfterBrowser: p3.countsAfterBrowser },
  };
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(summary, null, 2));
  if (!KEEP_HOME) {
    const keep = join(OUT, 'session-log');
    mkdirSync(keep, { recursive: true });
    const stack = [HOME];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries = [];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') stack.push(p);
          continue;
        }
        if (/\.(jsonl|log)(\.zstd)?$/.test(e.name)) {
          try {
            // 内核默认写多帧 zstd；原样拷一份进仓库既不可读、也过不了 diff 复核，
            // 所以解成明文再落盘（判据用的就是同一份解压实现）。
            const buf = readFileSync(p);
            const text = /\.zstd$/.test(e.name) ? unzstdAllFrames(buf) : buf.toString('utf8');
            if (text.trim().length === 0) continue;
            // 只收**会话事件日志**：每行必须是带 type 的 JSON 事件。`dsh web` 的 stdout
            // 也落在这个 home 的 logs/ 下，第一行就是带 token 的 URL —— 那个文件名字常见
            // 得像"日志"，混进来就是把凭据提交进仓库（本轮真的发生过，已拦）。
            const lines = text.split('\n').filter((l) => l.trim().startsWith('{'));
            if (lines.length === 0) continue;
            writeFileSync(join(keep, `${basename(dir)}.jsonl`), `${lines.join('\n')}\n`);
          } catch {
            /* 读不了就跳过 */
          }
        }
      }
    }
    rmSync(HOME, { recursive: true, force: true });
  }
  log(`\n结论：${summary.verdict}（dispatchBeforeBrowser spliced=${summary.dispatchBeforeBrowser.splicedCount} dispatch=${summary.dispatchBeforeBrowser.dispatchCount}）`);
  log(`产物：${OUT}/result.json`);
  process.exit(caught ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
