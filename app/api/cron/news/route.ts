import { randomUUID } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { after, NextResponse } from 'next/server'
import { cronAuthorized, digestLooksStale } from '@/lib/cron'
import {
  acquireLease,
  countNewsPollDue,
  enrollNewsPoll,
  getCatalogMeta,
  releaseLease,
  reviveGoneNewsPoll,
  setCatalogMeta,
  STEAM_LEASE,
  sweepDailyPicks,
  topCatalogAppids,
} from '@/lib/db'
import { runNewsSlice } from '@/lib/newsjob'
import { NEWS_MAJOR_TAG } from '@/lib/whatsnewcache'
import { sweepRateLimits } from '@/lib/ratelimit'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'
/** Потолок Hobby. На Pro можно поднять до 300 и опустить MAX_CHAIN. */
export const maxDuration = 60

/** Сколько звеньев цепочки максимум. 24 × 20 игр = 480 опросов в сутки. */
const MAX_CHAIN = 24
const SLICE_BUDGET_MS = 50_000
const ENROLL_KEY = 'news_enrolled_at'
const LAST_KEY = 'news_last_slice'

/** Чуть больше maxDuration: убитый по таймауту инстанс не держит аренду вечно. */
const LEASE_TTL_SEC = 75

/** Через сколько давать похороненной игре ещё один шанс */
const REVIVE_AFTER_SEC = 30 * 86_400

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

  // Своё имя цепочка получает на первом звене и передаёт дальше: аренда
  // реентерабельна по holder, поэтому звенья продлевают её, а не отбивают
  // друг у друга.
  const holder = url.searchParams.get('holder') ?? `news:${randomUUID()}`

  // Расписание живёт снаружи (GitHub Actions), поэтому триггер вполне может
  // прийти поверх ещё живой цепочки. Тогда это не работа, а второй поток
  // запросов к Steam мимо общего лимитера — молча уходим.
  if (!(await acquireLease(db, STEAM_LEASE, holder, LEASE_TTL_SEC, nowSec()))) {
    return NextResponse.json({ skipped: 'locked' }, { status: 202 })
  }

  after(async () => {
    let result: Awaited<ReturnType<typeof runNewsSlice>> | null = null
    try {
      const now = nowSec()
      // раз в сутки пополняем очередь топом каталога
      const lastEnroll = Number((await getCatalogMeta(db, ENROLL_KEY)) ?? 0)
      if (now - lastEnroll > 86_400) {
        await enrollNewsPoll(db, await topCatalogAppids(db, 200), 1, now)
        // Заодно поднимаем похороненных: три отказа подряд чаще означают
        // закрывшийся Steam, чем мёртвую игру, а отметка 'gone' до сих пор
        // была вечной. Раз в месяц на игру — цена пренебрежимая.
        await reviveGoneNewsPoll(db, now - REVIVE_AFTER_SEC, now)
        await setCatalogMeta(db, ENROLL_KEY, String(now))
      }
      // digestLimit: 0 — пересказы уехали в /api/cron/digest со своим
      // бюджетом. Здесь это не только разделение задач, но и прибавка к
      // опросу: те 35% времени, что придерживались под модель, теперь идут
      // на игры.
      result = await runNewsSlice(db, { deadlineAt: Date.now() + SLICE_BUDGET_MS, digestLimit: 0 })
    } catch (err) {
      console.error('news slice', err)
    } finally {
      // Звено цепочки — в finally и ПОСЛЕ работы. В finally, потому что иначе
      // одно исключение на кривом фиде тихо убивает всю суточную работу.
      // После работы, потому что запуск ребёнка первым дал бы параллельные
      // инвокации, а lib/pace — состояние модуля: на разных инстансах защиты
      // от общего лимита Steam нет вовсе.
      await setCatalogMeta(db, LAST_KEY, JSON.stringify({ at: nowSec(), chain, ...result }))

      /*
       * Лента перестала быть свежей — сообщаем кэшу.
       *
       * Общая лента лежит в unstable_cache с десятиминутным потолком, но
       * потолок здесь страховка, а не механизм: обновления приезжают срезами
       * по расписанию, и ждать до десяти минут после того, как патч уже в
       * базе, незачем. Инвалидация по тегу делает ленту событийной.
       *
       * profile 'max' — это stale-while-revalidate: следующий посетитель
       * получает старую ленту мгновенно, а свежая подтягивается фоном. Без
       * второго аргумента (устаревшая форма) он же получил бы блокирующий
       * промах ровно в тот момент, когда крон только что отработал.
       *
       * Условие по inserted: срез, не принёсший ни одной записи, ленту не
       * менял, и сбрасывать кэш из-за него значит платить за холодный рендер
       * на пустом месте.
       */
      if ((result?.inserted ?? 0) > 0) revalidateTag(NEWS_MAJOR_TAG, 'max')

      const secret = process.env.CRON_SECRET
      const goesOn = Boolean(
        result?.hasMore && result.stopped !== 'blocked' && chain < MAX_CHAIN && secret,
      )
      // Аренду отдаём, только если цепочка на этом кончилась. Иначе передаём
      // её следующему звену вместе с holder: пауза между отдал-и-взял пустила
      // бы внутрь чужой триггер ровно в тот момент, когда работа продолжается.
      if (!goesOn) await releaseLease(db, STEAM_LEASE, holder)

      // Подметание окон ограничителя и вчерашних игр дня — раз в цепочку, а не
      // на запрос: обе таблицы самокорректирующиеся (ключ содержит номер окна,
      // ключ выбора содержит дату), поэтому чистка нужна только чтобы они не
      // росли вечно. В пользовательском пути ей делать нечего — это лишняя
      // запись на каждой проверке лимита и на каждом заходе на /daily.
      if (!goesOn) {
        await sweepRateLimits(db, nowSec())
        // Вчерашние оставляем: на границе суток по UTC у части людей ещё идёт
        // «сегодня», и удалять их выбор из-под них незачем.
        await sweepDailyPicks(db, new Date((nowSec() - 86_400) * 1000).toISOString().slice(0, 10))
      }

      // Цепочка кончилась — заодно проверяем, жив ли крон пересказов. Он
      // висит на одном GitHub Actions без подстраховки в vercel.json, и
      // отвалиться может молча. Пинок делается ОДИН раз на цепочку, а не на
      // каждом звене, и не ждёт ответа: если пересказы на паузе, их роут сам
      // ответит {paused:true} — килл-свитч остаётся главнее нас.
      if (!goesOn && secret) {
        const last = await getCatalogMeta(db, 'digest_last_slice')
        if (digestLooksStale(last, nowSec())) {
          await fetch(`${appBaseUrl()}/api/cron/digest`, {
            headers: { 'x-cron-secret': secret },
          }).catch(() => {})
        }
      }

      if (goesOn && secret) {
        await fetch(
          `${appBaseUrl()}/api/cron/news?chain=${chain + 1}&holder=${encodeURIComponent(holder)}`,
          { headers: { 'x-cron-secret': secret } },
        ).catch(() => {})
      }
    }
  })

  return NextResponse.json(
    { started: true, chain, due: await countNewsPollDue(db, nowSec()) },
    { status: 202 },
  )
}
