export interface DueComparable {
    readonly scheduledAt?: unknown;
}
export declare function dueTargetOf(value: unknown): number | undefined;
export declare function isDue(record: DueComparable | undefined, now: number): boolean;
export interface DueIndexEntry {
    readonly scheduledAt?: unknown;
    readonly dispatchedAt?: unknown;
}
export type DueIndexReading = {
    readonly kind: 'due';
    readonly target: number;
} | {
    readonly kind: 'consumed';
} | {
    readonly kind: 'unknown';
};
export declare function readDueIndex(entry: DueIndexEntry | undefined): DueIndexReading;
export declare function isDueIndex(entry: DueIndexEntry | undefined, now: number): boolean;
