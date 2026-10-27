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
 * **provider 对外永不抛**，这是本模块最硬的一条不变式，因为抛错的代价不是「我们少一行
 * 曝光」，而是全机器的 skill 面降质：
 *  - `list()` 抛 → 内核 `listLayerCandidates` 虽然 catch 住并记 warn，但同时置
 *    `cacheable = false`；`SkillRegistry.collect()` 只在 cacheable 时写缓存，
 *    `snapshot()` 于是把 `complete: false` 交出去。而 dsh-tool-skill 在 `agent/pre-step`
 *    里 `if (!snapshot.complete) return decision;`：**那一轮整个 catalog 不发布也不更新**
 *    （模型看不到任何 skill，包括宿主 filesystem 那一批），且因为永不缓存，每个 step 都要
 *    重新 collect 全部 provider。
 *  - `get()` 抛 → `SkillRegistry.get()` 对 `provider.get()` **没有** try/catch，异常直接
 *    冒给调用方（模型的 `skill` 工具、用户的显式 `/skill` 注入）。
 *
 * 所以两条失败路径都收敛成「本 skill 缺席 + 一条 warn」：`list()` 返回空数组（裸数组按
 * 内核 `normalizeProviderObservation` 就是 `complete: true`，catalog 照常发布），`get()`
 * 返回 `undefined`（契约里这就是「不再可加载」，内核据此作废该条目）。
 *
 * @param getLocale - 宿主当前语言 id。注意 **host 平面今天拿不到它**：`locale` 是
 *   client 侧服务（见 `src/index.ts` 顶层 `inject` 的注释），所以生产路径上恒为
 *   `undefined`，实际恒走中文那一份。保留这条判定是为了语言源一旦可达时不必再改形状。
 * @param paths - 双语文件路径，测试可注入夹具。
 * @param onWarn - 失败上报口（接宿主 `logger.warn`）；默认静默。
 */
export declare function laterSkillProvider(getLocale?: () => string | undefined, paths?: Record<HostLocaleId, string>, onWarn?: (message: string) => void): SkillProviderLike;
/**
 * 把 {@link laterSkillProvider} 挂进宿主的 skills 服务，**fail-safe**。
 *
 * 四条退化路径，最坏结果都只是「本 skill 缺席 + 一条 warn」，永远不会是「插件起不来」，
 * 也永远不会是「整台宿主的 catalog 降质」（后者是 provider 抛错的代价，见
 * {@link laterSkillProvider} 的不变式）：
 *  1. `inject` 不是函数（宿主形态不符）→ 直接返回；
 *  2. `ctx.inject(...)` **这一步**同步抛 → 外层 catch 记一条 warn；
 *  3. 注入的那层 ctx 没有 `registerProvider` → 静默返回；
 *  4. 回调体内抛（`registerProvider` 遇到同层重名或撞保留名 `runtime` 就抛）→ **必须**由
 *     回调自己的 catch 兜住。cordis 的子 fiber 是异步 apply 的（`_reload` 先
 *     `await Promise.resolve()` 再执行），所以第 2 层那个外层 catch 根本接不到回调里的
 *     抛错：不加回调内的 catch，那句 warn 永远不会出现，只剩 cordis 自己把子 fiber 标成
 *     FAILED（父入口不受影响，但现场没有任何属于本插件的说明）。
 *
 * 还有一种情形不在这四条里，而是注入点永不激活：宿主装配里没有 `skills` 服务时，cordis
 * 给这条**子 fiber** 建的门控永远不满足，回调根本不执行，父入口照常激活。本仓支持的各代
 * 内核都带该服务（0.2.1-rc.2 由测试用真 `SkillRegistry` 实跑；0.1.2-rc.1 一代是脱离本仓
 * 单独装包跑通同一对 `list()`/`get()` 的，复现方式见 `tests/skill-provider.test.mjs` 的
 * `DSH_LATER_SKILL_PKG`），所以这条路是给「装配里没有它」的宿主留的，不是给某个代次留的。
 * 要点是形状而不是概率：`'skills'` 一旦误进 `src/index.ts` 的顶层 `inject`（那是整个
 * 插件的激活门控），它就从「少一行 catalog」变成「服务不来则整插件永久 pending、
 * `/later` 与 `/schedule` 集体消失」。这条边界由 `tests/skill-provider.test.mjs` 与
 * `tests/host-entry-activation.test.mjs` 双向锁住。
 *
 * @param host - 宿主 ctx（只取 `inject` 与 `logger`）。
 * @param getLocale - 当前语言 id，传给 provider 用于双语选文件。
 */
export declare function registerBundledSkill(host: SkillHostLike, getLocale: () => string | undefined): void;
