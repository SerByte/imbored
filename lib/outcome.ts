/*
 * ИСХОД СОВЕТА — СКОЛЬКО ЧЕЛОВЕК НА САМОМ ДЕЛЕ СЫГРАЛ ПОСЛЕ НЕГО.
 *
 * «Зашло» — слово, а запуск — ещё не игра: нажал «Запустить», посмотрел меню
 * и закрыл. Самый честный сигнал, который у продукта есть, лежит в следующем
 * снапшоте библиотеки: сколько минут прибавилось у игры после того, как её
 * посоветовали. Steam отдаёт их сам, человек ничего не заполняет.
 *
 * Путь такой. Запуск с /play или /daily (и переход в магазин за не купленной)
 * пишет строку в outcomes с минутами ДО — из последнего снапшота
 * (recordOutcome). Каждый новый снапшот в течение OUTCOME_WINDOW_SEC
 * дописывает минуты ПОСЛЕ и то, стоит ли игра в библиотеке — покупка
 * (fillOutcomesFromSnapshot). Если сыграно заметно, /play и /daily раз в сутки
 * спрашивают «как тебе?» (OutcomeAsk) — ответ ложится в verdict. Отчёт
 * (scripts/feedback-report.ts) сводит всё это по источникам и слотам.
 *
 * Модуль клиентский: здесь сроки, ответы и подписи, база — в lib/db.ts.
 */

/** Сколько после совета снапшоты ещё дописывают минуты: две недели */
export const OUTCOME_WINDOW_SEC = 14 * 86_400

/**
 * Сколько живёт строка исхода. Три месяца — как снимок выдачи в фидбеке
 * (FEEDBACK_CTX_TTL_SEC): это та же история поведения, и нужна она отчёту
 * о гипотезах, а не подбору. /privacy, раздел 06.
 */
export const OUTCOME_TTL_SEC = 90 * 86_400

/**
 * С какого прибавка минут — «сыграл», а не «открыл и закрыл». Четверть часа:
 * правило остановки на /play даёт игре от пятнадцати минут (STOP_MINUTES), и
 * всё, что короче, — проба, про которую уже спросил «Не зацепило?».
 */
export const OUTCOME_PLAYED_MIN = 15

/**
 * Ответы на «как тебе?». dismissed — «Закрыть»: тоже ответ, и больше про эту
 * игру не спрашиваем.
 */
export const OUTCOME_VERDICTS = ['hooked', 'meh', 'dismissed'] as const

export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number]

export function isOutcomeVerdict(x: unknown): x is OutcomeVerdict {
  return (OUTCOME_VERDICTS as readonly unknown[]).includes(x)
}

/** Что спросить: игра, когда её посоветовали и сколько в ней сыграно с тех пор */
export type OutcomeAsk = {
  appid: number
  name: string
  /** Ключ строки исхода вместе с appid — вернуть его с ответом */
  shownAt: number
  /** Сыграно после совета, минут */
  minutes: number
  /** Игры до совета не было, а теперь она в библиотеке */
  bought: boolean
}

/** Ответ GET /api/outcome на клиенте: проверка формы, а не приведение типом */
export function parseOutcomeAsk(raw: unknown): OutcomeAsk | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.appid !== 'number' || !Number.isInteger(r.appid) || r.appid === 0) return null
  if (typeof r.name !== 'string' || !r.name.trim()) return null
  if (typeof r.shownAt !== 'number' || !Number.isInteger(r.shownAt)) return null
  if (typeof r.minutes !== 'number' || !Number.isFinite(r.minutes) || r.minutes < 0) return null
  return {
    appid: r.appid,
    name: r.name,
    shownAt: r.shownAt,
    minutes: Math.round(r.minutes),
    bought: r.bought === true,
  }
}

/**
 * Сыгранное — коротко: «40 мин», «2 ч», «3 ч 20 мин». Сокращения не
 * склоняются, и строке рядом с названием игры не нужно «часа» и «минут».
 */
export function playedLine(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (!h) return `${rest} мин`
  return rest ? `${h} ч ${rest} мин` : `${h} ч`
}

/** Вопрос целиком — одна строка на /play и /daily */
export function outcomeQuestion(ask: Pick<OutcomeAsk, 'name' | 'minutes' | 'bought'>): string {
  const played = playedLine(ask.minutes)
  return ask.bought
    ? `«${ask.name}»: взял и наиграл ${played}. Как тебе?`
    : `«${ask.name}»: ${played} с тех пор, как мы её предложили. Как тебе?`
}

/** Сыграл ли — или открыл и закрыл (OUTCOME_PLAYED_MIN) */
export function playedEnough(minutes: number | null): boolean {
  return minutes !== null && minutes >= OUTCOME_PLAYED_MIN
}
