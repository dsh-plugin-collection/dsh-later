export type KernelIdentityStatus = 'same' | 'different' | 'unknown';
export interface KernelModuleIdentity {
    specifier: string;
    status: KernelIdentityStatus;
    pluginUrl?: string;
    hostUrl?: string;
    pluginPath?: string;
    hostPath?: string;
    pluginVersion?: string;
    hostVersion?: string;
    reason?: string;
}
export interface KernelIdentityReport {
    status: KernelIdentityStatus;
    modules: readonly KernelModuleIdentity[];
    hostAnchor: string | null;
    disabled: boolean;
    reason?: string;
}
export declare const KERNEL_GUARD_ENV = "DSH_LATER_KERNEL_GUARD";
export declare const HOST_ENTRY_ENV = "DSH_LATER_HOST_ENTRY";
export type KernelGuardMode = 'off' | 'on' | 'verbose';
export declare function resolveGuardMode(raw: string | undefined): KernelGuardMode;
export interface HostAnchorSources {
    env?: NodeJS.ProcessEnv;
    argv1?: string | null;
}
export declare function resolveHostAnchor(sources?: HostAnchorSources): string | null;
export interface ClassifyModuleIdentityOptions {
    specifier: string;
    pluginUrl: string;
    hostUrl: string;
    canonicalize?: (url: string) => string;
    preserveSymlinks?: boolean;
    pluginVersion?: string;
    hostVersion?: string;
}
export declare function classifyModuleIdentity(options: ClassifyModuleIdentityOptions): KernelModuleIdentity;
export declare function aggregateIdentityStatus(modules: readonly KernelModuleIdentity[]): KernelIdentityStatus;
export interface KernelIdentityProbeOptions {
    specifiers?: readonly string[];
    hostAnchor?: string | null;
    resolvePlugin?: (specifier: string) => string;
    resolveHost?: (specifier: string) => string;
    canonicalize?: (url: string) => string;
    readVersion?: (specifier: string, url: string) => string | undefined;
    preserveSymlinks?: boolean;
}
export declare function probeKernelIdentity(options?: KernelIdentityProbeOptions): KernelIdentityReport;
export declare function formatKernelIdentityWarning(report: KernelIdentityReport): string;
export declare function resetKernelIdentityGuardForTests(): void;
export interface KernelGuardStartupOptions extends KernelIdentityProbeOptions {
    mode?: KernelGuardMode;
}
export declare function checkKernelIdentityAtStartup(options?: KernelGuardStartupOptions): KernelIdentityReport;
