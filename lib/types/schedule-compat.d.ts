import * as sched from '@deepseek-ai/dsh-schedule';
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule';
import { type KernelVersion } from './upstream-compat.js';
declare const ScheduleId: typeof sched.ScheduleId;
export declare const SCHEDULE_TITLE_MAX = 120;
export declare function allocateScheduleIdCompat(_folded?: unknown): ReturnType<typeof ScheduleId>;
export declare function deriveScheduleTitle(prompt: string): string;
export declare function createAfterRecord(id: ReturnType<typeof ScheduleId>, prompt: string, afterSeconds: number, now: number): ScheduleRecord;
export declare function createAtRecord(id: ReturnType<typeof ScheduleId>, prompt: string, scheduledAt: string, now: number): ScheduleRecord;
export declare function createEveryRecord(id: ReturnType<typeof ScheduleId>, prompt: string, everySeconds: number, now: number): ScheduleRecord;
export declare function renderRecurringBatchFraming(reminders: readonly unknown[]): string;
export type MessageSourceVia = 'kernel-version' | 'symbol-probe';
export interface MessageSourceDecision {
    readonly kind: 'schedule' | 'plugin';
    readonly via: MessageSourceVia;
    readonly detail: string;
}
export interface MessageSourceProbeOptions {
    readKernel?: () => KernelVersion | undefined;
    hasModernRenderName?: () => boolean;
    warn?: (message: string) => void;
}
export declare function resetMessageSourceDecision(): void;
export declare function messageSourceDecision(options?: MessageSourceProbeOptions): MessageSourceDecision;
export declare function scheduleMessageSource(boundedSummary: string): Record<string, unknown>;
export declare function asLegacySchedules(folded: unknown): {
    readonly active: readonly ScheduleRecord[];
    readonly seenIds: ReadonlySet<string>;
};
export declare function toChangePayload(record: ScheduleRecord): never;
export {};
