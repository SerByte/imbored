import { editionKey } from './editions'
import { buildTagProfile, cosine, isMultiplayerMeta, normalizedTags } from './recommend'
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
  headerImage?: string
  tags: string[]
  store?: string
  storeUrl?: string
}

/**
 * Колода для свайп-матча пати: сначала общие мультиплеерные игры,
 * затем кандидаты «не у всех» с пометкой, кому не хватает, и ценой.
 * Скоринг — близость к суммарному вкусу всех участников.
 */
export function buildGroupDeck(args: {
  members: GroupMember[]
  metaOf: (appid: number) => GameMeta | undefined
  extraPool: GameMeta[]
  limit: number
}): GroupCard[] {
  const { members, metaOf, extraPool, limit } = args
  if (!members.length) return []

  // суммарный вкус пати
  const combined: Record<string, number> = {}
  for (const m of members) {
    for (const [tag, w] of Object.entries(buildTagProfile(m.library, metaOf))) {
      combined[tag] = (combined[tag] ?? 0) + w
    }
  }

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
      score: cosine(combined, normalizedTags(meta)),
      ...(meta.priceFinal !== undefined ? { priceFinal: meta.priceFinal } : {}),
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
