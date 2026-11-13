/**
 * 语言 id 的唯一来源。
 *
 * 单独成文件是为了打断循环 import：`ui.ts` / `host.ts` / `settings.ts` 都要用语言 id，
 * 而每个语言文件又要 `import type` 回各自的 `zh` 去锁键集。id 放在第三处，三棵依赖树
 * 就都只从叶子指向自己那一门，不存在 A → B → A。
 *
 * 为什么这 8 个：DSH 的 `LOCALE_IDS` 只**强制** `zh` / `en` 两个基线，其余 6 种由
 * `addLanguage` 注册；官方第一方包 `dsh-client-ui-schedule` 注册了全 8 种，本插件对齐它。
 * 多一门没有意义（宿主不认的 id 永远走回退链），少一门就在这台宿主上白丢一种语言。
 * @module dsh-later/locales/locale-id
 */

/** 本插件支持的 8 种语言 id（与 DSH `LOCALE_IDS` 同集，顺序与官方一致）。 */
export const LOCALE_IDS = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const;

/** 语言 id 联合。 */
export type LocaleId = (typeof LOCALE_IDS)[number];

/**
 * 语言 id 是不是本插件收录的那 8 种之一。
 *
 * `locale.getSnapshot().active` 的类型是 `string`（宿主允许 `addLanguage` 注册任意 id），
 * 所以运行时必须自己收窄，不能拿 `as LocaleId` 糊过去。
 * @param id - 候选 id（可为 undefined：locale 服务缺席）。
 * @returns 是否收录。
 */
export function isLocaleId(id: string | undefined): id is LocaleId {
  return id !== undefined && (LOCALE_IDS as readonly string[]).includes(id);
}
