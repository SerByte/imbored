import { classifyLibraryGame } from './recommend'
import type { GameMeta, LibraryGame } from './types'

/** «Цена бэклога»: сколько денег лежит в несыгранных играх (по известным ценам) */
export function backlogValue(
  library: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
  nowSec: number,
): { cents: number; pricedCount: number; unplayedCount: number } {
  let cents = 0
  let pricedCount = 0
  let unplayedCount = 0
  for (const g of library) {
    if (classifyLibraryGame(g, nowSec) !== 'unplayed') continue
    unplayedCount++
    const price = metaOf(g.appid)?.priceFinal
    if (price !== undefined && price > 0) {
      cents += price
      pricedCount++
    }
  }
  return { cents, pricedCount, unplayedCount }
}
