import type { Locale } from './i18n'
import type { OwnAnchor } from './recommend'
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

/** Из скольких верхних кандидатов разыгрывается игра дня */
export const DAILY_TOP = 12

/** Вес места i в розыгрыше — exp(−i/4), см. pickDaily */
const RANK_WEIGHTS = Array.from({ length: DAILY_TOP }, (_, i) => Math.exp(-i / 4))

/**
 * «Игра дня»: детерминированный взвешенный выбор — один и тот же весь день
 * для конкретного пользователя, завтра другой.
 *
 * Веса — по месту в скоре и круто вниз: exp(−i/4) по верхней дюжине. Прежние
 * линейные n−i по всему списку (своих обычно около восемнадцати) были почти
 * равномерны: лучший выпадал в каждый десятый день, пятёрка лучших — меньше
 * чем в половине дней, то есть «одна игра на сегодня» чаще бралась ниже пятого
 * места. Теперь, вместе с исключением вчерашнего (ниже), лучший выпадает
 * примерно в каждый пятый день, пятёрка лучших — в семи днях из десяти, а
 * хвост ниже дюжины не разыгрывается вовсе.
 *
 * avoid — вчерашний герой дня (и запасная своя), см. dailyHeroAppids и
 * selectDaily в /api/daily. С крутыми весами та же игра выпадала бы два дня
 * подряд примерно в каждый седьмой день, а назавтра «одна игра на сегодня» —
 * это «что-нибудь новое», даже если вчерашняя по-прежнему лучшая по скору.
 * Исключается ДО отсечки дюжиной: освободившееся место достаётся следующему.
 * Если, кроме вчерашней, выбирать не из чего, повтор лучше пустого экрана —
 * то же правило, что у pickDailyPool.
 *
 * Детерминированность на день держится: avoid читается из записи за вчера,
 * а она до полуночи не меняется.
 */
export function pickDaily(
  candidates: ScoredCandidate[],
  seed: string,
  avoid: readonly number[] = [],
): ScoredCandidate | null {
  const fresh = avoid.length ? candidates.filter((c) => !avoid.includes(c.appid)) : candidates
  const pool = (fresh.length ? fresh : candidates).slice(0, DAILY_TOP)
  if (!pool.length) return null
  const rng = mulberry32(hashString(seed))
  const weights = RANK_WEIGHTS.slice(0, pool.length)
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rng() * total
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }
  return pool[0]
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

/**
 * Ключ записи дня, отобранной под «Не предлагать» (lib/mutetags.ts), — рядом
 * с общей записью тех же суток.
 *
 * Запись дня одна на профиль, а фильтр — у браузера: телефон без фильтра мог
 * утром выбрать хоррор, а ноутбук «без хорроров» его не покажет. Отбор
 * ноутбука заново, записанный поверх общей, менял бы игру телефону посреди
 * дня, а два браузера с разными фильтрами переписывали бы её друг у друга на
 * каждом заходе — и каждый раз полным отбором в восемьсот строк. Поэтому
 * выбор под фильтром ложится сюда, а общая остаётся как была (dailyRecord в
 * lib/dailyrecord.ts решает, какую из двух показать).
 *
 * Одна запись на все фильтры, а не своя на каждый набор: ключ из ключей
 * наборов («2026-09-24~horror.vr») положил бы в базу сам фильтр — то, что
 * lib/mutetags обещает серверу не хранить. Цена: браузеры с разными
 * фильтрами делят её, и если герой, выбранный одним, попал под фильтр
 * другого — или причина, написанная профилем первого, называет вкусом тег,
 * запретный второму (namesMutedTaste в lib/recommend), — второй отбирает
 * заново и переписывает её. Сколько бы раз два таких браузера ни сменяли
 * друг друга, каждый такой отбор платит личным потолком и потолком адреса
 * /api/daily.
 *
 * Суффикс — после даты: уборка в кроне (sweepDailyPicks, day < вчера)
 * сравнивает строки и сметает её вместе с общей — «2026-09-23~mute» меньше
 * «2026-09-24», но не меньше «2026-09-23».
 */
export function mutedDayKey(day: string): string {
  return `${day}~mute`
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
 * Своя запасная на магазинный день: тот же сид, свой пул и те же вчерашние
 * в исключении — по нажатию она становится героем. null — день и так свой
 * (или своего нет вовсе): предлагать «из своего» тогда нечего.
 */
export function pickOwnAlternate(
  own: ScoredCandidate[],
  discovery: ScoredCandidate[],
  seed: string,
  avoid: readonly number[] = [],
): ScoredCandidate | null {
  if (!own.length || pickDailyPool(own, discovery, seed) !== discovery) return null
  return pickDaily(own, seed, avoid)
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
 * Английская основа причины рядом с русской — для /en.
 *
 * Запись дня одна на steamid, а заходят с обоих языков: причина, записанная
 * только по-русски, на /en была бы русской фразой посреди английской
 * страницы. Поэтому отбор пишет основу на обоих языках сразу, а GET берёт
 * свою (dailyReasonBase). Поле необязательно: записи до английской версии
 * его не несут, и на /en такую запись маршрут пересчитывает, а не
 * показывает по-русски.
 */
export type DailyReasonEn = { reasonBase: string; reasonPatched?: string }

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
  /** Та же причина с крупным патчем после последнего запуска: см. DailySelection */
  reasonPatched?: string
  /** Та же основа по-английски — см. DailyReasonEn */
  en?: DailyReasonEn
  sharedTags: string[]
  /**
   * Своя игра, на которую эта похожа. Её арт — фон героя у игры не из Steam,
   * у которой своего арта нет. Записи до появления поля его не несут: null.
   */
  via: OwnAnchor | null
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
  /**
   * Та же причина, но с фактом «с твоего последнего захода вышло крупное
   * обновление» (lib/comeback.ts); нет поля — факта нет. Отдельным полем, а
   * не внутри reasonBase: запись одна на steamid, её читают все сессии этого
   * профиля, а факт — производная от даты последнего запуска и положен только
   * writer-сессии. Какую из двух отдать, решает GET (dailyReasonBase).
   */
  reasonPatched?: string
  /** Обе основы по-английски — см. DailyReasonEn; нет поля — записано до /en */
  en?: DailyReasonEn
  sharedTags: string[]
  via: OwnAnchor | null
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

/** Якорь необязателен: битый или отсутствующий — просто без фона, запись живёт */
function parseAnchor(raw: unknown): OwnAnchor | null {
  if (!raw || typeof raw !== 'object') return null
  const { appid, name, hours } = raw as Record<string, unknown>
  if (typeof appid !== 'number' || !Number.isInteger(appid) || appid <= 0) return null
  if (typeof name !== 'string' || typeof hours !== 'number') return null
  return { appid, name, hours }
}

function parseAlternate(raw: unknown): DailyAlternate | null {
  if (!raw || typeof raw !== 'object') return null
  const { pick, hoursPlayed, reasonBase, reasonPatched, en, sharedTags, via } = raw as Record<string, unknown>
  const chosen = parseChosen(pick)
  if (!chosen) return null
  if (hoursPlayed !== null && typeof hoursPlayed !== 'number') return null
  if (typeof reasonBase !== 'string' || !isTags(sharedTags)) return null
  return {
    pick: chosen,
    hoursPlayed,
    reasonBase,
    ...patchedField(reasonPatched),
    ...enField(en),
    sharedTags,
    via: parseAnchor(via),
  }
}

/** Причина с патчем необязательна: битая или пустая — просто без неё */
function patchedField(raw: unknown): { reasonPatched?: string } {
  return typeof raw === 'string' && raw ? { reasonPatched: raw } : {}
}

/**
 * Английская основа необязательна, как и причина с патчем: битая или пустая
 * — поля нет, и /en пересчитает запись, а не покажет её по-русски. Запись
 * при этом живёт: русская часть у неё целая.
 */
function enField(raw: unknown): { en?: DailyReasonEn } {
  if (!raw || typeof raw !== 'object') return {}
  const { reasonBase, reasonPatched } = raw as Record<string, unknown>
  if (typeof reasonBase !== 'string' || !reasonBase) return {}
  return { en: { reasonBase, ...patchedField(reasonPatched) } }
}

/**
 * Какую основу причины отдать сессии: с патчем — только writer-сессии (см.
 * DailySelection.reasonPatched), остальным и записям без поля — прежнюю.
 *
 * locale — язык основы. Без него — русская, как и раньше, и ответ всегда
 * строка. 'en' — английская из DailyReasonEn тем же правилом про патч; null —
 * записи по-английски нет (сделана до английской версии или битая), и
 * маршрут обязан пересчитать выбор, а не отдать русскую причину на /en.
 */
export function dailyReasonBase(
  sel: Pick<DailyAlternate, 'reasonBase' | 'reasonPatched' | 'en'>,
  writer: boolean,
): string
export function dailyReasonBase(
  sel: Pick<DailyAlternate, 'reasonBase' | 'reasonPatched' | 'en'>,
  writer: boolean,
  locale: Locale,
): string | null
export function dailyReasonBase(
  sel: Pick<DailyAlternate, 'reasonBase' | 'reasonPatched' | 'en'>,
  writer: boolean,
  locale: Locale = 'ru',
): string | null {
  if (locale === 'en') {
    if (!sel.en) return null
    return writer && sel.en.reasonPatched ? sel.en.reasonPatched : sel.en.reasonBase
  }
  return writer && sel.reasonPatched ? sel.reasonPatched : sel.reasonBase
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
  const { pick, shelf, hoursPlayed, reasonBase, reasonPatched, en, sharedTags, via, hideUrgency, alt } =
    raw as Record<string, unknown>
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
    ...patchedField(reasonPatched),
    ...enField(en),
    sharedTags,
    via: parseAnchor(via),
    hideUrgency,
    alt: parseAlternate(alt),
  }
}

/**
 * Игры, которые «Игра дня» сегодня может показать героем: сам герой и
 * запасная своя. «Не сегодня» про любую из них сбрасывает запись — отбор
 * обязан учесть его в тот же день; про остальные игры — нет, иначе любое
 * «не сейчас» на /play перетасовывало бы выбор, обещанный на сутки.
 *
 * Назавтра те же две — исключение отбора (avoid у pickDaily): показанное
 * героем вчера сегодня не повторяется.
 */
export function dailyHeroAppids(sel: DailySelection | null): number[] {
  if (!sel) return []
  return sel.alt ? [sel.pick.appid, sel.alt.pick.appid] : [sel.pick.appid]
}

/** «Вчера была: …» под героем /daily — ссылкой на страницу игры */
export type DailyYesterday = { appid: number; name: string }

/**
 * Вчерашняя игра дня — одной тихой строкой под сегодняшней.
 *
 * Источник — запись daily_picks за вчера по тому же dayKey (московские
 * сутки), что и сегодняшняя; имя — из самой записи: выбор хранит publicPick
 * с названием, и ни база метаданных, ни сеть ради строки не нужны.
 *
 * Честная оговорка: запись дня хранит ПОСЛЕДНЕГО героя. «Не сегодня» про
 * героя стирает запись, и отбор пишет замену, — значит, «вчера была» здесь
 * та, на которой вчерашний день закончился, а не та, что стояла утром.
 * Для строки «что было вчера» это приемлемо: отложенную вчера человек сам
 * отодвинул, и напоминать о ней незачем. Запасная своя (alt) сюда не
 * попадает: героем её делало только нажатие, а какое — запись не знает.
 *
 * null — строки нет: записи за вчера нет (новый человек, крон подмёл, запись
 * не разобралась), имени нет (пустое после trim), или вчерашняя сегодня снова
 * на экране — героем, запасной своей (pickDaily исключает вчерашних, но
 * повторяет, когда выбирать больше не из чего) или карточкой полки находок.
 * Полка — частый случай, а не редкий: после магазинного дня вчерашний герой
 * пришёл из верхушки каталога, а полка — та же верхушка без сегодняшнего
 * героя и без avoid. «Вчера была X» рядом с той же X читалось бы как сбой.
 *
 * Бан и «надоела» здесь не проверяются, и запроса ради них нет: /api/feedback
 * на них стирает и вчерашнюю запись, если её герой — эта игра (см. там). Нет
 * записи — нет и строки, в обычном ответе и при ?cached=1 одинаково.
 */
export function yesterdayLine(
  yesterday: DailySelection | null,
  today: DailySelection,
): DailyYesterday | null {
  if (!yesterday) return null
  const { appid, name } = yesterday.pick
  const title = name.trim()
  if (!title) return null
  if (dailyHeroAppids(today).includes(appid)) return null
  if (today.shelf.some((c) => c.appid === appid)) return null
  return { appid, name: title }
}
