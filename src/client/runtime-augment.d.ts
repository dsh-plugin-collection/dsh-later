/**
 * 客户端 Cordis 上下文类型增强（augment @deepseek-ai/cordis 的 Context）。
 *
 * 为什么不从 dsh-client-runtime/client 或 dsh-client-ui-(settings|conversation)/client
 * 取类型：这些包是浏览器运行时注入产物，不应作为插件的 NPM 依赖（pnpm 解析
 * 它们的预发布版本会触发 hoisting / range 噪声）。宿主加载时按 dsh.client.inject
 * 配置注入服务，本文件只声明插件用到的那部分契约，足以让 typecheck 干净、
 * 不引入运行时依赖。
 *
 * 形状参考 dsh-client-runtime 0.1.1-rc.2 与 dsh-client-ui-(settings|conversation)
 * 0.1.2-rc.1 的真实公开 API（SlotRegistry、ISessions、SettingsScope、SlotMap），
 * 但仅暴露本插件调用的成员。所有缺失字段随宿主升级动态补齐，本文件不会被
 * 这些字段的存在与否所约束。
 *
 * @module dsh-later/client/runtime-augment
 */
import type { ComponentType, ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { SchedUIKey } from './strings.js';

/** 一个 slot 声明的核心字段（足够 plugin 调用；不展开 SlotMap 全部键）。
 *
 * `inject` 的返回类型故意写成 `object`：避免要求插件每次都构造
 * `Record<string, unknown>` 字面量（会与组件 props 类型互斥）；宿主渲染器
 * 实际通过「字段名 → 组件 prop / hook」的桥接表分发，类型安全由组件 prop
 * 类型自身保证。
 */
export interface ClientSlotDeclaration {
  readonly name: string;
  readonly id?: string;
  readonly key?: string;
  readonly order?: number;
  /**
   * 影子优先级：同一 cell 的条目按 priority 升序，**最低者渲染**；同 key 同 priority
   * 的第二条注册会抛错。官方 `user` / `steering` 都在默认 0，本插件用 -10。
   */
  readonly priority?: number;
  readonly locale?: string;
  readonly inject?: () => object;
}

/** slot 注入字段的最小契约（每个字段会被宿主转成 prop / hook）。 */
export interface ClientSlotInjectFace {
  [field: string]: unknown;
}

/** 客户端 SlotRegistry 的最小视图（slot 注册 + 生命周期）。 */
export interface ClientSlotRegistry {
  inject(
    key: string,
    callback: () => unknown | Iterable<() => void>,
  ): () => void;
  register<T = unknown>(
    declaration: ClientSlotDeclaration,
    component: ComponentType<T>,
  ): () => void;
  /** 读某个插槽的声明（未声明/宿主无该服务时 undefined）。能力门禁用。 */
  spec?(key: string): { readonly kind: string } | undefined;
}

/** 客户端会话面：足够 callCommand 链路使用；不暴露全部 ISessions。 */
export interface ClientSessionFace {
  command(line: string): Promise<{
    ok?: boolean;
    value?: { matched?: boolean; [k: string]: unknown };
    [k: string]: unknown;
  } | undefined>;
}

/** Agent-scoped 上下文视图（运行时返回真正的 Context；这里只用到 type guard）。 */
export type ClientAgentContext = Context;

export interface ClientSessionsService {
  scope(id: string): ClientAgentContext | undefined;
  sessionOf(ctx: ClientAgentContext): ClientSessionFace | undefined;
  list?: {
    getSnapshot(): { byId: Readonly<Record<string, unknown>> };
    subscribe(fn: () => void): () => void;
  };
  refresh?: () => Promise<unknown>;
}

/** 设置 namespace scope（取自 dsh-client-ui-settings 0.1.2-rc.1 的 SettingsScope）。 */
export interface ClientSettingsScopeSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'unavailable';
  readonly value: T | undefined;
  readonly base: unknown;
  readonly user: unknown;
  readonly writable: boolean;
}

export interface ClientSettingsScope<T = unknown> {
  getSnapshot(): ClientSettingsScopeSnapshot<T>;
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<void>;
  unset(field: string): Promise<void>;
}

export interface ClientSettingsScopeService {
  bind(spec: { namespace: string }): ClientSettingsScope;
  describe?(): unknown;
}

/** 一个 namespace 的配置表单（取自 0.1.7 settings rewrite 的 ConfigForm）。
 *
 * 与 {@link ClientSettingsScope} 同形状，差异只在写入返回 `boolean`（宿主是否
 * 接受）而非 `void`——按 TS 的返回类型协变，可直接喂给只认 `Promise<void>` 的
 * 卡片组件。
 */
export interface ClientConfigForm<T = unknown> {
  getSnapshot(): ClientSettingsScopeSnapshot<T>;
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<boolean>;
  unset(field: string): Promise<boolean>;
}

/** 配置表单服务（0.1.7 起取代浏览器端 settingsScope）。 */
export interface ClientConfigFormsService {
  /** 取某 Host plugin entry（namespace）的共享表单。 */
  get<T = unknown>(entryId: string): ClientConfigForm<T>;
  /** 宿主仍在服务这些 namespace 时保持注册有效；返回终止用 disposer。 */
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void;
}

/** Locale 服务：register 注册命名空间字典、bind 取出 `t(key)` 函数。 */
export interface ClientLocaleService {
  register(
    namespace: string,
    dictionaries: Readonly<Record<string, Record<string, string>>>,
  ): () => void;
  bind(namespace: string): (key: string) => string;
  getSnapshot(): { active: string; revision: number };
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: ClientSlotRegistry;
    sessions: ClientSessionsService;
    settingsScope: ClientSettingsScopeService;
    configForms: ClientConfigFormsService;
    locale: ClientLocaleService;
    conversation?: unknown;
  }
}

/* ============================================================================
 * locale seat 的键表（issue #28）
 *
 * 官方合并形状核实自宿主包：**成员值是 string 联合类型别名**，不是对象、不是字典
 * 类型（dsh-client-locale/lib/types/client/index.d.ts:20-26 的 `common: CommonKey`
 * 与 `'settings.locale': SettingsLocaleKey`；dsh-client-ui-conversation
 * /lib/types/client/apply.d.ts:5-8 的 `conversation: ConversationKey`，而
 * `ConversationKey = keyof typeof …`）。写成字典形状的话
 * `LocaleKeysOf<N> = (LocaleNamespaceMap[N] & string) | CommonKeyOf` 会退化成
 * `never`，`t` 虽然还在类型里却一个 key 都不吃——typecheck 只会报「参数不能赋给
 * never」这种看不出根因的错，所以这里加正向哨兵（见文件末尾）。
 * ========================================================================== */

/** 本插件在宿主 locale 服务里的 namespace（与 index.tsx 的 `NS` 同值）。 */
export type LaterLocaleNamespace = 'settings.plugins.later';

/**
 * 宿主 `LocaleNamespaceMap` 的键表镜像。
 *
 * 为什么要镜像而不是只靠下面的 `declare module`：`@deepseek-ai/dsh-client-ui-slots`
 * 不在本仓依赖里（只有 dsh-client-ui-primitives），本文件又是带顶层 import 的模块，
 * 那段 `declare module` 对不可解析的模块名只能算「幽灵合并」——在本仓编译单元里
 * 拿不到那个 interface，断言就无从谈起。镜像与 `declare module` 必须保持一致，
 * 宿主包进入编译单元后由后者接管。
 */
export interface LaterLocaleNamespaceMap {
  'settings.plugins.later': SchedUIKey;
}

/** 宿主 `LocaleKeysOf` 的镜像（dsh-client-ui-slots/lib/types/index.d.ts:59）。 */
type LaterLocaleKeysOf<N extends keyof LaterLocaleNamespaceMap & string> =
  LaterLocaleNamespaceMap[N] & string;

/** 宿主 `Translate` / `TranslateNS` 的镜像（同文件 :47-67）。 */
type LaterTranslate<K extends string> = (key: K, params?: Record<string, unknown>) => string;
type LaterTranslateNS<N extends keyof LaterLocaleNamespaceMap & string> = LaterTranslate<LaterLocaleKeysOf<N>>;

/** 宿主 `PropsLocale` 的镜像（同文件 :78-81）：NS 不在表里时**塌成 `object`**。 */
export type LaterPropsLocale<N> =
  N extends keyof LaterLocaleNamespaceMap & string ? { t: LaterTranslateNS<N> } : object;

/**
 * 正向哨兵：必须是 `true`。
 *
 * index.tsx 里有一行 `const _dockSeatProbe: LaterDockSeatProbe = true;` 消费它——
 * 断言体写在本文件（.d.ts，`skipLibCheck` 下不会被检查），**只有在被检查的文件里
 * 消费才真的会失败**。合并形状写错、或宿主规则变化导致 `t` 塌陷 / 键集退化时，
 * 这里解析成 `false`，那一行立刻编译失败。
 */
export type LaterDockSeatProbe =
  ['t'] extends [keyof LaterPropsLocale<LaterLocaleNamespace>]
    ? 'panelCount' extends Parameters<LaterPropsLocale<LaterLocaleNamespace>['t']>[0]
      ? 'steerTask' extends Parameters<LaterPropsLocale<LaterLocaleNamespace>['t']>[0]
        ? true
        : false
      : false
    : false;

/**
 * 真正的宿主合并点：与上面 `LaterLocaleNamespaceMap` 必须同值。
 *
 * 说明本仓的编译现实（不要误以为它在这里生效）：
 *  - `@deepseek-ai/dsh-client-ui-slots` 不是本仓依赖，也不在 node_modules 里，
 *    所以在本仓编译单元内这是一段**无法解析的合并**（`skipLibCheck` 下不报错，
 *    也不产生效果）；`LaterDockSeatProbe` 才是可验证的那一份。
 *  - 一旦宿主把该包纳入插件可见的类型面（或本仓加了 devDependency），这段就接管，
 *    与镜像同形 ⇒ 行为不变。
 *  - **不为了类型去加依赖**：那会牵动 build 的 external 面与发布依赖清单。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session scheduler 的全部客户端 UI 词条（strings.ts 的 schedDicts）。 */
    'settings.plugins.later': SchedUIKey;
  }
}

