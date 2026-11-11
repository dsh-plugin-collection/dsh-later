import { z } from 'zod';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
declare function decodeScheduleChangeCompat(data: unknown): ScheduleChange;
export declare const __decodeScheduleChangeCompatForTest: typeof decodeScheduleChangeCompat;
import type { AfterScheduleRecord, AtScheduleRecord, EveryScheduleRecord } from '@deepseek-ai/dsh-schedule';
type ScheduleChange = {
    readonly operation: 'create';
    readonly schedule: unknown;
} | {
    readonly operation: 'delete';
    readonly id: string;
} | {
    readonly operation: 'dispatch';
    readonly id: string;
    readonly acceptedAt?: string;
};
import type { PausedEntry, ScheduledAttachment } from './ownership-store.js';
import type { UserScheduleProjectionValue } from './domain.js';
type ImageRefLike = Extract<ScheduledAttachment, {
    type: 'image';
}>['attachment'];
type ImageHostPathResolver = (ref: ImageRefLike) => string | undefined;
export declare function setImageHostPathResolver(resolver: ImageHostPathResolver | undefined): void;
export declare const userSchedulesSchema: z.ZodObject<{
    schedules: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodUnion<readonly [z.ZodLiteral<"after">, z.ZodLiteral<"at">, z.ZodLiteral<"every">]>;
        prompt: z.ZodString;
        after_seconds: z.ZodOptional<z.ZodNumber>;
        every_seconds: z.ZodOptional<z.ZodNumber>;
        scheduled_at: z.ZodString;
        created_at: z.ZodOptional<z.ZodString>;
        delivery_mode: z.ZodLiteral<"session-local">;
        status: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"active">, z.ZodLiteral<"paused">]>>;
        remaining_seconds: z.ZodOptional<z.ZodNumber>;
        paused_at: z.ZodOptional<z.ZodString>;
        schedule_id: z.ZodOptional<z.ZodString>;
        window_seconds: z.ZodOptional<z.ZodNumber>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            kind: z.ZodUnion<readonly [z.ZodLiteral<"image">, z.ZodLiteral<"file">]>;
            attachment_id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            bytes: z.ZodOptional<z.ZodNumber>;
            media_type: z.ZodOptional<z.ZodString>;
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
            host_path: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
        attachments_total: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const userSchedulesStateSchema: z.ZodObject<{
    sessionId: z.ZodString;
    owned: z.ZodArray<z.ZodString>;
    active: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodUnion<readonly [z.ZodLiteral<"after">, z.ZodLiteral<"at">, z.ZodLiteral<"every">]>;
        prompt: z.ZodString;
        afterSeconds: z.ZodOptional<z.ZodNumber>;
        everySeconds: z.ZodOptional<z.ZodNumber>;
        scheduledAt: z.ZodString;
        createdAt: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>>;
    seedSeq: z.ZodNumber;
    paused: z.ZodDefault<z.ZodArray<z.ZodObject<{
        uid: z.ZodString;
        prompt: z.ZodString;
        delivery: z.ZodUnion<readonly [z.ZodLiteral<"context">, z.ZodLiteral<"user">]>;
        kind: z.ZodLiteral<"after">;
        remainingSeconds: z.ZodNumber;
        originalScheduledAt: z.ZodString;
        originalAfterSeconds: z.ZodOptional<z.ZodNumber>;
        lastScheduleId: z.ZodString;
        pausedAt: z.ZodNumber;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type StoredScheduleRecord = (AfterScheduleRecord & {
    readonly createdAt?: number;
}) | (AtScheduleRecord & {
    readonly createdAt?: number;
}) | (EveryScheduleRecord & {
    readonly createdAt?: number;
});
export interface UserScheduleProjectionState {
    readonly sessionId: string;
    readonly owned: readonly string[];
    readonly active: readonly StoredScheduleRecord[];
    readonly seedSeq: number;
    readonly paused: readonly PausedEntry[];
}
export declare function initUserScheduleProjection(header?: {
    readonly id?: string;
}, inheritedEventCount?: number): UserScheduleProjectionState;
export declare function applyUserScheduleProjection(state: UserScheduleProjectionState, event: SessionEvent): UserScheduleProjectionState;
export declare function viewUserScheduleProjection(state: UserScheduleProjectionState): UserScheduleProjectionValue;
export declare const userSchedulesProjectionUnit: {
    readonly key: "userSchedules";
    readonly stateSchema: z.ZodObject<{
        sessionId: z.ZodString;
        owned: z.ZodArray<z.ZodString>;
        active: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodUnion<readonly [z.ZodLiteral<"after">, z.ZodLiteral<"at">, z.ZodLiteral<"every">]>;
            prompt: z.ZodString;
            afterSeconds: z.ZodOptional<z.ZodNumber>;
            everySeconds: z.ZodOptional<z.ZodNumber>;
            scheduledAt: z.ZodString;
            createdAt: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>>;
        seedSeq: z.ZodNumber;
        paused: z.ZodDefault<z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            prompt: z.ZodString;
            delivery: z.ZodUnion<readonly [z.ZodLiteral<"context">, z.ZodLiteral<"user">]>;
            kind: z.ZodLiteral<"after">;
            remainingSeconds: z.ZodNumber;
            originalScheduledAt: z.ZodString;
            originalAfterSeconds: z.ZodOptional<z.ZodNumber>;
            lastScheduleId: z.ZodString;
            pausedAt: z.ZodNumber;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
    readonly init: typeof initUserScheduleProjection;
    readonly apply: typeof applyUserScheduleProjection;
    readonly wire: {
        readonly viewSchema: z.ZodObject<{
            schedules: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodUnion<readonly [z.ZodLiteral<"after">, z.ZodLiteral<"at">, z.ZodLiteral<"every">]>;
                prompt: z.ZodString;
                after_seconds: z.ZodOptional<z.ZodNumber>;
                every_seconds: z.ZodOptional<z.ZodNumber>;
                scheduled_at: z.ZodString;
                created_at: z.ZodOptional<z.ZodString>;
                delivery_mode: z.ZodLiteral<"session-local">;
                status: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"active">, z.ZodLiteral<"paused">]>>;
                remaining_seconds: z.ZodOptional<z.ZodNumber>;
                paused_at: z.ZodOptional<z.ZodString>;
                schedule_id: z.ZodOptional<z.ZodString>;
                window_seconds: z.ZodOptional<z.ZodNumber>;
                attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    kind: z.ZodUnion<readonly [z.ZodLiteral<"image">, z.ZodLiteral<"file">]>;
                    attachment_id: z.ZodString;
                    name: z.ZodOptional<z.ZodString>;
                    bytes: z.ZodOptional<z.ZodNumber>;
                    media_type: z.ZodOptional<z.ZodString>;
                    width: z.ZodOptional<z.ZodNumber>;
                    height: z.ZodOptional<z.ZodNumber>;
                    host_path: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>>;
                attachments_total: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly view: typeof viewUserScheduleProjection;
    };
    readonly stateVersion: 5;
};
export {};
