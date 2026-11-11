export declare const name = "dsh-later";
export declare const SETTINGS_NAMESPACE = "dsh-later";
export declare const PROJECTION_KEY = "userSchedules";
export declare const OWNED_EVENT = "session-scheduler/user-schedule";
export interface UserScheduleOwnedChange {
    readonly version: 1;
    readonly operation: 'add' | 'remove';
    readonly id: string;
    readonly delivery?: 'context' | 'user';
}
export type UserScheduleDelivery = 'context' | 'user';
export interface WireAttachment {
    readonly kind: 'image' | 'file';
    readonly attachment_id: string;
    readonly name?: string;
    readonly bytes?: number;
    readonly media_type?: string;
    readonly width?: number;
    readonly height?: number;
    readonly host_path?: string;
}
export interface UserScheduleWireItem {
    readonly id: string;
    readonly kind: 'after' | 'at' | 'every';
    readonly prompt: string;
    readonly after_seconds?: number;
    readonly every_seconds?: number;
    readonly scheduled_at: string;
    readonly created_at?: string;
    readonly delivery_mode: 'session-local';
    readonly status?: 'active' | 'paused';
    readonly remaining_seconds?: number;
    readonly paused_at?: string;
    readonly schedule_id?: string;
    readonly window_seconds?: number;
    readonly attachments?: readonly WireAttachment[];
    readonly attachments_total?: number;
}
export interface UserScheduleProjectionValue {
    readonly schedules: readonly UserScheduleWireItem[];
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        'session-scheduler/user-schedule': UserScheduleOwnedChange;
    }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        userSchedules: UserScheduleProjectionValue;
    }
}
export interface UserScheduleProjectionState {
    readonly sessionId: string;
    readonly owned: readonly string[];
    readonly active: readonly {
        id: string;
        kind: 'after' | 'at' | 'every';
        prompt: string;
        afterSeconds?: number;
        everySeconds?: number;
        scheduledAt: string;
        createdAt?: number;
    }[];
    readonly seedSeq: number;
    readonly paused: readonly {
        uid: string;
        prompt: string;
        delivery: UserScheduleDelivery;
        kind: 'after';
        remainingSeconds: number;
        originalScheduledAt: string;
        originalAfterSeconds?: number;
        lastScheduleId: string;
        pausedAt: number;
    }[];
}
