import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { after, NextResponse } from 'next/server'
import { refreshCatalogSignals, type SignalsResult } from '@/lib/catalogsignals'
import { openRun, runChain } from '@/lib/chain'
import { cronAuthorized, pagesDailyLinks, pagesLinkVerdict } from '@/lib/cron'
import { countPageEnrichDue, STEAM_LEASE } from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { resetSliceCards, revalidateEndedDeals } from '@/lib/gamecache'
import { llmAvailable } from '@/lib/llm'
import { llmDailyCap } from '@/lib/llmcap'
import {
  PAGE_MAX_AGE_SEC,
  PAGE_MAX_TRIES,
  PAGE_REDO_AFTER_SEC,
  runPageSlice,
  type PageSliceResult,
} from '@/lib/pagejob'
import { getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'
/** Потолок Hobby с Fluid — CRON_MAX_DURATION_SEC, см. там; сверяет lib/chain.test.ts */
export const maxDuration = 300

/**
 * Сколько звеньев максимум за запуск.
 *
 * Упирается запуск обычно не в это число, а во время: шесть звеньев по
 * LINK_MS в 300 с. Потолок держит горячую петлю — звенья, падающие сразу
 * (легла база), — и суточный потолок (pagesDailyLinks) всё равно не пустит
 * больше. Сколько карточек успевает звено, записано у LINK_MS и
 * PAGES_LLM_PER_LINK.
 *
 * Лишние карточки в пачке звена ничего не стоят: claimPageEnrichBatch только
 * читает, ничего не помечает, и неотработанный хвост попыток не теряет —
 * следующее звено возьмёт его первым.
 */
const MAX_LINKS = 8

type PagesLink = Omit<PageSliceResult, 'cards'> & { сброшено: number; сигналы?: SignalsResult }

/**
 * Обогащение карточек игр: скриншоты, вердикт отзывов, pros/cons.
 *
 * Устроено как /api/cron/news: 202 сразу, работа в after() — звенья подряд
 * внутри этого же вызова (lib/chain). Зовут сюда суточное расписание в
 * vercel.json и конец запуска новостей, раз в час, пока не выбран суточный
 * потолок звеньев (pagesNeedKick в lib/cron: почему не часовой воркфлоу).
 *
 * Существует этот роут потому, что раньше всю эту работу делала страница
 * /game/[appid] прямо на рендере — публичная, без кэша и без ограничений.
 */
export async function GET(req: Request) {
  // Первой строкой: срок запуска считается от начала вызова — см. sliceDeadline.
  const startedAt = Date.now()
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const db = await getDb()
  const dailyCap = pagesDailyLinks({ llmCap: llmDailyCap(), llmOn: llmAvailable() })

  // Аренда на Steam — ОДНА на оба крона: обогащение карточек ходит на тот же
  // store.steampowered.com через тот же pace('steam-store') и тратит тот же
  // лимит в ~200 запросов за пять минут. Два потока разом его превышают.
  const lease = { key: STEAM_LEASE, holder: `pages:${randomUUID()}` }
  const refusal = await openRun(db, { job: 'pages', lease, startedAt, maxDurationSec: maxDuration, dailyCap })
  // килл-свитч без редеплоя — тот же приём, что у новостей
  if (refusal === 'paused') return NextResponse.json({ paused: true })
  if (refusal) return NextResponse.json({ skipped: refusal }, { status: 202 })

  after(() =>
    runChain<PagesLink>({
      db,
      job: 'pages',
      lease,
      startedAt,
      maxDurationSec: maxDuration,
      maxLinks: MAX_LINKS,
      dailyCap,
      totals: ['enriched', 'withShots', 'withProsCons', 'viaClaude', 'withSemantics', 'сброшено'],
      link: async ({ deadlineAt }) => {
        /*
         * Сигналы каталога — рядом со срезом карточек, а не после него.
         *
         * После — значило бы никогда: срез карточек съедает бюджет звена
         * целиком, пока в очереди есть работа, а её там тысячи. Рядом можно,
         * потому что они не делят лимит: карточки ходят в
         * store.steampowered.com через pace('steam-store'), сигналы — в
         * api.steampowered.com через pace('steam-api'). Срок у обоих один.
         *
         * Своё исключение сигналы глотают сами: сверка отзывов не имеет права
         * ронять ни срез карточек, ни звено.
         */
        const сверка = refreshCatalogSignals(db, { deadlineAt }).catch((err: unknown) => {
          logSwallowed('cron/pages:signals', err)
          return null
        })
        try {
          // Карточки, которые срез поменял, — в перегенерацию: страница живёт
          // неделю (lib/gamecache), и без сброса свежие pros/cons и кадры
          // ждали бы её конца. Сверка сигналов карточки не сбрасывает: её
          // шаг — неделя, ровно срок кэша, и он доезжает сам
          const slice = resetSliceCards(await runPageSlice(db, { deadlineAt }), revalidatePath)
          const сигналы = await сверка
          return { ...slice, ...(сигналы ? { сигналы } : {}) }
        } finally {
          // Упал срез — сверку всё равно дожидаемся: иначе она шла бы рядом со
          // следующим звеном, а у того своя
          await сверка
        }
      },
      // Работа — у среза карточек или у сверки сигналов; см. pagesLinkVerdict
      verdict: ({ result, failed }) =>
        pagesLinkVerdict({ failed, slice: result, signals: result?.сигналы ?? null }),
      /*
       * Карточки с погасшей с прошлого запуска скидкой — в перегенерацию: в
       * недельном кэше они обещают её в JSON-LD (revalidateEndedDeals). В
       * конце запуска, а не в начале: пометки уходят в Next разом, когда
       * after() закончил, и отметка прохода должна двигаться как можно ближе
       * к ним. Снимут вызов раньше — отметка стоит на месте, и окно целиком
       * достанется следующему запуску. Исключение глотает runChain.
       */
      onEnd: async () => {
        await revalidateEndedDeals(db, revalidatePath, nowSec())
      },
    }),
  )

  /*
   * due — диагностика для человека с curl: запуск её не читает. COUNT(*) идёт
   * по всему каталогу, шесть тысяч строк, которые Turso тарифицирует, —
   * поэтому только на начатом запуске (их несколько в сутки), а не на отказах
   * выше.
   *
   * redoHeuristic передаётся тем же значением, что и в выборку: иначе счётчик
   * говорит одно, а очередь делает другое — ровно то, от чего предостерегает
   * докблок countPageEnrichDue.
   */
  return NextResponse.json(
    {
      started: true,
      dailyCap,
      due: await countPageEnrichDue(db, nowSec() - PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES, {
        redoHeuristic: llmAvailable(),
        redoBefore: nowSec() - PAGE_REDO_AFTER_SEC,
      }),
    },
    { status: 202 },
  )
}
