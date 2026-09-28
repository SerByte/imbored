import { NextResponse } from 'next/server'
import {
  CRON_JOBS,
  cronAuthorized,
  sliceHealth,
  steamKeyHealth,
  SWEEP_KEY,
  type CronJob,
  type SliceHealth,
} from '@/lib/cron'
import { getCatalogMeta } from '@/lib/db'
import { llmBudgetUsed, llmDailyCap } from '@/lib/llmcap'
import { getDb, nowSec } from '@/lib/server'
import { STEAM_PROBE_KEY } from '@/lib/steamprobe'
import { SERVER_ERRORS_LIMIT, telemetryCount } from '@/lib/telemetry'

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
 * Кроме кронов — две проверки того, что кроны сами не покажут:
 *   • steamKey — живой ли ключ Steam Web API. Сам ключ health не трогает:
 *     пробу раз в час делает конец цепочки новостей (lib/steamprobe.ts), здесь
 *     читается её отметка;
 *   • sweep — прошла ли суточная уборка (sweepStale в кроне новостей) за
 *     последние 48 часов. Упавшая уборка пишет только в console.error, а
 *     протухшие демо и комнаты копятся молча.
 * Обе стоят на паузе вместе с новостями: их делает тот же крон.
 *
 * serverErrors — сбои на сервере за последний час (почасовые счётчики,
 * lib/telemetry.ts; пишет instrumentation.ts). Порог — SERVER_ERRORS_LIMIT:
 * единичные 500 бывают всегда, а десятки в час — это уже поломка, о
 * которой иначе узнавали бы из жалоб. Недоступный счётчик проверку не
 * валит: о лёгшей базе и так скажут кроны.
 *
 * llm — справка, а не проверка: сколько вызовов модели потрачено сегодня из
 * суточного бюджета (lib/llmcap). Выбранный бюджет — не авария, сервис
 * отвечает эвристикой, поэтому 503 он не даёт.
 *
 * Только чтение: точечные SELECT по catalog_meta и rate_limits, ни одной
 * записи, ни одного похода в Steam или к модели. Закрыт тем же секретом, что
 * и кроны: содержимое отметок — внутренняя кухня, и тексты исключений в ней
 * тоже.
 */
/**
 * Уборка идёт раз в сутки из крона новостей; 48 часов — это минимум одна
 * пропущенная подряд, а не опоздание на пару часов.
 */
const SWEEP_STALE_SEC = 48 * 3600

/** Проба ключа ходит раз в час; три часа — два пропуска подряд, как у новостей */
const STEAM_PROBE_STALE_SEC = 3 * 3600

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

  const newsPaused = (await getCatalogMeta(db, CRON_JOBS.news.pausedKey)) === '1'
  const [probe, sweep, used, errors] = await Promise.all([
    getCatalogMeta(db, STEAM_PROBE_KEY),
    getCatalogMeta(db, SWEEP_KEY),
    llmBudgetUsed(db, now),
    telemetryCount(db, 'server-error', now - 3600).catch(() => null),
  ])
  const checks = {
    steamKey: steamKeyHealth(probe, now, STEAM_PROBE_STALE_SEC, newsPaused),
    sweep: sliceHealth(sweep, now, SWEEP_STALE_SEC, newsPaused),
    serverErrors:
      errors !== null && errors > SERVER_ERRORS_LIMIT
        ? { ok: false as const, problem: 'сбои' as const, count: errors, limit: SERVER_ERRORS_LIMIT }
        : { ok: true as const, count: errors },
  }

  const ok = Object.values(jobs).every((j) => j.ok) && Object.values(checks).every((c) => c.ok)
  return NextResponse.json(
    { ok, jobs, checks, llm: { used, cap: llmDailyCap() } },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  )
}
