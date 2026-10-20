/**
 * 内核模块同源护栏（Gitea issue #57 的「显形」一半）。
 *
 * link: 开发态下，插件与宿主可能各持一份 `@deepseek-ai/dsh-*` 内核模块**实例**
 * （插件侧落在自己的 `node_modules/.pnpm`，宿主侧是 dsh 安装目录那份）。两份
 * 模块级状态互不可见：这正是 #57 实测到的现场——插件侧 0.2.0-rc.2 与 `npx dsh`
 * 宿主的 0.2.1-rc.2 并存，插件对**自己那份**模块状态的任何改动（例如当时还存在的
 * 「读兼容注册」把自有事件类型 add 进 `KNOWN_SESSION_EVENT_TYPES`）宿主侧一概看不见，
 * 于是「看起来生效了」而实际静默失效。（那次注册已随 #58 删除，改为
 * `scripts/migrate-owned-events.mjs` 的一次性迁移；本护栏针对的是一整类问题。）
 *
 * 本模块只做**观测**：启动时比较「插件 bare import 会解析到的文件」与「从宿主
 * 入口出发会解析到的文件」，给出 same / different / unknown 三态；different 时
 * 告警一次。它**不修复任何问题**——双实例下该如何共享内核状态，属上游 API 的
 * 话题（#43 那类转提单），不是本仓能自行解决的。
 *
 * 三态契约（重要，别让探测失败伪装成同源）：
 * - `same`：两侧解析到同一份真实文件。Node ESM 以 realpath 为模块缓存键，同一
 *   份文件即同一模块实例，插件对内核模块状态（如事件类型集合）的改动宿主可见。
 * - `different`：两侧真实文件不同 → 必然是两份模块实例，注册只落进孤岛。
 * - `unknown`：宿主锚点缺失、解析/realpath 失败、或 `--preserve-symlinks` 下
 *   路径相同也不足以证明同实例。**探测失败一律 unknown，绝不降级成 same**——
 *   #57 的教训正是「看起来生效了」。
 *
 * 「宿主实际加载的那份」无法从 ESM 侧枚举，故以「从宿主入口文件出发解析到哪份」
 * 作为最近似证据：默认锚点是 `process.argv[1]`，可用 `DSH_LATER_HOST_ENTRY`
 * 覆盖（指认宿主入口文件，或宿主 `node_modules` 所在目录）。
 *
 * 启动噪音与降级：
 * - 每个进程只对 `different` 告警一次（不刷屏）；
 * - `DSH_LATER_KERNEL_GUARD=off`（或 `0` / `false` / `no`）完全关闭探测；
 * - `DSH_LATER_KERNEL_GUARD=verbose` 额外打印一次 same/unknown 结论，便于排查；
 * - 锚点判不准时结论退化为 `unknown`（不是误报 `different`）：此时指向
 *   `DSH_LATER_HOST_ENTRY` 后重新启动即可恢复判定。
 *
 * @module dsh-later/kernel-identity
 */
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { name } from './domain.js';
import { KERNEL_SCOPED_PACKAGES } from './upstream-compat.js';
/** 关闭/详细模式的开关变量名。 */
export const KERNEL_GUARD_ENV = 'DSH_LATER_KERNEL_GUARD';
/** 宿主入口锚点覆盖变量名。 */
export const HOST_ENTRY_ENV = 'DSH_LATER_HOST_ENTRY';
/** 解析开关取值（缺省/无法识别 → on；只有显式关闭才 off）。 */
export function resolveGuardMode(raw) {
    const value = (raw ?? '').trim().toLowerCase();
    if (value === 'off' || value === '0' || value === 'false' || value === 'no')
        return 'off';
    if (value === 'verbose' || value === 'debug')
        return 'verbose';
    return 'on';
}
/**
 * 取宿主锚点：显式入参 → `DSH_LATER_HOST_ENTRY` → `process.argv[1]`。
 * 相对路径按 `cwd` 补全；两者都没有时返回 null（调用方据此给 unknown）。
 */
export function resolveHostAnchor(sources = {}) {
    const env = sources.env ?? process.env;
    const argv1 = sources.argv1 === null ? undefined : sources.argv1 ?? process.argv[1];
    const fromEnv = env[HOST_ENTRY_ENV]?.trim();
    const raw = fromEnv && fromEnv.length > 0 ? fromEnv : argv1?.trim();
    if (!raw)
        return null;
    return isAbsolute(raw) ? raw : resolvePath(process.cwd(), raw);
}
/** URL / 路径统一成「真实文件路径」；非 file: URL 或 realpath 失败时抛出。 */
function canonicalizeDefault(url) {
    if (!url.startsWith('file:'))
        return url;
    return realpathSync(fileURLToPath(url));
}
/** 是否处于 `--preserve-symlinks`（该模式下同 realpath 也可能是两份实例）。 */
function detectPreserveSymlinks() {
    const args = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/)];
    return args.includes('--preserve-symlinks') || args.includes('--preserve-symlinks-main');
}
/**
 * 比较两侧解析结果，给出单模块三态。
 *
 * - 解析串完全相同 → `same`（同一缓存键，无需访问文件系统）；
 * - realpath 不同 → `different`；
 * - realpath 相同但解析串不同（符号链接别名）→ 默认 `same`（Node ESM 按
 *   realpath 缓存），`--preserve-symlinks` 下退化为 `unknown`（无法证明同实例）；
 * - realpath 抛错 → `unknown`。
 */
export function classifyModuleIdentity(options) {
    const base = {
        specifier: options.specifier,
        status: 'unknown',
        pluginUrl: options.pluginUrl,
        hostUrl: options.hostUrl,
    };
    if (options.pluginVersion !== undefined)
        base.pluginVersion = options.pluginVersion;
    if (options.hostVersion !== undefined)
        base.hostVersion = options.hostVersion;
    if (options.pluginUrl === options.hostUrl) {
        return { ...base, status: 'same', reason: 'resolved_urls_equal' };
    }
    const canonicalize = options.canonicalize ?? canonicalizeDefault;
    let pluginPath;
    let hostPath;
    try {
        pluginPath = canonicalize(options.pluginUrl);
        hostPath = canonicalize(options.hostUrl);
    }
    catch (error) {
        return {
            ...base,
            status: 'unknown',
            reason: `canonicalize_failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    if (pluginPath !== hostPath) {
        return { ...base, status: 'different', pluginPath, hostPath, reason: 'resolved_paths_differ' };
    }
    const preserveSymlinks = options.preserveSymlinks ?? detectPreserveSymlinks();
    if (preserveSymlinks) {
        return {
            ...base,
            status: 'unknown',
            pluginPath,
            hostPath,
            reason: 'same_realpath_but_differs_under_preserve_symlinks',
        };
    }
    return { ...base, status: 'same', pluginPath, hostPath, reason: 'same_realpath_via_symlink_alias' };
}
/** 聚合规则：different 优先；只有「全部 same 且非空」才是 same，其余 unknown。 */
export function aggregateIdentityStatus(modules) {
    if (modules.some((entry) => entry.status === 'different'))
        return 'different';
    if (modules.length > 0 && modules.every((entry) => entry.status === 'same'))
        return 'same';
    return 'unknown';
}
/** 从 specifier 取包名（去掉子路径），如 `@scope/pkg/sub` → `@scope/pkg`。 */
function packageNameOf(specifier) {
    const [first, second] = specifier.split('/');
    if (first === undefined)
        return specifier;
    return first.startsWith('@') && second !== undefined ? `${first}/${second}` : first;
}
/** 从模块文件向上找 package.json，读取同名包的 version（best-effort）。 */
function readVersionDefault(specifier, url) {
    if (!url.startsWith('file:'))
        return undefined;
    let dir;
    try {
        dir = dirname(fileURLToPath(url));
    }
    catch {
        return undefined;
    }
    const packageName = packageNameOf(specifier);
    for (let depth = 0; depth < 12; depth += 1) {
        try {
            const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
            if (parsed.name === packageName && typeof parsed.version === 'string')
                return parsed.version;
        }
        catch {
            /* 该层没有可读的 package.json，继续向上 */
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return undefined;
}
/**
 * 锚点可能是入口文件，也可能是目录（用户按 `DSH_LATER_HOST_ENTRY` 指认
 * `node_modules` 所在目录时）。目录补一个虚拟文件名，让解析基准落在该目录。
 * 锚点不存在时返回 null → 调用方给 unknown。
 */
function anchorToBase(anchor) {
    try {
        return statSync(anchor).isDirectory() ? join(anchor, '__dsh_later_host__.js') : anchor;
    }
    catch {
        return null;
    }
}
/** 探测一组内核包与宿主是否同源；不告警、不写日志（纯观测）。 */
export function probeKernelIdentity(options = {}) {
    const specifiers = options.specifiers ?? KERNEL_SCOPED_PACKAGES;
    const canonicalize = options.canonicalize ?? canonicalizeDefault;
    const readVersion = options.readVersion ?? readVersionDefault;
    const resolvePlugin = options.resolvePlugin ?? ((specifier) => import.meta.resolve(specifier));
    const rawAnchor = options.hostAnchor === undefined ? resolveHostAnchor() : options.hostAnchor;
    const hostBase = rawAnchor === null ? null : anchorToBase(rawAnchor);
    let resolveHost = hostBase === null ? null : options.resolveHost ?? null;
    if (resolveHost === null && hostBase !== null) {
        const hostRequire = createRequire(hostBase);
        resolveHost = (specifier) => pathToFileURL(hostRequire.resolve(specifier)).href;
    }
    const modules = [];
    for (const specifier of specifiers) {
        let pluginUrl;
        let hostUrl;
        let pluginResolveError;
        let hostResolveError;
        try {
            pluginUrl = resolvePlugin(specifier);
        }
        catch (error) {
            pluginResolveError = error instanceof Error ? error.message : String(error);
        }
        if (resolveHost === null) {
            hostResolveError =
                rawAnchor === null
                    ? 'no_host_anchor: 拿不到宿主入口（process.argv[1] 缺失），可用 DSH_LATER_HOST_ENTRY 指认'
                    : `host_anchor_unreadable: ${rawAnchor}`;
        }
        else {
            try {
                hostUrl = resolveHost(specifier);
            }
            catch (error) {
                hostResolveError = error instanceof Error ? error.message : String(error);
            }
        }
        if (pluginUrl === undefined || hostUrl === undefined) {
            modules.push({
                specifier,
                status: 'unknown',
                ...(pluginUrl === undefined ? {} : { pluginUrl }),
                ...(hostUrl === undefined ? {} : { hostUrl }),
                reason: [
                    pluginResolveError === undefined ? null : `plugin_resolve_failed: ${pluginResolveError}`,
                    hostResolveError === undefined ? null : `host_resolve_failed: ${hostResolveError}`,
                ]
                    .filter((part) => part !== null)
                    .join('; '),
            });
            continue;
        }
        const pluginVersion = readVersion(specifier, pluginUrl);
        const hostVersion = readVersion(specifier, hostUrl);
        modules.push(classifyModuleIdentity({
            specifier,
            pluginUrl,
            hostUrl,
            canonicalize,
            ...(options.preserveSymlinks === undefined
                ? {}
                : { preserveSymlinks: options.preserveSymlinks }),
            ...(pluginVersion === undefined ? {} : { pluginVersion }),
            ...(hostVersion === undefined ? {} : { hostVersion }),
        }));
    }
    const report = {
        status: aggregateIdentityStatus(modules),
        modules,
        hostAnchor: rawAnchor,
        disabled: false,
    };
    if (rawAnchor === null)
        report.reason = 'no_host_anchor';
    else if (hostBase === null)
        report.reason = `host_anchor_unreadable: ${rawAnchor}`;
    return report;
}
/** 把 `{path, version}` 渲染成告警里的一行证据。 */
function describeSide(path, version) {
    if (path === undefined)
        return '（未解析到）';
    return version === undefined ? path : `${path} (${version})`;
}
/** 生成启动告警文案（不同源时使用；可直接定位到两侧文件与 issue）。 */
export function formatKernelIdentityWarning(report) {
    const differing = report.modules.filter((entry) => entry.status === 'different');
    const shown = differing.slice(0, 3);
    const lines = [
        `[${name}] 内核模块出现双实例：本插件解析到的 @deepseek-ai/dsh-* 与宿主不是同一份模块（issue #57）。`,
    ];
    for (const entry of shown) {
        lines.push(`  • ${entry.specifier}`);
        lines.push(`      插件: ${describeSide(entry.pluginPath, entry.pluginVersion)}`);
        lines.push(`      宿主: ${describeSide(entry.hostPath, entry.hostVersion)}`);
    }
    if (differing.length > shown.length) {
        lines.push(`  …另有 ${differing.length - shown.length} 个内核包不同源（详见下文 verbose 开关）。`);
    }
    lines.push('  后果：对宿主已知事件集合的 owned-event 读兼容注册会写进插件侧孤岛 Set，宿主读路径仍拒读含该事件的旧日志——静默失效。');
    lines.push('  定位与取舍：issue #57（现象/实测）与 #58（A 放弃 / B 保留+迁移 / C 折中，尚未拍板）。');
    lines.push(`  本检查只告警、不修复；可用 ${KERNEL_GUARD_ENV}=off 关闭，或用 ${HOST_ENTRY_ENV}=/path/to/host-entry 指认宿主入口。`);
    return lines.join('\n');
}
/** 进程级「已告警」标记（cordis 重载会再次 apply，但不应重复刷屏）。 */
let warnedDifferent = false;
let reportedOther = false;
/** 测试用：清空一次性告警去重状态。 */
export function resetKernelIdentityGuardForTests() {
    warnedDifferent = false;
    reportedOther = false;
}
/**
 * 启动护栏：探测一次，`different` 时每个进程只告警一次；`unknown` 保持安静
 * （除非 verbose），因为「测不出来」不该制造启动噪音。
 *
 * 永不抛出：任何内部异常都折成 `unknown` 报告——护栏不能反过来弄坏插件加载。
 */
export function checkKernelIdentityAtStartup(options = {}) {
    const { mode: explicitMode, ...probeOptions } = options;
    const mode = explicitMode ?? resolveGuardMode(process.env[KERNEL_GUARD_ENV]);
    if (mode === 'off') {
        return {
            status: 'unknown',
            modules: [],
            hostAnchor: null,
            disabled: true,
            reason: 'disabled_by_env',
        };
    }
    let report;
    try {
        report = probeKernelIdentity(probeOptions);
    }
    catch (error) {
        return {
            status: 'unknown',
            modules: [],
            hostAnchor: null,
            disabled: false,
            reason: `probe_failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    if (report.status === 'different') {
        if (!warnedDifferent) {
            warnedDifferent = true;
            console.warn(formatKernelIdentityWarning(report));
        }
    }
    else if (mode === 'verbose' && !reportedOther) {
        reportedOther = true;
        const detail = report.reason === undefined ? '' : `（${report.reason}）`;
        console.info(`[${name}] 内核模块同源探测：${report.status}${detail}`);
    }
    return report;
}
