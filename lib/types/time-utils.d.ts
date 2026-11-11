export declare function detectTimeZone(): string;
export type TextLocale = 'zh' | 'en';
export declare function formatRelative(epoch: number, now?: number, locale?: TextLocale): string;
export declare const MINUTE_MS: number;
export declare const HOUR_MS: number;
export declare const DAY_MS: number;
export declare function formatAbsolute(epoch: number, timeZone: string, locale?: TextLocale): string;
export declare function formatHhmm(epoch: number, timeZone: string): string;
export declare function formatCountdown(epoch: number, now?: number): string;
export declare function remainingMs(epoch: number, now?: number): number;
export interface LocalClockParts {
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
    readonly millisecond: number;
}
export declare function parseLocalClock(raw: unknown): LocalClockParts | undefined;
export declare function canonicalLocalClock(raw: unknown): string | undefined;
export declare function parseLocalDate(raw: unknown): {
    year: number;
    month: number;
    day: number;
} | undefined;
export declare function canonicalLocalDate(raw: unknown): string | undefined;
export declare function canonicalInstantString(raw: unknown): string | undefined;
