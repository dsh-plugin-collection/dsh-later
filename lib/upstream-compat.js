import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const KERNEL_GENERATIONS = [
    {
        id: '0.1.2-rc.1',
        sessionApi: 'own-events',
    },
    {
        id: '0.1.5-rc.3',
        sessionApi: 'own-events',
    },
    {
        id: '0.1.7-rc.1',
        sessionApi: 'own-events',
    },
    {
        id: '0.1.7-rc.2',
        sessionApi: 'own-events',
    },
    {
        id: '0.2.0-rc.2',
        sessionApi: 'own-events',
    },
    {
        id: '0.2.1-rc.2',
        sessionApi: 'own-events',
    },
    {
        id: '0.2.1-rc.3',
        sessionApi: 'own-events',
    },
    {
        id: '0.2.1-rc.4',
        sessionApi: 'own-events',
    },
    {
        id: '0.2.2-alpha.2',
        sessionApi: 'own-events',
    },
    {
        id: '0.2.2-alpha.3',
        sessionApi: 'own-events',
    },
    {
        id: '0.2.2-rc.1',
        sessionApi: 'own-events',
    },
];
export const KERNEL_SCOPED_PACKAGES = [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-schedule',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-projection',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-tools',
];
const EXTRA_PEER_GENERATIONS = {
    '@deepseek-ai/dsh-commands': ['0.0.1-rc.1'],
};
function segmentCeiling(base) {
    const [major, minor, patch] = base.split('.').map((part) => Number(part));
    return `${major}.${minor}.${patch + 1}-0`;
}
export function genPeerRange(id) {
    return `>=${id} <${segmentCeiling(id.split('-')[0])}`;
}
function foldSegmentClauses(clauses) {
    const out = [];
    for (const clause of clauses) {
        const previous = out.at(-1);
        const parts = previous === undefined ? null : /^>=(\S+) <(\S+)$/.exec(previous);
        const inside = parts !== null &&
            parts[2] === clause.ceiling &&
            (compareVersions(clause.floor, parts[1]) ?? -1) > 0;
        if (inside)
            continue;
        out.push(`>=${clause.floor} <${clause.ceiling}`);
    }
    return out;
}
export function peerRangeFor(packageName) {
    const extras = EXTRA_PEER_GENERATIONS[packageName] ?? [];
    const clauses = [...extras, ...KERNEL_GENERATIONS.map((g) => g.id)].map((id) => {
        const [floor, ceiling] = genPeerRange(id).split(' ');
        return { floor: floor.slice(2), ceiling: ceiling.slice(1) };
    });
    return foldSegmentClauses(clauses).join(' || ');
}
export function peerMatrixEntries() {
    return KERNEL_SCOPED_PACKAGES.map((packageName) => ({
        packageName,
        range: peerRangeFor(packageName),
    }));
}
export function enginesDshRange() {
    const floors = new Map();
    for (const gen of KERNEL_GENERATIONS) {
        const base = gen.id.split('-')[0];
        const held = floors.get(base);
        if (held === undefined || (compareVersions(gen.id, held) ?? 0) < 0)
            floors.set(base, gen.id);
    }
    return [...floors.entries()]
        .sort((a, b) => (compareVersions(`${a[0]}-0`, `${b[0]}-0`) ?? 0))
        .map(([base, floor]) => `>=${floor} <${segmentCeiling(base)}`)
        .join(' || ');
}
export function readOwnEvents(session) {
    const surface = session;
    if (typeof surface.ownEvents === 'function') {
        return surface.ownEvents();
    }
    return surface.events ?? [];
}
export function readInheritedEventCount(session) {
    const surface = session;
    const modern = surface.inheritedEventCount;
    if (typeof modern === 'number' && Number.isSafeInteger(modern) && modern >= 0) {
        return modern;
    }
    const seed = surface.header?.seedLength;
    if (typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0) {
        return seed;
    }
    return 0;
}
export function readLogCursor(session) {
    const surface = session;
    const offset = readInheritedEventCount(session);
    const seq = surface.seq;
    if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0) {
        return { offset, tail: seq };
    }
    return { offset, tail: readOwnEvents(session).length };
}
export function readFoldInput(session) {
    const surface = session;
    if (typeof surface.ownEvents === 'function') {
        return { events: surface.ownEvents(), inheritedEventCount: 0 };
    }
    return { events: surface.events ?? [], inheritedEventCount: readInheritedEventCount(session) };
}
export function readEventAt(session, seq) {
    const surface = session;
    if (typeof surface.eventAt === 'function') {
        return surface.eventAt(seq);
    }
    const events = readOwnEvents(session);
    const index = typeof surface.ownEvents === 'function'
        ? seq - readInheritedEventCount(session)
        : seq;
    return index >= 0 ? events[index] : undefined;
}
export function detectSessionApi(session) {
    return typeof session.ownEvents === 'function'
        ? 'own-events'
        : 'legacy-events';
}
export const PLUGIN_KIND_RETIRED_SINCE = '0.1.7-rc.1';
export const KERNEL_VERSION_SPECIFIERS = [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-schedule',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
];
function resolveSpecifierDefault(specifier) {
    return import.meta.resolve(specifier);
}
function packageNameOf(specifier) {
    return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}
function versionNearEntry(specifier, entry, readFile) {
    const url = entry.startsWith('file:') ? fileURLToPath(entry) : entry;
    const packageName = packageNameOf(specifier);
    let dir = dirname(url);
    for (let depth = 0; depth < 12; depth += 1) {
        let raw;
        try {
            raw = readFile(join(dir, 'package.json'));
        }
        catch {
        }
        if (raw !== undefined) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed.name === packageName && typeof parsed.version === 'string')
                    return parsed.version;
            }
            catch {
            }
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return undefined;
}
export function readKernelVersion(sources = {}) {
    const resolve = sources.resolve ?? resolveSpecifierDefault;
    const readFile = sources.readFile ?? ((filePath) => readFileSync(filePath, 'utf8'));
    for (const specifier of sources.specifiers ?? KERNEL_VERSION_SPECIFIERS) {
        let entry;
        try {
            entry = resolve(specifier);
        }
        catch {
            continue;
        }
        const version = versionNearEntry(specifier, entry, readFile);
        if (typeof version === 'string' && version.length > 0)
            return { version, specifier };
    }
    return undefined;
}
const VERSION_PATTERN = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;
export function parseVersion(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const m = VERSION_PATTERN.exec(raw);
    if (m === null)
        return undefined;
    const pre = m[4] === undefined
        ? []
        : m[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}
function comparePreIdentifier(a, b) {
    const aNum = typeof a === 'number';
    const bNum = typeof b === 'number';
    if (aNum && bNum)
        return a < b ? -1 : a > b ? 1 : 0;
    if (aNum)
        return -1;
    if (bNum)
        return 1;
    return a < b ? -1 : a > b ? 1 : 0;
}
export function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (a === undefined || b === undefined)
        return undefined;
    for (const key of ['major', 'minor', 'patch']) {
        if (a[key] !== b[key])
            return a[key] < b[key] ? -1 : 1;
    }
    if (a.pre.length === 0 || b.pre.length === 0) {
        if (a.pre.length === b.pre.length)
            return 0;
        return a.pre.length === 0 ? 1 : -1;
    }
    const shared = Math.min(a.pre.length, b.pre.length);
    for (let i = 0; i < shared; i += 1) {
        const c = comparePreIdentifier(a.pre[i], b.pre[i]);
        if (c !== 0)
            return c;
    }
    if (a.pre.length === b.pre.length)
        return 0;
    return a.pre.length > b.pre.length ? 1 : -1;
}
export function versionAtLeast(raw, threshold) {
    const c = compareVersions(raw, threshold);
    return c === undefined ? undefined : c >= 0;
}
