#!/usr/bin/env node
/**
 * 跨内核代次回归 · 在真内核上跑真入口（issue #75 / #76 的复发防线）。
 *
 * ## 为什么需要它
 *
 * 单测与 `typecheck` 都只在**本仓 devDependencies 那一版内核**上成立；而 #75 的故障
 * （0.1.7-rc.1 上提醒 100% 不投递）与 #76 的故障（`HH:mm` 被上游文法拒）都只在
 * **特定代次**上显形，跨代差异不会出现在本地 `npm test` 里。仓库已有的 `sync-peer-matrix`
 * 只同步 peer 范围，也不执行任何行为。
 *
 * 本脚本对每一个代次：拉起那一代**真内核**（不是 mock），经**注册命令的真实派发路径**
 * 执行两个判据，然后打印表格 + 落 JSON，退出码 0/1/2 可直接当门禁。
 *
 * ## 用法
 *
 *     npm run build
 *     node scripts/verify-across-kernels.mjs                       # 跑 KERNEL_GENERATIONS 全部代次
 *     node scripts/verify-across-kernels.mjs --versions 0.1.7-rc.1,0.2.1-rc.2
 *     node scripts/verify-across-kernels.mjs --kernel-root ~/dsh-versions --hold 12
 *     node scripts/verify-across-kernels.mjs --no-install      # 只用已铺好的树，缺的报「未判定」
 *
 * 退出码：0 全绿；1 有红（真回归失败）；2 有未判定（代次装不出来，需要人看一眼）。
 *
 * 代次清单**取自 `lib/upstream-compat.js` 的 `KERNEL_GENERATIONS`**：声明支持哪一代，
 * 就回归哪一代；不再另写一份列表（写第二份就会漂）。内核树缺失时脚本会 `npm i` 到
 * `--kernel-root/<版本>`（约 600MB / 代次，一次性），装不动就报「未判定」而不是假绿。
 *
 * ## 注意（三条判据纪律，都是踩过的坑）
 *
 * 1. **别用"日志里搜得到文本"当投递判据**：创建事件与命令回执里含同样的正文，
 *    会同时造成假绿和假红。真投递 = 一条 `agent/inbox/spliced` 且其 `inserted[].content`
 *    带 nonce，随后一条 `schedule/change operation:dispatch`。
 * 2. 会话日志是**多帧 zstd 拼接**（每次 flush 追加一帧），`zstdDecompressSync` 只解第一帧；
 *    这里按帧 magic 切分逐帧解。
 * 3. 内核模块必须解析到**被测那一代**：插件目录直接挂载会让它用自己 `node_modules` 里
 *    那份宿主包（版本矩阵当场失真）。所以是把插件实体副本放进 `<临时HOME>/profiles/…/node_modules`，
 *    再把该代版本树软链铺成同一层的 `node_modules`。
 *
 * 与 devkit 的关系：devkit 是本机工作区里的工具集，CI 与别人的 checkout 都没有它；
 * 本脚本自包含（只依赖本仓 + 被测内核树），所以它是这份回归**长期该待的地方**。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { KERNEL_GENERATIONS } from '../lib/upstream-compat.js';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const NAME = PKG.name;
const KERNEL_ROOT = resolve(opt('kernel-root', join(homedir(), 'dsh-versions')));
const HOLD = Number(opt('hold', 12));
const OUT_DIR = resolve(opt('out', join(ROOT, '.verify')));
const given = (opt('versions', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
const VERSIONS = given.length ? given : KERNEL_GENERATIONS.map((g) => g.id ?? g);

/** 取该代次的内核安装树；没有就装一次（一次性成本，之后复用）。 */
function kernelTree(version) {
  if (version.startsWith('/')) return { root: version, note: null };
  const root = join(KERNEL_ROOT, version);
  if (existsSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot'))) return { root, note: null };
  if (argv.includes('--no-install')) return { root: null, note: `本地树不完整（缺 @deepseek-ai/dsh-app-boot）且 --no-install：${root}` };
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(root, 'package.json'))) writeFileSync(join(root, 'package.json'), '{"private":true}\n');
  // 安装上限 7 分钟：CI 里一次意外卡死不该拖垮整条回归，未判定比假绿/假红都有用。
  const r = spawnSync('npm', ['i', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${version}`], { cwd: root, encoding: 'utf8', timeout: 420_000 });
  if (!existsSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot'))) {
    const miss = String(`${r.stdout}${r.stderr}`).match(/No matching version found for (\S+)/);
    return { root: null, note: miss ? `该代次没有可安装的启动器：${miss[1]}` : `npm i 失败或未装出 app-boot：${String(r.stderr ?? '').split('\n').slice(-1)[0].slice(0, 120)}` };
  }
  return { root, note: '现场安装' };
}

/** 按 zstd 帧 magic 切分逐帧解（多帧拼接的日志只解第一帧会漏掉后半）。 */
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
    try { parts.push(zstdDecompressSync(buf.subarray(from, to)).toString('utf8')); }
    catch (error) { parts.push(`#frame${k} 解码失败 ${String(error.message).slice(0, 60)}`); }
  }
  return parts.join('\n');
}

function readEvents(home) {
  const out = [];
  const stack = [home];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') stack.push(p); continue; }
      if (!/\.(jsonl|log)(\.zstd)?$/.test(e.name)) continue;
      try {
        if (statSync(p).size > 40 * 1024 * 1024) continue;
        const text = /\.zstd$/.test(e.name) ? unzstdAllFrames(readFileSync(p)) : readFileSync(p, 'utf8');
        for (const line of text.split('\n')) {
          if (!line.trim().startsWith('{')) continue;
          try { out.push({ ...JSON.parse(line), raw: line }); } catch { /* 非事件行跳过 */ }
        }
      } catch { /* 读不了就跳过这个文件 */ }
    }
  }
  return out;
}

/** 未来 N 天的本地日期（避免"时刻已过"被上游拒，从而污染 at 判据）。 */
function futureDate(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function atShapes() {
  const date = futureDate(3);
  const tz = 'Asia/Shanghai';
  return [
    { label: '面板原生 HH:mm', at: { date, time: '09:00', time_zone: tz }, mustBuild: true },
    { label: '个位小时带秒', at: { date, time: '9:00:00', time_zone: tz }, mustBuild: true },
    { label: '个位无秒', at: { date, time: '9:00', time_zone: tz }, mustBuild: true },
    { label: '严格基线', at: { date, time: '09:00:00', time_zone: tz }, mustBuild: true },
    // 无偏移字符串必须**被拒且给出可执行提示**：猜宿主时区会把用户意图的时刻改掉，比报错更糟。
    { label: '无偏移字符串应拒+提示', at: `${date} 09:00`, mustBuild: false, mustHint: true },
  ];
}

async function runOne(version) {
  const { root, note } = kernelTree(version);
  if (!root) return { version, verdict: 'UNDETERMINED', notes: [note ?? '无内核树'] };
  const runtime = JSON.parse(readFileSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version;
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-xkernel-')));
  const profile = join(home, 'profiles', 'x');
  const nm = join(profile, 'node_modules');
  const record = { version, runtime, notes: [], at: [], delivery: null };
  try {
    mkdirSync(nm, { recursive: true });
    for (const entry of readdirSync(join(root, 'node_modules'))) {
      if (entry === '.bin' || entry.startsWith('.')) continue;
      const src = join(root, 'node_modules', entry);
      if (entry.startsWith('@')) {
        mkdirSync(join(nm, entry), { recursive: true });
        for (const child of readdirSync(src)) symlinkSync(join(src, child), join(nm, entry, child), 'dir');
        continue;
      }
      symlinkSync(src, join(nm, entry), 'dir');
    }
    const copy = join(nm, NAME);
    mkdirSync(copy, { recursive: true });
    for (const f of ['package.json', 'cordis.patch.yml', 'icon.svg']) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(copy, f));
    for (const d of ['lib', 'locale', 'assets']) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(copy, d), { recursive: true });
    // 隔离的关键一行：不设 DSH_HOME 时内核会按真实 `~/.dsh` 落盘，
    // 于是"测试"变成"往你机器上写垃圾"（这台机器上真发生过：两条 xk-* 会话进了 ~/.dsh/sessions）。
    process.env.DSH_HOME = home;
    process.env.DSH_TELEMETRY_DISABLED = '1';
    const rootConfig = join(profile, 'cordis.yml');
    writeFileSync(rootConfig, '[]\n');
    const off = join(home, 'off.patch.yml');
    // hmr 行要求真实启动器给的 appReady；这里只要干净装配，显式关掉，别把无关警告当故障。
    writeFileSync(off, '- id: hmr\n  disabled: true\n');
    const appBoot = join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js');
    const boot = await import(pathToFileURL(appBoot).href);
    const layers = [join(root, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'), join(copy, 'cordis.patch.yml'), off];
    const patches = layers.flatMap((f) => existsSync(f) ? boot.loadOverlayPatches('dsh-xkernel', f) : []);
    const ctx = await boot.boot('dsh-xkernel', rootConfig, patches, (c) => {
      c.provide('profileContext', { name: 'x', dir: profile, patchPath: join(profile, 'cordis.patch.yml'), installAnchor: root, startedBundles: [], cwd: home, home, overlays: [] });
    });
    if (!ctx.agents) throw new Error('没有 ctx.agents（AgentRegistry 未装配）');
    const sessionId = `xk-${Date.now().toString(36)}`;
    const handle = await ctx.agents.create({ sessionId, meta: { cwd: home } });
    const agent = handle?.agent ?? handle;

    // 判据 1：at 文法形状经真实命令派发
    for (const shape of atShapes()) {
      const nonce = `XK-AT-${Math.random().toString(36).slice(2, 8)}`;
      let kind = '?';
      let text = '';
      try {
        const exec = await ctx.commands.execute(agent, `/user-schedule-create ${JSON.stringify({ prompt: nonce, at: shape.at })}`, [], new AbortController().signal);
        kind = exec?.result?.kind ?? exec?.kind ?? '?';
        text = String(exec?.result?.text ?? '');
      } catch (error) { text = `抛错 ${String(error.message).slice(0, 80)}`; }
      const built = kind === 'success' && !/"ok":false|invalid_rule/.test(text);
      const hinted = /偏移|offset|RFC|Z|时区/.test(text);
      const pass = shape.mustBuild ? built : (!built && (!shape.mustHint || hinted));
      record.at.push({ label: shape.label, built, hinted, pass, echo: text.replace(/\s+/g, ' ').slice(0, 120) });
    }

    // 判据 2：到点投递（事件形状，不看文本命中）
    const nonce = `XK-FIRE-${Date.now().toString(36)}`;
    const exec = await ctx.commands.execute(agent, `/user-schedule-create ${JSON.stringify({ prompt: nonce, after_seconds: 2 })}`, [], new AbortController().signal);
    if (exec?.result?.kind !== 'success') record.notes.push(`投递用例没建起来：${String(exec?.result?.text ?? '').slice(0, 140)}`);
    await new Promise((r) => setTimeout(r, HOLD * 1000));
    const evs = readEvents(home);
    const spliced = evs.filter((e) => e.type === 'agent/inbox/spliced' && e.raw.includes(nonce) && (e.data?.inserted?.length ?? 0) > 0).length;
    const dispatched = evs.some((e) => e.type === 'schedule/change' && e.data?.operation === 'dispatch');
    const admission = evs.find((e) => /producer-owned source kind/.test(e.raw));
    record.delivery = { spliced, dispatched, admissionError: admission ? admission.raw.replace(/\s+/g, ' ').slice(0, 160) : null };
    if (spliced === 0) {
      // 诊断留进产物：投递为 0 时看不到事件直方图，就只能靠猜（这台机器上真猜错过两次）
      const hist = {};
      for (const e of evs) hist[e.type ?? '?'] = (hist[e.type ?? '?'] ?? 0) + 1;
      record.eventHistogram = hist;
      record.notes.push(`未投递：spliced=0 dispatch=${dispatched ? 'Y' : 'N'}${admission ? ' 且有 v4 源校验报错（issue #75 的形状）' : ''}｜事件 ${Object.keys(hist).length} 种 ${JSON.stringify(hist).slice(0, 160)}`);
    }
    else if (!dispatched) record.notes.push('注入了但没有 dispatch 事件，状态账可能对不齐');
    if (admission) record.notes.push(`v4 源校验拒绝：${admission.raw.replace(/\s+/g, ' ').slice(0, 150)}`);
    record.notes.unshift(note ? `内核树：${note}` : '内核树：复用本地');
    try { await ctx.fiber?.dispose?.(); } catch { /* 释放失败不改写结论 */ }
    try { await handle.dispose?.(); } catch { /* 同上 */ }
    // 越界自检：任何一条本次会话 id 出现在真实 ~/.dsh 里，就说明隔离没生效 —— 大声失败并清干净，
    // 而不是留一堆测试会话在你的机器上等别人发现。
    const leaked = [];
    const realSessions = join(homedir(), '.dsh', 'sessions');
    try {
      for (const top of readdirSync(realSessions, { withFileTypes: true })) {
        if (!top.isDirectory()) continue;
        const dir = join(realSessions, top.name);
        for (const kid of readdirSync(dir)) if (kid.startsWith('xk-')) leaked.push(join(dir, kid));
      }
    } catch { /* 目录不存在就是没泄漏 */ }
    if (leaked.length) {
      record.verdict = 'RED';
      record.notes.push(`隔离失效：本次会话写进了真实 DSH_HOME（${leaked.length} 个），已删除：${leaked.join(', ').slice(0, 160)}`);
      for (const p of leaked) rmSync(p, { recursive: true, force: true });
      const tops = new Set(leaked.map((p) => dirname(p)));
      for (const t of tops) { try { if (readdirSync(t).length === 0) rmSync(t, { recursive: true, force: true }); } catch { /* 忽略 */ } }
    }
  } catch (error) {
    record.verdict = 'RED';
    record.notes.push(`装配失败：${String(error?.message ?? error).slice(0, 220)}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  const red = (record.delivery?.spliced ?? 0) === 0 || !!record.delivery?.admissionError || record.at.some((a) => !a.pass) || record.notes.some((n) => n.startsWith('装配失败') || n.startsWith('未投递'));
  record.verdict = red ? 'RED' : 'GREEN';
  return record;
}

console.log(`${NAME}@${PKG.version} · 跨内核回归 · 代次取自 KERNEL_GENERATIONS（${VERSIONS.length} 个）`);
const results = [];
for (const v of VERSIONS) {
  process.stdout.write(`\n### ${v} … `);
  const r = await runOne(v);
  results.push(r);
  if (r.verdict === 'UNDETERMINED') { console.log(`未判定\n    ${r.notes.join(' / ').slice(0, 160)}`); continue; }
  console.log(r.verdict === 'GREEN' ? 'GREEN' : 'RED');
  console.log(`    内核=${r.runtime} · 投递 spliced=${r.delivery?.spliced} dispatch=${r.delivery?.dispatched ? 'Y' : 'N'} · at 形状 ${r.at.filter((a) => a.pass).length}/${r.at.length}`);
  for (const a of r.at) if (!a.pass) console.log(`      ✗ ${a.label}：${a.echo}`);
  for (const n of r.notes) console.log(`      · ${n}`);
}
mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(OUT_DIR, `across-kernels-${stamp}.json`);
writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), versions: VERSIONS, results }, null, 2)}\n`);
const red = results.filter((r) => r.verdict === 'RED').length;
const und = results.filter((r) => r.verdict === 'UNDETERMINED').length;
console.log(`\n汇总：绿 ${results.length - red - und} / 红 ${red} / 未判定 ${und}；明细 ${file}`);
process.exit(red > 0 ? 1 : und > 0 ? 2 : 0);
