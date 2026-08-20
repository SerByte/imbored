import { randomUUID } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import { passChain } from '@/lib/chain'
import { cronAuthorized } from '@/lib/cron'
import {
  acquireLease,
  countPageEnrichDue,
  getCatalogMeta,
  releaseLease,
  setCatalogMeta,
  STEAM_LEASE,
} from '@/lib/db'
import { llmAvailable } from '@/lib/llm'
import { PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES, runPageSlice } from '@/lib/pagejob'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'
/** Потолок Hobby. */
export const maxDuration = 60

/** Сколько звеньев цепочки максимум. 24 × 20 карточек = 480 в сутки. */
const MAX_CHAIN = 24
const SLICE_BUDGET_MS = 50_000
const LAST_KEY = 'pages_last_slice'
const LEASE_TTL_SEC = 75

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

  // Аренда на Steam — ОДНА на оба крона: обогащение карточек ходит на тот же
  // store.steampowered.com через тот же pace('steam-store') и тратит тот же
  // лимит в ~200 запросов за пять минут. Две цепочки разом его превышают.
  const holder = url.searchParams.get('holder') ?? `pages:${randomUUID()}`
  if (!(await acquireLease(db, STEAM_LEASE, holder, LEASE_TTL_SEC, nowSec()))) {
    return NextResponse.json({ skipped: 'locked' }, { status: 202 })
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
      const goesOn = Boolean(
        result?.hasMore && result.stopped !== 'blocked' && chain < MAX_CHAIN && secret,
      )
      // Аренда передаётся следующему звену вместе с holder, а отдаётся только
      // когда цепочка кончилась — см. тот же кусок в /api/cron/news.
      if (!goesOn) await releaseLease(db, STEAM_LEASE, holder)
      /*
       * Обрыв цепочки записывается, а не проглатывается.
       *
       * Здесь стояло `.catch(() => {})` без проверки res.ok, и это стоило
       * ровно того, ради чего роут существует. Замер по проду 19 августа:
       * пять звеньев по 52 секунды, 49 карточек, все удачные, — и остановка
       * при hasMore: true и stopped: "budget". То есть очередь не кончилась,
       * Steam не блокировал, а шестое звено просто не состоялось, и узнать
       * почему было НЕЧЕМ: ребёнок ничего не записал, родитель отказ съел.
       *
       * Причина ложится ПОВЕРХ записи этого звена. Ребёнка не будет — значит
       * перезаписывать её некому, и до следующих суток она останется
       * единственным следом обрыва.
       */
      if (goesOn && secret) {
        const передача = await passChain(
          `${appBaseUrl()}/api/cron/pages?chain=${chain + 1}&holder=${encodeURIComponent(holder)}`,
          secret,
        )
        if (!передача.ok) {
          await setCatalogMeta(
            db,
            LAST_KEY,
            JSON.stringify({ at: nowSec(), chain, ...result, обрыв: передача.reason }),
          )
          // Аренду отдаём, ТОЛЬКО когда ребёнка точно нет. При отказе сети он
          // мог принять звено и работать прямо сейчас — тогда пусть аренда
          // истечёт сама, а не откроет дверь третьему потоку к Steam.
          if (!передача.childMayRun) await releaseLease(db, STEAM_LEASE, holder)
        }
      }
    }
  })

  /*
   * due считается ТОЛЬКО на первом звене.
   *
   * Это диагностика для человека с curl: родитель ответ ребёнка не читает
   * вовсе. А COUNT(*) идёт по всему каталогу — шесть тысяч прочитанных строк,
   * которые Turso тарифицирует, на КАЖДОЕ звено цепочки. За сутки это 144 000
   * строк выброшенных в никуда при полной цепочке.
   *
   * redoHeuristic передаётся тем же значением, что и в выборку: иначе счётчик
   * говорит одно, а очередь делает другое — ровно то, от чего предостерегает
   * докблок countPageEnrichDue.
   */
  return NextResponse.json(
    {
      started: true,
      chain,
      ...(chain === 0
        ? {
            due: await countPageEnrichDue(db, nowSec() - PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES, {
              redoHeuristic: llmAvailable(),
            }),
          }
        : {}),
    },
    { status: 202 },
  )
}
