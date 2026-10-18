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
 * «Сессия» или «Матч» — из семантики игры (lib/semantics), без модели.
 *
 * Матч — у сетевой игры без одиночного режима (playMode не solo-capable),
 * которую посреди не бросить (canStopAnytime false) и у которой заход не на
 * вечер. Все три условия нужны: у Rust нет одиночного режима, но «матча» там
 * нет — вайп на недели, и строка остаётся «Сессия: на вечер»; у асинхронной
 * партии можно выйти в любой момент — это тоже не матч. У матча минуты
 * называются числом: для него длина и есть главный вопрос («успею до ужина?»),
 * а оценка по отзывам про матчи обычно и говорит конкретно.
 *
 * null — семантики нет или она недостаточно уверена (SESSION_MIN_CONFIDENCE).
 */
export function sessionTrait(meta: Pick<GameMeta, 'semantics' | 'categories'>): GameTrait | null {
  const s = meta.semantics
  if (!s || s.confidence < SESSION_MIN_CONFIDENCE) return null
  const { minutes, bucket, canStopAnytime } = s.session
  const match =
    playMode(meta.categories ?? []) !== 'solo-capable' && !canStopAnytime && bucket !== 'long'
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

/** Отзывы, которые показываются людям: доля положительных, сколько и оценка Steam */
export type ShownReviews = {
  /** 0…100 */
  percent: number
  total: number
  /** EUserReviewScore той же сводки, 1…9; null — Steam оценки не назвал */
  score: number | null
}

/**
 * Какие отзывы показывать людям — одно правило на весь сайт: кольцо /game, его
 * meta description и OG-картинка (reviewFacts в lib/gamepage), плитки хабов
 * жанров (app/games/[tag]) и полка покупок /play (cardView в lib/cards).
 *
 * Показываются все языки — сводка магазина (GetItems summary_filtered),
 * которую крон сигналов каталога сверяет у всего пула раз в неделю. Раньше
 * плитки печатали reviews_total, а это англоязычная шкала (посев каталога
 * читал поиск с l=english, сверка держит ту же шкалу ради порогов живости):
 * The Binding of Isaac на /games/roguelike — «96% из 165 тыс.», а на своей
 * карточке — «97% из 459 857». Одно из двух чисел выглядело выдуманным, а
 * доверие — ровно то, что продукт продаёт. Англоязычные колонки остаются
 * шкалой порогов и порядка пула, людям они не показываются: молчание здесь
 * лучше, чем «N отзывов» не той шкалы. Пока сверка до игры не дошла (новичок
 * пула — до ближайшего звена: ни разу не сверенные идут в её очереди первыми,
 * а пул, сверенный до этих колонок, разовый шаг migrateDb поставил туда же),
 * плитка молчит, а кольцо /game берёт сводку своей карточки — тоже все языки
 * (reviewFacts).
 *
 * Оценка словами — той же сводки и того же замера, что числа: слово от одной
 * сводки рядом с долей из другой разошлось бы на границе («Очень
 * положительные» при 79%).
 */
export function shownReviews(
  meta: Pick<GameMeta, 'reviewsAllTotal' | 'reviewsAllPercent'> & Partial<Pick<GameMeta, 'reviewsAllScore'>>,
): ShownReviews | null {
  const { reviewsAllTotal: total, reviewsAllPercent: percent, reviewsAllScore: score } = meta
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
  return {
    percent: Math.round(Math.min(100, Math.max(0, percent))),
    total: Math.round(total),
    score: typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 9 ? score : null,
  }
}

/**
 * «92% из 48 тыс.» — доверие к покупке на плитке полки: та же пара чисел, что
 * кольцо на карточке игры (shownReviews — одно правило для обоих), только
 * короче. Полная фраза — с тем же склонением, что там: «92% из 48 213 отзывов
 * — положительные». null — отзывов нет или они битые: пустое «0% из 0» хуже
 * молчания.
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
