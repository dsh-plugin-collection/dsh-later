/**
 * 宿主侧微文案字典 —— **再导出层**。
 *
 * 字典本体在 `src/locales/host.ts`（8 语言单一来源）。本文件只保留对外符号的形状，
 * 因为这两类调用方都按模块路径 import，且它们不属于本轮的改动范围：
 *  - `src/index.ts`（工具注册时的 `hostDictFor(getLocale())`）
 *  - `src/commands.ts`（slash 命令描述与回执）
 *  - `src/skill.ts`（`HostLocaleId`，SKILL 文件按语言选版本）
 *
 * ## 为什么 `HostLocaleId` 仍然是 `'zh' | 'en'`
 *
 * 它不是「字典收录了哪些语言」，而是「SKILL 文件有哪几种」。包里的 SKILL 正文只有
 * `SKILL.md`（中文）与 `SKILL.en.md`（英文）两份：让 `skillFilePaths()` 的键扩到 8 种，
 * 就得为日语、俄语等各写一份技能正文，那是**另一个任务**，不是把那两行改宽就能成立的。
 * 宿主 `resolveSkillLocale` 的回退链仍然是「非 en 一律回中文」，与既有行为逐字一致。
 *
 * @module dsh-later/strings
 */
// 经 `./locales/index.js` 取而不是直连 `./locales/host.js`：聚合入口是这台机器上
// 「8 语言字典从哪儿来」的唯一门面，`check:lib-reach` 也要求它从宿主入口可达——
// 直连 host.js 会让 index.js 变成宿主永不加载的死产物（门禁会如实判红）。
import { hostDictFor } from './locales/index.js';

export { hostDicts, hostDictFor, hostFormat } from './locales/index.js';

/**
 * SKILL 文件支持的语言（只有中英两份正文，与字典的 8 门**不是**同一件事）。
 * @see 本文件头注释「为什么 HostLocaleId 仍然是 'zh' | 'en'」
 */
export type HostLocaleId = 'zh' | 'en';

/**
 * 单语言文案字典类型 —— 从真实字典推导，不再手写映射。
 *
 * 注意它**已宽化**为 `string`（`hostDictFor` 的返回类型就是这么来的）。要参与「漏键必须
 * 编译期报错」的检查，请用 `src/locales/host.ts` 里的就地映射类型，不要用这个别名。
 */
export type HostStrings = ReturnType<typeof hostDictFor>;
