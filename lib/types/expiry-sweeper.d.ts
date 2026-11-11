import type { OwnedEntry } from './ownership-store.js';
export declare const DEFAULT_SWEEP_INTERVAL_MS = 60000;
export declare const MAX_WAKE_FAILURES = 5;
export declare const MAX_BACKOFF_MS: number;
export interface SweepSnapshot {
    readonly sessionId: string;
    readonly entries: Readonly<Record<string, OwnedEntry>>;
}
export interface ScheduleChangeEventLike {
    readonly type: string;
    readonly data?: unknown;
}
export interface ExpirySweeperOptions {
    snapshots(): readonly SweepSnapshot[];
    wake(sessionId: string): void | Promise<void>;
    wakeable(sessionId: string): boolean;
    refuseReason?(sessionId: string): string | undefined;
    resolveScheduledAt(sessionId: string, scheduleId: string): number | undefined;
    warn(message: string): void;
    now?(): number;
    intervalMs?: number;
    setTimeout?(handler: () => void, delayMs: number): ReturnType<typeof setTimeout>;
    clearTimeout?(handle: ReturnType<typeof setTimeout>): void;
    setInterval?(handler: () => void, delayMs: number): ReturnType<typeof setInterval>;
    clearInterval?(handle: ReturnType<typeof setInterval>): void;
}
export interface ExpirySweeper {
    sweepNow(): number;
    reschedule(): void;
    rearm(sessionId: string): void;
    readonly stopped: boolean;
    dispose(): Promise<void>;
    failuresOf(sessionId: string): number;
    undeliveredReasons(): ReadonlyMap<string, number>;
}
export declare function backoffForFailures(failures: number): number;
export declare function resolveScheduledAtFromLog(events: readonly ScheduleChangeEventLike[], scheduleId: string, createdAt: number): number | undefined;
export declare function createExpirySweeper(options: ExpirySweeperOptions): ExpirySweeper;
