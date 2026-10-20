/** 同源判定三态。`unknown` 是「没测出来」，语义上不等于 `same`。 */
export type KernelIdentityStatus = 'same' | 'different' | 'unknown';
/** 单个内核包的同源判定结果（诊断信息全部保留，便于告警里直接定位）。 */
export interface KernelModuleIdentity {
    /** bare specifier，如 `@deepseek-ai/dsh-session`。 */
    specifier: string;
    status: KernelIdentityStatus;
    /** 插件侧 bare import 解析出的 URL（解析失败时缺省）。 */
    pluginUrl?: string;
    /** 宿主锚点出发解析出的 URL（解析失败时缺省）。 */
    hostUrl?: string;
    /** 两侧真实文件路径（realpath；用于人工比对/告警文案）。 */
    pluginPath?: string;
    hostPath?: string;
    /** 两侧内核版本（best-effort 读最近 package.json；读不到时缺省）。 */
    pluginVersion?: string;
    hostVersion?: string;
    /** 结论依据（机器可读短语，如 `resolved_paths_differ`）。 */
    reason?: string;
}
/** 一次探测的整体结论。 */
export interface KernelIdentityReport {
    /** 聚合三态：任一包 different → different；全 same → same；否则 unknown。 */
    status: KernelIdentityStatus;
    modules: readonly KernelModuleIdentity[];
    /** 实际使用的宿主锚点；拿不到时为 null。 */
    hostAnchor: string | null;
    /** true 表示护栏被显式关闭（`DSH_LATER_KERNEL_GUARD=off`），此时未做探测。 */
    disabled: boolean;
    /** 整体层面的补充说明（如无锚点、探测异常）。 */
    reason?: string;
}
/** 关闭/详细模式的开关变量名。 */
export declare const KERNEL_GUARD_ENV = "DSH_LATER_KERNEL_GUARD";
/** 宿主入口锚点覆盖变量名。 */
export declare const HOST_ENTRY_ENV = "DSH_LATER_HOST_ENTRY";
/** 护栏运行模式。 */
export type KernelGuardMode = 'off' | 'on' | 'verbose';
/** 解析开关取值（缺省/无法识别 → on；只有显式关闭才 off）。 */
export declare function resolveGuardMode(raw: string | undefined): KernelGuardMode;
/**
 * 取宿主锚点的输入来源。
 *
 * 注意 `argv1` 的语义：缺省/`undefined` = 用 `process.argv[1]`，**`null` 显式
 * 表示「没有 argv1」**——不能用 `undefined` 表达，否则会踩 JS 默认参数陷阱，
 * 在测试里悄悄回落到真实进程参数。
 */
export interface HostAnchorSources {
    /** 环境变量来源；缺省 `process.env`。 */
    env?: NodeJS.ProcessEnv;
    /** 宿主入口；缺省 `process.argv[1]`，`null` 表示没有。 */
    argv1?: string | null;
}
/**
 * 取宿主锚点：显式入参 → `DSH_LATER_HOST_ENTRY` → `process.argv[1]`。
 * 相对路径按 `cwd` 补全；两者都没有时返回 null（调用方据此给 unknown）。
 */
export declare function resolveHostAnchor(sources?: HostAnchorSources): string | null;
/** 单模块判定的可注入参数（测试用；生产走默认实现）。 */
export interface ClassifyModuleIdentityOptions {
    specifier: string;
    pluginUrl: string;
    hostUrl: string;
    canonicalize?: (url: string) => string;
    preserveSymlinks?: boolean;
    pluginVersion?: string;
    hostVersion?: string;
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
export declare function classifyModuleIdentity(options: ClassifyModuleIdentityOptions): KernelModuleIdentity;
/** 聚合规则：different 优先；只有「全部 same 且非空」才是 same，其余 unknown。 */
export declare function aggregateIdentityStatus(modules: readonly KernelModuleIdentity[]): KernelIdentityStatus;
/** 探测参数（全部可注入，测试不依赖真实 GUI/真实内核安装）。 */
export interface KernelIdentityProbeOptions {
    /** 要检查的内核包（默认取 {@link KERNEL_SCOPED_PACKAGES}）。 */
    specifiers?: readonly string[];
    /** 宿主锚点；`undefined` 走默认解析，`null` 表示没有锚点。 */
    hostAnchor?: string | null;
    /** 插件侧解析器；默认 `import.meta.resolve`（ESM 语义，与真实 import 一致）。 */
    resolvePlugin?: (specifier: string) => string;
    /** 宿主侧解析器；默认 `createRequire(hostAnchor).resolve` + file URL。 */
    resolveHost?: (specifier: string) => string;
    /** 路径规范化；默认 realpath。 */
    canonicalize?: (url: string) => string;
    /** 版本读取；默认向最近的 package.json 查询。 */
    readVersion?: (specifier: string, url: string) => string | undefined;
    /** 是否 `--preserve-symlinks`；默认从 execArgv/NODE_OPTIONS 探测。 */
    preserveSymlinks?: boolean;
}
/** 探测一组内核包与宿主是否同源；不告警、不写日志（纯观测）。 */
export declare function probeKernelIdentity(options?: KernelIdentityProbeOptions): KernelIdentityReport;
/** 生成启动告警文案（不同源时使用；可直接定位到两侧文件与 issue）。 */
export declare function formatKernelIdentityWarning(report: KernelIdentityReport): string;
/** 测试用：清空一次性告警去重状态。 */
export declare function resetKernelIdentityGuardForTests(): void;
export interface KernelGuardStartupOptions extends KernelIdentityProbeOptions {
    /** 运行模式；缺省读 {@link KERNEL_GUARD_ENV}。 */
    mode?: KernelGuardMode;
}
/**
 * 启动护栏：探测一次，`different` 时每个进程只告警一次；`unknown` 保持安静
 * （除非 verbose），因为「测不出来」不该制造启动噪音。
 *
 * 永不抛出：任何内部异常都折成 `unknown` 报告——护栏不能反过来弄坏插件加载。
 */
export declare function checkKernelIdentityAtStartup(options?: KernelGuardStartupOptions): KernelIdentityReport;
