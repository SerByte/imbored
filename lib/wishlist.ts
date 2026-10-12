import { after } from 'next/server'
import type { GameArtUrls } from './art'
import { DEFAULT_WAIT_MS } from './deals'
import { saveWishlist, type Db, type WishlistRow } from './db'
import { discountView, type Discount } from './discount'
import { logSwallowed } from './errlog'
import { fetchWishlist } from './steam'
import type { GameMeta } from './types'

/**
 * Полка «Из желаемого подешевело» на /library.
 *
 * Главный повод вернуться в сезон распродаж — «то, что я сам хотел, стало
 * дешевле». Список желаемого человек составил сам, и полка говорит только о
 * нём: что из него сейчас продаётся со скидкой. Не больше.
 *
 * ФАКТ, А НЕ ДАВЛЕНИЕ. Обратного отсчёта нет ни у кого — не только у тех, кому
 * его прячет hideUrgencyFor (lib/recommend): срок распродажи — это «успей
 * купить», а полка сообщает, что цена ниже, и всё. Порядок — приоритеты
 * самого человека в Steam, а не размер скидки: сортировка по проценту
 * превратила бы полку в витрину. Пушей и писем нет.
 *
 * Логика здесь, а не в компоненте полки, по той же причине, что у
 * runPageSlice: vitest собирает только lib/.
 */

/**
 * Сколько живёт прочитанный список. Полсуток: список желаемого меняется
 * редко, а поход в Steam на каждый заход /library — это и лимит общих IP
 * Vercel, и секунды до полки.
 */
export const WISHLIST_MAX_AGE_SEC = 12 * 3600

/** Плиток на полке — два ряда по шесть, как у соседних полок библиотеки */
export const WISHLIST_SHELF = 12

/** Пора ли перечитать список: не читали или прочитали давно */
export function wishlistStale(row: WishlistRow | null, nowSec: number): boolean {
  return row === null || nowSec - row.takenAt >= WISHLIST_MAX_AGE_SEC
}

export type WishlistDeal = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
  /** регион цены (lib/steamregion) — её валюта */
  priceCc: string
  discount: Discount
}

/**
 * Что из списка сейчас со скидкой — в порядке списка, не больше WISHLIST_SHELF.
 *
 * Только настоящие скидки: discountView с правилами доверия discountOf (срок от
 * Steam или замер моложе PRICE_TRUST_SEC), по цене своего региона — чужую
 * rowToMeta не отдаёт, и её скидки для полки просто нет. Без срока: urgency
 * false, см. докблок модуля.
 *
 * Мимо полки: своё (купил — разговор окончен), бесплатное (скидки не бывает)
 * и «не продаётся в российском Steam» (скидка есть только там, где продают).
 */
export function wishlistDeals(args: {
  appids: readonly number[]
  metaOf: (appid: number) => GameMeta | undefined
  owned: ReadonlySet<number>
  now: number
}): WishlistDeal[] {
  const out: WishlistDeal[] = []
  for (const appid of args.appids) {
    if (args.owned.has(appid)) continue
    const meta = args.metaOf(appid)
    if (!meta || meta.isFree || meta.storeHidden || !meta.priceCc) continue
    const discount = discountView(meta, args.now, { urgency: false })
    if (!discount) continue
    out.push({
      appid,
      name: meta.name,
      headerImage: meta.headerImage ?? null,
      art: meta.art ?? null,
      priceCc: meta.priceCc,
      discount,
    })
    if (out.length >= WISHLIST_SHELF) break
  }
  return out
}

/** Пауза после сбоя: столько не ходим за списками вовсе — как у цен (lib/deals) */
export const WISHLIST_COOLDOWN_MS = 60_000
let cooldownUntil = 0

/** Сброс паузы. Нужен тестам — в проде её ждут. */
export function clearWishlistCooldown(): void {
  cooldownUntil = 0
}

/**
 * Перечитать список из Steam и записать — закрытый тоже (saveWishlist).
 * Возвращает записанное; null — Steam не ответил или база не приняла.
 *
 * Сбой глотается: полки просто не будет до следующего захода. И выдерживается
 * пауза на процесс — без неё отказ Steam (лимит общих IP Vercel) повторялся бы
 * с частотой заходов на /library.
 */
export async function refreshWishlist(
  db: Db,
  steamid: string,
  nowSec: number,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<WishlistRow | null> {
  if (Date.now() < cooldownUntil) return null
  try {
    const list = await fetchWishlist(steamid, opts)
    await saveWishlist(db, steamid, list, nowSec)
    return list === 'closed'
      ? { takenAt: nowSec, closed: true, appids: [] }
      : { takenAt: nowSec, closed: false, appids: list }
  } catch (err) {
    // Без steamid: журнал хостинга — не место для идентификаторов людей
    logSwallowed('wishlist:refresh', err)
    cooldownUntil = Date.now() + WISHLIST_COOLDOWN_MS
    return null
  }
}

/**
 * То же с потолком ожидания — устроено как refreshDealsWithin (lib/deals).
 *
 * Не успел Steam к сроку — эта страница обойдётся прежним списком (или без
 * полки), а ответ доедет в after() и запишется: следующий заход будет со
 * свежим. Ждать дольше нельзя — полка стоит ниже всего, ради чего открывают
 * библиотеку.
 */
export async function refreshWishlistWithin(
  db: Db,
  steamid: string,
  nowSec: number,
  waitMs = DEFAULT_WAIT_MS,
  opts: Parameters<typeof refreshWishlist>[3] = {},
): Promise<WishlistRow | null> {
  const work = refreshWishlist(db, steamid, nowSec, opts)
  try {
    after(work)
  } catch {
    // вне контекста запроса (скрипт, тест) after недоступен — не беда
  }
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
  ])
}
