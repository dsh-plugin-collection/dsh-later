import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { PromptLimits } from './user-tools.js';
export type UserChangeNotifier = (agent: Agent) => boolean;
export type UserSteerHandler = (agent: Agent, id: string) => Promise<{
    readonly ok: true;
    readonly id: string;
    readonly steered: true;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
}>;
export declare function coercePayload(rawInput: string): {
    ok: true;
    value: unknown;
} | {
    ok: false;
    text: string;
};
export type ParsedScheduleSpec = {
    ok: true;
    kind: 'after';
    afterSeconds: number;
} | {
    ok: true;
    kind: 'at';
    at: {
        date: string;
        time: string;
        time_zone: string;
    };
    epoch: number;
} | {
    ok: false;
    error: string;
};
export type ParsedScheduleInput = {
    ok: true;
    target: ResolvedTarget;
    targets: readonly ResolvedTarget[];
    content: string;
} | {
    ok: false;
    error: string;
};
export interface ScheduleSyntaxOptions {
    readonly advancedSyntax?: boolean;
}
export declare const ADVANCED_SYNTAX_DISABLED: string;
export declare const MAX_OCCURRENCES = 10;
export declare const MIN_OCCURRENCE_INTERVAL_SECONDS = 60;
type ResolvedTarget = {
    kind: 'after';
    afterSeconds: number;
} | {
    kind: 'at';
    at: {
        date: string;
        time: string;
        time_zone: string;
    };
    epoch: number;
};
export declare function parseScheduleInput(raw: string, now: number, timeZone: string, limits?: PromptLimits, options?: ScheduleSyntaxOptions): ParsedScheduleInput;
export declare function parseScheduleSpec(spec: string, now: number, timeZone: string): ParsedScheduleSpec;
export declare function userScheduleCommands(ctx: Context, getSettings?: number | (() => number) | (() => {
    maxSchedules: number;
    allowLongPrompts?: boolean;
    maxPromptChars?: number;
    advancedSyntax?: boolean;
}), onUserChange?: UserChangeNotifier, onUserSteer?: UserSteerHandler, getLocale?: () => string | undefined): CommandDefinition[];
export declare function registerUserScheduleCommands(ctx: Context, getSettings?: number | (() => number) | (() => {
    maxSchedules: number;
    allowLongPrompts?: boolean;
    maxPromptChars?: number;
    advancedSyntax?: boolean;
}), onUserChange?: UserChangeNotifier, onUserSteer?: UserSteerHandler, getLocale?: () => string | undefined): () => void;
export {};
