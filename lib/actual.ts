import { collapseEditions } from './editions'
import { filterPlayable, playMode, type PlayContext } from './liveness'
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
      // Вердикт офлайн-курации, если он доехал: раньше здесь стояло true
      // безусловно, потому что rowToMeta терял колонку alive при чтении, и
      // buildSeriesIndex всегда объявлял канонической первую игру серии.
      alive: meta.alive ?? true,
      soloCapable: playMode(meta.categories) === 'solo-capable',
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

  const fresh = candidates.filter((c) => {
    if (superseded.has(c.appid)) return false
    // Вердикт офлайн-курации, если он есть. Индекс выше строится по тому, что
    // лежит в metas, поэтому вытеснение находится, только когда преемник тоже
    // рядом. У Condition Zero преемник — бесплатная CS2, но «бесплатная» не
    // значит «есть в аккаунте»: без этой проверки она возвращалась в выдачу
    // ровно тем, кто CS2 не покупал. rowToMeta отдаёт supersededBy только при
    // непустом signals_at, так что здесь именно посчитанный вердикт, а не
    // умолчание пустой колонки.
    return metas.get(c.appid)?.supersededBy === undefined
  })
  // Два издания одной игры — одна карточка. Вытеснение серий этого не ловит:
  // buildSeriesIndex пропускает всё немультиплеерное, а Hellblade и её же
  // «VR Edition» — одиночные. Без этого шага «Игра дня» могла поставить героем
  // базовую игру, а в полку находок — её же Definitive Edition.
  //
  // Схлопываем КАНДИДАТОВ, а не metas.values(): колода пати кладёт в metas весь
  // пул из полутора сотен игр, не ограничивая его кандидатами, и каталожная
  // игра, которой ни у кого нет, возглавила бы группу и вытеснила карточку,
  // которой партия владеет.
  //
  // Побеждает первый: вход уже отранжирован, и порядок знает больше, чем строка
  // названия. Кандидат без меты даёт пустой ключ и остаётся всегда.
  const unique = collapseEditions(
    fresh.length ? fresh : candidates,
    (c) => metas.get(c.appid)?.name ?? '',
    () => 1,
  )
  const playable = filterPlayable(unique, (id) => metas.get(id), context)
  // Откат — к схлопнутому списку, а не к исходному: «фильтр, который всё
  // выкинул, — не фильтр», но возвращать дубликаты обратно тоже нельзя
  return playable.length ? playable : unique
}
