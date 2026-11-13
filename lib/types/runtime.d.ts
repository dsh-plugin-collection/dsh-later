import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ScheduleRecord, OneShotScheduleRecord, EveryScheduleRecord } from '@deepseek-ai/dsh-schedule';
import type { UserScheduleDelivery } from './domain.js';
import type { DeliveryMode } from './delivery.js';
export interface SteerDeliverySettings {
    readonly steerDelivery: DeliveryMode;
    readonly confirmDelivery: boolean;
    readonly onUnconfirmed: 'keep' | 'discard';
}
type UserDecision = {
    kind: 'one-shot';
    delivery: UserScheduleDelivery;
    records: readonly OneShotScheduleRecord[];
} | {
    kind: 'every';
    acceptedAt: string;
    reminders: readonly {
        record: EveryScheduleRecord;
        occurrenceAt: string;
    }[];
} | {
    kind: 'wait';
    target?: number;
};
export declare function dueUserDecision(active: readonly ScheduleRecord[], now: number, delivery?: ReadonlyMap<string, UserScheduleDelivery>): UserDecision;
export declare function renderOneShotBatchFraming(records: readonly OneShotScheduleRecord[]): string;
export declare class UserScheduleRuntime {
    private readonly ctx;
    private readonly agent;
    private readonly getSettings;
    private readonly stop;
    private resolveStop;
    private timer;
    private run;
    private requested;
    private stopping;
    private failures;
    private idleWait;
    private disposal;
    constructor(ctx: Context, agent: Agent, getSettings: () => SteerDeliverySettings);
    private dict;
    private isLive;
    requestDrive(): void;
    private clearTimer;
    private arm;
    private runRequested;
    private waitForIdle;
    dispose(): Promise<void>;
    steerById(id: string): Promise<{
        ok: true;
        id: string;
        steered: true;
    } | {
        ok: false;
        code: string;
        message: string;
    }>;
    private rearmOneShot;
    private deliver;
    private verifyDelivery;
    private noteUnconfirmed;
    private reconcileDueIndex;
    private driveOnce;
    private steerPausedById;
    private buildMessage;
    private attachmentsOf;
}
export {};
