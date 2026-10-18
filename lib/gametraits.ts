/**
 * Факты об игре короткой строкой — из семантики (lib/semantics), без модели.
 *
 * Отдельный модуль, а не часть lib/gamepage, потому что строку сессии теперь
 * показывают три экрана: карточка игры, герой выдачи /play и колода пати. Два
 * последних — клиентские, а gamepage тянет за собой базу. Сюда же — отзывы
 * короткой строкой для плитки полки на /play, русский язык (строка карточки
 * и фраза героя) и «Наиграли» карточки. Модуль чистый: из других
 * модулей только правило режима игры (lib/liveness), склонения и порог
 * уверенности.
 */
import { entryCost } from './entry'
import { playMode } from './liveness'
import { plural } from './plural'
import { axisBucket, SEMANTICS_MIN_CONFIDENCE } from './semantics'
import type { GameMeta, RuLang } from './types'

/** Строка фактов: подпись и значение */
export type GameTrait = { label: string; value: string }

/**
 * С какой уверенности семантики карточка называет длину сессии.
 *
 * По одним тегам уверенность не выше 0.4 (TAGS_MAX_CONFIDENCE в
 * lib/semantics), поэтому строку получают только игры, у которых оси
 * уточнили отзывы. Приор по тегам годится подбору — там он один голос из
 * многих, — а на публичной карточке это было бы утверждение, выданное за
 * факт: «Сессия: ~40 мин» у игры, про которую мы знаем только теги. Порог тот
 * же, по которому семантике верит подбор, — одно число на всех.
 */
export const SESSION_MIN_CONFIDENCE = SEMANTICS_MIN_CONFIDENCE

/**
 * Минуты захода словами. Четыре корзины, а не число: минуты — оценка по
 * тегам и отзывам, и «~35 мин» обещало бы точность, которой нет. Границы —
 * между соседними подписями по середине в разах (20 и 40 → 30, 40 и 90 →
 * 60), тильда у каждой: заход в 10 и в 25 минут одинаково «~20».
 */
function sessionWords(minutes: number): string {
  if (minutes < 30) return '~20 мин'
  if (minutes < 60) return '~40 мин'
  if (minutes < 120) return '~1,5 ч'
  return 'на вечер'
}

/**
 * Против людей: 36 Online PvP, 37 Shared/Split Screen PvP, 47 LAN PvP, 49 PvP.
 * Шире, чем PVP_CATEGORIES в lib/recommend, и это разные вопросы: там —
 * «нет финала» (PvP-режим рядом с кампанией её бесконечной не делает), здесь —
 * «есть ли противник-человек», а он есть и за одним экраном, и по LAN.
 */
const VERSUS_CATEGORIES: ReadonlySet<number> = new Set([36, 37, 47, 49])

/**
 * Теги, которые выдают игру против людей там, где Steam PvP-категорию не
 * поставил, — ключами tags_json.
 *
 * Словарь один на два правила: этот же читает playsAgainst в lib/gamehub
 * («с другом» на /games/coop). Правила у них разные — здесь «есть ли такой
 * тег среди главных», там «чьих голосов больше, соперничества или
 * кооператива», — а вот что считать соперничеством, должно совпадать: иначе
 * тег, дописанный сюда, менял бы «Матч» на карточке и не трогал бы подборку,
 * где стоит та же карточка.
 */
export const VERSUS_TAGS: ReadonlySet<string> = new Set([
  'PvP',
  'Online PvP',
  'Competitive',
  'eSports',
  'MOBA',
  'Battle Royale',
  'Fighting',
  '2D Fighter',
  '3D Fighter',
  'Arena Shooter',
])

/**
 * Среди скольких первых по голосам тегов искать. Замер на каталоге продакшна
 * (75 живых коопов без одиночного режима и без PvP-категории): у настоящих
 * матчей такой тег стоит в первой десятке — MOBA у Dota 2 вторым, PvP у
 * REMATCH четвёртым, у GunZ 2 девятым, — а у PvE-коопов с заблудшим «PvP» он
 * в хвосте: Dragonheir — одиннадцатым, Star Trek Online — семнадцатым,
 * MIMESIS — девятнадцатым из двадцати. Промах один — Insurgency (Competitive
 * четырнадцатым): ей достаётся «Сессия», то есть осторожная сторона.
 */
const VERSUS_TAG_WINDOW = 10

/** Есть ли у игры противник-человек: PvP-категория или такой тег среди главных */
function isVersus(meta: { categories?: number[]; tags?: Record<string, number> }): boolean {
  if ((meta.categories ?? []).some((c) => VERSUS_CATEGORIES.has(c))) return true
  return Object.entries(meta.tags ?? {})
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    // ничьи — по имени: порядок ключей tags_json решать не должен
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, VERSUS_TAG_WINDOW)
    .some(([tag]) => VERSUS_TAGS.has(tag))
}

/**
 * «Сессия» или «Матч» — из семантики игры (lib/semantics), без модели.
 *
 * Матч — у игры против людей без одиночного режима (playMode не
 * solo-capable), которую посреди не бросить (canStopAnytime false) и у
 * которой заход не на вечер. Все условия нужны: у Rust нет одиночного режима,
 * но «матча» там нет — вайп на недели, и строка остаётся «Сессия: на вечер»; у
 * асинхронной партии можно выйти в любой момент — это тоже не матч. У матча
 * минуты называются числом: для него длина и есть главный вопрос («успею до
 * ужина?»), а оценка по отзывам про матчи обычно и говорит конкретно.
 *
 * «Против людей» — не то же, что «без одиночного режима». Сетевая игра без
 * коопа (playMode 'online': CS2, TF2 — [1, 27]) иначе как с незнакомцами не
 * играется, и она матч, как прежде. А кооп без одиночного ('coop') — это и
 * Dota 2 ([1, 9]), и It Takes Two ([1, 9, 38, 39, 24]): прежнее правило звало
 * матчем обе, и /game/1426210 писал «Матч: ~30 мин» у десятичасовой кампании
 * на двоих — та же строка ехала на героя /play, в колоду пати и на полки
 * жанров. Поэтому коопу нужен противник: PvP-категория или тег среди главных
 * (isVersus). Требовать одну PvP-категорию нельзя — у Dota 2 её нет, матч у
 * неё выдают теги MOBA и eSports.
 *
 * Без тегов кооп судится по одним категориям: «Сессия» — осторожная сторона,
 * «Матч» обещал бы противника, которого, может, и нет.
 *
 * null — семантики нет или она недостаточно уверена (SESSION_MIN_CONFIDENCE).
 */
export function sessionTrait(
  meta: Pick<GameMeta, 'semantics' | 'categories'> & Partial<Pick<GameMeta, 'tags'>>,
): GameTrait | null {
  const s = meta.semantics
  if (!s || s.confidence < SESSION_MIN_CONFIDENCE) return null
  const { minutes, bucket, canStopAnytime } = s.session
  const mode = playMode(meta.categories ?? [])
  const versus = mode === 'online' || (mode === 'coop' && isVersus(meta))
  const match = versus && !canStopAnytime && bucket !== 'long'
  return match
    ? { label: 'Матч', value: `~${minutes} мин` }
    : { label: 'Сессия', value: sessionWords(minutes) }
}

/**
 * «Вход» — время до веселья, названное отзывами: «затягивает с первых минут»
 * или «раскрывается через 3 часа».
 *
 * Только когда отзывы дали число (timeToFun.hours — медиана упоминаний, не
 * меньше MIN_TTF_MENTIONS в lib/semantics). Уверенности семантики мало:
 * она говорит, что отзывы разобраны, а не что они что-то сказали про старт.
 * Без упоминаний корзина времени до веселья — приор по тегам жанра, и
 * подпись «по отзывам» выдала бы его за мнение игроков. На /play строка по
 * тегам уместна — там она подсказка к выбору на вечер, — а публичная
 * карточка говорит об игре как о факте: у Hades по одному тегу Difficult
 * выходило «высокий порог — сначала придётся разобраться».
 */
export function entryTrait(meta: Pick<GameMeta, 'tags' | 'semantics'>): GameTrait | null {
  const e = entryCost(meta)
  if (!e || e.basis !== 'reviews' || e.hours === null) return null
  if (e.level === 'low') return { label: 'Вход', value: 'затягивает с первых минут — по отзывам' }
  const h = Math.max(1, Math.round(e.hours))
  return { label: 'Вход', value: `раскрывается через ${h} ${plural(h, 'час', 'часа', 'часов')} — по отзывам` }
}

/**
 * Ступени наигранного: «ниже скольких часов» → слова. Сами ступени — 1, 2, 3,
 * 5, 8, 12, 20, 30 часов, каждая в полтора-два раза больше соседней, граница
 * — около середины между соседями в разах (между 5 и 8 — 6,5). Ступени, а не число,
 * по той же причине, что у минут сессии: медиана сотни самых полезных отзывов
 * — не замер, и «~7 ч» против «~8 ч» обещало бы точность, которой нет. Края
 * открытые и точные: «меньше часа» — строго меньше, «от 40 ч» — сорок и
 * дальше; «~30 ч» у игры, где хвалившие наиграли сотню, было бы неправдой.
 */
const PLAYED_STEPS: ReadonlyArray<readonly [belowHours: number, words: string]> = [
  [1, 'меньше часа'],
  [1.5, '~1 ч'],
  [2.5, '~2 ч'],
  [4, '~3 ч'],
  [6.5, '~5 ч'],
  [10, '~8 ч'],
  [16, '~12 ч'],
  [25, '~20 ч'],
  [40, '~30 ч'],
]

function playedWords(minutes: number): string {
  const hours = minutes / 60
  return PLAYED_STEPS.find(([below]) => hours < below)?.[1] ?? 'от 40 ч'
}

/**
 * «Наиграли» — сколько наиграли те, кто её хвалит: «~8 ч — те, кто её
 * хвалит». Отвечает на «потяну ли я её» до покупки, из отзывов, которые крон
 * карточек и так разбирает (GameSemantics.played, lib/semantics).
 *
 * Чьё это время — в самой строке, и это не вежливость. Выборка — сотня самых
 * полезных отзывов, хвалившие среди них наигрывают больше среднего, и
 * «обычно в неё играют 8 часов» было бы неправдой; «те, кто её хвалит,
 * наиграли около восьми» — правда.
 *
 * endless — у игры нет конца (isEndless в lib/recommend: песочницы,
 * выживание, рогалики, MOBA, соревновательный мультиплеер без одиночного
 * режима). Там хвалившие наигрывают сотни часов, и это не длина игры, а то,
 * как долго к ней возвращаются. Решает вызывающий: правило живёт в
 * lib/recommend, а этот модуль обязан оставаться клиентобезопасным
 * (lib/gametraits.test.ts).
 *
 * Правило не то, по которому страница прячет «Уже прошёл» (isReplayable), и
 * расходятся они ровно в одном: у одиночной игры с PvP-режимом — Elden Ring,
 * Dark Souls III — строка есть, а кнопки нет. Строке PvP рядом с кампанией не мешает:
 * она говорит, сколько наиграли, а не сколько проходить. Кнопку и совет
 * «знакомого» isReplayable решает по-прежнему; сузить и его — отдельное
 * решение владельца (см. isEndless).
 *
 * null — наигранного не знаем: до обхода крона карточек его нет у
 * большинства игр, и тогда строки нет вовсе.
 */
export function lengthTrait(
  meta: Pick<GameMeta, 'semantics'>,
  { endless }: { endless: boolean },
): GameTrait | null {
  const played = meta.semantics?.played
  if (!played || endless) return null
  return { label: 'Наиграли', value: `${playedWords(played.posMedianMin)} — те, кто её хвалит` }
}

/** Слова осей — те же, что у «под настроение» в подборе (moodWordsOf в lib/recommend) */
const AXIS_WORDS = {
  challenge: { low: 'спокойная', high: 'с вызовом' },
  pace: { low: 'неторопливая', high: 'динамичная' },
  complexity: { low: 'без долгого освоения', high: 'есть что осваивать' },
} as const

/**
 * «Характер» — одна-две оси семантики словами: «спокойная, неторопливая».
 *
 * Только выраженные оси (axisBucket — те же пороги, что у отчёта и подбора) и
 * не больше двух, самые далёкие от середины: три слова — уже анкета. Только
 * из уверенной семантики: по тегам оси — приор жанра, а не факт об игре.
 */
export function characterTrait(meta: Pick<GameMeta, 'semantics'>): GameTrait | null {
  const s = meta.semantics
  if (!s || s.confidence < SEMANTICS_MIN_CONFIDENCE) return null
  const words = (Object.keys(AXIS_WORDS) as Array<keyof typeof AXIS_WORDS>)
    .map((axis) => ({ axis, x: s.axes[axis], bucket: axisBucket(s.axes[axis]) }))
    .filter((a) => a.bucket !== 'mid')
    .sort((a, b) => Math.abs(b.x - 50) - Math.abs(a.x - 50))
    .slice(0, 2)
    .map((a) => AXIS_WORDS[a.axis][a.bucket as 'low' | 'high'])
  return words.length ? { label: 'Характер', value: words.join(', ') } : null
}

/** Фразы героя и плитки — по ступени RuLang, см. ruLangLine */
const RU_LINE: Record<RuLang, string> = {
  3: 'русская озвучка',
  2: 'русские субтитры',
  1: 'русский интерфейс',
  0: 'без русского',
}

/**
 * Русский одной фразой — для героя /play и плитки полки покупок, где места на
 * строку «подпись: значение» нет. Называет одно, самое сильное из того, что
 * отметил Steam (ступень RuLang в lib/types): «русские субтитры» не обещают
 * озвучки, «русский интерфейс» — субтитров.
 *
 * Готовой строкой с сервера, а не ступенью: клиенту /play не нужно тащить
 * в бандл таблицу подписей ради одной фразы (потолок маршрута — в
 * bundle-budget.json).
 *
 * null — не знаем: язык приезжает с кроном карточек, промоутом и доливкой
 * медиа, а до их прохода поля нет. «Без русского» по пустоте было бы
 * выдумкой, причём той, что отговаривает.
 */
export function ruLangLine(ru: RuLang | null | undefined): string | null {
  if (ru === null || ru === undefined) return null
  return RU_LINE[ru] ?? null
}

/** Значения строки карточки — те же ступени, словами столбцов Steam */
const RU_VALUE: Record<RuLang, string> = {
  3: 'полная озвучка',
  2: 'субтитры',
  1: 'интерфейс',
  0: 'нет',
}

/**
 * «Русский: субтитры — по данным Steam» — строка фактов карточки игры.
 *
 * Для русскоязычного читателя «есть ли русский» — часто тот самый решающий
 * факт, и его же спрашивают поиском («X на русском»). Слова — столбцы
 * таблицы языков в магазине (интерфейс, озвучка, субтитры), чтобы сверить
 * было с чем. «По данным Steam» — не скромность, а источник: отметки ставит
 * издатель, и мы пересказываем их, а не проверяли перевод сами.
 *
 * «Нет» показываем: для решения оно весит не меньше «озвучки». null — не
 * знаем (см. ruLangLine), и строки нет вовсе.
 */
export function languageTrait(meta: Pick<GameMeta, 'ruLang'>): GameTrait | null {
  const value = meta.ruLang === undefined ? undefined : RU_VALUE[meta.ruLang]
  return value ? { label: 'Русский', value: `${value} — по данным Steam` } : null
}

/** Отзывы короткой строкой для плитки и полной — для скринридера и подсказки */
export type ReviewsBrief = { short: string; full: string }

/**
 * Объём коротким числом: «480», «4,8 тыс.», «48 тыс.», «1,2 млн». Плитка полки
 * узкая, а точность до единицы здесь ничего не решает: «48 тыс.» от «48 213»
 * отличается только местом в строке. Десятые — только там, где без них
 * число теряет порядок (4,8 тыс., а не 5).
 */
function compactCount(n: number): string {
  const tenths = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',')
  if (n < 1000) return String(n)
  if (n < 10_000) return `${tenths(n / 1000)} тыс.`
  const thousands = Math.round(n / 1000)
  if (thousands < 1000) return `${thousands} тыс.`
  return `${tenths(n / 1_000_000)} млн`
}

/**
 * «92% из 48 тыс.» — доверие к покупке на плитке полки: та же пара чисел, что
 * кольцо на карточке игры (reviewFacts в lib/gamepage), только короче. Полная
 * фраза — с тем же склонением, что там: «92% из 48 213 отзывов — положительные».
 * null — отзывов нет или они битые: пустое «0% из 0» хуже молчания.
 */
export function reviewsBrief(
  percent: number | null | undefined,
  total: number | null | undefined,
): ReviewsBrief | null {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null
  const p = Math.round(Math.min(100, Math.max(0, percent)))
  const n = Math.round(total)
  return {
    short: `${p}% из ${compactCount(n)}`,
    full: `${p}% из ${n.toLocaleString('ru-RU')} ${plural(n, 'отзыва', 'отзывов', 'отзывов')} — положительные`,
  }
}
