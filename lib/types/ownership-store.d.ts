import type { ImageBlock } from '@deepseek-ai/dsh-llm';
import type { UserScheduleDelivery } from './domain.js';
import type { FileBlockShim } from './upstream-shims.js';
export type ScheduledAttachment = ImageBlock | FileBlockShim;
export declare function sanitizeAttachments(value: unknown): readonly ScheduledAttachment[] | undefined;
export interface OwnedEntry {
    readonly delivery: UserScheduleDelivery;
    readonly createdAt: number;
    readonly uid?: string;
    readonly windowSeconds?: number;
    readonly attachments?: readonly ScheduledAttachment[];
    readonly scheduledAt?: number;
    readonly dispatchedAt?: number;
}
export interface PausedEntry {
    readonly uid: string;
    readonly prompt: string;
    readonly delivery: UserScheduleDelivery;
    readonly kind: 'after';
    readonly remainingSeconds: number;
    readonly originalScheduledAt: string;
    readonly originalAfterSeconds?: number;
    readonly lastScheduleId: string;
    readonly pausedAt: number;
    readonly attachments?: readonly ScheduledAttachment[];
}
export declare function ownershipGeneration(): number;
export declare function allOwnership(sessionId: string): Readonly<Record<string, OwnedEntry>>;
export declare function hasOwnership(sessionId: string, id: string): boolean;
export declare function getOwnership(sessionId: string, id: string): OwnedEntry | undefined;
export declare function newTaskUid(): string;
export declare function recordOwnership(sessionId: string, id: string, delivery: UserScheduleDelivery, uid?: string, windowSeconds?: number, attachments?: readonly ScheduledAttachment[], scheduledAt?: number): OwnedEntry;
export interface SidecarSnapshot {
    readonly sessionId: string;
    readonly entries: Readonly<Record<string, OwnedEntry>>;
}
export declare function listOwnershipSnapshots(warn?: (message: string) => void): readonly SidecarSnapshot[];
export declare function removeOwnership(sessionId: string, id: string): void;
export declare function mirrorDueIndex(sessionId: string, targets: ReadonlyMap<string, number | undefined>): number;
export declare function findScheduleIdByUid(sessionId: string, uid: string): string | undefined;
export declare function allPaused(sessionId: string): Readonly<Record<string, PausedEntry>>;
export declare function getPaused(sessionId: string, uid: string): PausedEntry | undefined;
export declare function findPausedByScheduleId(sessionId: string, scheduleId: string): PausedEntry | undefined;
export declare function recordPaused(sessionId: string, entry: PausedEntry): void;
export declare function removePaused(sessionId: string, uid: string): void;
export declare function resetCacheForTests(): void;
