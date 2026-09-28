import { randomUUID } from 'node:crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { after, NextResponse } from 'next/server'
import { openRun, runChain } from '@/lib/chain'
import { cronAuthorized, digestLinkVerdict } from '@/lib/cron'
import { DIGEST_LEASE } from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { announceFreshPatches } from '@/lib/indexnow'
import { runDigestSlice } from '@/lib/newsjob'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'
import { NEWS_MAJOR_TAG } from '@/lib/whatsnewcache'

export const dynamic = 'force-dynamic'
/** Потолок Hobby с Fluid — CRON_MAX_DURATION_SEC, см. там; сверяет lib/chain.test.ts */
export const maxDuration = 300

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
 * два параллельных запуска возьмут одни и те же записи и заплатят дважды.
 *
 * В vercel.json этот крон намеренно НЕ добавлен: на Hobby лимит — два
 * расписания на проект, и они уже заняты новостями и карточками. Расписание
 * живёт в .github/workflows/cron.yml — там же, где триггер новостей: два
 * воркфлоу стоили вдвое больше минут GitHub при одинаковой работе.
 *
 * Звенья — подряд внутри этого же вызова (lib/chain), и каждому нужна модель:
 * выбран суточный бюджет (lib/llmcap) — следующее не начинается.
 */
const MAX_LINKS = 8

/** За звено: пересказ занимает 1–3 с, в сорок восемь секунд укладывается около 25 */
const DIGEST_LIMIT = 25

export async function GET(req: Request) {
  // Первой строкой: срок запуска считается от начала вызова — см. sliceDeadline.
  const startedAt = Date.now()
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const db = await getDb()
  const lease = { key: DIGEST_LEASE, holder: `digest:${randomUUID()}` }
  const refusal = await openRun(db, { job: 'digest', lease, startedAt, maxDurationSec: maxDuration })
  // килл-свитч без редеплоя — тот же приём, что у новостей и карточек
  if (refusal === 'paused') return NextResponse.json({ paused: true })
  if (refusal) return NextResponse.json({ skipped: refusal }, { status: 202 })

  after(() =>
    runChain({
      db,
      job: 'digest',
      lease,
      startedAt,
      maxDurationSec: maxDuration,
      maxLinks: MAX_LINKS,
      needsLlm: true,
      totals: ['digested'],
      link: ({ deadlineAt }) => runDigestSlice(db, { deadlineAt, limit: DIGEST_LIMIT }),
      // Упавшее звено запуск останавливает — это про деньги, см. digestLinkVerdict
      verdict: ({ result, failed }) => digestLinkVerdict({ failed, result }),
      onEnd: async ({ totals, hardLeftMs }) => {
        // Пересказ переписывает tldr, а его рисует PatchRow — значит лента
        // после запуска выглядит иначе, даже если ни одной новой записи не
        // появилось. Тот же тег и та же логика, что в /api/cron/news: раз на
        // запуск.
        if ((totals.digested ?? 0) > 0) revalidateTag(NEWS_MAJOR_TAG, 'max')

        /*
         * Страницы свежепересказанных патчей перегенерировать и объявить
         * поисковикам (lib/indexnow). Раз на запуск, а не на звено: один пинг
         * со всеми адресами. Только если хватает времени: у хвоста функции
         * свой срок (как у пробы Steam в /api/cron/news), а пропущенное
         * дождётся следующего запуска — отметка двигается только после успеха.
         */
        if (hardLeftMs() > 15_000) {
          try {
            await announceFreshPatches(db, {
              now: nowSec(),
              baseUrl: appBaseUrl(),
              revalidate: (path) => revalidatePath(path),
            })
          } catch (err) {
            logSwallowed('digest:indexnow', err)
          }
        }
      },
    }),
  )

  return NextResponse.json({ started: true }, { status: 202 })
}
