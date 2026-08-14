import { after } from 'next/server'
import { STORE_ITEMS_BATCH, callStoreItems, parsePurchaseOption, type PurchaseOption } from './catalog'
import { stalePriceAppids, updateGamePrices, type Db, type PriceQuote } from './db'

/**
 * Свежие цены и скидки.
 *
 * Зачем отдельный проход, если цена и так приезжает с метаданными: у
 * метаданных TTL четырнадцать суток (META_MAX_AGE_SEC), у распродажи Steam —
 * несколько дней. По TTL метаданных скидка успевала бы протухнуть трижды, а
 * карточка всё ещё обещала бы «−70%».
 *
 * Запрос тот же GetItems, но с пустым data_request: блок покупки приходит без
 * единого include-флага (проверено на живом ответе), поэтому обновление цен
 * стоит на порядок дешевле полного прогрева и берёт те же 200 игр за вызов.
 */

/** Сколько замер цены считается свежим для планирования следующего */
export const PRICE_MAX_AGE_SEC = 12 * 3600

type PricesResponse = {
  response?: { store_items?: Array<{ appid?: number; id?: number; best_purchase_option?: PurchaseOption }> }
}

/** Чистый разбор ответа — appid -> цена со скидкой */
export function parseStorePrices(json: unknown): Map<number, PriceQuote> {
  const items = (json as PricesResponse)?.response?.store_items
  const out = new Map<number, PriceQuote>()
  if (!Array.isArray(items)) return out
  for (const it of items) {
    const appid = it.appid ?? it.id
    if (!appid) continue
    out.set(appid, { appid, ...parsePurchaseOption(it.best_purchase_option) })
  }
  return out
}

/**
 * Цены пачки игр. Возвращает запись на КАЖДЫЙ запрошенный appid, даже если
 * Steam о нём промолчал: пустая котировка — тоже ответ («цены нет»), и без неё
 * снятая с продажи игра попадала бы в очередь замера на каждом заходе.
 */
export async function fetchStorePrices(
  appids: number[],
  opts: { fetchFn?: typeof fetch } = {},
): Promise<PriceQuote[]> {
  const positive = [...new Set(appids.filter((id) => id > 0))]
  if (!positive.length) return []
  const { fetchFn = fetch } = opts

  const out: PriceQuote[] = []
  for (let i = 0; i < positive.length; i += STORE_ITEMS_BATCH) {
    const chunk = positive.slice(i, i + STORE_ITEMS_BATCH)
    // Ответ без ассетов и тегов на порядок легче полного, поэтому и потолок
    // ожидания скромнее: на двух сотнях игр это 12 секунд вместо сорока.
    // Сорок здесь были бы не терпением, а способом упереться в лимит времени
    // самой функции — и не записать вообще ничего.
    const byAppid = parseStorePrices(await callStoreItems(chunk, {}, fetchFn, PRICE_MS_PER_APP))
    for (const appid of chunk) out.push(byAppid.get(appid) ?? { appid })
  }
  return out
}

const PRICE_MS_PER_APP = 60

/**
 * Перезамеряет цены тем играм из списка, у кого замер протух, и пишет их в базу.
 *
 * Возвращает число обновлённых записей. Сетевую осечку глотает, как ensureMeta:
 * подбор игр не должен падать из-за того, что Steam не отдал цену — на карточке
 * просто останется прошлая, а скидка погаснет сама по сроку годности
 * (см. discountOf в lib/discount).
 */
export const DEFAULT_WAIT_MS = 2500

/**
 * То же самое, но с потолком ожидания — для страниц, где замер цены стоит
 * шагом перед выдачей.
 *
 * Запрос не отменяется, а доверяется after(): не успел к сроку — эта выдача
 * покажет прошлую цену, но ответ Steam всё равно доедет и запишется, и
 * следующая будет свежей. Без after() на serverless инвокация замерзает сразу
 * после ответа, запись теряется, отметка замера не двигается — и следующий
 * запрос идёт в Steam за тем же самым. Ждать же десять секунд ради ценника
 * нельзя: это экран «во что поиграть», а не витрина.
 */
export async function refreshDealsWithin(
  db: Db,
  appids: number[],
  nowSec: number,
  waitMs = DEFAULT_WAIT_MS,
  opts: Parameters<typeof refreshDeals>[3] = {},
): Promise<number> {
  const work = refreshDeals(db, appids, nowSec, opts)
  try {
    after(work)
  } catch {
    // вне контекста запроса (скрипт, тест) after недоступен — не беда
  }
  return Promise.race([
    work,
    new Promise<number>((resolve) => setTimeout(() => resolve(0), waitMs)),
  ])
}

export async function refreshDeals(
  db: Db,
  appids: number[],
  nowSec: number,
  opts: { maxFetch?: number; maxAgeSec?: number; fetchFn?: typeof fetch } = {},
): Promise<number> {
  const { maxFetch = STORE_ITEMS_BATCH, maxAgeSec = PRICE_MAX_AGE_SEC, fetchFn } = opts
  if (Date.now() < cooldownUntil) return 0
  const stale = await stalePriceAppids(db, appids, maxAgeSec, nowSec, maxFetch)
  if (!stale.length) return 0
  try {
    const quotes = await fetchStorePrices(stale, ...(fetchFn ? [{ fetchFn }] : []))
    await updateGamePrices(db, quotes, nowSec)
    return quotes.length
  } catch {
    // Осечка ничего не записывает, а значит те же игры останутся «протухшими»
    // и следующий заход пойдёт за ними снова. При обычном сбое это правильно,
    // при 429 — способ долбить Steam ровно с той же частотой, с какой к нам
    // ходят люди. Пауза общая на процесс: цена — не то, ради чего стоит
    // спорить с лимитом магазина.
    cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS
    return 0
  }
}

/** Пауза после сбоя: столько не ходим за ценами вовсе */
export const FAILURE_COOLDOWN_MS = 60_000
let cooldownUntil = 0

/** Сброс паузы. Нужен тестам и ручным прогонам — в проде её ждут. */
export function clearDealsCooldown(): void {
  cooldownUntil = 0
}
