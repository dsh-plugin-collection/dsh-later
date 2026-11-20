export declare function detectTimeZone(): string;
export type TextLocale = 'zh' | 'en' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt';
export interface RelativePhrases {
    readonly relOverdue: string;
    readonly relSoon: string;
    readonly relMinutes: string;
    readonly relHours: string;
    readonly relHoursMinutes: string;
    readonly relDays: string;
}
export declare function formatRelative(epoch: number, now?: number, phrases?: RelativePhrases): string;
export declare function formatAbsolute(epoch: number, timeZone: string, locale?: TextLocale): string;
export declare function formatHhmm(epoch: number, timeZone: string): string;
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
