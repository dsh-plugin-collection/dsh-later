export declare const LATER_SOURCE_VERSION = 1;
export type LaterDeliveryKind = 'one-shot' | 'every';
export interface LaterUserMessageMarker {
    readonly v: number;
    readonly delivery: LaterDeliveryKind;
    readonly count: number;
}
export interface LaterUserSource {
    readonly kind: 'user';
    readonly later: LaterUserMessageMarker;
}
export declare function laterUserSource(input: {
    readonly delivery: LaterDeliveryKind;
    readonly count: number;
}): LaterUserSource;
export declare function readLaterMarker(source: unknown): LaterUserMessageMarker | undefined;
