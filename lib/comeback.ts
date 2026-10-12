import type { LibraryTileState } from './recommend'
import type { CandidateSource, LibraryGame } from './types'

/*
 * «С ТЕХ ПОР ВЫШЛО КРУПНОЕ ОБНОВЛЕНИЕ» — КОМУ ЭТО ВООБЩЕ МОЖНО СКАЗАТЬ.
 *
 * У заброшенной игры причина вернуться раньше была пустой: «вернись и проверь,
 * как оно теперь». Довод «жалко вложенных часов» из неё убран намеренно (см.
 * SOURCE_TEMPLATES.comeback в lib/llm.ts), а честный довод про саму игру —
 * «с тех пор её переделали» — лежал в news_items и с датой последнего запуска
 * не сопоставлялся нигде.
 *
 * Здесь — только отбор: у каких игр вообще есть момент, с которым сравнивать.
 * Сам патч ищет latestMajorPatchSince (lib/db.ts) одним запросом на пачку пар.
 *
 * Момент — lastPlayed, и только настоящий:
 *   • 0 или undefined — даты нет. classifyLibraryGame такую игру всё равно
 *     зовёт заброшенной, но «с твоего последнего захода» без захода — выдумка,
 *     а «с начала времён» сделал бы фактом любой патч за всю историю;
 *   • время скрыто настройками Steam (lib/playtime.ts) — нули в часах тогда
 *     не факт, и дата рядом с ними тоже не повод строить утверждение.
 *
 * Даты на экран не выходят ни здесь, ни в причине: ни «заброшена с марта», ни
 * счётчиков «три обновления с тех пор». Срок подчёркивает упрёк бэклогу, а
 * счётчик по неглубокой истории (30 постов на игру) врал бы в меньшую сторону.
 * Один самый свежий подтверждённый патч — факт, который нечем опровергнуть.
 *
 * Видит факт только writer-сессия (isWriter в lib/server.ts) — везде, где он
 * выходит на экран. Сам патч публичен (/game, «Что нового»), но «вышел после
 * твоего последнего запуска» говорит о дате запуска точнее, чем бейдж «Давно
 * не заходил», а сессию по вставленной ссылке /api/connect выдаёт на любой
 * публичный профиль. Поэтому:
 *   • стена /library — пар нет (wallPatchPairs), запроса нет;
 *   • /play — /api/recommend грузит патчи (buildPickContext, opts.patches)
 *     только writer-сессии, остальным причина прежняя и запроса нет;
 *   • «Игра дня» — запись одна на steamid и общая для всех его сессий, так
 *     что факт лежит в ней отдельным полем (reasonPatched), а GET отдаёт его
 *     только writer (dailyReasonBase в lib/daily.ts).
 */

/**
 * Как факт называется на экране — одной строкой на весь продукт: начало
 * причины на /play и в «Игре дня» (patchSentence в lib/llm.ts) и подсказка
 * метки «обновлялась» на стене /library. «Захода», а не «запуска»: так
 * говорит и промпт модели.
 */
export const PATCH_SINCE_LEAD = 'С твоего последнего захода вышло крупное обновление'

/*
 * Срок в пересказе. Схема дайджеста зовёт крупным и сезон, и ивент с новым
 * контентом, а промпт дайджеста сроков не запрещает: «Хэллоуинский сезон с
 * новой картой идёт до 5 ноября». Такой пересказ в причине — дата и «успей»
 * там, где обещан повод без давления, и ровно то, что hideUrgency прячет у
 * распродаж. Узнаём срок грубо и с запасом: лишний отказ стоит только
 * прежней фразы «вернись и проверь», пропуск — давления в главной причине.
 */
const MONTH_GEN =
  /(?<![а-яё])(?:январ[яеь]|феврал[яеь]|марта?|апрел[яеь]|мая|июн[яеь]|июл[яеь]|августа?|сентябр[яеь]|октябр[яеь]|ноябр[яеь]|декабр[яеь])(?![а-яё])/i
/** «05.11», «5.11» — но не версия «1.5» и не «1.10.2» */
const DAY_MONTH = /(?<![\d.])\d{1,2}\.(?:0[1-9]|1[0-2])(?![\d.])/
const DEADLINE_WORDS =
  /(?<![а-яё])(?:до\s+\d|только\s+до|до\s+конца|успе[йвт]|осталось|остаётся|заканчива|законч|ограниченн|временн|последн(?:ий|ие|яя)\s+(?:шанс|дн))/i

/** Несёт ли пересказ патча срок — тогда он не повод, а «успей» */
export function patchHasDeadline(tldr: string): boolean {
  return MONTH_GEN.test(tldr) || DAY_MONTH.test(tldr) || DEADLINE_WORDS.test(tldr)
}

/** С какого момента искать обновление у своей игры; null — сравнивать не с чем */
export function comebackSince(
  g: Pick<LibraryGame, 'lastPlayed'> | undefined,
  hidden: boolean,
): number | null {
  if (hidden || !g) return null
  const t = g.lastPlayed
  return typeof t === 'number' && t > 0 ? t : null
}

/**
 * Пары [appid, lastPlayed] для причин выдачи — только у кандидатов-comeback.
 *
 * Остальным источникам факт не нужен: у нераспакованной «с последнего захода»
 * не бывает, а у любимой, в которую играют сейчас, обновление человек видел
 * сам. Повтор кандидата — одна пара.
 */
export function comebackPatchPairs(
  cands: ReadonlyArray<{ appid: number; source: CandidateSource }>,
  games: ReadonlyArray<LibraryGame>,
  hidden: boolean,
): Array<[number, number]> {
  if (hidden) return []
  const lib = new Map(games.map((g) => [g.appid, g]))
  const seen = new Set<number>()
  const out: Array<[number, number]> = []
  for (const c of cands) {
    if (c.source !== 'comeback' || seen.has(c.appid)) continue
    seen.add(c.appid)
    const since = comebackSince(lib.get(c.appid), hidden)
    if (since !== null) out.push([c.appid, since])
  }
  return out
}

/**
 * Пары для метки «обновлялась» на стене /library — по плиткам текущей порции.
 *
 * Только writer-сессии: метка — производная от даты последнего запуска, а
 * даты запусков — личное (сессию по вставленной ссылке /api/connect выдаёт на
 * любой публичный профиль, см. isWriter в lib/server.ts). Не writer — пар нет,
 * запроса нет, метки нет: пустое не утечёт ни в HTML, ни в пропсы.
 */
export function wallPatchPairs(
  tiles: ReadonlyArray<LibraryGame>,
  stateOf: (g: LibraryGame) => LibraryTileState,
  opts: { hidden: boolean; writer: boolean },
): Array<[number, number]> {
  if (!opts.writer || opts.hidden) return []
  const out: Array<[number, number]> = []
  for (const g of tiles) {
    if (stateOf(g) !== 'comeback') continue
    const since = comebackSince(g, opts.hidden)
    if (since !== null) out.push([g.appid, since])
  }
  return out
}
