import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const SKILL_NAME = 'later-reminders';
export const SKILL_PROVIDER = 'dsh-later';
const BUNDLED_SKILL_RANK = 600;
const INVOCATION = { modelInvocable: true, userInvocable: true };
export function parseSkill(raw, label = 'SKILL.md') {
    const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const end = text.indexOf('\n---\n', 4);
    if (!text.startsWith('---\n') || end < 0) {
        throw new Error(`${label} 缺少 --- 包裹的 frontmatter`);
    }
    const match = /^description:[ \t]*(.+)$/m.exec(text.slice(4, end));
    if (match === null)
        throw new Error(`${label} 的 frontmatter 没有 description`);
    let description = (match[1] ?? '').trim();
    if (description.startsWith('"')) {
        try {
            description = JSON.parse(description);
        }
        catch {
            throw new Error(`${label} 的 description 双引号未闭合或含非法转义`);
        }
    }
    if (description.length === 0)
        throw new Error(`${label} 的 description 为空`);
    return { description, content: text.slice(end + 5) };
}
export function skillFilePaths(rootDir) {
    const base = rootDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
    return {
        zh: resolve(base, 'SKILL.md'),
        en: resolve(base, 'SKILL.en.md'),
    };
}
export function resolveSkillLocale(localeId) {
    return localeId === 'en' ? 'en' : 'zh';
}
function locatorPath(locator) {
    if (locator === null || typeof locator !== 'object')
        return undefined;
    const path = locator.path;
    return typeof path === 'string' ? path : undefined;
}
function loadSkill(path) {
    return parseSkill(readFileSync(path, 'utf8'), path.split('/').pop() ?? path);
}
export function laterSkillProvider(getLocale = () => undefined, paths = skillFilePaths(), onWarn = () => undefined) {
    const frame = (path) => ({
        name: SKILL_NAME,
        invocation: INVOCATION,
        source: 'bundled',
        provider: SKILL_PROVIDER,
        path,
        resourceBase: { kind: 'directory', path: dirname(path) },
    });
    const tryLoad = (path) => {
        try {
            return loadSkill(path);
        }
        catch (error) {
            onWarn(`later: 跳过 ${SKILL_NAME}（${error instanceof Error ? error.message : String(error)}），` +
                '其余功能不受影响');
            return undefined;
        }
    };
    return {
        name: SKILL_PROVIDER,
        async list() {
            const path = paths[resolveSkillLocale(getLocale())];
            const parsed = tryLoad(path);
            if (parsed === undefined)
                return [];
            return [{ ...frame(path), description: parsed.description, rank: BUNDLED_SKILL_RANK, locator: { path } }];
        },
        async get(candidate) {
            const path = locatorPath(candidate.locator) ?? paths[resolveSkillLocale(getLocale())];
            const parsed = tryLoad(path);
            if (parsed === undefined)
                return undefined;
            return { ...frame(path), description: parsed.description, content: parsed.content };
        },
    };
}
export function registerBundledSkill(host, getLocale) {
    if (typeof host.inject !== 'function')
        return;
    const warn = (message) => {
        try {
            host.logger?.warn?.(message);
        }
        catch {
        }
    };
    try {
        host.inject(['skills'], (skillCtx) => {
            try {
                const registry = skillCtx?.skills;
                if (typeof registry?.registerProvider !== 'function')
                    return;
                registry.registerProvider(() => laterSkillProvider(getLocale, skillFilePaths(), warn));
            }
            catch (error) {
                warn(`later: skill provider 注册失败（不影响其余功能）: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
    catch (error) {
        warn(`later: skill 注入失败（不影响其余功能）: ${error instanceof Error ? error.message : String(error)}`);
    }
}
