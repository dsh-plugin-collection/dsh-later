export declare const LOCALE_IDS: readonly ["zh", "en", "ja", "es", "fr", "de", "ru", "pt"];
export type LocaleId = (typeof LOCALE_IDS)[number];
export declare function isLocaleId(id: string | undefined): id is LocaleId;
