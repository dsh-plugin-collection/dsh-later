const NUM = String.raw `\d+(?:[.,]\d+)?`;
export function normalizeNumber(raw) {
    const normalized = raw.replace(',', '.');
    const value = Number(normalized);
    return Number.isFinite(value) ? value : undefined;
}
const zh = {
    day: [['大后天', 3], ['后天', 2], ['明天', 1], ['明日', 1], ['今天', 0], ['今日', 0]],
    unit: { 秒: 1, 秒钟: 1, 分: 60, 分钟: 60, 小时: 3600, 个小时: 3600, 钟头: 3600, 天: 86400, 日: 86400, 周: 604800 },
    relative: [],
    clock: [],
};
const en = {
    day: [['day after tomorrow', 2], ['tomorrow', 1], ['today', 0]],
    unit: {
        sec: 1, secs: 1, second: 1, seconds: 1,
        min: 60, mins: 60, minute: 60, minutes: 60,
        h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
        d: 86400, day: 86400, days: 86400,
        wk: 604800, week: 604800, weeks: 604800,
    },
    relative: [new RegExp(String.raw `^in\s+(${NUM})\s*([a-z]+)`, 'i')],
    clock: [
        new RegExp(String.raw `^(\d{1,2}):(\d{2})\s*(?:am|pm)`, 'i'),
        new RegExp(String.raw `^(\d{1,2})\s*(?:am|pm)`, 'i'),
    ],
};
const de = {
    day: [['übermorgen', 2], ['uebermorgen', 2], ['morgen', 1], ['heute', 0]],
    unit: {
        sek: 1, sekunde: 1, sekunden: 1,
        min: 60, minute: 60, minuten: 60,
        std: 3600, stunde: 3600, stunden: 3600,
        tag: 86400, tage: 86400, tagen: 86400,
        woche: 604800, wochen: 604800,
    },
    relative: [new RegExp(String.raw `^in\s+(${NUM})\s*([a-zäöü]+)`, 'i')],
    clock: [
        new RegExp(String.raw `^(\d{1,2})\s*uhr\s*(\d{1,2})(?!\d)`, 'i'),
        new RegExp(String.raw `^(\d{1,2}):(\d{2})\s*uhr`, 'i'),
        new RegExp(String.raw `^(\d{1,2})\s*uhr(?!\s*\d)`, 'i'),
    ],
};
const es = {
    day: [['pasado mañana', 2], ['pasado manana', 2], ['mañana', 1], ['manana', 1], ['hoy', 0]],
    unit: {
        seg: 1, segundo: 1, segundos: 1,
        min: 60, minuto: 60, minutos: 60,
        h: 3600, hora: 3600, horas: 3600,
        dia: 86400, dias: 86400, día: 86400, días: 86400,
        semana: 604800, semanas: 604800,
    },
    relative: [new RegExp(String.raw `^en\s+(${NUM})\s*([a-záéíóúñ]+)`, 'i')],
    clock: [],
};
const fr = {
    day: [['après-demain', 2], ['apres-demain', 2], ['demain', 1], ["aujourd'hui", 0], ['aujourdhui', 0]],
    unit: {
        sec: 1, seconde: 1, secondes: 1,
        min: 60, minute: 60, minutes: 60,
        h: 3600, heure: 3600, heures: 3600,
        jour: 86400, jours: 86400,
        semaine: 604800, semaines: 604800,
    },
    relative: [new RegExp(String.raw `^dans\s+(${NUM})\s*([a-zéèêàû]+)`, 'i')],
    clock: [],
};
const ru = {
    day: [['послезавтра', 2], ['после завтра', 2], ['завтра', 1], ['сегодня', 0]],
    unit: {
        сек: 1, секунда: 1, секунды: 1, секунд: 1,
        мин: 60, минута: 60, минуты: 60, минут: 60,
        ч: 3600, час: 3600, часа: 3600, часов: 3600,
        день: 86400, дня: 86400, дней: 86400, сутки: 86400,
        неделя: 604800, недели: 604800, недель: 604800,
    },
    relative: [new RegExp(String.raw `^через\s+(${NUM})\s*([а-яё]+)`, 'i')],
    clock: [],
};
const pt = {
    day: [['depois de amanhã', 2], ['depois de amanha', 2], ['amanhã', 1], ['amanha', 1], ['hoje', 0]],
    unit: {
        seg: 1, segundo: 1, segundos: 1,
        min: 60, minuto: 60, minutos: 60,
        h: 3600, hora: 3600, horas: 3600,
        dia: 86400, dias: 86400,
        semana: 604800, semanas: 604800,
    },
    relative: [new RegExp(String.raw `^em\s+(${NUM})\s*([a-zãáâéêíóôõúç]+)`, 'i')],
    clock: [],
};
const TABLES = { zh, en, de, es, fr, ru, pt };
export function wordsFor(locale) {
    if (locale === 'ja')
        return zh;
    return TABLES[locale] ?? zh;
}
