import { editionKey } from './editions'
import { buildTagProfile, isMultiplayerMeta, normalizedTags } from './recommend'
import { weightedCosineTo, type TagWeight } from './tagweight'
import type { GameMeta, LibraryGame } from './types'

export type GroupMember = {
  steamid: string
  name: string
  library: LibraryGame[]
}

export type GroupCard = {
  appid: number
  name: string
  ownedByAll: boolean
  /** имена участников, у которых игры нет */
  missingFor: string[]
  score: number
  priceFinal?: number
  /**
   * Бесплатная игра. Цены у такой карточки нет вовсе, даже если в строке
   * каталога она лежит: у Counter-Strike 2 is_free = 1 и price_final = 1499 —
   * это Prime, а не игра (см. offersOf в lib/jsonld.ts).
   */
  isFree?: boolean
  headerImage?: string
  tags: string[]
  store?: string
  storeUrl?: string
}

/**
 * Колода для свайп-матча пати: сначала общие мультиплеерные игры,
 * затем кандидаты «не у всех» с пометкой, кому не хватает, и ценой.
 * Скоринг — близость к суммарному вкусу всех участников.
 *
 * banned — «Больше не показывать» хоть кого-то из участников (bannedAppidsOf).
 * Отсев до выбора изданий, а не после: иначе забаненное издание занимало бы
 * ключ, и живое второе издание той же игры в колоду уже не попадало бы.
 *
 * tagWeight — вес редкости, та же мера вкуса, что у /play (weightedCosineTo):
 * на сыром косинусе колода пати ранжировала по Multiplayer и Action, которые
 * есть у половины каталога. null — сырой косинус, до бита прежний.
 */
export function buildGroupDeck(args: {
  members: GroupMember[]
  metaOf: (appid: number) => GameMeta | undefined
  extraPool: GameMeta[]
  limit: number
  banned?: ReadonlySet<number>
  tagWeight?: TagWeight | null
}): GroupCard[] {
  const { members, metaOf, extraPool, limit, banned, tagWeight = null } = args
  if (!members.length) return []

  // суммарный вкус пати
  const combined: Record<string, number> = {}
  for (const m of members) {
    for (const [tag, w] of Object.entries(buildTagProfile(m.library, metaOf))) {
      combined[tag] = (combined[tag] ?? 0) + w
    }
  }
  // Сторона общего вкуса готовится один раз, а не на каждую карту
  const tasteOf = weightedCosineTo(combined, tagWeight)

  const owners = new Map<number, Set<string>>()
  for (const m of members) {
    for (const g of m.library) {
      let set = owners.get(g.appid)
      if (!set) {
        set = new Set()
        owners.set(g.appid, set)
      }
      set.add(m.steamid)
    }
  }

  const toCard = (meta: GameMeta): GroupCard => {
    const owning = owners.get(meta.appid) ?? new Set()
    const missingFor = members.filter((m) => !owning.has(m.steamid)).map((m) => m.name)
    const topTags = Object.entries(meta.tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([t]) => t)
    return {
      appid: meta.appid,
      name: meta.name,
      ownedByAll: missingFor.length === 0,
      missingFor,
      score: tasteOf(normalizedTags(meta)),
      // «Бесплатно» сильнее цены — тот же порядок, что у PriceTag и разметки.
      // Колода пати писала «Нет у: Дима · $15» у бесплатной CS2: у колоды своя
      // строка цены, и isFree до неё просто не доезжал.
      ...(meta.isFree
        ? { isFree: true }
        : meta.priceFinal !== undefined
          ? { priceFinal: meta.priceFinal }
          : {}),
      ...(meta.headerImage ? { headerImage: meta.headerImage } : {}),
      tags: topTags,
      ...(meta.store ? { store: meta.store } : {}),
      ...(meta.storeUrl ? { storeUrl: meta.storeUrl } : {}),
    }
  }

  const seen = new Set<number>()
  // Тот же запрет «не дважды», но на уровень выше appid: два издания одной игры
  // — это два appid, и колода из двадцати карт голосовала бы за одну игру
  // дважды, а матч срабатывал бы не на том издании. Порядок циклов ниже сам
  // решает, кто победит: общие игры разбираются раньше пула, поэтому карточка
  // из каталога не может вытеснить издание, которым партия владеет.
  const seenKeys = new Set<string>()
  const cards: GroupCard[] = []

  const take = (meta: GameMeta): boolean => {
    if (banned?.has(meta.appid)) return false
    const key = editionKey(meta.name)
    if (key && seenKeys.has(key)) return false
    seen.add(meta.appid)
    if (key) seenKeys.add(key)
    cards.push(toCard(meta))
    return true
  }

  // общие игры всех участников
  for (const [appid, owning] of owners) {
    if (owning.size !== members.length) continue
    const meta = metaOf(appid)
    if (!meta || !isMultiplayerMeta(meta)) continue
    take(meta)
  }

  // пул «не у всех»/«ни у кого»
  for (const meta of extraPool) {
    if (seen.has(meta.appid) || !isMultiplayerMeta(meta)) continue
    const owning = owners.get(meta.appid) ?? new Set()
    if (owning.size === members.length) continue // уже покрыто выше
    take(meta)
  }

  return cards
    .sort((a, b) => Number(b.ownedByAll) - Number(a.ownedByAll) || b.score - a.score)
    .slice(0, limit)
}
