import { randomUUID } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { after, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron'
import { acquireLease, DIGEST_LEASE, getCatalogMeta, releaseLease, setCatalogMeta } from '@/lib/db'
import { runDigestSlice } from '@/lib/newsjob'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'
import { NEWS_MAJOR_TAG } from '@/lib/whatsnewcache'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Пересказы патчноутов — отдельно от опроса Steam.
 *
 * Раньше обе фазы делили один пятидесятисекундный бюджет среза в отношении
 * 65/35, и опрос всегда выигрывал: он приносил под сотню новых записей, а
 * пересказ успевал десяток. Очередь не сокращалась, а росла — замер на живой
 * базе показал 1 499 → 1 644 за час. Настройкой долей это не лечится: пока
 * фазы стоят в одной очереди за одним таймером, та, что впереди, забирает
 * столько, сколько ей нужно.
 *
 * Аренда своя (DIGEST_LEASE), не общая со Steam: сюда мы в Steam не ходим
 * вовсе, и запрещать опросу работать одновременно было бы не за что. Замок
 * нужен по другой причине — getUnsummarized не резервирует строки, поэтому
 * две параллельные цепочки возьмут одни и те же записи и заплатят дважды.
 *
 * В vercel.json этот крон намеренно НЕ добавлен: на Hobby лимит — два
 * расписания на проект, и они уже заняты новостями и карточками. Расписание
 * живёт в .github/workflows/cron.yml — там же, где триггер новостей: два
 * воркфлоу стоили вдвое больше минут GitHub при одинаковой работе.
 */
const MAX_CHAIN = 8
const SLICE_BUDGET_MS = 50_000
const LEASE_TTL_SEC = 75
const LAST_KEY = 'digest_last_slice'

/** За срез: пересказ занимает 1–3 с, в пятьдесят секунд укладывается около 25 */
const DIGEST_LIMIT = 25

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const url = new URL(req.url)
  const chain = Number(url.searchParams.get('chain') ?? 0)
  const db = await getDb()

  // килл-свитч без редеплоя — тот же приём, что у новостей и карточек
  if ((await getCatalogMeta(db, 'digest_paused')) === '1') {
    return NextResponse.json({ paused: true })
  }

  const holder = url.searchParams.get('holder') ?? `digest:${randomUUID()}`
  if (!(await acquireLease(db, DIGEST_LEASE, holder, LEASE_TTL_SEC, nowSec()))) {
    return NextResponse.json({ skipped: 'locked' }, { status: 202 })
  }

  after(async () => {
    let result: Awaited<ReturnType<typeof runDigestSlice>> | null = null
    try {
      result = await runDigestSlice(db, {
        deadlineAt: Date.now() + SLICE_BUDGET_MS,
        limit: DIGEST_LIMIT,
      })
    } catch (err) {
      console.error('digest slice', err)
    } finally {
      await setCatalogMeta(db, LAST_KEY, JSON.stringify({ at: nowSec(), chain, ...result }))

      // Пересказ переписывает tldr, а его рисует PatchRow — значит лента после
      // среза выглядит иначе, даже если ни одной новой записи не появилось.
      // Тот же тег и та же логика, что в /api/cron/news.
      if ((result?.digested ?? 0) > 0) revalidateTag(NEWS_MAJOR_TAG, 'max')

      const secret = process.env.CRON_SECRET
      const goesOn = Boolean(result?.hasMore && chain < MAX_CHAIN && secret)
      // Аренду передаём следующему звену вместе с holder, отдаём — только
      // когда цепочка кончилась. См. тот же кусок в /api/cron/news.
      if (!goesOn) await releaseLease(db, DIGEST_LEASE, holder)
      if (goesOn && secret) {
        await fetch(
          `${appBaseUrl()}/api/cron/digest?chain=${chain + 1}&holder=${encodeURIComponent(holder)}`,
          { headers: { 'x-cron-secret': secret } },
        ).catch(() => {})
      }
    }
  })

  return NextResponse.json({ started: true, chain }, { status: 202 })
}
