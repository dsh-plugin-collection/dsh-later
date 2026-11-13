export const LOCALE_IDS = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'];
export function isLocaleId(id) {
    return id !== undefined && LOCALE_IDS.includes(id);
}
