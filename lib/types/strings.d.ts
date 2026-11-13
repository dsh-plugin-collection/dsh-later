import { hostDictFor } from './locales/index.js';
export { hostDicts, hostDictFor, hostFormat } from './locales/index.js';
export type HostLocaleId = 'zh' | 'en';
export type HostStrings = ReturnType<typeof hostDictFor>;
