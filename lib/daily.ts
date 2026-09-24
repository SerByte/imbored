import { CANDIDATE_SOURCES, type ScoredCandidate } from './types'

/** FNV-1a — стабильный хеш строки в uint32 */
export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — детерминированный ГПСЧ */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * «Игра дня»: детерминированный взвешенный выбор — один и тот же весь день
 * для конкретного пользователя, завтра другой. Верхние кандидаты весят больше.
 */
export function pickDaily(candidates: ScoredCandidate[], seed: string): ScoredCandidate | null {
  if (!candidates.length) return null
  const rng = mulberry32(hashString(seed))
  const weights = candidates.map((_, i) => candidates.length - i)
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rng() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r <= 0) return candidates[i]
  }
  return candidates[0]
}

/**
 * Чьи сутки у «Игры дня».
 *
 * Сутки считались по UTC (toISOString), и игра менялась в 03:00 по Москве —
 * посреди ночной сессии, а с полуночи до трёх подпись показывала вчерашнее
 * число. Аудитория русскоязычная, и полночь продукта — московская.
 *
 * Пояс клиента сюда не берётся сознательно: запись дня (daily_picks) и сид
 * отбора ключуются этой датой, и у одного человека с двух устройств в разных
 * поясах «сегодня» разошлось бы на две разные игры. Граница одна на всех.
 */
export const DAILY_TZ = 'Europe/Moscow'

const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>()

/**
 * Ключ суток вида 2026-09-24 в поясе tz.
 *
 * Один ключ на всё, что зовётся «сегодня» у игры дня: сид отбора, запись в
 * daily_picks, подпись даты (dayLabel в lib/freshness строит её из ключа) и
 * уборка вчерашних записей в кроне.
 *
 * Дата собирается по частям (formatToParts), а не строкой формата en-CA:
 * вид «ГГГГ-ММ-ДД» у en-CA — договорённость данных ICU, а не стандарт, и
 * от неё зависел бы первичный ключ таблицы.
 *
 * Не путать с dayKey из lib/forgotten: тот — сид полки «запечатанного» в
 * /library и считается по UTC.
 */
export function dayKey(nowSec: number, tz: string = DAILY_TZ): string {
  let fmt = DAY_FORMATS.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    DAY_FORMATS.set(tz, fmt)
  }
  const parts = fmt.formatToParts(new Date(nowSec * 1000))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Каждый какой день герой — игра из магазина, а не из библиотеки */
export const STORE_DAY_EVERY = 3

/**
 * Из какого пула берём героя дня.
 *
 * «Игра дня» задумывалась как разбор своего бэклога, и витрина магазина не
 * должна его вытеснять: магазинный день — каждый третий, остальные два свои.
 * Отдельный хеш, а не тот же, что у pickDaily: общий сид дал бы корреляцию
 * между «сегодня магазинный день» и «какая именно игра», а это две независимые
 * лотереи.
 *
 * Если одна из сторон пуста, берём вторую: пустой экран хуже неудачной
 * рекомендации — то же правило, что у фильтров актуальности.
 */
export function pickDailyPool<T>(own: T[], discovery: T[], seed: string): T[] {
  if (!discovery.length) return own
  if (!own.length) return discovery
  return hashString(`${seed}:store`) % STORE_DAY_EVERY === 0 ? discovery : own
}

/**
 * Своя запасная на магазинный день: тот же сид, свой пул. null — день и так
 * свой (или своего нет вовсе): предлагать «из своего» тогда нечего.
 */
export function pickOwnAlternate(
  own: ScoredCandidate[],
  discovery: ScoredCandidate[],
  seed: string,
): ScoredCandidate | null {
  if (!own.length || pickDailyPool(own, discovery, seed) !== discovery) return null
  return pickDaily(own, seed)
}

/**
 * Что из кандидата уходит клиенту: кто он и откуда. Скор и его части — это
 * ранжирование, и живут они только на сервере: по части cooldown видно, что
 * человек откладывал и что ему надоело. /api/recommend получает это даром —
 * Pick из llm.ts частей не несёт, — а здесь герой и есть сам кандидат, и
 * спред отдал бы всё.
 */
export function publicPick(c: ScoredCandidate): Pick<ScoredCandidate, 'appid' | 'name' | 'source'> {
  return { appid: c.appid, name: c.name, source: c.source }
}

/**
 * Начало суток «Игры дня» (dayKey) в unix-секундах: с какого момента «Не
 * сегодня» считается сказанным про сегодня. Полночь по Москве; перехода на
 * летнее время там нет, поэтому вычитания часов, минут и секунд хватает.
 */
export function dayStartSec(nowSec: number, tz: string = DAILY_TZ): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(nowSec * 1000))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return nowSec - (part('hour') * 3600 + part('minute') * 60 + part('second'))
}

/** Кандидат в том виде, в каком он уходит в запись дня */
export type DailyChosen = ReturnType<typeof publicPick>

/**
 * Своя игра на магазинный день — «Сегодня хочу из своего». Раз в три дня
 * героем становится игра из магазина (pickDailyPool), и человеку, который
 * сегодня покупать ничего не собирался, раньше оставалось только уйти в
 * обычный подбор. Запасная выбирается тем же отбором из своего пула и тем же
 * сидом, показывается только по нажатию.
 */
export type DailyAlternate = {
  pick: DailyChosen
  hoursPlayed: number | null
  /** Причина без ценового хвоста, как у героя */
  reasonBase: string
  sharedTags: string[]
}

/**
 * Что именно запоминается на сутки.
 *
 * Герой, полка и часы — результат ОТБОРА: он опирается на пул каталога,
 * профиль вкуса и фидбек и до полуночи меняться не должен по определению
 * страницы. Вместе с ним — всё, для чего иначе пришлось бы снова читать
 * библиотеку: основа причины (якорь и совпавшие теги уже вписаны в неё),
 * отметки на чипсах и флаг hideUrgency. И запасная своя на магазинный день.
 *
 * Цены здесь НЕТ, и это не упущение. Ценовой хвост причины («Сейчас −40%:
 * …») и ценник под ней живут своей осью свежести и пересчитываются на каждом
 * заходе: запомнить их значило бы заморозить вчерашнюю сумму рядом с
 * сегодняшним ценником.
 *
 * Скора и его частей тоже нет: запись хранит publicPick, а не кандидата.
 */
export type DailySelection = {
  pick: DailyChosen
  shelf: DailyChosen[]
  hoursPlayed: number | null
  /** Причина без ценового хвоста; хвост — reasonPrice на каждом заходе */
  reasonBase: string
  sharedTags: string[]
  hideUrgency: boolean
  /** Своя на магазинный день; null — день и так свой, или своего нет */
  alt: DailyAlternate | null
}

function parseChosen(raw: unknown): DailyChosen | null {
  if (!raw || typeof raw !== 'object') return null
  const { appid, name, source } = raw as Record<string, unknown>
  if (typeof appid !== 'number' || !Number.isInteger(appid)) return null
  if (typeof name !== 'string') return null
  if (!CANDIDATE_SOURCES.includes(source as never)) return null
  return { appid, name, source: source as ScoredCandidate['source'] }
}

const isTags = (x: unknown): x is string[] => Array.isArray(x) && x.every((t) => typeof t === 'string')

function parseAlternate(raw: unknown): DailyAlternate | null {
  if (!raw || typeof raw !== 'object') return null
  const { pick, hoursPlayed, reasonBase, sharedTags } = raw as Record<string, unknown>
  const chosen = parseChosen(pick)
  if (!chosen) return null
  if (hoursPlayed !== null && typeof hoursPlayed !== 'number') return null
  if (typeof reasonBase !== 'string' || !isTags(sharedTags)) return null
  return { pick: chosen, hoursPlayed, reasonBase, sharedTags }
}

/**
 * Запись дня — с проверкой формы, а не приведением типом.
 *
 * Строку писала, возможно, предыдущая версия приложения, и состав записи с
 * тех пор мог измениться. Непрошедшая запись — не ошибка: маршрут просто
 * пересчитает выбор и перезапишет её. Запасной своей (alt) у записей до её
 * появления нет — это не повод пересчитывать утренний выбор посреди дня:
 * запись проходит, просто без запасной.
 */
export function parseDailySelection(raw: unknown): DailySelection | null {
  if (!raw || typeof raw !== 'object') return null
  const { pick, shelf, hoursPlayed, reasonBase, sharedTags, hideUrgency, alt } = raw as Record<
    string,
    unknown
  >
  const parsedPick = parseChosen(pick)
  if (!parsedPick) return null
  if (!Array.isArray(shelf)) return null
  const parsedShelf: DailyChosen[] = []
  for (const item of shelf) {
    const c = parseChosen(item)
    if (!c) return null
    parsedShelf.push(c)
  }
  if (hoursPlayed !== null && typeof hoursPlayed !== 'number') return null
  if (typeof reasonBase !== 'string') return null
  if (!isTags(sharedTags)) return null
  if (typeof hideUrgency !== 'boolean') return null
  return {
    pick: parsedPick,
    shelf: parsedShelf,
    hoursPlayed,
    reasonBase,
    sharedTags,
    hideUrgency,
    alt: parseAlternate(alt),
  }
}

/**
 * Игры, которые «Игра дня» сегодня может показать героем: сам герой и
 * запасная своя. «Не сегодня» про любую из них сбрасывает запись — отбор
 * обязан учесть его в тот же день; про остальные игры — нет, иначе любое
 * «не сейчас» на /play перетасовывало бы выбор, обещанный на сутки.
 */
export function dailyHeroAppids(sel: DailySelection | null): number[] {
  if (!sel) return []
  return sel.alt ? [sel.pick.appid, sel.alt.pick.appid] : [sel.pick.appid]
}
