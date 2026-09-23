import { randomUUID } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import { refreshCatalogSignals } from '@/lib/catalogsignals'
import { chainBreakLine, passChain } from '@/lib/chain'
import { CRON_JOBS, cronAuthorized, pagesChainGoesOn, sliceDeadline } from '@/lib/cron'
import {
  acquireLease,
  countPageEnrichDue,
  getCatalogMeta,
  releaseLease,
  setCatalogMeta,
  STEAM_LEASE,
} from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { llmAvailable } from '@/lib/llm'
import { PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES, runPageSlice } from '@/lib/pagejob'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'
/** Потолок Hobby. */
export const maxDuration = 60

/**
 * Сколько звеньев цепочки максимум.
 *
 * Стояло «24 × 20 карточек = 480 в сутки». Двадцать — это limit пачки, то есть
 * сколько карточек СПРАШИВАЮТ из очереди, а не сколько успевает срез.
 *
 * Каждая карточка это ДВА запроса в Steam: appdetails и appreviews. Оба идут
 * через один пейсер на ключе steam-store (lib/pace.ts — цепочка промисов на
 * ключ, шаг STORE_PACE_MS = 1700мс), то есть строго по очереди. Сорок запросов
 * это 39 промежутков по 1.7с = 66 секунд одного лишь ожидания — при бюджете
 * среза в 48 (sliceDeadline: 60 минус хвост в 12, и считая от начала вызова).
 * Двадцать карточек за срез недостижимы структурно, а не иногда.
 *
 * Что помещается: 1 + floor(48000 / 1700) = 29 запросов, то есть 14 карточек.
 * Отсюда предел 24 × 14 = 336 в сутки — и это ещё без времени самих ответов,
 * записей в базу и вызова модели.
 *
 * Замер на проде: пять звеньев, 49 карточек, около 9.8 за срез. Почему звеньев
 * пять, а не 24, пока не установлено — ровно поэтому передача цепочки и
 * сделана наблюдаемой, см. passChain ниже.
 *
 * Лишние пять карточек в пачке при этом ничего не стоят: claimPageEnrichBatch
 * только читает, ничего не помечает, и неотработанный хвост попыток не теряет.
 */
const MAX_CHAIN = 24
const LAST_KEY = CRON_JOBS.pages.lastKey
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
  // Первой строкой: срок среза считается от начала вызова — см. sliceDeadline.
  const startedAt = Date.now()
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const url = new URL(req.url)
  const chain = Number(url.searchParams.get('chain') ?? 0)
  const db = await getDb()

  // килл-свитч без редеплоя — тот же приём, что у новостей
  if ((await getCatalogMeta(db, CRON_JOBS.pages.pausedKey)) === '1') {
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
    const deadlineAt = sliceDeadline(startedAt, maxDuration)
    /*
     * Сигналы каталога — рядом со срезом карточек, а не после него.
     *
     * После — значило бы никогда: срез карточек съедает бюджет звена целиком,
     * пока в очереди есть работа, а её там тысячи. Рядом можно, потому что
     * они не делят лимит: карточки ходят в store.steampowered.com через
     * pace('steam-store'), сигналы — в api.steampowered.com через
     * pace('steam-api'). Срок у обоих один, и хвост звена (finally ниже) их
     * дожидается.
     *
     * Своё исключение сигналы глотают сами: сверка отзывов не имеет права
     * ронять ни срез карточек, ни передачу звена.
     */
    const сверка = refreshCatalogSignals(db, { deadlineAt }).catch((err: unknown) => {
      logSwallowed('cron/pages:signals', err)
      return null
    })
    let result: Awaited<ReturnType<typeof runPageSlice>> | null = null
    /*
     * Упало ли звено — отдельно от результата, и это несущая разница.
     *
     * Комментарий ниже обещает, что «исключение не должно убивать сутки», но
     * обещание не выполнялось: при броске result оставался null, goesOn читал
     * result?.hasMore и получал false, и цепочка обрывалась молча. finally
     * защищал только запись отметки и отдачу аренды, а не продолжение.
     *
     * Бросить может любой db.execute внутри среза — это сетевой вызов к
     * Turso, и один моргнувший запрос стоил целых суток: расписание у этого
     * роута одно и суточное.
     *
     * Поэтому упавшее звено передаёт эстафету дальше: следующее заново
     * выберет очередь и, скорее всего, отработает. Долбёжки не будет — цепочку
     * ограничивает MAX_CHAIN, ровно как и в удачном случае.
     */
    let упало: string | null = null
    try {
      result = await runPageSlice(db, { deadlineAt })
    } catch (err) {
      console.error('page slice', err)
      упало = err instanceof Error ? err.message.slice(0, 120) : 'исключение'
    } finally {
      const сигналы = await сверка
      // Звено цепочки — в finally и ПОСЛЕ работы, ровно по тем же причинам,
      // что расписаны в /api/cron/news: исключение не должно убивать сутки,
      // а параллельные инвокации сломали бы общий лимитер темпа Steam.
      // Отметка — диагностика, а не работа. Её отказ не имеет права обрывать
      // цепочку: иначе одно моргнувшее соединение к Turso стоит того же, что и
      // исключение в самом срезе, ради которого всё это и написано.
      try {
        await setCatalogMeta(
          db,
          LAST_KEY,
          JSON.stringify({
            at: nowSec(),
            chain,
            ...result,
            ...(сигналы ? { сигналы } : {}),
            ...(упало ? { упало } : {}),
          }),
        )
      } catch (err) {
        console.error('cron meta', err)
      }
      const secret = process.env.CRON_SECRET
      // Работа — у среза карточек или у сверки сигналов; см. pagesChainGoesOn
      const goesOn = pagesChainGoesOn({
        failed: упало !== null,
        slice: result,
        signals: сигналы,
        chain,
        maxChain: MAX_CHAIN,
        hasSecret: Boolean(secret),
      })
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
          console.error(chainBreakLine({ cron: 'pages', chain, reason: передача.reason }))
          await setCatalogMeta(
            db,
            LAST_KEY,
            JSON.stringify({
              at: nowSec(),
              chain,
              ...result,
              ...(сигналы ? { сигналы } : {}),
              обрыв: передача.reason,
            }),
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
