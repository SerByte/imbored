import { after, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron'
import { countPageEnrichDue, getCatalogMeta, setCatalogMeta } from '@/lib/db'
import { PAGE_MAX_AGE_SEC, runPageSlice } from '@/lib/pagejob'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'
/** Потолок Hobby. */
export const maxDuration = 60

/** Сколько звеньев цепочки максимум. 24 × 20 карточек = 480 в сутки. */
const MAX_CHAIN = 24
const SLICE_BUDGET_MS = 50_000
const LAST_KEY = 'pages_last_slice'

/**
 * Обогащение карточек игр: скриншоты, вердикт отзывов, pros/cons.
 *
 * Устроено ровно как /api/cron/news и по той же причине: 202 сразу, работа в
 * after(), пропускная способность берётся из цепочки вызовов, а не из частоты
 * расписания (на Hobby крон ходит примерно раз в сутки, что бы ни стояло в
 * vercel.json).
 *
 * Существует этот роут потому, что раньше всю эту работу делала страница
 * /game/[appid] прямо на рендере — публичная, без кэша и без ограничений.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const url = new URL(req.url)
  const chain = Number(url.searchParams.get('chain') ?? 0)
  const db = await getDb()

  // килл-свитч без редеплоя — тот же приём, что у новостей
  if ((await getCatalogMeta(db, 'pages_paused')) === '1') {
    return NextResponse.json({ paused: true })
  }

  after(async () => {
    let result: Awaited<ReturnType<typeof runPageSlice>> | null = null
    try {
      result = await runPageSlice(db, { deadlineAt: Date.now() + SLICE_BUDGET_MS })
    } catch (err) {
      console.error('page slice', err)
    } finally {
      // Звено цепочки — в finally и ПОСЛЕ работы, ровно по тем же причинам,
      // что расписаны в /api/cron/news: исключение не должно убивать сутки,
      // а параллельные инвокации сломали бы общий лимитер темпа Steam.
      await setCatalogMeta(db, LAST_KEY, JSON.stringify({ at: nowSec(), chain, ...result }))
      const secret = process.env.CRON_SECRET
      if (result?.hasMore && result.stopped !== 'blocked' && chain < MAX_CHAIN && secret) {
        await fetch(`${appBaseUrl()}/api/cron/pages?chain=${chain + 1}`, {
          headers: { 'x-cron-secret': secret },
        }).catch(() => {})
      }
    }
  })

  return NextResponse.json(
    { started: true, chain, due: await countPageEnrichDue(db, nowSec() - PAGE_MAX_AGE_SEC) },
    { status: 202 },
  )
}
