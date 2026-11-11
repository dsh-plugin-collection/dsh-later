import { createRequire } from 'node:module';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { name } from './domain.js';
import { KERNEL_SCOPED_PACKAGES } from './upstream-compat.js';
export const KERNEL_GUARD_ENV = 'DSH_LATER_KERNEL_GUARD';
export const HOST_ENTRY_ENV = 'DSH_LATER_HOST_ENTRY';
export function resolveGuardMode(raw) {
    const value = (raw ?? '').trim().toLowerCase();
    if (value === 'off' || value === '0' || value === 'false' || value === 'no')
        return 'off';
    if (value === 'verbose' || value === 'debug')
        return 'verbose';
    return 'on';
}
export function resolveHostAnchor(sources = {}) {
    const env = sources.env ?? process.env;
    const argv1 = sources.argv1 === null ? undefined : sources.argv1 ?? process.argv[1];
    const fromEnv = env[HOST_ENTRY_ENV]?.trim();
    const raw = fromEnv && fromEnv.length > 0 ? fromEnv : argv1?.trim();
    if (!raw)
        return null;
    return isAbsolute(raw) ? raw : resolvePath(process.cwd(), raw);
}
function canonicalizeDefault(url) {
    if (!url.startsWith('file:'))
        return url;
    return realpathSync(fileURLToPath(url));
}
function detectPreserveSymlinks() {
    const args = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/)];
    return args.includes('--preserve-symlinks') || args.includes('--preserve-symlinks-main');
}
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
export function aggregateIdentityStatus(modules) {
    if (modules.some((entry) => entry.status === 'different'))
        return 'different';
    if (modules.length > 0 && modules.every((entry) => entry.status === 'same'))
        return 'same';
    return 'unknown';
}
function packageNameOf(specifier) {
    const [first, second] = specifier.split('/');
    if (first === undefined)
        return specifier;
    return first.startsWith('@') && second !== undefined ? `${first}/${second}` : first;
}
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
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return undefined;
}
function anchorToBase(anchor) {
    try {
        return statSync(anchor).isDirectory() ? join(anchor, '__dsh_later_host__.js') : anchor;
    }
    catch {
        return null;
    }
}
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
function describeSide(path, version) {
    if (path === undefined)
        return '（未解析到）';
    return version === undefined ? path : `${path} (${version})`;
}
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
let warnedDifferent = false;
let reportedOther = false;
export function resetKernelIdentityGuardForTests() {
    warnedDifferent = false;
    reportedOther = false;
}
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
