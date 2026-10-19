import { DEMO_METAS, demoLibrary, demoLibrary2 } from './demo'
import { filterActual } from './actual'
import { heuristicPicks } from './llm'
import { playContextOf } from './liveness'
import {
  buildAnchorFinder,
  buildTagProfile,
  mixHeroPool,
  ownFirst,
  PICK_COUNT,
  scoreCandidates,
  splitBySource,
  topTags,
} from './recommend'
import { tr, type Locale } from './i18n'
import { sourceBadge } from './sources'
import { tagLabel } from './tagsru'
import type { GameArtUrls } from './art'
import type { Mood } from './types'

/**
 * ДЕМО-ВЫДАЧА ДЛЯ ГЛАВНОЙ: ПОКАЗАТЬ РАБОТУ ДО ТОГО, КАК ПРОСИТЬ БИБЛИОТЕКУ.
 *
 * Главная просила Steam, не показав ничего. Восемь проработанных экранов
 * человек не видел, пока не отдаст библиотеку, — и решение отдавать принимал
 * вслепую. Здесь собирается настоящая выдача настоящим конвейером продукта, но
 * на демо-библиотеке: та же, что стоит за кнопкой «Попробовать демо».
 *
 * Ни базы, ни сети, ни сессии: DEMO_METAS и demoLibrary — константы модуля,
 * поэтому всё считается синхронно прямо в серверном компоненте и уходит в
 * статический HTML.
 *
 * ПОЧЕМУ КОНВЕЙЕР ЦЕЛИКОМ, А НЕ scoreCandidates. splitBySource и mixHeroPool
 * пропускать нельзя: потолок покупок в пятёрке (MAX_NEW_PICKS) обеспечивается
 * именно там, а не в скоринге. Без этих двух шагов обещание «покупок здесь не
 * больше двух» было бы напечатано и не обеспечено. Второе обещание той же
 * строки — «своё идёт первым» — держит ownFirst после подбора, тот же, что
 * у /api/recommend.
 *
 * ЧЕГО В ЭТИХ ДАННЫХ НЕТ И БЫТЬ НЕ ДОЛЖНО:
 *
 *   reason — шаблоны причины продукта (lib/llm.ts, SOURCE_TEMPLATES)
 *     обращаются к человеку на «ты» и говорят про ЕГО библиотеку: «ты не
 *     запускал», «ты открыл и закрыл». Гостю это прямая неправда — библиотека
 *     чужая. Правило обеспечено формой данных, а не дисциплиной: поля нет.
 *   priceFinal и discount — цена демо-игры к настоящему магазину отношения не
 *     имеет, а ценник на лендинге читается как предложение купить.
 *
 * ЧТО ЕСТЬ ВМЕСТО ПРИЧИНЫ: `why` у первой карточки — та же причина в третьем
 * лице, про демо-игрока (heuristicPicks с voice: 'them', THEM_TEMPLATES).
 * Первая строка главной обещает «Одна игра. И почему именно она», а до входа
 * «почему» показать было нечем — и главное отличие продукта от списка игр
 * гость не видел, пока не отдаст библиотеку. Доводы настоящие: якорь и часы
 * считаются из демо-библиотеки так же, как у вошедшего (lib/cards.ts), только
 * без «ты», без цены и без пересказа патча. Только у первой: она и есть
 * «одна игра», а пять причин в колонке не поместились бы в закреплённую сцену.
 *
 * ОСЕЙ ДВЕ, А НЕ ТРИ, и это замер, а не вкус. Вопросов в подборе три, но на
 * библиотеке из 22 игр ось времени почти не двигает выдачу: TIME_FIT даёт
 * ±0.15…−0.2, а теги демо-библиотеки почти все падают в корзины medium/long.
 * Показать третий переключатель значило бы пообещать реакцию, которой нет.
 * Время зафиксировано на 'medium' — это и есть NEUTRAL_MOOD продукта.
 * Расхождение оставшихся четырёх наборов закреплено в lib/landing.test.ts.
 */

/** Ключ состояния переключателей: вайб и компания. */
export type MoodKey = 'chill:solo' | 'chill:friends' | 'engaged:solo' | 'engaged:friends'

export const MOOD_KEYS: readonly MoodKey[] = [
  'chill:solo',
  'chill:friends',
  'engaged:solo',
  'engaged:friends',
]

/** Время не спрашиваем — см. докблок выше. */
const FIXED_TIME = 'medium' as const

export type LandingCard = {
  appid: number
  name: string
  /** Подпись источника продукта: «Пора вернуться», «Открыл и закрыл»… */
  badge: string
  /** Подписи тегов, уже на языке страницы (см. demoTags ниже) */
  tags: string[]
  headerImage: string | null
  art: GameArtUrls | null
  /**
   * Почему она первая — причина в третьем лице, только у первой карточки
   * (см. докблок выше: «ЧТО ЕСТЬ ВМЕСТО ПРИЧИНЫ»).
   */
  why?: string
}

export type LandingWallGame = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
}

export type CompatRow = { name: string; a: number; b: number }

export type LandingDemo = {
  /** Пятёрка на каждое состояние переключателей. */
  picks: Record<MoodKey, LandingCard[]>
  /** Вся демо-библиотека — стена, из которой вынуты пятёрки. */
  wall: LandingWallGame[]
  libraryCount: number
  libraryHours: number
  compat: { rows: CompatRow[]; hours: number; countA: number; countB: number }
}

function moodOf(key: MoodKey): Mood {
  const [vibe, social] = key.split(':') as ['chill' | 'engaged', 'solo' | 'friends']
  return { time: FIXED_TIME, vibe, social }
}

/**
 * Главные теги демо-карточки — topTags из lib/recommend, тот же отбор, что у
 * чипсов выдачи, «Игры дня» и колоды пати. Своя копия здесь уже разошлась с
 * ним: предупреждения о контенте (CONTENT_WARNING_TAGS) выдача отсеивает до
 * среза, а копия — нет, и демо-игра с Gore показала бы на главной чипс,
 * которого настоящая выдача не покажет. Сейчас в DEMO_METAS таких тегов нет,
 * но правило одно, и держится оно одной функцией.
 *
 * Сразу подписями на языке страницы (tagLabel: для ru это tagRu, для en — сам
 * тег Steam), и это исключение из правила «переводить на месте вывода»:
 * главная рисует их клиентским компонентом, и перевод там положил бы словарь
 * тегов в бандл самой лёгкой страницы сайта. Здесь теги — уже только подпись:
 * ни с чем их дальше не сравнивают.
 */
function demoTags(
  appid: number,
  metaOf: (id: number) => (typeof DEMO_METAS)[number] | undefined,
  locale: Locale,
): string[] {
  return topTags(metaOf(appid)).map((t) => tagLabel(t, locale))
}

/** Запасное имя игры без метаданных — глоссарий: «Игра 730» / «Game 730» */
function gameName(appid: number, locale: Locale): string {
  return tr(locale, { ru: `Игра ${appid}`, en: `Game ${appid}` })
}

/**
 * Всё, что показывает главная. Чистая функция от времени — и от него почти не
 * зависит: lastPlayed в демо задан относительными сдвигами, скидок в
 * DEMO_METAS нет, поэтому пятёрки не «дышат» между ревалидациями ISR.
 *
 * locale — язык главной: обе главные статические и собираются при сборке,
 * каждая своим вызовом. Выбор игр от языка не зависит — тот же конвейер на тех
 * же данных, — меняются только слова: причина первой карточки, подписи тегов
 * и запасные имена игр.
 */
export function landingDemo(nowSec: number, locale: Locale = 'ru'): LandingDemo {
  const metas = new Map(DEMO_METAS.map((m) => [m.appid, m]))
  const metaOf = (appid: number) => metas.get(appid)

  const library = demoLibrary(nowSec)
  const profile = buildTagProfile(library, metaOf)
  const owned = new Set(library.map((g) => g.appid))
  const newPool = DEMO_METAS.filter((m) => !owned.has(m.appid))
  // Якорь и часы — как у вошедшего (lib/cards.ts), только из демо-библиотеки.
  // Карты редкости тегов у гостя нет (её строит каталог) — сырой косинус, как
  // в замере порога якоря (ANCHOR_MIN_SIM, lib/recommend.ts).
  const findAnchor = buildAnchorFinder(library, metaOf, null)
  const minutes = new Map(library.map((g) => [g.appid, g.playtimeForever]))
  const reasonOpts = {
    voice: 'them' as const,
    locale,
    anchorOf: (appid: number) => {
      const meta = metaOf(appid)
      return meta ? findAnchor(meta) : null
    },
    hoursOf: (appid: number) => {
      const m = minutes.get(appid)
      return m === undefined ? null : Math.round(m / 60)
    },
  }

  const picks = {} as Record<MoodKey, LandingCard[]>
  for (const key of MOOD_KEYS) {
    const mood = moodOf(key)
    const scored = scoreCandidates({
      profile,
      library,
      metaOf,
      newPool,
      mood,
      nowSec,
      limit: 12,
    })
    // Контекст живости — тем же правилом, что у /play (playContextOf): «Один»
    // на главной обязан отсеять то же, что отсеет выдача после входа
    const fresh = filterActual(scored, metas, playContextOf(mood))
    const { own, discovery } = splitBySource(fresh)
    // ownFirst — тот же, что у /api/recommend: «своё идёт первым» напечатано
    // под этой пятёркой, и держать его должен тот же шаг, что и в продукте.
    // На демо-данных он почти всегда холостой (скидок в DEMO_METAS нет, и
    // покупка своё по скору не обгоняет), но без него обещание держалось бы
    // на совпадении данных, а не на конвейере
    const chosen = ownFirst(
      heuristicPicks(mixHeroPool(own, discovery), metaOf, PICK_COUNT, nowSec, profile, reasonOpts),
    )

    picks[key] = chosen.map((p, i) => ({
      appid: p.appid,
      name: p.name,
      // Подпись источника — из lib/sources.ts, на языке главной: та же, что
      // у полосы героя выдачи («Bought, never opened», «Time to go back»)
      badge: sourceBadge(p.source, locale),
      tags: demoTags(p.appid, metaOf, locale),
      headerImage: metaOf(p.appid)?.headerImage ?? null,
      art: metaOf(p.appid)?.art ?? null,
      ...(i === 0 ? { why: p.reason } : {}),
    }))
  }

  const wall: LandingWallGame[] = library.map((g) => ({
    appid: g.appid,
    name: metaOf(g.appid)?.name ?? gameName(g.appid, locale),
    headerImage: metaOf(g.appid)?.headerImage ?? null,
    art: metaOf(g.appid)?.art ?? null,
  }))

  /*
   * Совместимость считается перебором двух демо-библиотек, а не compatibility()
   * из lib/compat.ts. Причина не в экономии: проценту нужна карта редкости
   * тегов по всему каталогу, а у гостя её нет — на пустой базе шкала
   * схлопывается, и число получилось бы красивым и неправдивым. Поэтому здесь
   * только то, что считается честно: пересечение библиотек и часы с обеих
   * сторон. Процент главная не показывает и говорит об этом прямо.
   */
  const other = demoLibrary2(nowSec)
  const byOther = new Map(other.map((g) => [g.appid, g]))
  const rows: CompatRow[] = library
    .filter((g) => byOther.has(g.appid))
    .map((g) => ({
      name: metaOf(g.appid)?.name ?? gameName(g.appid, locale),
      a: Math.round(g.playtimeForever / 60),
      b: Math.round((byOther.get(g.appid)?.playtimeForever ?? 0) / 60),
    }))
    .sort((x, y) => y.a + y.b - (x.a + x.b))

  return {
    picks,
    wall,
    libraryCount: library.length,
    libraryHours: Math.round(library.reduce((s, g) => s + g.playtimeForever, 0) / 60),
    compat: {
      rows,
      hours: rows.reduce((s, r) => s + r.a + r.b, 0),
      countA: library.length,
      countB: other.length,
    },
  }
}
