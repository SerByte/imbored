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
 * Снапшот пишется, только когда человек заходит. Кто пропал дольше окна, у
 * того совет сверяет первый снапшот после возвращения — один раз (поздняя
 * сверка, late): минуты в ней набежали за всю паузу, поэтому в честную долю
 * она не идёт, а на полке и в вопросе подписана сроком.
 *
 * Модуль клиентский: здесь сроки, ответы и подписи, база — в lib/db.ts.
 */

/** Сколько после совета снапшоты ещё дописывают минуты: две недели */
export const OUTCOME_WINDOW_SEC = 14 * 86_400

/**
 * Сколько поздняя сверка ждёт ответа на «как тебе?»: сутки с самой сверки.
 * Это новость для обоих — первый заход после паузы, — а не напоминание о
 * совете прошлого месяца каждый раз, как человек откроет сайт. Дальше
 * ответить можно только в «Твоих вечерах».
 */
export const OUTCOME_LATE_ASK_SEC = 86_400

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
  /**
   * Сверено после окна — первым снапшотом после долгой паузы: минуты
   * набежали за всю паузу. Поле есть только у такого вопроса.
   */
  late?: true
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
    ...(r.late === true ? { late: true as const } : {}),
  }
}

/**
 * Сыгранное — коротко: «40 мин», «2 ч», «3 ч 20 мин». Сокращения не
 * склоняются, и строке рядом с названием игры не нужно «часа» и «минут».
 * От десяти часов — только часы, с разрядами: «2434 ч 42 мин» минуты не
 * уточняют, а читаются дольше самого числа.
 */
export function playedLine(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (!h) return `${rest} мин`
  if (h >= 10) return `${Math.round(m / 60).toLocaleString('ru-RU')} ч`
  return rest ? `${h} ч ${rest} мин` : `${h} ч`
}

/**
 * Вопрос целиком — одна строка на /play и /daily. После поздней сверки он
 * говорит, откуда столько: «с тех пор, как мы её предложили» про месяц
 * назад звучало бы так, будто прошла пара дней.
 */
export function outcomeQuestion(ask: Pick<OutcomeAsk, 'name' | 'minutes' | 'bought' | 'late'>): string {
  const played = playedLine(ask.minutes)
  if (ask.late) {
    return ask.bought
      ? `Пока тебя не было: взял «${ask.name}» и наиграл ${played}. Как тебе?`
      : `Пока тебя не было: «${ask.name}» — ${played} после нашего совета. Как тебе?`
  }
  return ask.bought
    ? `«${ask.name}»: взял и наиграл ${played}. Как тебе?`
    : `«${ask.name}»: ${played} с тех пор, как мы её предложили. Как тебе?`
}

/** Сыграл ли — или открыл и закрыл (OUTCOME_PLAYED_MIN) */
export function playedEnough(minutes: number | null): boolean {
  return minutes !== null && minutes >= OUTCOME_PLAYED_MIN
}

/*
 * «ТВОИ ВЕЧЕРА» — те же строки, показанные самому человеку (/library).
 */

/** Совет глазами человека: что посоветовали, когда и что вышло */
export type Evening = {
  appid: number
  shownAt: number
  /** Нажал «Запустить» (а не только сходил в магазин) */
  launched: boolean
  /**
   * Сыграно после совета, минут; null — ещё не сверяли: снапшота после
   * совета не было, результат неизвестен (а не «ноль»)
   */
  minutes: number | null
  /** Игры не было, когда советовали, — и она появилась */
  bought: boolean
  verdict: OutcomeVerdict | null
  /** Когда сверили; null — ещё нет */
  checkedAt: number | null
  /**
   * Сверено позже окна — первым снапшотом после долгой паузы, и минуты
   * набежали за всю паузу. Отметки в схеме нет: в окне строку сверяют только
   * снапшоты, снятые не позже shownAt + OUTCOME_WINDOW_SEC
   * (fillOutcomesFromSnapshot), так что сверка позже бывает только поздней.
   */
  late: boolean
}

/** Строка из outcomes в Evening. Минуты — прирост за окно своего совета, не меньше нуля. */
export function eveningFrom(row: {
  appid: number
  shownAt: number
  launchedAt: number | null
  minutesBefore: number | null
  minutesAfter: number | null
  ownedAfter: number | null
  checkedAt: number | null
  verdict: string | null
}): Evening {
  const checked = row.checkedAt !== null
  // Сверили, а игры так и нет (заглянул в магазин и не взял) — сыграно ноль
  const minutes = !checked
    ? null
    : row.minutesAfter === null
      ? 0
      : Math.max(0, row.minutesAfter - (row.minutesBefore ?? 0))
  return {
    appid: row.appid,
    shownAt: row.shownAt,
    launched: row.launchedAt !== null,
    minutes,
    bought: row.minutesBefore === null && row.ownedAfter === 1,
    verdict: isOutcomeVerdict(row.verdict) ? row.verdict : null,
    checkedAt: row.checkedAt,
    late: row.checkedAt !== null && row.checkedAt - row.shownAt > OUTCOME_WINDOW_SEC,
  }
}

/**
 * Подпись сыгранного на полке «Твои вечера». У поздней сверки — со сроком:
 * «5 ч за 6 нед.» честнее голых «5 ч» рядом с советами, которые мерили
 * двумя неделями. У нуля срок не нужен: «не запускал» за месяц — всё ещё
 * «не запускал».
 */
export function eveningPlayed(
  e: Pick<Evening, 'minutes' | 'launched' | 'late' | 'shownAt' | 'checkedAt'>,
): string {
  if (e.minutes === null) return 'ещё не сверяли'
  if (e.minutes === 0) return e.launched ? 'открыл и закрыл' : 'не запускал'
  const played = playedLine(e.minutes)
  if (!e.late || e.checkedAt === null) return played
  return `${played} за ${Math.round((e.checkedAt - e.shownAt) / (7 * 86_400))} нед.`
}

/**
 * Можно ли сейчас спросить «как тебе?» про этот совет — то же правило, что у
 * pendingOutcomeAsk (lib/db.ts): сыграно заметно, ответа нет, и совет в окне
 * либо поздняя сверка не старше суток. /library по нему держит на полке
 * совет, на который ведёт вопрос, даже если он не из двенадцати свежих.
 */
export function askableNow(e: Evening, nowSec: number): boolean {
  if (e.verdict !== null || !playedEnough(e.minutes)) return false
  return e.late
    ? e.checkedAt !== null && e.checkedAt >= nowSec - OUTCOME_LATE_ASK_SEC
    : e.shownAt >= nowSec - OUTCOME_WINDOW_SEC
}

/**
 * Сводка по советам — честная доля. Знаменатель — только сверенные: совет
 * без снапшота после него не «не сыграл», а «ещё неизвестно» (тот же закон,
 * что в lib/feedbackreport.ts). Часы — сумма приростов, каждый в окне своего
 * совета, поэтому одна и та же игра, посоветованная дважды, не считается
 * дважды за одни минуты.
 *
 * Поздние сверки в долю и в часы не идут: их минуты набежали за всю паузу,
 * и пропавший на месяц поднимал бы долю одним снапшотом. Их минуты —
 * отдельным числом (lateMinutes), /library говорит о них своей фразой.
 */
export function eveningsSummary(list: Evening[]): {
  checked: number
  played: number
  minutes: number
  lateMinutes: number
} {
  let checked = 0
  let played = 0
  let minutes = 0
  let lateMinutes = 0
  for (const e of list) {
    if (e.minutes === null) continue
    if (e.late) {
      lateMinutes += e.minutes
      continue
    }
    checked++
    minutes += e.minutes
    if (playedEnough(e.minutes)) played++
  }
  return { checked, played, minutes, lateMinutes }
}
