/**
 * 时间写法的**多语言词表**（解析器用，不是界面文案）。
 *
 * ## 为什么单独一个模块
 *
 * 解析器原来把中文词表硬编码在 `commands.ts` 的正则里（`明天|后天|半小时` 等约 30 个词）。
 * 界面补齐 8 门之后，出现一个荒谬的不对称：非中文用户的界面上写着「中文形式也接受」，
 * 而**他们自己语言的自然写法反而不认**——德语用户写 `morgen 9 Uhr` 得到的是解析失败。
 *
 * 这类词表必须能被逐语言审阅、扩展、测试，塞在 `commands.ts` 的大函数里既看不见也改不动。
 * 因此抽到这里，每个语言一个纯数据对象。
 *
 * ## 边界：解析用 vs 界面用
 *
 * 本文件的词**不是**界面文案，不进 `src/locales/`：
 *  - 界面文案要翻译给人看，8 门必须齐全，缺失就是 bug；
 *  - 词表是**额外接受的输入**，某语言缺条目只意味着「那个写法不支持」，
 *    用户仍可用语言无关的 `+30m` / `1532` / `15:32`。
 *
 * 所以这里刻意**不求 8 门齐全**：只收各语言真正高频、无歧义的写法。
 * 宁可少收，也不收一个会导致误解析的词。
 * @module dsh-later/time-words
 */
import type { LocaleId } from './locales/locale-id.js';

/** 一个语言的时间词表。 */
export interface TimeWords {
  /**
   * 「今天 / 明天 / 后天」这类**日词 → 相对今天的天数偏移**。
   *
   * 长的必须排在前面（匹配按顺序 `startsWith`）：德语 `übermorgen`（后天）若排在
   * `morgen`（明天）之后，前者永远匹配不到。
   */
  readonly day: ReadonlyArray<readonly [string, number]>;
  /** 「天 / 小时 / 分钟 / 秒」这类**单位词 → 秒数**。 */
  readonly unit: Readonly<Record<string, number>>;
  /**
   * 相对时长的**写法规则**：从 `"30 minutes ago"-ish 的文本` 里抽出数值与单位。
   *
   * 给正则而不是给词表，是因为各语言的语序差异太大：
   *  - 中文 `30分钟后`：数值在前、单位在后、`后` 收尾；
   *  - 英文 `in 30 minutes`：`in` 在前、单位在后、无收尾词；
   *  - 德语 `in 30 Minuten` / `vor 30 Minuten`（过去）不同前缀。
   *
   * 正则约定：第 1 组是**数值**（可能是小数），第 2 组是**单位词**（要在 `unit` 里查得到）。
   * 匹配到的 `[0]` 长度即视为已消费。
   */
  readonly relative: ReadonlyArray<RegExp>;
  /**
   * 时刻的**整点/半点写法**，用于 `9点半` / `9:30` 之外的表达。
   *
   * 第 1 组小时、第 2 组分钟（可缺省 = 整点）。同样按语序各语言自定。
   */
  readonly clock: ReadonlyArray<RegExp>;
}

/** 数字：统一用 `\d+(?:\.\d+)?`，不引入各语言的数词（`halbe` / `une` 歧义太多）。 */
const NUM = String.raw`\d+(?:[.,]\d+)?`;

/** 把 `30,5` 这类小数逗号写法归一（德语/俄语/法语都用逗号作小数点）。 */
export function normalizeNumber(raw: string): number | undefined {
  const normalized = raw.replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/** 西里尔/拉丁词边界：避免 `morgen` 吃掉 `morgenfrüh` 之后又去匹配。 */
const zh: TimeWords = {
  day: [['大后天', 3], ['后天', 2], ['明天', 1], ['明日', 1], ['今天', 0], ['今日', 0]],
  unit: { 秒: 1, 秒钟: 1, 分: 60, 分钟: 60, 小时: 3600, 个小时: 3600, 钟头: 3600, 天: 86400, 日: 86400, 周: 604800 },
  // 中文不在这里处理：它的数词（半/两/一）与「×3」次数后缀跟其他语言完全不同，
  // 仍由 commands.ts 的 `cnRel` 那条正则负责，避免两条规则抢同一段输入。
  relative: [],
  clock: [],
};

/**
 * 英文。
 *
 * `in 30 minutes` / `in 2 hours`；单位支持 `min`/`mins`/`minute`/`minutes` 等常见缩写。
 * 不接受 `half an hour`：这类表达歧义大，且与中文的「半小时」不对称，宁可少收。
 */
const en: TimeWords = {
  day: [['day after tomorrow', 2], ['tomorrow', 1], ['today', 0]],
  unit: {
    sec: 1, secs: 1, second: 1, seconds: 1,
    min: 60, mins: 60, minute: 60, minutes: 60,
    h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
    d: 86400, day: 86400, days: 86400,
    wk: 604800, week: 604800, weeks: 604800,
  },
  relative: [new RegExp(String.raw`^in\s+(${NUM})\s*([a-z]+)`, 'i')],
  // `9am` / `9 am` / `9:30 pm`。am/pm 用**非捕获组**：捕获组位置必须跨语言一致
  // （第 1 组小时、第 2 组分钟），标记由 matchWordClock 从整串里找。
  clock: [
    new RegExp(String.raw`^(\d{1,2}):(\d{2})\s*(?:am|pm)`, 'i'), // 9:30pm
    new RegExp(String.raw`^(\d{1,2})\s*(?:am|pm)`, 'i'),         // 9am
  ],
};

/** 德语。`in 30 Minuten`；`morgen` / `übermorgen`。 */
const de: TimeWords = {
  day: [['übermorgen', 2], ['uebermorgen', 2], ['morgen', 1], ['heute', 0]],
  unit: {
    sek: 1, sekunde: 1, sekunden: 1,
    min: 60, minute: 60, minuten: 60,
    std: 3600, stunde: 3600, stunden: 3600,
    tag: 86400, tage: 86400, tagen: 86400,
    woche: 604800, wochen: 604800,
  },
  relative: [new RegExp(String.raw`^in\s+(${NUM})\s*([a-zäöü]+)`, 'i')],
  // `9 Uhr` / `9:30 Uhr` / `9 Uhr 30`。最后那种把分钟放**第 2 组**（与 en 一致）：
  // `9 Uhr 30` 里 `\s*uhr\s*` 之后才是分钟，用分支保证两种写法都落在第 2 组。
  // 拆成多条简单正则而不是一条带分支的：分支会让捕获组位置随写法漂移，
  // 而 `matchWordClock` 的契约是「第 1 组小时、第 2 组分钟」。长的写法必须排在前面。
  clock: [
    new RegExp(String.raw`^(\d{1,2})\s*uhr\s*(\d{1,2})(?!\d)`, 'i'), // 9 Uhr 30
    new RegExp(String.raw`^(\d{1,2}):(\d{2})\s*uhr`, 'i'),            // 9:30 Uhr
    new RegExp(String.raw`^(\d{1,2})\s*uhr(?!\s*\d)`, 'i'),          // 9 Uhr
  ],
};

/** 西语。`en 30 minutos`；`mañana` / `pasado mañana`。 */
const es: TimeWords = {
  day: [['pasado mañana', 2], ['pasado manana', 2], ['mañana', 1], ['manana', 1], ['hoy', 0]],
  unit: {
    seg: 1, segundo: 1, segundos: 1,
    min: 60, minuto: 60, minutos: 60,
    h: 3600, hora: 3600, horas: 3600,
    dia: 86400, dias: 86400, día: 86400, días: 86400,
    semana: 604800, semanas: 604800,
  },
  relative: [new RegExp(String.raw`^en\s+(${NUM})\s*([a-záéíóúñ]+)`, 'i')],
  clock: [],
};

/** 法语。`dans 30 minutes`；`demain` / `après-demain`。 */
const fr: TimeWords = {
  day: [['après-demain', 2], ['apres-demain', 2], ['demain', 1], ["aujourd'hui", 0], ['aujourdhui', 0]],
  unit: {
    sec: 1, seconde: 1, secondes: 1,
    min: 60, minute: 60, minutes: 60,
    h: 3600, heure: 3600, heures: 3600,
    jour: 86400, jours: 86400,
    semaine: 604800, semaines: 604800,
  },
  relative: [new RegExp(String.raw`^dans\s+(${NUM})\s*([a-zéèêàû]+)`, 'i')],
  clock: [],
};

/** 俄语。`через 30 минут`；`завтра` / `послезавтра`。注意复数变化（минуту/минуты/минут）。 */
const ru: TimeWords = {
  day: [['послезавтра', 2], ['после завтра', 2], ['завтра', 1], ['сегодня', 0]],
  unit: {
    сек: 1, секунда: 1, секунды: 1, секунд: 1,
    мин: 60, минута: 60, минуты: 60, минут: 60,
    ч: 3600, час: 3600, часа: 3600, часов: 3600,
    день: 86400, дня: 86400, дней: 86400, сутки: 86400,
    неделя: 604800, недели: 604800, недель: 604800,
  },
  relative: [new RegExp(String.raw`^через\s+(${NUM})\s*([а-яё]+)`, 'i')],
  clock: [],
};

/** 葡语。`em 30 minutos`；`amanhã` / `depois de amanhã`。 */
const pt: TimeWords = {
  day: [['depois de amanhã', 2], ['depois de amanha', 2], ['amanhã', 1], ['amanha', 1], ['hoje', 0]],
  unit: {
    seg: 1, segundo: 1, segundos: 1,
    min: 60, minuto: 60, minutos: 60,
    h: 3600, hora: 3600, horas: 3600,
    dia: 86400, dias: 86400,
    semana: 604800, semanas: 604800,
  },
  relative: [new RegExp(String.raw`^em\s+(${NUM})\s*([a-zãáâéêíóôõúç]+)`, 'i')],
  clock: [],
};

/** `ja` 暂不提供：日语的时刻写法（`9時`／`9:00`）与中文高度重叠，
 *  直接复用中文词表反而更准确，见 `wordsFor`。 */
const TABLES: Partial<Record<LocaleId, TimeWords>> = { zh, en, de, es, fr, ru, pt };

/**
 * 取某语言的词表。
 *
 * `ja` 映射到中文表：两者都用汉字，`9時` / `9:30` 这类写法的处理一致，
 * 分开维护只会让两边的改动漂移。未收录的 locale 一律回中文——与 `hostDictFor` 的回退同规则。
 *
 * @param locale - locale id（`undefined` 表示宿主拿不到 locale 服务）。
 */
export function wordsFor(locale: string | undefined): TimeWords {
  if (locale === 'ja') return zh;
  return TABLES[locale as LocaleId] ?? zh;
}
