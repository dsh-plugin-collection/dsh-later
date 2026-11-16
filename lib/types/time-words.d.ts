export interface TimeWords {
    readonly day: ReadonlyArray<readonly [string, number]>;
    readonly unit: Readonly<Record<string, number>>;
    readonly relative: ReadonlyArray<RegExp>;
    readonly clock: ReadonlyArray<RegExp>;
}
export declare function normalizeNumber(raw: string): number | undefined;
export declare function wordsFor(locale: string | undefined): TimeWords;
