/**
 * Факты об игре короткой строкой — из семантики (lib/semantics), без модели.
 *
 * Отдельный модуль, а не часть lib/gamepage, потому что строку сессии теперь
 * показывают три экрана: карточка игры, герой выдачи /play и колода пати. Два
 * последних — клиентские, а gamepage тянет за собой базу. Сюда же — отзывы
 * короткой строкой для плитки полки на /play, русский язык (строка карточки
 * и фраза героя) и «Наиграли» карточки. Модуль чистый: из других
 * модулей только правило режима игры (lib/liveness), склонения, порог
 * уверенности и язык строк (lib/i18n — тоже чистый). Каждая строка — на
 * языке страницы: последний параметр locale, без него — русский.
 */
import { entryCost } from './entry'
import { fmtNumber, pl, tr, type Locale } from './i18n'
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
function sessionWords(minutes: number, locale: Locale): string {
  if (minutes < 30) return tr(locale, { ru: '~20 мин', en: '~20 min' })
  if (minutes < 60) return tr(locale, { ru: '~40 мин', en: '~40 min' })
  if (minutes < 120) return tr(locale, { ru: '~1,5 ч', en: '~1.5 h' })
  return tr(locale, { ru: 'на вечер', en: SESSION_EVENING_EN })
}

/**
 * «На вечер» по-английски (глоссарий docs/i18n.md). Отдельной константой: по
 * ней sessionPhrase узнаёт вечернюю корзину и строит фразу целиком, а не
 * склеивает «session all evening».
 */
const SESSION_EVENING_EN = 'all evening'

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
  locale: Locale = 'ru',
): GameTrait | null {
  const s = meta.semantics
  if (!s || s.confidence < SESSION_MIN_CONFIDENCE) return null
  const { minutes, bucket, canStopAnytime } = s.session
  const mode = playMode(meta.categories ?? [])
  const versus = mode === 'online' || (mode === 'coop' && isVersus(meta))
  const match = versus && !canStopAnytime && bucket !== 'long'
  return match
    ? { label: tr(locale, { ru: 'Матч', en: 'Match' }), value: tr(locale, { ru: `~${minutes} мин`, en: `~${minutes} min` }) }
    : { label: tr(locale, { ru: 'Сессия', en: 'Session' }), value: sessionWords(minutes, locale) }
}

/**
 * Строка сессии одной фразой — для героя /play и колоды пати, где нет места
 * на «подпись: значение».
 *
 * По-русски это ровно то, что экраны склеивали сами: «сессия ~20 мин»,
 * «матч ~45 мин», «сессия на вечер». По-английски та же склейка читается
 * криво («session all evening»), поэтому фраза строится целиком и
 * множественным числом, как говорят о длине захода: «~20 min sessions»,
 * «~45 min matches», «all-evening sessions».
 *
 * Принимает готовую строку sessionTrait того же языка — она и едет с сервера
 * в карточке, — а не семантику: клиенту не нужно знать корзины.
 */
export function sessionPhrase(trait: GameTrait, locale: Locale = 'ru'): string {
  if (locale !== 'en') return `${trait.label.toLowerCase()} ${trait.value}`
  const noun = trait.label.toLowerCase() === 'match' ? 'matches' : 'sessions'
  return trait.value === SESSION_EVENING_EN ? `all-evening ${noun}` : `${trait.value} ${noun}`
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
export function entryTrait(
  meta: Pick<GameMeta, 'tags' | 'semantics'>,
  locale: Locale = 'ru',
): GameTrait | null {
  const e = entryCost(meta)
  if (!e || e.basis !== 'reviews' || e.hours === null) return null
  const label = tr(locale, { ru: 'Вход', en: 'Ramp-up' })
  if (e.level === 'low') {
    return {
      label,
      value: tr(locale, {
        ru: 'затягивает с первых минут — по отзывам',
        en: 'hooks you from the first minutes — per reviews',
      }),
    }
  }
  const h = Math.max(1, Math.round(e.hours))
  const hours = pl(locale, h, { ru: ['час', 'часа', 'часов'], en: ['hour', 'hours'] })
  return {
    label,
    value: tr(locale, {
      ru: `раскрывается через ${h} ${hours} — по отзывам`,
      en: `takes ${h} ${hours} to click — per reviews`,
    }),
  }
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
const PLAYED_STEPS: ReadonlyArray<readonly [belowHours: number, words: { ru: string; en: string }]> = [
  [1, { ru: 'меньше часа', en: 'under an hour' }],
  [1.5, { ru: '~1 ч', en: '~1 h' }],
  [2.5, { ru: '~2 ч', en: '~2 h' }],
  [4, { ru: '~3 ч', en: '~3 h' }],
  [6.5, { ru: '~5 ч', en: '~5 h' }],
  [10, { ru: '~8 ч', en: '~8 h' }],
  [16, { ru: '~12 ч', en: '~12 h' }],
  [25, { ru: '~20 ч', en: '~20 h' }],
  [40, { ru: '~30 ч', en: '~30 h' }],
]

function playedWords(minutes: number, locale: Locale): string {
  const hours = minutes / 60
  return tr(locale, PLAYED_STEPS.find(([below]) => hours < below)?.[1] ?? { ru: 'от 40 ч', en: '40+ h' })
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
  locale: Locale = 'ru',
): GameTrait | null {
  const played = meta.semantics?.played
  if (!played || endless) return null
  const words = playedWords(played.posMedianMin, locale)
  // По-английски чьё это время — тем же смыслом, но фразой, а не через тире:
  // «~8 h — those who praise it» читается подстрочником
  return tr(locale, {
    ru: { label: 'Наиграли', value: `${words} — те, кто её хвалит` },
    en: { label: 'Playtime', value: `${words} among players who recommend it` },
  })
}

/**
 * Слова осей на обоих языках. Таблица одна на карточку и на «под настроение»
 * подбора (moodWordsOf в lib/recommend берёт её отсюда): карточка и «Почему
 * она?» обязаны называть одну и ту же сложность одним словом, и две копии
 * слов разъехались бы при первой правке перевода.
 */
export const AXIS_WORDS = {
  ru: {
    challenge: { low: 'спокойная', high: 'с вызовом' },
    pace: { low: 'неторопливая', high: 'динамичная' },
    complexity: { low: 'без долгого освоения', high: 'есть что осваивать' },
  },
  en: {
    challenge: { low: 'calm', high: 'challenging' },
    pace: { low: 'unhurried', high: 'fast-paced' },
    complexity: { low: 'easy to pick up', high: 'plenty to master' },
  },
} as const satisfies Record<Locale, Record<'challenge' | 'pace' | 'complexity', { low: string; high: string }>>

/**
 * «Характер» — одна-две оси семантики словами: «спокойная, неторопливая».
 *
 * Только выраженные оси (axisBucket — те же пороги, что у отчёта и подбора) и
 * не больше двух, самые далёкие от середины: три слова — уже анкета. Только
 * из уверенной семантики: по тегам оси — приор жанра, а не факт об игре.
 */
export function characterTrait(meta: Pick<GameMeta, 'semantics'>, locale: Locale = 'ru'): GameTrait | null {
  const s = meta.semantics
  if (!s || s.confidence < SEMANTICS_MIN_CONFIDENCE) return null
  const table = AXIS_WORDS[locale]
  const words = (Object.keys(table) as Array<keyof typeof table>)
    .map((axis) => ({ axis, x: s.axes[axis], bucket: axisBucket(s.axes[axis]) }))
    .filter((a) => a.bucket !== 'mid')
    .sort((a, b) => Math.abs(b.x - 50) - Math.abs(a.x - 50))
    .slice(0, 2)
    .map((a) => table[a.axis][a.bucket as 'low' | 'high'])
  return words.length ? { label: tr(locale, { ru: 'Характер', en: 'Feel' }), value: words.join(', ') } : null
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
 *
 * На английской версии — всегда null: «есть ли русская озвучка» — вопрос
 * русскоязычного читателя, а других языков игры мы не храним, и фразы про
 * английский честно не собрать.
 */
export function ruLangLine(ru: RuLang | null | undefined, locale: Locale = 'ru'): string | null {
  if (locale === 'en') return null
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
 * знаем (см. ruLangLine), и строки нет вовсе. На английской версии строки
 * нет тоже — по той же причине, что у ruLangLine; inLanguage разметки
 * (lib/jsonld) там тогда не ставится.
 */
export function languageTrait(meta: Pick<GameMeta, 'ruLang'>, locale: Locale = 'ru'): GameTrait | null {
  if (locale === 'en') return null
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
function compactCount(n: number, locale: Locale): string {
  const tenths = (x: number) => {
    const t = String(Math.round(x * 10) / 10)
    return locale === 'en' ? t : t.replace('.', ',')
  }
  // По-английски — K и M слитно с числом (глоссарий: «тыс. / млн → K / M»)
  const k = tr(locale, { ru: ' тыс.', en: 'K' })
  const m = tr(locale, { ru: ' млн', en: 'M' })
  if (n < 1000) return String(n)
  if (n < 10_000) return `${tenths(n / 1000)}${k}`
  const thousands = Math.round(n / 1000)
  if (thousands < 1000) return `${thousands}${k}`
  return `${tenths(n / 1_000_000)}${m}`
}

/**
 * «92% из 48 213 отзывов — положительные» — полная фраза доли отзывов: та
 * же, что у кольца на карточке игры, в её meta description (gameDescription
 * в lib/gamepage) и в подсказке плитки. Одна на всех, чтобы склонение и
 * число не разъехались по экранам.
 *
 * percent и total — уже целые (их округляет вызывающий). По-английски —
 * целым шаблоном на единицу: «1 review is», а не «1 reviews are».
 */
export function reviewsLine(percent: number, total: number, locale: Locale = 'ru'): string {
  const n = fmtNumber(locale, total)
  return tr(locale, {
    ru: `${percent}% из ${n} ${plural(total, 'отзыва', 'отзывов', 'отзывов')} — положительные`,
    en: total === 1 ? `${percent}% of 1 review is positive` : `${percent}% of ${n} reviews are positive`,
  })
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
  locale: Locale = 'ru',
): ReviewsBrief | null {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null
  const p = Math.round(Math.min(100, Math.max(0, percent)))
  const n = Math.round(total)
  const count = compactCount(n, locale)
  return {
    short: tr(locale, { ru: `${p}% из ${count}`, en: `${p}% of ${count}` }),
    full: reviewsLine(p, n, locale),
  }
}

/** Ярлыки отзывов Steam по-русски — как их пишет русский магазин (глоссарий docs/i18n.md) */
const SCORE_RU: Readonly<Record<string, string>> = {
  'Overwhelmingly Positive': 'Крайне положительные',
  'Very Positive': 'Очень положительные',
  Positive: 'Положительные',
  'Mostly Positive': 'В основном положительные',
  Mixed: 'Смешанные',
  'Mostly Negative': 'В основном отрицательные',
  Negative: 'Отрицательные',
  'Very Negative': 'Очень отрицательные',
  'Overwhelmingly Negative': 'Крайне отрицательные',
}

/**
 * Словесная оценка Steam на языке страницы: на ru — русский ярлык магазина,
 * на en — сам ярлык Steam, он и так английский. Незнакомый ярлык — как есть:
 * Steam заводит новые редко, и его слово честнее пустого места.
 *
 * reviewFacts (lib/gamepage) отдаёт ярлык сырым, а переводит его место
 * вывода — так же, как подпись тега. Таблица здесь, а не в странице: ярлык
 * нужен и карточке игры, и её OG-картинке, а модуль клиентобезопасный.
 */
export function steamScoreLabel(label: string, locale: Locale = 'ru'): string {
  if (locale === 'en') return label
  return Object.hasOwn(SCORE_RU, label) ? SCORE_RU[label] : label
}
