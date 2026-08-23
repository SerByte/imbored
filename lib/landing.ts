import { DEMO_METAS, demoLibrary, demoLibrary2 } from './demo'
import { filterActual } from './actual'
import { heuristicPicks } from './llm'
import {
  buildTagProfile,
  mixHeroPool,
  PICK_COUNT,
  scoreCandidates,
  splitBySource,
} from './recommend'
import { SOURCE_BADGE } from './sources'
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
 * больше двух» было бы напечатано и не обеспечено.
 *
 * ЧЕГО В ЭТИХ ДАННЫХ НЕТ И БЫТЬ НЕ ДОЛЖНО:
 *
 *   reason — все четыре шаблона причины (lib/llm.ts, SOURCE_TEMPLATES)
 *     обращаются к человеку на «ты» и говорят про ЕГО библиотеку: «ты не
 *     запускал», «ты открыл и закрыл». Гостю это прямая неправда — библиотека
 *     чужая. Правило обеспечено формой данных, а не дисциплиной: поля нет.
 *   priceFinal и discount — цена демо-игры к настоящему магазину отношения не
 *     имеет, а ценник на лендинге читается как предложение купить.
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
  tags: string[]
  headerImage: string | null
  art: GameArtUrls | null
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

/** Топ-4 тега игры по голосам — тот же отбор, что у выдачи и карточки игры. */
function topTags(appid: number, metaOf: (id: number) => (typeof DEMO_METAS)[number] | undefined): string[] {
  return Object.entries(metaOf(appid)?.tags ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t)
}

/**
 * Всё, что показывает главная. Чистая функция от времени — и от него почти не
 * зависит: lastPlayed в демо задан относительными сдвигами, скидок в
 * DEMO_METAS нет, поэтому пятёрки не «дышат» между ревалидациями ISR.
 */
export function landingDemo(nowSec: number): LandingDemo {
  const metas = new Map(DEMO_METAS.map((m) => [m.appid, m]))
  const metaOf = (appid: number) => metas.get(appid)

  const library = demoLibrary(nowSec)
  const profile = buildTagProfile(library, metaOf)
  const owned = new Set(library.map((g) => g.appid))
  const newPool = DEMO_METAS.filter((m) => !owned.has(m.appid))

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
    // Контекст живости — 'solo' | 'party', а не значение mood.social
    const fresh = filterActual(scored, metas, mood.social === 'friends' ? 'party' : 'solo')
    const { own, discovery } = splitBySource(fresh)
    const chosen = heuristicPicks(mixHeroPool(own, discovery), metaOf, PICK_COUNT, nowSec, profile)

    picks[key] = chosen.map((p) => ({
      appid: p.appid,
      name: p.name,
      badge: SOURCE_BADGE[p.source],
      tags: topTags(p.appid, metaOf),
      headerImage: metaOf(p.appid)?.headerImage ?? null,
      art: metaOf(p.appid)?.art ?? null,
    }))
  }

  const wall: LandingWallGame[] = library.map((g) => ({
    appid: g.appid,
    name: metaOf(g.appid)?.name ?? `Игра ${g.appid}`,
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
      name: metaOf(g.appid)?.name ?? `Игра ${g.appid}`,
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
