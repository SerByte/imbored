import { filterPlayable, type PlayContext } from './liveness'
import { buildSeriesIndex, type SeriesMember } from './series'
import type { GameMeta } from './types'

/**
 * Актуальность для игр ИЗ БИБЛИОТЕКИ.
 *
 * У каталога допустимость решается офлайн, при наполнении: там считаются
 * `alive` и `superseded_by`. Но библиотека у каждого своя и через тот проход
 * не идёт — из-за чего «Игра дня» предлагала Half-Life 2: Deathmatch с 99
 * игроками, а пати выкидывало Counter-Strike: Condition Zero при живой CS2.
 *
 * Здесь то же самое считается на лету. Это дёшево: библиотека — это десятки
 * или сотни игр, а обе проверки — чистые функции без обращений к сети.
 */

/** Отсеивает мёртвое и устаревшие версии, сохраняя порядок ранжирования. */
export function filterActual<T extends { appid: number }>(
  candidates: T[],
  metas: Map<number, GameMeta>,
  context: PlayContext = 'solo',
): T[] {
  const members: SeriesMember[] = []
  for (const meta of metas.values()) {
    members.push({
      appid: meta.appid,
      name: meta.name,
      isMultiplayer: meta.categories.some((c) => [1, 9, 24, 36, 38, 39, 49].includes(c)),
      alive: true,
      // онлайн точнее показывает, переехала ли аудитория; отзывы — запасной сигнал
      ...((meta.ccu ?? meta.reviews30d) !== undefined
        ? { audience: meta.ccu ?? meta.reviews30d }
        : {}),
      ...(meta.releaseYear !== undefined ? { releaseYear: meta.releaseYear } : {}),
      ...(meta.developer ? { developer: meta.developer } : {}),
      ...(meta.publisher ? { publisher: meta.publisher } : {}),
    })
  }
  const superseded = buildSeriesIndex(members)

  const fresh = candidates.filter((c) => !superseded.has(c.appid))
  const playable = filterPlayable(fresh.length ? fresh : candidates, (id) => metas.get(id), context)
  return playable.length ? playable : candidates
}
