import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
export declare const KERNEL_GENERATIONS: readonly [{
    readonly id: "0.1.2-rc.1";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.1.5-rc.3";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.1.7-rc.1";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.1.7-rc.2";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.2.0-rc.2";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.2.1-rc.2";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.2.1-rc.3";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.2.1-rc.4";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.2.2-alpha.2";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.2.2-alpha.3";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.2.2-rc.1";
    readonly sessionApi: "own-events";
}, {
    readonly id: "0.2.2-rc.2";
    readonly sessionApi: "own-events";
}];
export declare const KERNEL_SCOPED_PACKAGES: readonly ["@deepseek-ai/dsh-agent", "@deepseek-ai/dsh-commands", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-schedule", "@deepseek-ai/dsh-session", "@deepseek-ai/dsh-session-projection", "@deepseek-ai/dsh-settings", "@deepseek-ai/dsh-tools"];
export declare function genPeerRange(id: string): string;
export declare function peerRangeFor(packageName: string): string;
export declare function peerMatrixEntries(): ReadonlyArray<{
    packageName: string;
    range: string;
}>;
export declare function enginesDshRange(): string;
export interface SessionLogSurface {
    readonly header?: {
        readonly seedLength?: unknown;
    } | undefined;
    readonly events?: readonly SessionEvent[] | undefined;
    readonly ownEvents?: (() => readonly SessionEvent[]) | undefined;
    readonly inheritedEventCount?: unknown;
    readonly seq?: unknown;
}
export declare function readOwnEvents(session: SessionLogSurface | Session): readonly SessionEvent[];
export declare function readInheritedEventCount(session: SessionLogSurface | Session): number;
export interface LogCursor {
    readonly offset: number;
    readonly tail: number;
}
export declare function readLogCursor(session: SessionLogSurface | Session): LogCursor;
export declare function readFoldInput(session: SessionLogSurface | Session): {
    events: readonly SessionEvent[];
    inheritedEventCount: number;
};
export declare function readEventAt(session: SessionLogSurface | Session, seq: number): SessionEvent | undefined;
export declare function detectSessionApi(session: SessionLogSurface | Session): 'own-events' | 'legacy-events';
export interface AgentRegistrySurface<A> {
    readonly roots?: (() => readonly A[]) | undefined;
    readonly list?: (() => readonly A[]) | undefined;
}
export declare function readDelegationDepth(agent: unknown): number;
export declare function isRootAgentShape(agent: unknown): boolean;
export declare function isRootAgent<A>(agents: AgentRegistrySurface<A> | undefined, agent: A): boolean;
export declare function liveRootAgents<A>(agents: AgentRegistrySurface<A> | undefined): readonly A[];
export declare const PLUGIN_KIND_RETIRED_SINCE = "0.1.7-rc.1";
export declare const KERNEL_VERSION_SPECIFIERS: readonly ["@deepseek-ai/dsh", "@deepseek-ai/dsh-schedule", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-session"];
export interface KernelVersion {
    readonly version: string;
    readonly specifier: string;
}
export interface KernelVersionSources {
    resolve?: (specifier: string) => string;
    readFile?: (filePath: string) => string;
    specifiers?: readonly string[];
}
export declare function readKernelVersion(sources?: KernelVersionSources): KernelVersion | undefined;
export interface ParsedVersion {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly pre: readonly (string | number)[];
}
export declare function parseVersion(raw: string | undefined): ParsedVersion | undefined;
export declare function compareVersions(left: string | undefined, right: string | undefined): number | undefined;
export declare function versionAtLeast(raw: string | undefined, threshold: string): boolean | undefined;
