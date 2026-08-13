import { buildTagProfile, isUnplayed } from './recommend'
import type { GameMeta, LibraryGame } from './types'

export type Archetype = {
  tag: string
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

const ARCHETYPE_LABELS: Record<string, string> = {
  Automation: 'строитель фабрик',
  'Base Building': 'строитель баз',
  Roguelike: 'рогалик-энтузиаст',
  Roguelite: 'рогалик-энтузиаст',
  'Action Roguelike': 'рогалик-энтузиаст',
  'Story Rich': 'охотник за историями',
  MOBA: 'ветеран MOBA',
  FPS: 'стрелок',
  Shooter: 'стрелок',
  'Tactical FPS': 'тактический стрелок',
  Competitive: 'соревновательный зверь',
  'Open World': 'исследователь открытых миров',
  Survival: 'выживальщик',
  'Farming Sim': 'мирный фермер',
  Strategy: 'стратег',
  Tactical: 'тактик',
  RPG: 'ролевик',
  'Action RPG': 'ролевик',
  'Co-op': 'кооп-игрок',
  'Online Co-Op': 'кооп-игрок',
  Puzzle: 'головоломщик',
  Sandbox: 'архитектор песочниц',
  Metroidvania: 'картограф метроидваний',
  'Souls-like': 'терпеливый соулслайкер',
  'Card Game': 'мастер колоды',
  'Deck Building': 'мастер колоды',
  Difficult: 'любитель боли',
  Simulation: 'симуляторщик',
  'Colony Sim': 'управляющий колонией',
  Horror: 'любитель ужасов',
  Platformer: 'платформер-про',
  Crafting: 'крафтер',
  Exploration: 'исследователь',
  MMORPG: 'житель MMO',
  'Battle Royale': 'боец королевских битв',
  Mining: 'шахтёр',
  'Turn-Based': 'пошаговый мыслитель',
}

export function buildPortrait(
  library: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
): Portrait {
  const profile = buildTagProfile(library, metaOf)

  // синонимы (FPS и Shooter → «стрелок») схлопываем в один архетип
  const byLabel = new Map<string, { tag: string; weight: number; known: boolean }>()
  for (const [tag, weight] of Object.entries(profile)) {
    if (STOP_TAGS.has(tag)) continue
    const known = tag in ARCHETYPE_LABELS
    const label = ARCHETYPE_LABELS[tag] ?? `фанат ${tag}`
    const prev = byLabel.get(label)
    if (prev) prev.weight += weight
    else byLabel.set(label, { tag, weight, known })
  }

  const top = [...byLabel.entries()].sort((a, b) => b[1].weight - a[1].weight).slice(0, 4)
  const weightSum = top.reduce((s, [, v]) => s + v.weight, 0)
  const maxWeight = top[0]?.[1].weight ?? 0
  const archetypes: Archetype[] = weightSum
    ? top.map(([label, v]) => ({
        tag: v.tag,
        label,
        percent: Math.round((v.weight / weightSum) * 100),
        barPercent: Math.round((v.weight / maxWeight) * 100),
        known: v.known,
      }))
    : []

  const totalHours = Math.round(library.reduce((s, g) => s + g.playtimeForever, 0) / 60)
  const unplayedCount = library.filter(isUnplayed).length
  const topLib = [...library].sort((a, b) => b.playtimeForever - a.playtimeForever)[0]
  const topGame =
    topLib && topLib.playtimeForever > 0 && totalHours > 0
      ? {
          appid: topLib.appid,
          name: topLib.name,
          hours: Math.round(topLib.playtimeForever / 60),
          sharePercent: Math.round((topLib.playtimeForever / 60 / totalHours) * 100),
        }
      : null

  return {
    archetypes,
    facts: { gamesCount: library.length, totalHours, unplayedCount, topGame },
  }
}
