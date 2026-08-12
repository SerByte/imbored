import { buildTagProfile, cosine } from './recommend'
import type { GameMeta, LibraryGame } from './types'

export type Compatibility = {
  /** 0–100, косинус тег-профилей */
  percent: number
  commonGames: Array<{ appid: number; name: string; hoursA: number; hoursB: number }>
  sharedTags: string[]
}

/** Совместимость двух игроков по реальным библиотекам и наигранному времени */
export function compatibility(
  libA: LibraryGame[],
  libB: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
): Compatibility {
  const profileA = buildTagProfile(libA, metaOf)
  const profileB = buildTagProfile(libB, metaOf)
  const percent = Math.round(cosine(profileA, profileB) * 100)

  const byAppidB = new Map(libB.map((g) => [g.appid, g]))
  const commonGames = libA
    .filter((g) => byAppidB.has(g.appid))
    .map((g) => {
      const other = byAppidB.get(g.appid)!
      return {
        appid: g.appid,
        name: g.name,
        hoursA: Math.round(g.playtimeForever / 60),
        hoursB: Math.round(other.playtimeForever / 60),
      }
    })
    .sort((a, b) => b.hoursA + b.hoursB - (a.hoursA + a.hoursB))
    .slice(0, 10)

  const sharedTags = Object.keys(profileA)
    .filter((tag) => (profileB[tag] ?? 0) > 0 && profileA[tag] > 0)
    .sort((a, b) => Math.min(profileB[b], profileA[b] ?? 0) - Math.min(profileB[a], profileA[a] ?? 0))
    .slice(0, 6)

  return { percent, commonGames, sharedTags }
}
