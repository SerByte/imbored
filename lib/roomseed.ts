import { bannedAppidsOf, getGamesMetaLite, type Db } from './db'
import { judgeLiveness } from './liveness'
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
 *
 * Живость — дважды, и это не повтор. alive в строке каталога посчитан
 * офлайн-курацией в соло-контексте (promote-catalog зовёт judgeLiveness без
 * второго аргумента), а колода комнаты судит ту же игру в контексте пати
 * (filterActual(…, 'party')). Это разные вердикты: соло прощает всё, где
 * есть одиночный режим, а пати — нет. Сетевая игра с одиночной кампанией и
 * без коопа ([2, 1], [2, 1, 49, 36]) в соло жива при любом онлайне, а в
 * пати при ста игроках на весь мир — 'dead-multiplayer'. Игра без категорий,
 * но с тегом «Online Co-Op», проходит isMultiplayerMeta по тегам, а пати её
 * не берёт вовсе ('solo-only': колода судит по категориям). Без второй
 * проверки обе становились первой картой: приглашение звало «в X» с артом X,
 * колода закрепляла X — и filterActual снимал её, едва рядом оставалась
 * любая другая карта. Названную в приглашении игру не видел никто.
 *
 * Сигналы — те же пять полей, что колода отдаёт judgeLiveness (filterPlayable),
 * из той же строки каталога: мерка совпадает до поля, а не «похоже».
 * isMultiplayerMeta остаётся рядом, хотя пати-проверка его покрывает: это
 * отдельный шаг колоды (buildGroupDeck), и вычеркни его когда-нибудь из
 * judgeLiveness — кнопка не должна разойтись с колодой молча.
 */
export function seedable(meta: GameMeta): boolean {
  return (
    meta.appid > 0 &&
    isMultiplayerMeta(meta) &&
    meta.alive !== false &&
    meta.supersededBy === undefined &&
    judgeLiveness(
      {
        categories: meta.categories,
        ccu: meta.ccu,
        reviews30d: meta.reviews30d,
        reviewsTotal: meta.reviewsTotal,
        reviewsPercent: meta.reviewsPercent,
      },
      'party',
    ).alive
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
 *   • она жива для компании, а не только для одного — тем судом, которым
 *     колода пати её и снимет (judgeLiveness в контексте 'party', см.
 *     seedable): соло-вердикт каталога пропускает сетевую игру с пустыми
 *     серверами, если у неё есть одиночная кампания;
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
