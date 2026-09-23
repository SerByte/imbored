import { NextResponse } from 'next/server'
import { CRON_JOBS, cronAuthorized, sliceHealth, type CronJob, type SliceHealth } from '@/lib/cron'
import { getCatalogMeta } from '@/lib/db'
import { getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'

/**
 * Живы ли кроны — по отметкам, которые каждое звено пишет о себе.
 *
 * Воркфлоу в .github/workflows/cron.yml проверял только код первого ответа
 * news и digest, а это 202 ДО after(), то есть до всякой работы: упавший срез,
 * оборванная цепочка и крон карточек, который вообще не пришёл, выглядели
 * снаружи одинаково зелёными. Узнавали по пустым карточкам неделями позже.
 *
 * 503 — если хоть один крон нездоров (правила в sliceHealth, lib/cron.ts).
 * Воркфлоу валит на нём прогон, и о поломке приходит письмо от GitHub.
 *
 * Только чтение: шесть точечных SELECT по catalog_meta, ни одной записи, ни
 * одного похода в Steam или к модели. Закрыт тем же секретом, что и кроны:
 * содержимое отметок — внутренняя кухня, и тексты исключений в ней тоже.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const db = await getDb()
  const now = nowSec()
  const jobs = {} as Record<CronJob, SliceHealth>
  for (const job of Object.keys(CRON_JOBS) as CronJob[]) {
    const { lastKey, pausedKey, staleSec } = CRON_JOBS[job]
    const [raw, paused] = await Promise.all([
      getCatalogMeta(db, lastKey),
      getCatalogMeta(db, pausedKey),
    ])
    jobs[job] = sliceHealth(raw, now, staleSec, paused === '1')
  }

  const ok = Object.values(jobs).every((j) => j.ok)
  return NextResponse.json(
    { ok, jobs },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  )
}
