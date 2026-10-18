import { archetypeKey, archetypeLabel, isKnownArchetype } from './archetypes'
import { looksLikeNonGame } from './junk'
import { playtimeHidden } from './playtime'
import { buildTagProfile, isUnplayed } from './recommend'
import type { GameMeta, LibraryGame } from './types'

export type Archetype = {
  /** первый тег архетипа в профиле — по нему подбираются улики (archetypeEvidence) */
  tag: string
  /**
   * Язык-нейтральный ключ архетипа — канонический тег (lib/archetypes): по
   * нему схлопнуты синонимы, по нему же подпись на любом языке —
   * archetypeLabel(key, locale)
   */
  key: string
  /** русская подпись, archetypeLabel(key, 'ru'); на другом языке — archetypeLabel(key, locale) */
  label: string
  /** доля внутри показанной четвёрки — на ней держатся тексты («ты на 37% стрелок») */
  percent: number
  /**
   * То же самое, но нормированное к лидеру: топ-1 всегда 100%.
   * Для полосок — при нормировке к сумме лидер получал куцые 37% ширины,
   * и шкала выглядела произвольной. В текст это значение брать нельзя.
   */
  barPercent: number
  /** есть ли человеческая подпись в словаре; фолбэк «фанат Fantasy» нельзя выносить в заголовок */
  known: boolean
}

export type Portrait = {
  archetypes: Archetype[]
  facts: {
    gamesCount: number
    totalHours: number
    unplayedCount: number
    topGame: { appid: number; name: string; hours: number; sharePercent: number } | null
    /**
     * Время скрыто настройками Steam (lib/playtime.ts). Часы тогда нулевые, а
     * незапущенных — ноль не потому, что всё сыграно, а потому, что сказать
     * нельзя: текст портрета и шеринговая карточка о часах молчат.
     */
    playtimeHidden: boolean
  }
}

/** Слишком общие теги — портрет из них скучный */
const STOP_TAGS = new Set([
  'Indie',
  'Singleplayer',
  'Single-player',
  'Multiplayer',
  'Multi-player',
  'Great Soundtrack',
  'Atmospheric',
  'Pixel Graphics',
  '2D',
  '3D',
  'Early Access',
  'Free to Play',
  'Action',
  'Adventure',
  'Casual',
])

// Словарь подписей и синонимов — в lib/archetypes: его берут и запасной
// текст портрета, и промпт модели, а этот модуль тянет движок подбора
export { archetypeKey, archetypeLabel, isKnownArchetype } from './archetypes'

export function buildPortrait(
  library: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
): Portrait {
  const profile = buildTagProfile(library, metaOf)

  // Синонимы (FPS и Shooter → «стрелок») схлопываем в один архетип — по
  // ключу, а не по подписи: подписи на двух языках разные, а четвёрка,
  // проценты и заголовок обязаны быть одни (см. lib/archetypes)
  const byKey = new Map<string, { tag: string; weight: number }>()
  for (const [tag, weight] of Object.entries(profile)) {
    if (STOP_TAGS.has(tag)) continue
    const key = archetypeKey(tag)
    const prev = byKey.get(key)
    if (prev) prev.weight += weight
    else byKey.set(key, { tag, weight })
  }

  const top = [...byKey.entries()].sort((a, b) => b[1].weight - a[1].weight).slice(0, 4)
  const weightSum = top.reduce((s, [, v]) => s + v.weight, 0)
  const maxWeight = top[0]?.[1].weight ?? 0
  const archetypes: Archetype[] = weightSum
    ? top.map(([key, v]) => ({
        tag: v.tag,
        key,
        label: archetypeLabel(key, 'ru'),
        percent: Math.round((v.weight / weightSum) * 100),
        barPercent: Math.round((v.weight / maxWeight) * 100),
        known: isKnownArchetype(key),
      }))
    : []

  const totalMinutes = library.reduce((s, g) => s + g.playtimeForever, 0)
  const totalHours = Math.round(totalMinutes / 60)
  const hidden = playtimeHidden(library)
  // Та же граница, что у buildWrapped и backlogValue: саундтрек не бэклог.
  // При скрытом времени «так и не запущена» выглядит вся библиотека — не считаем
  const unplayedCount = hidden
    ? 0
    : library.filter((g) => isUnplayed(g) && !looksLikeNonGame(g, metaOf(g.appid))).length
  const topLib = [...library].sort((a, b) => b.playtimeForever - a.playtimeForever)[0]
  // Доля — из минут, как в buildWrapped: делитель из округлённых часов у
  // маленькой библиотеки (85 мин → «1 ч») давал «142% всего времени» на
  // карточке и в тексте портрета, пока полоса «Куда ушло время» той же
  // страницы честно показывала 100%. Порог totalHours > 0 оставлен: меньше
  // получаса на всю библиотеку — топ-игры нет, а не «0 ч (100%)».
  const topGame =
    topLib && topLib.playtimeForever > 0 && totalHours > 0
      ? {
          appid: topLib.appid,
          name: topLib.name,
          hours: Math.round(topLib.playtimeForever / 60),
          sharePercent: Math.round((topLib.playtimeForever / totalMinutes) * 100),
        }
      : null

  return {
    archetypes,
    facts: { gamesCount: library.length, totalHours, unplayedCount, topGame, playtimeHidden: hidden },
  }
}
