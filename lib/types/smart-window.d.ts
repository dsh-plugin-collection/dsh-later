export interface SmartWindowConfig {
    readonly workStart: string;
    readonly workEnd: string;
    readonly lunchStart: string;
    readonly lunchEnd: string;
    readonly eveningEnd: string;
}
export declare const DEFAULT_SMART_WINDOW: SmartWindowConfig;
export declare function isValidHhmm(value: unknown): value is string;
export declare function pickSmartWindowFields(raw: Partial<Record<keyof SmartWindowConfig, unknown>> | undefined | null): SmartWindowConfig;
export declare function sanitizeSmartWindowConfig(raw: Partial<Record<keyof SmartWindowConfig, unknown>> | undefined | null): SmartWindowConfig;
export declare const SMART_MIN_DELAY_MS: number;
export declare const MINUTE_MS: number;
export declare const HOUR_MS: number;
export declare const DAY_MS: number;
export type DayMinutes = number;
export interface LocalFields {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
}
export declare function hhmmToMinutes(value: string): DayMinutes | undefined;
export declare function minutesToHhmm(minutes: DayMinutes): string;
export declare const SMART_WINDOW_ORDER: ReadonlyArray<readonly [keyof SmartWindowConfig, keyof SmartWindowConfig]>;
export declare function firstOrderViolation(window: SmartWindowConfig): readonly [keyof SmartWindowConfig, keyof SmartWindowConfig] | null;
export declare function isValidWindow(window: SmartWindowConfig): boolean;
export declare function floorToMinute(epoch: number): number;
export declare function localFieldsOf(epoch: number, timeZone: string): LocalFields;
export declare function resolveWallClock(epochOnDay: number, timeZone: string, hour: number, minute: number, second?: number): number | undefined;
export declare function nextSmartTarget(now: number, timeZone: string, window?: SmartWindowConfig): number;
export declare function epochFromLocal(date: string, time: string, timeZone: string): number | undefined;
export declare function nextSmartAt(now: number, timeZone: string, window?: SmartWindowConfig): {
    date: string;
    time: string;
    time_zone: string;
    epoch: number;
} | null;
