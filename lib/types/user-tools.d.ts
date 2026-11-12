import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule';
export type ScheduleState = 'scheduled' | 'overdue';
export type ScheduleDeliveryMode = 'host';
export type ScheduleView = ScheduleRecord & {
    readonly state: ScheduleState;
    readonly deliveryMode: ScheduleDeliveryMode;
};
export type ScheduleChange = {
    readonly operation: 'create';
    readonly schedule: ScheduleRecord;
} | {
    readonly operation: 'delete';
    readonly id: string;
} | {
    readonly operation: 'dispatch';
    readonly id: string;
    readonly acceptedAt?: string;
};
export declare function foldScheduleEventsLikeUpstream(events: readonly SessionEvent[], inheritedEventCount?: number): {
    readonly active: readonly ScheduleRecord[];
    readonly seenIds: readonly string[];
};
import type { UserScheduleDelivery } from './domain.js';
import type { ScheduledAttachment } from './ownership-store.js';
export declare const DEFAULT_MAX_SCHEDULES = 100;
export declare const DEFAULT_MAX_PROMPT_CHARS = 1000;
export interface PromptLimits {
    readonly allowLong: boolean;
    readonly maxChars: number;
}
export declare function resolvePromptLimits(settings: {
    readonly allowLongPrompts?: boolean;
    readonly maxPromptChars?: number;
} | undefined): PromptLimits;
export declare function validatePrompt(raw: unknown, limits: PromptLimits): {
    ok: true;
    value: string;
} | UserScheduleError;
export type UserScheduleErrorCode = 'invalid_prompt' | 'invalid_selector' | 'invalid_time_zone' | 'not_future' | 'time_out_of_range' | 'frequency_too_high' | 'invalid_rule' | 'subagent_session' | 'schedule_not_found' | 'already_overdue' | 'quota_exceeded' | 'persistence_uncertain' | 'unsupported_kind' | 'not_paused' | 'internal_error';
export interface UserScheduleError {
    readonly ok: false;
    readonly code: UserScheduleErrorCode;
    readonly message: string;
}
export type UserScheduleResult<TSuccess> = TSuccess | UserScheduleError;
export type UserScheduleCreateResult = UserScheduleResult<ScheduleRecordView & {
    readonly ok: true;
}>;
export type UserScheduleListResult = UserScheduleResult<{
    readonly ok: true;
    readonly schedules: readonly ScheduleRecordView[];
}>;
export type UserScheduleDeleteResult = UserScheduleResult<{
    readonly ok: true;
    readonly id: string;
    readonly deleted: true;
} | {
    readonly ok: true;
    readonly id: string;
    readonly deleted: false;
    readonly code: 'schedule_not_found';
}>;
export type UserSchedulePauseResult = UserScheduleResult<{
    readonly ok: true;
    readonly uid: string;
    readonly schedule_id: string;
    readonly remaining_seconds: number;
    readonly scheduled_at: string;
}>;
export type UserScheduleResumeResult = UserScheduleResult<{
    readonly ok: true;
    readonly uid: string;
    readonly schedule_id: string;
    readonly remaining_seconds: number;
}>;
export interface UserScheduleCreateInput {
    readonly prompt: string;
    readonly time_zone: string;
    readonly after_seconds?: number;
    readonly at?: string | {
        readonly date: string;
        readonly time: string;
        readonly time_zone: string;
    };
    readonly every_seconds?: number;
}
export declare function validateCreateInput(input: unknown, limits?: PromptLimits): {
    ok: true;
    value: UserScheduleCreateInput;
} | UserScheduleError;
export declare function isValidIanaZone(value: string): boolean;
export declare function foldOwnedIds(events: readonly SessionEvent[]): Set<string>;
export declare function foldOwnedDelivery(events: readonly SessionEvent[]): ReadonlyMap<string, UserScheduleDelivery>;
export interface UserFoldState {
    readonly folded: FoldedUserSchedules;
    readonly owned: ReadonlySet<string>;
    readonly delivery: ReadonlyMap<string, UserScheduleDelivery>;
}
export interface FoldedUserSchedules {
    readonly active: readonly ScheduleRecord[];
    readonly seenIds: ReadonlySet<string>;
}
export declare function foldUserState(session: Session): UserFoldState;
export declare function internalError(): UserScheduleError;
export declare function persistenceError(): UserScheduleError;
export declare function toInputError(error: unknown): UserScheduleError;
export type ScheduleRecordView = {
    readonly id: string;
    readonly kind: ScheduleRecord['kind'];
    readonly prompt: string;
    readonly after_seconds?: number;
    readonly every_seconds?: number;
    readonly scheduled_at: string;
    readonly state: 'scheduled' | 'overdue';
    readonly delivery_mode: 'session-local';
    readonly source: 'user-tool';
};
export declare function serializeScheduleView(view: ScheduleView): ScheduleRecordView;
export declare function runUserScheduleTransaction<T>(agent: Agent, operation: () => Promise<T>): Promise<T>;
export interface UserScheduleCreateOptions {
    readonly trustedDelivery?: UserScheduleDelivery;
    readonly attachments?: readonly ScheduledAttachment[];
}
export declare function userScheduleCreate(input: unknown, agent: Agent, ctx: Context, maxSchedules?: number, options?: UserScheduleCreateOptions, limits?: PromptLimits): Promise<UserScheduleCreateResult>;
export declare function userScheduleList(agent: Agent): Promise<UserScheduleListResult>;
export declare function userScheduleDelete(id: unknown, agent: Agent, ctx: Context): Promise<UserScheduleDeleteResult>;
export declare function userScheduleEditPrompt(id: unknown, newPrompt: unknown, agent: Agent, ctx: Context, limits?: PromptLimits): Promise<UserScheduleCreateResult | UserScheduleError>;
export declare function userSchedulePause(id: unknown, agent: Agent, ctx: Context): Promise<UserSchedulePauseResult>;
export declare function userScheduleResume(uid: unknown, agent: Agent, ctx: Context, maxSchedules?: number): Promise<UserScheduleResumeResult>;
