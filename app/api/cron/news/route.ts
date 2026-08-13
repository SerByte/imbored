import { after, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron'
import { countNewsPollDue, enrollNewsPoll, getCatalogMeta, setCatalogMeta, topCatalogAppids } from '@/lib/db'
import { runNewsSlice } from '@/lib/newsjob'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'
/** Потолок Hobby. На Pro можно поднять до 300 и опустить MAX_CHAIN. */
export const maxDuration = 60

/** Сколько звеньев цепочки максимум. 24 × 20 игр = 480 опросов в сутки. */
const MAX_CHAIN = 24
const SLICE_BUDGET_MS = 50_000
const ENROLL_KEY = 'news_enrolled_at'
const LAST_KEY = 'news_last_slice'

/**
 * Vercel Cron ходит именно GET.
 *
 * Отвечаем 202 СРАЗУ, а работаем в after(): на Hobby крон вызывается примерно
 * раз в сутки независимо от выражения в vercel.json, поэтому пропускная
 * способность берётся из цепочки вызовов, а не из частоты расписания.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const url = new URL(req.url)
  const chain = Number(url.searchParams.get('chain') ?? 0)
  const db = await getDb()

  // килл-свитч без редеплоя
  if ((await getCatalogMeta(db, 'news_paused')) === '1') {
    return NextResponse.json({ paused: true })
  }

  after(async () => {
    let result: Awaited<ReturnType<typeof runNewsSlice>> | null = null
    try {
      const now = nowSec()
      // раз в сутки пополняем очередь топом каталога
      const lastEnroll = Number((await getCatalogMeta(db, ENROLL_KEY)) ?? 0)
      if (now - lastEnroll > 86_400) {
        await enrollNewsPoll(db, await topCatalogAppids(db, 200), 1, now)
        await setCatalogMeta(db, ENROLL_KEY, String(now))
      }
      result = await runNewsSlice(db, { deadlineAt: Date.now() + SLICE_BUDGET_MS })
    } catch (err) {
      console.error('news slice', err)
    } finally {
      // Звено цепочки — в finally и ПОСЛЕ работы. В finally, потому что иначе
      // одно исключение на кривом фиде тихо убивает всю суточную работу.
      // После работы, потому что запуск ребёнка первым дал бы параллельные
      // инвокации, а lib/pace — состояние модуля: на разных инстансах защиты
      // от общего лимита Steam нет вовсе.
      await setCatalogMeta(db, LAST_KEY, JSON.stringify({ at: nowSec(), chain, ...result }))
      const secret = process.env.CRON_SECRET
      if (result?.hasMore && result.stopped !== 'blocked' && chain < MAX_CHAIN && secret) {
        await fetch(`${appBaseUrl()}/api/cron/news?chain=${chain + 1}`, {
          headers: { 'x-cron-secret': secret },
        }).catch(() => {})
      }
    }
  })

  return NextResponse.json(
    { started: true, chain, due: await countNewsPollDue(db, nowSec()) },
    { status: 202 },
  )
}
