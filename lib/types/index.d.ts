import type { Context } from '@deepseek-ai/cordis';
import type z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { name } from './domain.js';
export declare const Config: z;
export declare const inject: string[];
export interface SchedulerSettings {
    readonly maxSchedules: number;
    readonly allowLongPrompts: boolean;
    readonly maxPromptChars: number;
    readonly steerDelivery: UserScheduleSteerDelivery;
    readonly confirmDelivery: boolean;
    readonly onUnconfirmed: UserScheduleOnUnconfirmed;
    readonly clockIconStyle: 'auto' | 'modern' | 'classic';
    readonly advancedSyntax: boolean;
}
export type UserScheduleSteerDelivery = 'followup' | 'steer';
export type UserScheduleOnUnconfirmed = 'keep' | 'discard';
export declare function registerUserScheduleTools(rootCtx: Context, toolCtx: Context, agent: Agent, getSettings: () => SchedulerSettings, getLocale: () => string | undefined, onUserChange: (agent: Agent) => boolean): () => void;
interface UserWatch {
    readonly recent: Map<string, number>;
    readonly suppressed: Map<string, Set<string>>;
}
export declare function canWakeColdSession(ctx: Context, sessionId: string, watch?: UserWatch): boolean;
export declare function coldWakeRefusal(ctx: Context, sessionId: string): 'subagent' | 'not-root' | undefined;
export declare function apply(ctx: Context, config?: {
    maxSchedules?: number;
}): void;
export { name };
