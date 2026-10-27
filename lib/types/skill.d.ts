import type { HostLocaleId } from './strings.js';
/** catalog 里显示的技能名（kebab-case，内核按 `/^^[a-z0-9]+(?:-[a-z0-9]+)*$/` 校验）。 */
export declare const SKILL_NAME = "later-reminders";
/** 本插件在 skills registry 里的 provider 名；与插件名一致，便于日志定位。 */
export declare const SKILL_PROVIDER = "dsh-later";
/** `SKILL.md` 解析结果：catalog 用 `description`，点开用 `content`。 */
export interface ParsedSkill {
    readonly description: string;
    readonly content: string;
}
/**
 * skills 服务在本插件用到的最小面。
 *
 * 不 import `@deepseek-ai/dsh-skill` 的类型包（理由见 {@link BUNDLED_SKILL_RANK}），
 * 按「本插件实际触碰的最小面」本地声明，与 `index.ts` 里 settings 两代兼容的写法同
 * 一套路：类型由这里描述，运行时对象由内核提供。
 */
export interface SkillCandidateLike {
    readonly name: string;
    readonly description: string;
    readonly invocation: {
        readonly modelInvocable: boolean;
        readonly userInvocable: boolean;
    };
    readonly source: string;
    readonly provider: string;
    readonly path?: string;
    readonly resourceBase?: {
        readonly kind: 'directory';
        readonly path: string;
    };
    readonly rank: number;
    readonly locator: unknown;
}
export interface SkillDefinitionLike extends Omit<SkillCandidateLike, 'rank' | 'locator'> {
    readonly content: string;
}
/** provider 的 `list()` 可返回裸数组，也可返回带 `complete` 的观测对象。 */
export interface SkillProviderLike {
    readonly name: string;
    list(options: {
        readonly cwd?: string;
        readonly signal?: AbortSignal;
    }): Promise<readonly SkillCandidateLike[]>;
    get(candidate: SkillCandidateLike): Promise<SkillDefinitionLike | undefined>;
}
export interface SkillRegistryLike {
    /** 必须在 apply() 里**同步**注册；返回效应 disposer，随本 fiber 析构自动摘除。 */
    registerProvider(create: (control: unknown) => SkillProviderLike): () => void;
}
/**
 * `ctx.inject(['skills'], …)` 回调拿到的那层 ctx 的本插件视角形状。
 *
 * `skills` 声明为可选：收窄由 {@link registerBundledSkill} 在运行时做，类型层不给
 * 「注入进来的一定有这个成员」这种保证（宿主把 skills 改名、或装配里根本没有它，都从这里过）。
 */
export interface SkillsContextLike {
    readonly skills?: SkillRegistryLike;
}
/**
 * 注册所需的最小宿主面：`ctx.inject` + `ctx.logger.warn`。
 *
 * 刻意只声明这两个成员，且都可选：注入点是否存在由宿主装配决定，不由插件断言。注册
 * 路径在「没有 `inject`」「`skills` 缺席」「注入抛错」三种形态下都必须退化成「什么都不做」。
 */
export interface SkillHostLike {
    readonly inject?: ((deps: readonly string[], callback: (skillCtx: SkillsContextLike) => void) => unknown);
    readonly logger?: {
        warn?: (message: string) => unknown;
    };
}
/**
 * 解析 `SKILL.md`：切出 frontmatter 的 `description` 与正文。
 *
 * @param raw - 文件原文。
 * @param label - 出错时引用的文件名（让「哪个文件坏了」进得了日志）。
 * @throws 缺 frontmatter、缺 `description`、或引号形式无法解析时抛出。
 */
export declare function parseSkill(raw: string, label?: string): ParsedSkill;
/** 双语文件的绝对路径（默认相对本模块所在目录的上一级，即包根）。 */
export declare function skillFilePaths(rootDir?: string): Record<HostLocaleId, string>;
/** 按 locale id 选语言；与 `strings.ts` 的 `hostDictFor` 完全同规则（未收录回退中文）。 */
export declare function resolveSkillLocale(localeId: string | undefined): HostLocaleId;
/**
 * 构造随包分发的 skill provider。
 *
 * @param getLocale - 宿主当前语言（`ctx.get('locale')?.getSnapshot().active`）；
 *   host 平面通常拿不到，`undefined` 按中文处理，与工具 description 的语言一致。
 * @param paths - 双语文件路径，测试可注入夹具。
 */
export declare function laterSkillProvider(getLocale?: () => string | undefined, paths?: Record<HostLocaleId, string>): SkillProviderLike;
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
export declare function registerBundledSkill(host: SkillHostLike, getLocale: () => string | undefined): void;
