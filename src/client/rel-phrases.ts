/**
 * 把客户端 UI 字典适配成 `formatRelative` 需要的措辞面。
 *
 * 为什么需要这一层：`formatRelative` 住在 `src/time-utils.ts`，那个模块**同时进 host 产物
 * 和 client bundle**，所以它不能 import 任何一本 8 语言字典（会把 8 门宿主字典
 * 一并拖进客户端，约 118KB）。它改为接收调用方传进来的措辞；宿主侧直接传
 * `hostDictFor(locale)`（键名 `relOverdue` / `relMinutes` …），客户端侧字典用的是
 * `relPhrase*` 前缀（避免与同文件里既有的 `relMinutes`/`relHours` 芯片文案撞名），
 * 于是由这里做键名映射。
 * @module dsh-later/client/rel-phrases
 */
import type { RelativePhrases } from '../time-utils.js';
import type { SchedStrings } from './locales/ui.js';

/**
 * @param t - 当前语言的客户端 UI 字典。
 * @returns `formatRelative` 可用的相对时间措辞。
 */
export function relPhrases(t: SchedStrings): RelativePhrases {
  return {
    relOverdue: t.relPhraseOverdue,
    relSoon: t.relPhraseSoon,
    relMinutes: t.relPhraseMinutes,
    relHours: t.relPhraseHours,
    relHoursMinutes: t.relPhraseHoursMinutes,
    relDays: t.relPhraseDays,
  };
}
