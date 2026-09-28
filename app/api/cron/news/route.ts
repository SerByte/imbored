import { randomUUID } from 'node:crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { after, NextResponse } from 'next/server'
import { kickCron, kickFailLine, linksToday, openRun, runChain } from '@/lib/chain'
import { dayKey } from '@/lib/daily'
import {
  CRON_JOBS,
  cronAuthorized,
  DIGEST_STALE_SEC,
  newsLinkVerdict,
  pagesDailyLinks,
  pagesNeedKick,
  sliceLooksStale,
  SWEEP_KEY,
  type CronJob,
} from '@/lib/cron'
import {
  countNewsPollDue,
  enrollNewsPoll,
  getCatalogMeta,
  reviveGoneNewsPoll,
  setCatalogMeta,
  STEAM_LEASE,
  sweepDailyPicks,
  sweepStale,
  topCatalogAppids,
  type Db,
} from '@/lib/db'
import { resetSliceCards } from '@/lib/gamecache'
import { llmAvailable } from '@/lib/llm'
import { llmDailyCap } from '@/lib/llmcap'
import { runNewsSlice } from '@/lib/newsjob'
import { sweepRateLimits } from '@/lib/ratelimit'
import { appBaseUrl, getDb, nowSec, steamApiKey } from '@/lib/server'
import { runSteamProbe } from '@/lib/steamprobe'
import { pruneTelemetry } from '@/lib/telemetry'
import { NEWS_MAJOR_TAG } from '@/lib/whatsnewcache'

export const dynamic = 'force-dynamic'
/** Потолок Hobby с Fluid — CRON_MAX_DURATION_SEC, см. там; сверяет lib/chain.test.ts */
export const maxDuration = 300

/**
 * Сколько звеньев максимум за запуск. Спрос — около трёхсот опросов в сутки,
 * то есть дюжина игр в час: обычно запуск кончается первым же звеном (20 игр),
 * а упирается, когда упирается, во время — шесть звеньев по LINK_MS.
 */
const MAX_LINKS = 8
const ENROLL_KEY = 'news_enrolled_at'

/** Через сколько давать похороненной игре ещё один шанс */
const REVIVE_AFTER_SEC = 30 * 86_400

/**
 * Vercel Cron ходит именно GET.
 *
 * Отвечаем 202 СРАЗУ, а работаем в after(): звенья подряд внутри этого же
 * вызова (lib/chain). Зовут сюда часовой воркфлоу (.github/workflows/cron.yml)
 * и суточное расписание в vercel.json как подстраховка.
 */
export async function GET(req: Request) {
  // Первой строкой: срок запуска считается от начала вызова — см. sliceDeadline.
  const startedAt = Date.now()
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const db = await getDb()

  // Расписание живёт снаружи (GitHub Actions), поэтому триггер вполне может
  // прийти поверх ещё живого запуска — своего или карточек. Тогда это не
  // работа, а второй поток запросов к Steam мимо общего лимитера — молча
  // уходим (openRun: аренда STEAM_LEASE).
  const lease = { key: STEAM_LEASE, holder: `news:${randomUUID()}` }
  const refusal = await openRun(db, { job: 'news', lease, startedAt, maxDurationSec: maxDuration })
  // килл-свитч без редеплоя
  if (refusal === 'paused') return NextResponse.json({ paused: true })
  if (refusal) return NextResponse.json({ skipped: refusal }, { status: 202 })

  after(() =>
    runChain({
      db,
      job: 'news',
      lease,
      startedAt,
      maxDurationSec: maxDuration,
      maxLinks: MAX_LINKS,
      totals: ['polled', 'inserted', 'сброшено'],
      link: async ({ deadlineAt }) => {
        await dailyChores(db)
        // digestLimit: 0 — пересказы уехали в /api/cron/digest со своим
        // бюджетом. Здесь это не только разделение задач, но и прибавка к
        // опросу: те 35% времени, что придерживались под модель, теперь идут
        // на игры.
        const slice = await runNewsSlice(db, { deadlineAt, digestLimit: 0 })
        // Карточки игр, чья лента патчей поменялась, — в перегенерацию: они
        // живут в ISR неделю (lib/gamecache). На звено, а не на запуск:
        // сброс ничего не рендерит сам, а отметки всё равно уходят разом,
        // когда after() закончит (withExecuteRevalidates в Next)
        return resetSliceCards(slice, revalidatePath)
      },
      verdict: ({ result, failed }) => newsLinkVerdict({ failed, result }),
      onEnd: async ({ totals, hardLeftMs }) => {
        /*
         * Лента перестала быть свежей — сообщаем кэшу. Раз на запуск, а не на
         * звено: каждый сброс — это перегенерация ленты при следующем заходе,
         * а ISR Writes на Hobby уже выбраны сверх лимита.
         *
         * Общая лента лежит в unstable_cache с десятиминутным потолком, но
         * потолок здесь страховка, а не механизм: обновления приезжают
         * запусками по расписанию, и ждать до десяти минут после того, как
         * патч уже в базе, незачем. Инвалидация по тегу делает ленту
         * событийной.
         *
         * profile 'max' — это stale-while-revalidate: следующий посетитель
         * получает старую ленту мгновенно, а свежая подтягивается фоном. Без
         * второго аргумента (устаревшая форма) он же получил бы блокирующий
         * промах ровно в тот момент, когда крон только что отработал.
         *
         * Условие по inserted: запуск, не принёсший ни одной записи, ленту не
         * менял, и сбрасывать кэш из-за него значит платить за холодный рендер
         * на пустом месте.
         */
        if ((totals.inserted ?? 0) > 0) revalidateTag(NEWS_MAJOR_TAG, 'max')

        await kickNeighbours(db)

        /*
         * Проба ключа Steam Web API (lib/steamprobe): раз в час, отсюда же —
         * единственного места, что ходит ежечасно. Только если до жёсткого
         * срока функции остаётся с запасом: проба кладёт на себя две попытки
         * по пять секунд, а обрыв посреди неё стоил бы и остатка after().
         * Остаток — на сейчас, а не на начало конца запуска: пинки выше
         * ждут ответа соседних роутов (hardLeftMs считает в момент вызова).
         */
        if (hardLeftMs() > 15_000) {
          await runSteamProbe(db, { nowSec: nowSec(), apiKey: steamApiKey() })
        }
      },
    }),
  )

  return NextResponse.json({ started: true, due: await countNewsPollDue(db, nowSec()) }, { status: 202 })
}

/**
 * Раз в сутки: пополнить очередь топом каталога и прибраться. В звене, а не
 * отдельно перед запуском: упади она — звено упадёт и следующее попробует
 * снова (newsLinkVerdict), а проверка «прошли ли сутки» — одно чтение.
 */
async function dailyChores(db: Db): Promise<void> {
  const now = nowSec()
  const lastEnroll = Number((await getCatalogMeta(db, ENROLL_KEY)) ?? 0)
  if (now - lastEnroll <= 86_400) return
  await enrollNewsPoll(db, await topCatalogAppids(db, 200), 1, now)
  // Заодно поднимаем похороненных: три отказа подряд чаще означают
  // закрывшийся Steam, чем мёртвую игру, а отметка 'gone' до сих пор была
  // вечной. Раз в месяц на игру — цена пренебрежимая.
  await reviveGoneNewsPoll(db, now - REVIVE_AFTER_SEC, now)
  // Заодно подметаем истёкшие окна ограничителя частоты. Из запроса это
  // делать нельзя — лишняя запись на каждом обращении к дорогой ручке ровно
  // там, где мы экономим, — а суточного прохода хватает: ключи содержат номер
  // окна, поэтому старые строки не влияют на счёт и только занимают место.
  await sweepRateLimits(db, now)
  // Граница — сутки игры дня (dayKey, московские), а не UTC: иначе уборка и
  // ключ записи жили бы в разных календарях. Вчерашние оставляем, и не только
  // с запасом на запрос, начатый до полуночи и ещё дописывающий вчерашний
  // ключ: по вчерашней записи отбор не повторяет вчерашнего героя (avoid у
  // pickDaily в /api/daily). Старше вчерашних строки на выбор уже не влияют.
  await sweepDailyPicks(db, dayKey(now - 86_400))
  // Демо-личности, истёкшие сессии и старые комнаты — см. sweepStale. Своим
  // try: мусор спокойно подождёт до завтра, а суточное пополнение очереди и
  // сам срез из-за него пропадать не должны.
  try {
    const swept = await sweepStale(db, now)
    // Почасовые счётчики (lib/telemetry) старше 90 дней — тем же проходом и
    // в ту же отметку уборки
    const telemetry = await pruneTelemetry(db, now)
    await setCatalogMeta(db, SWEEP_KEY, JSON.stringify({ at: now, ...swept, telemetry }))
  } catch (err) {
    console.error('sweep stale', err)
  }
  await setCatalogMeta(db, ENROLL_KEY, String(now))
}

/**
 * Запуск кончился — пнуть соседей, если им пора.
 *
 * Пересказы висят на одном GitHub Actions без подстраховки в vercel.json
 * (на Hobby два расписания, оба заняты): молчат дольше DIGEST_STALE_SEC —
 * пинок. Карточки берут отсюда свой часовой ритм, пока не выбран суточный
 * потолок звеньев, — почему отсюда, а не из воркфлоу, см. pagesNeedKick.
 * Аренда Steam к этому моменту уже отдана (runChain отдаёт её до onEnd), так
 * что карточки её возьмут. Если крон на паузе, его роут сам ответит
 * {paused:true} — килл-свитч остаётся главнее нас.
 *
 * Пинок — один HTTP-запрос к соседнему роуту, а не звено: см. kickCron.
 * Своим try: чтение отметок — сетевой вызов к Turso, а исключение здесь не
 * должно лишить запуск пробы ключа ниже.
 */
async function kickNeighbours(db: Db): Promise<void> {
  const secret = process.env.CRON_SECRET
  if (!secret) return
  try {
    const now = nowSec()
    const пинки: Array<{ cron: CronJob; надо: boolean }> = [
      {
        cron: 'digest',
        надо: sliceLooksStale(await getCatalogMeta(db, CRON_JOBS.digest.lastKey), now, DIGEST_STALE_SEC),
      },
      {
        cron: 'pages',
        надо: pagesNeedKick({
          linksToday: await linksToday(db, 'pages', now),
          cap: pagesDailyLinks({ llmCap: llmDailyCap(), llmOn: llmAvailable() }),
        }),
      },
    ]
    for (const { cron, надо } of пинки) {
      if (!надо) continue
      const пинок = await kickCron(`${appBaseUrl()}/api/cron/${cron}`, secret)
      if (!пинок.ok) console.error(kickFailLine({ cron, reason: пинок.reason }))
    }
  } catch (err) {
    console.error('cron kick', err)
  }
}
