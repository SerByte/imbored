import Link from 'next/link'
import { GameCardBody } from '@/components/GameCard'
import { Icon } from '@/components/Icon'
import { Eyebrow } from '@/components/Labels'
import { DiscountCorner, PriceTag } from '@/components/PriceTag'
import { trimArt } from '@/lib/art'
import { PRICE_MAX_AGE_SEC, refreshDealsWithin } from '@/lib/deals'
import { getGamesMetaLite, type WishlistRow } from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { getDb } from '@/lib/server'
import { byPrices } from '@/lib/steamregion'
import {
  refreshWishlistWithin,
  wishlistDeals,
  wishlistStale,
  type WishlistDeal,
} from '@/lib/wishlist'

type ShelfProps = {
  steamid: string
  row: WishlistRow | null
  owned: ReadonlySet<number>
  now: number
}

/**
 * «Из желаемого подешевело» — что из списка желаемого Steam сейчас со скидкой.
 *
 * Серверный островок под Suspense: страница не ждёт Steam, а полка догоняет
 * её потоком. Здесь, а не на /play: у /play первый экран — одно решение и не
 * больше двух покупок в выдаче (MAX_NEW_PICKS), а библиотека — место, где уже
 * лежит «чего хочется», и валюту с подписью региона здесь решает сервер без
 * пересылки через клиентские ответы и их кэш. Правила полки — lib/wishlist.
 *
 * Зовёт её страница только для isWriter не из демо (app/library/page.tsx):
 * список — личное, а у демо его нет. row — прочитанное страницей заранее, в
 * общем Promise.all; сюда steamid приходит уже проверенным.
 *
 * Чего нет намеренно: DiscountEnds и любого срока. Полка сообщает факт, а не
 * «успей» — см. докблок lib/wishlist. Сторож — lib/wishlist.test.ts.
 */
export async function WishlistShelf(props: ShelfProps) {
  let deals: WishlistDeal[]
  try {
    deals = await shelfDeals(props)
  } catch (err) {
    // Полка — необязательная, и сбой Steam lib/wishlist глотает сам. Но
    // база и замер цен бросают мимо него, а островок стоит под Suspense уже
    // после того, как оболочка /library ушла потоком: исключение отсюда
    // дошло бы до границы ошибки и сломало всю страницу из-за второстепенной
    // полки. Здесь сбой любой природы значит одно — полки нет
    logSwallowed('wishlist:shelf', err)
    return null
  }
  if (!deals.length) return null
  const { steamid } = props
  const cc = deals[0].priceCc

  return (
    <section aria-labelledby="shelf-wishlist" className="mb-12">
      <Eyebrow className="mb-2">Список желаемого</Eyebrow>
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 id="shelf-wishlist" className="font-display text-display-sm">
          Из желаемого подешевело
        </h2>
        <a
          href={`https://store.steampowered.com/wishlist/profiles/${steamid}/`}
          target="_blank"
          rel="noreferrer"
          className="tap link-more shrink-0"
        >
          Весь список — в Steam <Icon name="arrow" size={14} />
        </a>
      </div>
      <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">
        Игры из твоего списка желаемого, на которые сейчас скидка, — {byPrices(cc)}.
      </p>
      {/* Та же лестница колонок, что у «Запечатанного», с шестью на широком:
          двенадцать плиток — два ряда */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-6">
        {deals.map((d) => (
          <Link key={d.appid} href={`/game/${d.appid}`} prefetch={false} className="game-card block">
            <GameCardBody
              appid={d.appid}
              name={d.name}
              headerImage={d.headerImage}
              art={trimArt(d.art)}
              sizes="(min-width: 1024px) 16vw, (min-width: 640px) 33vw, 50vw"
              // Процент — уголком на обложке, как у всех плиток со скидкой:
              // в строке под названием ему места нет рядом с двумя ценами
              corner={<DiscountCorner discount={d.discount} />}
              meta={
                <PriceTag
                  priceFinal={d.discount.finalCents}
                  cc={d.priceCc}
                  discount={d.discount}
                  isFree={false}
                  showPercent={false}
                  className="shrink-0"
                />
              }
            />
          </Link>
        ))}
      </div>
    </section>
  )
}

/** Данные полки: список, мета и цены; пусто — полки нет */
async function shelfDeals({ steamid, row, owned, now }: ShelfProps): Promise<WishlistDeal[]> {
  const db = await getDb()
  // Протух или не читали — перечитать; не успел Steam — обойдёмся прежним
  const list = wishlistStale(row, now) ? ((await refreshWishlistWithin(db, steamid, now)) ?? row) : row
  if (!list || list.closed || !list.appids.length) return []

  // Только игры, что уже есть в каталоге (games): мету остальным не догреваем,
  // чтобы список желаемого не просачивался в пул кандидатов
  let metas = await getGamesMetaLite(db, list.appids)
  // Цены — только протухшим, и только тем, кому полка может их показать. Чужой
  // регион rowToMeta прячет вместе с отметкой замера, и такая цена тоже здесь
  const stale = list.appids.filter((id) => {
    const meta = metas.get(id)
    return (
      meta !== undefined &&
      !owned.has(id) &&
      !meta.isFree &&
      (meta.priceAt === undefined || now - meta.priceAt > PRICE_MAX_AGE_SEC)
    )
  })
  if (stale.length && (await refreshDealsWithin(db, stale, now))) {
    const fresh = await getGamesMetaLite(db, stale)
    metas = new Map([...metas, ...fresh])
  }

  return wishlistDeals({ appids: list.appids, metaOf: (id) => metas.get(id), owned, now })
}
