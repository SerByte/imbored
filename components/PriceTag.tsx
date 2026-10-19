'use client'

import { useLocale } from '@/components/LocaleProvider'
import {
  PriceTag as PriceTagView,
  PriceWhere as PriceWhereView,
  type PriceTagProps,
} from '@/components/PriceTagView'

/**
 * Ценник клиентских экранов — тонкая обёртка над components/PriceTagView.
 *
 * Сам ценник (порядок «не продаётся» → «бесплатно» → цена, валюта по
 * региону cc, скидка с сервера) живёт там, в универсальном модуле с языком
 * пропом: серверные страницы — карточка игры, /compat, полка желаемого —
 * рисуют его оттуда со своим toLocale(params.lang), и в их клиентский бандл
 * он не едет. Здесь — только язык: клиентский экран (/play, /daily, /explore,
 * колода, лента, матч пати) берёт его из контекста корневого layout
 * (useLocale), как и раньше, и вызовы у него прежние. Разметка та же до
 * байта — сторожит lib/pricetag.test.ts.
 *
 * Уголок и срок скидки языка не знают и отдаются как есть.
 */

export type { PriceTagProps }
export { DiscountCorner, DiscountEnds } from '@/components/PriceTagView'

export function PriceTag(props: PriceTagProps) {
  const locale = useLocale()
  return <PriceTagView {...props} locale={locale} />
}

export function PriceWhere(props: { cc: string | null | undefined; className?: string }) {
  const locale = useLocale()
  return <PriceWhereView {...props} locale={locale} />
}
