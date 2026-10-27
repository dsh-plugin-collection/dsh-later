/**
 * 随插件分发的 `SKILL.md`：给模型一个「何时主动排程」的常驻位点。
 *
 * 为什么 skill 讲了工具 description 没讲的事：工具的 description 只在模型**已经**考虑
 * 调用它时才进上下文；skill catalog 的每一行则每轮常驻。所以「我吃完饭回来继续」这种
 * 没说「设个提醒」的场景，只有 catalog 里那一行能让模型主动想起这条路。
 *
 * 三条纪律：
 *  1. **skill 只写「何时用 + 用哪个」**。参数规则（三选一、时区缺省、字符上限、次数
 *     上限要逐条建）留在 `strings.ts` 的工具 description 里，正文复述一遍等于把同一
 *     事实放两个地方，改一处漏一处。
 *  2. **文件即真相**：provider 每次被调用时读盘（load-on-call），改 `SKILL.md` 下一轮
 *     catalog 刷新即生效，不需要重建 bundle。代价是文件缺失会让 `list()` 抛错，这是
 *     有意的：内核 registry 会 containment 住单个 provider 的失败（记一条
 *     `skill provider "dsh-later" skipped: …` 后继续），静默返回半个条目才是更坏的形态。
 *  3. **双语按 locale 选文件**，与 `strings.ts` 的 `hostDictFor` 同源同规则：`en` 走
 *     `SKILL.en.md`，其余（含拿不到 locale 服务）回退 `SKILL.md`。语言在 `list()` 时
 *     定一次并写进 `locator`，`get()` 按 `locator` 取同一份文件：否则用户在 catalog
 *     刷新之间切了语言，会出现「中文描述点开是英文正文」。
 * @module dsh-later/skill
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** catalog 里显示的技能名（kebab-case，内核按 `/^^[a-z0-9]+(?:-[a-z0-9]+)*$/` 校验）。 */
export const SKILL_NAME = 'later-reminders';
/** 本插件在 skills registry 里的 provider 名；与插件名一致，便于日志定位。 */
export const SKILL_PROVIDER = 'dsh-later';
/**
 * packaged provider 的标准优先级，与内核 `@deepseek-ai/dsh-skill` 的
 * `BUNDLED_SKILL_RANK` 同值（已核对该常量在 0.1.2-rc.1 与 0.2.1-rc.2 两代都是 600）。
 *
 * 刻意**不** import 那个常量：`@deepseek-ai/dsh-skill` 不在本包的
 * dependencies/peerDependencies 里，运行时 import 等于给自己加一条没有声明的模块解析
 * 要求（能不能解析全看宿主怎么装配），而 esbuild 兜底路径还会把它整份内联进每个产物，
 * 等于复制一次模块实例（同 `kernel-identity.ts` 护栏防的那类问题）。为一个数字付这些
 * 代价不值。漂移由 `tests/skill-provider.test.mjs` 比对常量兜住，并在真 registry 上跑
 * 一遍 catalog。
 */
const BUNDLED_SKILL_RANK = 600;
/** 模型面和用户面都开放：catalog 每轮可见，同时允许用户显式调用。 */
const INVOCATION = { modelInvocable: true, userInvocable: true };
/**
 * 解析 `SKILL.md`：切出 frontmatter 的 `description` 与正文。
 *
 * @param raw - 文件原文。
 * @param label - 出错时引用的文件名（让「哪个文件坏了」进得了日志）。
 * @throws 缺 frontmatter、缺 `description`、或引号形式无法解析时抛出。
 */
export function parseSkill(raw, label = 'SKILL.md') {
    const text = raw.replace(/\r\n/g, '\n');
    // 从前matter 内容起始处找闭合线，避免把开头的 `---\n` 自己当成闭合。
    const end = text.indexOf('\n---\n', 4);
    if (!text.startsWith('---\n') || end < 0) {
        throw new Error(`${label} 缺少 --- 包裹的 frontmatter`);
    }
    const match = /^description:[ \t]*(.+)$/m.exec(text.slice(4, end));
    if (match === null)
        throw new Error(`${label} 的 frontmatter 没有 description`);
    // `.+` 已保证捕获组存在，`?? ''` 只为满足 noUncheckedIndexedAccess；空值由下面的
    // 「description 为空」判据兜住。
    let description = (match[1] ?? '').trim();
    if (description.startsWith('"')) {
        // 双引号形式按 JSON 解一次，让 `\"` 之类的转义走正规通道而非手工剥引号。
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
/** 双语文件的绝对路径（默认相对本模块所在目录的上一级，即包根）。 */
export function skillFilePaths(rootDir) {
    const base = rootDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
    return {
        zh: resolve(base, 'SKILL.md'),
        en: resolve(base, 'SKILL.en.md'),
    };
}
/** 按 locale id 选语言；与 `strings.ts` 的 `hostDictFor` 完全同规则（未收录回退中文）。 */
export function resolveSkillLocale(localeId) {
    return localeId === 'en' ? 'en' : 'zh';
}
function locatorPath(locator) {
    if (locator === null || typeof locator !== 'object')
        return undefined;
    const path = locator.path;
    return typeof path === 'string' ? path : undefined;
}
/**
 * 读一次盘。每次 `list()`/`get()` 都调用，因此改文件不需要重建插件即可生效。
 */
function loadSkill(path) {
    return parseSkill(readFileSync(path, 'utf8'), path.split('/').pop() ?? path);
}
/**
 * 构造随包分发的 skill provider。
 *
 * @param getLocale - 宿主当前语言（`ctx.get('locale')?.getSnapshot().active`）；
 *   host 平面通常拿不到，`undefined` 按中文处理，与工具 description 的语言一致。
 * @param paths - 双语文件路径，测试可注入夹具。
 */
export function laterSkillProvider(getLocale = () => undefined, paths = skillFilePaths()) {
    /** catalog 条目的公共骨架（不含每次要现读的 `description`）。 */
    const frame = (path) => ({
        name: SKILL_NAME,
        invocation: INVOCATION,
        source: 'bundled',
        provider: SKILL_PROVIDER,
        path,
        resourceBase: { kind: 'directory', path: dirname(path) },
    });
    return {
        name: SKILL_PROVIDER,
        async list() {
            const path = paths[resolveSkillLocale(getLocale())];
            const { description } = loadSkill(path);
            return [{ ...frame(path), description, rank: BUNDLED_SKILL_RANK, locator: { path } }];
        },
        async get(candidate) {
            // 语言以 `list()` 时的判定为准（见文件头纪律 3）；locator 不可用时退回现读，
            // 那只会发生在内核把别的 provider 的 candidate 误交给我们的场合。
            const path = locatorPath(candidate.locator) ?? paths[resolveSkillLocale(getLocale())];
            const { description, content } = loadSkill(path);
            return { ...frame(path), description, content };
        },
    };
}
/**
 * 把 {@link laterSkillProvider} 挂进宿主的 skills 服务，**fail-safe**。
 *
 * 三层退化，最坏结果都只是「少一个曝光位」，永远不会是「插件起不来」：
 *  1. `inject` 不是函数（宿主形态不符）→ 直接返回；
 *  2. `inject(['skills'], …)` 当场抛 → catch 后记一条 warn；
 *  3. 注入的那层 ctx 没有 `registerProvider` → 静默返回。
 *
 * 第 4 种情形不在这三层里，而是注入点本身不激活：宿主装配里没有 `skills` 服务时，
 * cordis 给这条**子 fiber** 建的门控永远不满足，回调根本不执行，父入口照常激活。
 * 本仓支持的代次都带该服务（实测 0.1.2-rc.1 与 0.2.1-rc.2 两代的 `SkillRegistry` 都能
 * 收下这个 provider），所以这条路是给「装配里没有它」的宿主留的，不是给某个代次留的。
 * 要点是形状而不是概率：`'skills'` 一旦误进 `src/index.ts` 的顶层 `inject`（那是整个
 * 插件的激活门控），它就从「少一行 catalog」变成「服务不来则整插件永久 pending、
 * `/later` 与 `/schedule` 集体消失」。这条边界由 `tests/skill-provider.test.mjs` 与
 * `tests/host-entry-activation.test.mjs` 双向锁住。
 *
 * @param host - 宿主 ctx（只取 `inject` 与 `logger`）。
 * @param getLocale - 当前语言 id，传给 provider 用于双语选文件。
 */
export function registerBundledSkill(host, getLocale) {
    if (typeof host.inject !== 'function')
        return;
    try {
        host.inject(['skills'], (skillCtx) => {
            const registry = skillCtx?.skills;
            if (typeof registry?.registerProvider !== 'function')
                return;
            registry.registerProvider(() => laterSkillProvider(getLocale));
        });
    }
    catch (error) {
        host.logger?.warn?.(`later: skill 注入失败（不影响其余功能）: ${error instanceof Error ? error.message : String(error)}`);
    }
}
