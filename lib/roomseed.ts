import { bannedAppidsOf, getGamesMetaLite, type Db } from './db'
import { roomSeedOf } from './presets'
import { isMultiplayerMeta } from './recommend'
import type { GameMeta } from './types'

/**
 * Годится ли игра в первую карту комнаты — по одной её строке каталога.
 *
 * Отдельно от roomSeed ради кнопок: страница игры и /pick рисуют «Позвать в
 * эту игру» по той же мерке, по которой создание комнаты игру возьмёт, —
 * иначе кнопка звала бы в игру, которую комната молча отбросит. Почему каждое
 * условие — см. roomSeed ниже.
 */
export function seedable(meta: GameMeta): boolean {
  return (
    meta.appid > 0 &&
    isMultiplayerMeta(meta) &&
    meta.alive !== false &&
    meta.supersededBy === undefined
  )
}

/**
 * Игра, в которую зовут («Позвать в эту игру»), — проверенная, либо null.
 *
 * Одна проверка на два места: создание комнаты (/api/room/create) и строку
 * «Первой картой — …» на /room/new (/api/room/seed). Разойдись они — экран
 * обещал бы первую карту, которой в комнате не окажется.
 *
 * appid приходит из адреса — из чата, закладки, чужой ссылки, — поэтому
 * берётся, только если:
 *   • форма годная (roomSeedOf: положительное целое; число из JSON тоже
 *     прогоняется через неё строкой — дробь и экспонента не проскочат);
 *   • игра есть в каталоге — иначе карточке приглашения нечего назвать;
 *   • в неё играют вместе (isMultiplayerMeta) — та же мерка, что у колоды
 *     пати: одиночную колода не раздаст, и приглашение звало бы в карту,
 *     которой нет;
 *   • её не похоронила офлайн-курация: мёртвую и вытесненную преемником
 *     колода отсеет сама (filterActual), а звать в неё — то же враньё;
 *   • зовущий её не скрывал («Больше не показывать»). Бан хоть кого-то из
 *     участников сильнее закрепления (buildGroupDeck), и свой бан хоста убрал
 *     бы карту у всех — приглашение звало бы в игру, которой в колоде нет.
 *
 * Не прошло — null, без отказа: человек хотел пати, и комната создаётся как
 * обычно. Банов других участников здесь не видно — их ещё нет; если войдёт
 * тот, кто её скрыл, колода честно уберёт карту у всех.
 */
export async function roomSeed(db: Db, raw: unknown, steamid: string | null): Promise<GameMeta | null> {
  const appid = roomSeedOf(typeof raw === 'number' || typeof raw === 'string' ? String(raw) : null)
  if (appid === null) return null
  const [metas, banned] = await Promise.all([
    getGamesMetaLite(db, [appid]),
    steamid ? bannedAppidsOf(db, [steamid]) : Promise.resolve(new Set<number>()),
  ])
  const meta = metas.get(appid)
  return meta && seedable(meta) && !banned.has(appid) ? meta : null
}
