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
 *  2. **provider 永不抛**。每次被调用时读盘（load-on-call），但读盘/解析失败一律收敛成
 *     「本 skill 缺席 + 一条 warn」：`list()` 返回空数组、`get()` 返回 `undefined`。
 *     这不是怕报错，是代价算过来的：`list()` 抛会被内核 catch，可它同时置
 *     `cacheable = false`，catalog 因此**永不缓存**且 `snapshot().complete` 为 false，而
 *     dsh-tool-skill 在 `agent/pre-step` 里 `if (!snapshot.complete) return decision;`
 *     一整轮都不发布 catalog；`get()` 抛则内核 `SkillRegistry.get()` 根本没有 try/catch，
 *     异常直接冒到模型的 `skill` 工具或用户的 `/skill` 注入上。也就是说「我们少一行」会被
 *     放大成「所有插件的所有 skill 一起降质」。另需知道：catalog 的重建节奏由内核按
 *     revision 缓存决定（provider 注册/析构才 bump），所以「改了文件立刻生效」只在缓存
 *     失效后的那一轮成立，别把它当成实时热更。
 *  3. **双语按 locale 选文件**，与 `strings.ts` 的 `hostDictFor` 同源同规则：`en` 走
 *     `SKILL.en.md`，其余（含拿不到 locale 服务）回退 `SKILL.md`。语言在 `list()` 时
 *     定一次并写进 `locator`，`get()` 按 `locator` 取同一份文件：否则用户在 catalog
 *     刷新之间切了语言，会出现「中文描述点开是英文正文」。**今天 host 平面拿不到
 *     `locale`**（它是 client 侧服务，见 `src/index.ts` 顶层 `inject` 的注释），所以实际
 *     恒走中文那份；这条判定留着，是为了语言源一旦可达时不必再改形状。
 * @module dsh-later/skill
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HostLocaleId } from './strings.js';

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
const INVOCATION = { modelInvocable: true, userInvocable: true } as const;

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
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean };
  readonly source: string;
  readonly provider: string;
  readonly path?: string;
  readonly resourceBase?: { readonly kind: 'directory'; readonly path: string };
  readonly rank: number;
  readonly locator: unknown;
}

export interface SkillDefinitionLike extends Omit<SkillCandidateLike, 'rank' | 'locator'> {
  readonly content: string;
}

/** provider 的 `list()` 可返回裸数组，也可返回带 `complete` 的观测对象。 */
export interface SkillProviderLike {
  readonly name: string;
  list(options: { readonly cwd?: string; readonly signal?: AbortSignal }):
    Promise<readonly SkillCandidateLike[]>;
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
  readonly logger?: { warn?: (message: string) => unknown };
}

/**
 * 解析 `SKILL.md`：切出 frontmatter 的 `description` 与正文。
 *
 * @param raw - 文件原文。
 * @param label - 出错时引用的文件名（让「哪个文件坏了」进得了日志）。
 * @throws 缺 frontmatter、缺 `description`、或引号形式无法解析时抛出。
 */
export function parseSkill(raw: string, label = 'SKILL.md'): ParsedSkill {
  // BOM 要先剥：Windows 编辑器、以及某些 `dsh plugin add` 的落盘路径会给首行加上
  // 一个 U+FEFF，那时 `startsWith('---\n')` 会失败，一份好端端的 SKILL 就被判成坏形状。
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  // 从前matter 内容起始处找闭合线，避免把开头的 `---\n` 自己当成闭合。
  const end = text.indexOf('\n---\n', 4);
  if (!text.startsWith('---\n') || end < 0) {
    throw new Error(`${label} 缺少 --- 包裹的 frontmatter`);
  }
  const match = /^description:[ \t]*(.+)$/m.exec(text.slice(4, end));
  if (match === null) throw new Error(`${label} 的 frontmatter 没有 description`);
  // `.+` 已保证捕获组存在，`?? ''` 只为满足 noUncheckedIndexedAccess；空值由下面的
  // 「description 为空」判据兜住。
  let description = (match[1] ?? '').trim();
  if (description.startsWith('"')) {
    // 双引号形式按 JSON 解一次，让 `\"` 之类的转义走正规通道而非手工剥引号。
    try {
      description = JSON.parse(description) as string;
    } catch {
      throw new Error(`${label} 的 description 双引号未闭合或含非法转义`);
    }
  }
  if (description.length === 0) throw new Error(`${label} 的 description 为空`);
  return { description, content: text.slice(end + 5) };
}

/** 双语文件的绝对路径（默认相对本模块所在目录的上一级，即包根）。 */
export function skillFilePaths(rootDir?: string): Record<HostLocaleId, string> {
  const base =
    rootDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return {
    zh: resolve(base, 'SKILL.md'),
    en: resolve(base, 'SKILL.en.md'),
  };
}

/** 按 locale id 选语言；与 `strings.ts` 的 `hostDictFor` 完全同规则（未收录回退中文）。 */
export function resolveSkillLocale(localeId: string | undefined): HostLocaleId {
  return localeId === 'en' ? 'en' : 'zh';
}

/** `locator` 里携带的加载线索：本插件只带一个 path。 */
interface SkillLocator {
  readonly path: string;
}

function locatorPath(locator: unknown): string | undefined {
  if (locator === null || typeof locator !== 'object') return undefined;
  const path = (locator as { path?: unknown }).path;
  return typeof path === 'string' ? path : undefined;
}

/**
 * 读一次盘。**会抛**：只给 {@link laterSkillProvider} 内部经 `tryLoad` 兜住后使用，
 * 任何直接对外暴露的调用点都不允许它把异常带出 provider。
 */
function loadSkill(path: string): ParsedSkill {
  return parseSkill(readFileSync(path, 'utf8'), path.split('/').pop() ?? path);
}

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
export function laterSkillProvider(
  getLocale: () => string | undefined = () => undefined,
  paths: Record<HostLocaleId, string> = skillFilePaths(),
  onWarn: (message: string) => void = () => undefined,
): SkillProviderLike {
  /** catalog 条目的公共骨架（不含每次要现读的 `description`）。 */
  const frame = (path: string): Omit<SkillCandidateLike, 'description' | 'rank' | 'locator'> => ({
    name: SKILL_NAME,
    invocation: INVOCATION,
    source: 'bundled',
    provider: SKILL_PROVIDER,
    path,
    resourceBase: { kind: 'directory', path: dirname(path) },
  });

  /**
   * 读盘 + 解析，失败时收敛成 `undefined` 并上报，**不向外抛**。
   */
  const tryLoad = (path: string): ParsedSkill | undefined => {
    try {
      return loadSkill(path);
    } catch (error) {
      onWarn(
        `later: 跳过 ${SKILL_NAME}（${error instanceof Error ? error.message : String(error)}），` +
          '其余功能不受影响',
      );
      return undefined;
    }
  };

  return {
    name: SKILL_PROVIDER,
    async list() {
      const path = paths[resolveSkillLocale(getLocale())];
      const parsed = tryLoad(path);
      // 空数组 = complete:true：我们缺席，但 catalog 照常发布。
      if (parsed === undefined) return [];
      return [{ ...frame(path), description: parsed.description, rank: BUNDLED_SKILL_RANK, locator: { path } }];
    },
    async get(candidate) {
      // 语言以 `list()` 时的判定为准（见文件头纪律 3）；locator 不可用时退回现读，
      // 那只会发生在内核把别的 provider 的 candidate 误交给我们的场合。
      const path = locatorPath(candidate.locator) ?? paths[resolveSkillLocale(getLocale())];
      const parsed = tryLoad(path);
      // undefined 是契约内的「不再可加载」，内核会作废该条目，不让它抛给模型/用户。
      if (parsed === undefined) return undefined;
      return { ...frame(path), description: parsed.description, content: parsed.content };
    },
  };
}

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
export function registerBundledSkill(host: SkillHostLike, getLocale: () => string | undefined): void {
  if (typeof host.inject !== 'function') return;
  // warn 自己也要兜住：logger 缺席或抛错的宿主，不能把「上报失败」变成新的抛点。
  const warn = (message: string): void => {
    try {
      host.logger?.warn?.(message);
    } catch {
      /* 上报不是功能，丢掉即可 */
    }
  };
  try {
    host.inject(['skills'], (skillCtx: SkillsContextLike) => {
      // 见退化路径 4：回调体是异步跑的，外层 catch 到不了这里。
      try {
        const registry = skillCtx?.skills;
        if (typeof registry?.registerProvider !== 'function') return;
        registry.registerProvider(() => laterSkillProvider(getLocale, skillFilePaths(), warn));
      } catch (error) {
        warn(
          `later: skill provider 注册失败（不影响其余功能）: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  } catch (error) {
    warn(
      `later: skill 注入失败（不影响其余功能）: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
