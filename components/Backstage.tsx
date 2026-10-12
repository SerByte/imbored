'use client'

import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { SessionKeeper } from '@/components/SessionKeeper'

/**
 * ЗАКУЛИСЬЕ: то, что работает на каждой странице и не рисует ничего.
 *
 * Продление входа (SessionKeeper), просмотры (Vercel Web Analytics) и полевые
 * Web Vitals (Speed Insights). Стояли прямо в корневом лэйауте, то есть в
 * первой загрузке каждой страницы, — и это 9 с лишним КБ к первому кадру,
 * которому ни одно из них не нужно. Теперь едут одним чанком в простое
 * после гидратации: components/BackstageLazy, там же — чем за это платим.
 *
 * Обёртки аналитики — те же next-овские, что стояли в лэйауте: маршрут они
 * по-прежнему считают сами (useParams, usePathname), и группировка
 * просмотров по /game/[appid] не меняется.
 *
 * Полевые Web Vitals нужны именно полевые: на сайте, где LCP — это всегда
 * чужая обложка со steamstatic, синтетика меряет не то — реальный разброс
 * дают чужой CDN и чужая сеть, а не наш рендер.
 */
export function Backstage() {
  return (
    <>
      <SessionKeeper />
      <Analytics />
      <SpeedInsights />
    </>
  )
}
