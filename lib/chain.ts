/**
 * Цикл звеньев крона — один на новости, пересказы и карточки.
 *
 * Пропускная способность кронов берётся не из частоты расписания (на Hobby
 * Vercel зовёт крон примерно раз в сутки, что бы ни стояло в vercel.json), а
 * из звеньев: срез работы на LINK_MS, за ним следующий, пока есть работа.
 *
 * РАНЬШЕ ЗВЕНО ПЕРЕДАВАЛОСЬ HTTP-ЗАПРОСОМ САМОМУ СЕБЕ, и в этом была вся беда.
 * Роут в конце after() звал `${appBaseUrl()}/api/cron/<job>?chain=N+1`, то
 * есть каждое звено было отдельным вызовом функции. Vercel на такой самовызов
 * со второго шага отвечает 508 (INFINITE_LOOP_DETECTED): замер по проду —
 * pages_last_slice {"chain":1, "enriched":14, "stopped":"budget",
 * "обрыв":"HTTP 508"}, и у пересказов то же, уже без прокси Cloudflare. За
 * запуск проходило одно-два звена, 20–40 карточек, а верх каталога модель не
 * получал вовсе.
 *
 * Теперь звенья идут подряд внутри ОДНОГО вызова: после ответа 202 роут
 * отдаёт runChain в after(), а тот крутит звенья, пока их пускают проверки
 * перед каждым (порядок — ниже, у gate). after живёт столько же, сколько
 * maxDuration роута (docs Next, after.md, Duration), — поэтому у всех трёх
 * роутов maxDuration = CRON_MAX_DURATION_SEC, 300 с, потолок Hobby с Fluid.
 *
 * Общая логика — здесь, а не копией в трёх роутах. Пока копий было три,
 * каждый из пяти фиксов надёжности (проглоченный отказ передачи, упавшее
 * звено, обрывающее цепочку, отметка, чей отказ рвал передачу, …) вносился в
 * две-три копии, а проглоченный отказ передачи, уже стоивший карточкам
 * суток, в пересказах дожил до отдельной правки. Роуту остаются авторизация,
 * само звено и конец запуска.
 *
 * Что сохранено от цепочки — ровно то, за что она платила:
 *   • аренда: одна на весь запуск, holder тот же, продлевается перед каждым
 *     звеном. Потеряна — запуск встаёт: два потока к Steam хуже остановки;
 *   • упавшее звено отличается от пустого, и у каждой задачи своё решение,
 *     идти ли дальше (verdict в роуте, *LinkVerdict в lib/cron);
 *   • отметка — диагностика, а не работа: её отказ не рвёт цикл;
 *   • килл-свитч *_paused проверяется перед каждым звеном, как раньше
 *     проверялся каждым вызовом.
 */

import {
  CRON_JOBS,
  sliceAlarm,
  sliceDeadline,
  type ChainStop,
  type CronJob,
  type LinkStop,
} from './cron'
import { acquireLease, getCatalogMeta, releaseLease, setCatalogMeta, type Db } from './db'
import { logSwallowed } from './errlog'
import { llmBudgetLeft } from './llmcap'
import { checkRate, rateUsage, type RateOptions } from './ratelimit'

/**
 * Сколько нужно звену, мс: столько должно оставаться до срока вызова
 * (sliceDeadline), чтобы следующее звено вообще начиналось.
 *
 * Сорок восемь секунд — то самое звено, что было при maxDuration = 60 (60
 * минус CRON_TAIL_MS). Под него подобраны пачки срезов — 20 карточек, 20 игр
 * новостей, 25 пересказов — и замеры: около четырнадцати карточек без модели,
 * около восьми с ней. Дробить мельче незачем (у каждого звена свой поход за
 * медиа пачкой и своя сверка сигналов), крупнее — хуже: реже проверки
 * аренды и паузы, и звено, не влезшее в остаток вызова, стоит целых LINK_MS
 * простоя в конце.
 *
 * При 300 с на вызов это шесть звеньев: срок 288 с, последнее начинается не
 * позже 240-й секунды.
 */
export const LINK_MS = 48_000

/**
 * Запас аренды сверх maxDuration. Срок аренды — не «сейчас + TTL», а конец
 * вызова: ceil(startedAt) + maxDuration + запас, одинаковый при взятии и при
 * каждом продлении. Живой запуск её не теряет, а убитый по сроку инстанс
 * держит её не дольше пятнадцати секунд сверх своей смерти — как и раньше,
 * когда TTL был 75 при maxDuration 60.
 */
export const LEASE_SLACK_SEC = 15

const secNow = () => Math.floor(Date.now() / 1000)

/** TTL аренды для acquireLease: до конца вызова плюс запас, не меньше секунды */
export function leaseTtlSec(startedAt: number, maxDurationSec: number, nowSec: number): number {
  return Math.max(1, Math.ceil(startedAt / 1000) + maxDurationSec + LEASE_SLACK_SEC - nowSec)
}

/**
 * Суточный счётчик звеньев задачи — в rate_limits, как суточный бюджет
 * модели (lib/llmcap): атомарный INSERT … ON CONFLICT … RETURNING, граница
 * суток UTC, старые окна подметает sweepRateLimits. В catalog_meta пришлось
 * бы читать и писать отдельно — и заводить уборку.
 */
const linksRate = (job: CronJob, cap: number, nowSec: number): RateOptions => ({
  bucket: 'cron-links',
  id: job,
  limit: cap,
  windowSec: 86_400,
  nowSec,
})

/** Сколько звеньев задача прошла за сутки UTC. Сбой учёта — 0, см. rateUsage. */
export function linksToday(db: Db, job: CronJob, nowSec: number): Promise<number> {
  return rateUsage(db, linksRate(job, 0, nowSec))
}

/** Почему запуск не начался: килл-свитч, суточный потолок, чужая аренда */
export type RunRefusal = 'paused' | 'daily' | 'locked'

/**
 * Можно ли начинать запуск — зовётся в GET до ответа, и при null аренда уже
 * взята. Порядок — от дешёвого к записи: аренду не берём, если всё равно
 * откажем.
 */
export async function openRun(
  db: Db,
  o: {
    job: CronJob
    lease: { key: string; holder: string }
    startedAt: number
    maxDurationSec: number
    /** Суточный потолок звеньев; без него — не считаем */
    dailyCap?: number
  },
): Promise<RunRefusal | null> {
  const now = secNow()
  if ((await getCatalogMeta(db, CRON_JOBS[o.job].pausedKey)) === '1') return 'paused'
  if (o.dailyCap !== undefined && (await linksToday(db, o.job, now)) >= o.dailyCap) return 'daily'
  const ttl = leaseTtlSec(o.startedAt, o.maxDurationSec, now)
  if (!(await acquireLease(db, o.lease.key, o.lease.holder, ttl, now))) return 'locked'
  return null
}

export type ChainEnd<R> = {
  ended: ChainStop
  /** Сколько звеньев начато за запуск, включая упавшие */
  links: number
  /** Итог последнего звена; null — звеньев не было или последнее упало */
  last: R | null
  /** Суммы полей totals по удачным звеньям запуска */
  totals: Record<string, number>
  упало: string | null
  /**
   * Сколько осталось до жёсткого срока функции (maxDuration), мс, — на момент
   * вызова, а не на начало конца запуска: пинки соседей ждут их ответа, и
   * проба ключа или IndexNow после них должны мерить уже то, что осталось.
   */
  hardLeftMs: () => number
}

export type ChainOpts<R extends object> = {
  db: Db
  job: CronJob
  lease: { key: string; holder: string }
  /** Date.now() первой строкой GET: срок считается от начала вызова */
  startedAt: number
  /** maxDuration роута — тем же экспортом, чтобы срок не разъехался с потолком */
  maxDurationSec: number
  /** Сам срез. deadlineAt — начало звена плюс linkMs */
  link: (x: { deadlineAt: number; index: number }) => Promise<R>
  /** Решение задачи по итогу звена: null — дальше (lib/cron, *LinkVerdict) */
  verdict: (x: { result: R | null; failed: boolean }) => LinkStop | null
  /** Потолок звеньев на запуск: держит горячую петлю, если звенья падают сразу */
  maxLinks: number
  linkMs?: number
  /** Звену нужна модель: без суточного бюджета (lib/llmcap) не начинаем */
  needsLlm?: boolean
  /** Суточный потолок звеньев задачи (pagesDailyLinks) */
  dailyCap?: number
  /** Числовые поля итога звена, которые складываются в «итого» за запуск */
  totals?: readonly (keyof R & string)[]
  /**
   * Конец запуска — после итоговой отметки и отдачи аренды: пинки соседей,
   * проба ключа, сброс кэша. Своё исключение глотает цикл: сделанного оно
   * не отменяет.
   */
  onEnd?: (end: ChainEnd<R>) => Promise<void>
}

const reason = (err: unknown) => (err instanceof Error ? err.message.slice(0, 120) : 'исключение')

/**
 * Запуск: звенья подряд, пока их пускают, затем итог, аренда и конец.
 *
 * Отметок в *_last_slice три вида, и различаются они полями links и ended:
 *   • в начале — { at, links: 0 }, но только поверх здорового итога (ниже);
 *   • после каждого звена — { at, links, …итог звена, итого, упало? };
 *   • в конце — то же плюс ended, почему запуск кончился.
 * Отметка без ended старше RUN_LOST_SEC — запуск, который сняли по сроку, не
 * дав дописать итог; health называет это «снят». Без промежуточных отметок
 * такой запуск выглядел бы здоровым прошлым итогом ещё сутки.
 *
 * Стартовая отметка НЕ затирает тревогу прошлого запуска — «упало», «снят»,
 * свежий отказ модели (sliceAlarm в lib/cron). Пишется она через сотню
 * миллисекунд после 202, а health зовут секундами позже: воркфлоу — после
 * пингов, человек — после ручного curl. Затирай она всё подряд, итог
 * упавшего запуска жил бы до следующего триггера, и health видел бы только
 * «запуск идёт» — 200 каждый час при восьми упавших звеньях из восьми. Такой
 * итог перепишет первое звено нынешнего запуска — своим, уже свежим.
 *
 * Не бросает: всё, что может сломаться, — звено, отметка, аренда, конец, —
 * ловится на своём месте.
 */
export async function runChain<R extends object>(o: ChainOpts<R>): Promise<ChainEnd<R>> {
  const { db, job } = o
  const linkMs = o.linkMs ?? LINK_MS
  const runDeadline = sliceDeadline(o.startedAt, o.maxDurationSec)
  const lastKey = CRON_JOBS[job].lastKey
  const totals: Record<string, number> = Object.fromEntries((o.totals ?? []).map((k) => [k, 0]))
  let links = 0
  let last: R | null = null
  let упало: string | null = null
  let ended: ChainStop | null = null

  const mark = async (): Promise<void> => {
    try {
      await setCatalogMeta(
        db,
        lastKey,
        JSON.stringify({
          at: secNow(),
          links,
          ...last,
          ...(o.totals?.length ? { итого: totals } : {}),
          ...(упало ? { упало } : {}),
          ...(ended ? { ended } : {}),
        }),
      )
    } catch (err) {
      logSwallowed('chain:mark', err, { cron: job })
    }
  }

  /*
   * Пускать ли следующее звено. Порядок — от бесплатного к записи:
   *   1. потолок звеньев на запуск и остаток времени — без базы;
   *   2. килл-свитч — чтение;
   *   3. аренда — продление тем же holder до того же срока; false значит, что
   *      её держит кто-то другой, то есть наш срок истёк или её отняли;
   *   4. бюджет модели, если звену она нужна, — чтение;
   *   5. суточный потолок — последним, потому что он засчитывает звено.
   */
  const gate = async (): Promise<ChainStop | null> => {
    if (links >= o.maxLinks) return 'links'
    if (runDeadline - Date.now() < linkMs) return 'time'
    const now = secNow()
    if ((await getCatalogMeta(db, CRON_JOBS[job].pausedKey)) === '1') return 'paused'
    const ttl = leaseTtlSec(o.startedAt, o.maxDurationSec, now)
    if (!(await acquireLease(db, o.lease.key, o.lease.holder, ttl, now))) return 'lease'
    if (o.needsLlm && !(await llmBudgetLeft(db, now))) return 'llm'
    if (o.dailyCap !== undefined) {
      // Сперва чтение: засчитанный отказ раздувал бы счётчик сверх потолка,
      // и health показывал бы 10 из 9
      if ((await linksToday(db, job, now)) >= o.dailyCap) return 'daily'
      if (!(await checkRate(db, linksRate(job, o.dailyCap, now))).ok) return 'daily'
    }
    return null
  }

  // Не прочли прошлую отметку — не затираем: стартовая только диагностика
  let startMark = false
  try {
    startMark = !sliceAlarm(await getCatalogMeta(db, lastKey), secNow())
  } catch (err) {
    logSwallowed('chain:prev-mark', err, { cron: job })
  }
  if (startMark) await mark()

  while (ended === null) {
    try {
      ended = await gate()
    } catch (err) {
      // Проверку не прошли не по правилу, а по сбою базы: аренду не
      // подтвердить, паузу не прочесть — звено не начинаем
      console.error(`cron ${job}: проверка перед звеном`, err)
      упало = reason(err)
      ended = 'failed'
    }
    if (ended) break

    links++
    last = null
    упало = null
    try {
      last = await o.link({ deadlineAt: Date.now() + linkMs, index: links - 1 })
      for (const k of o.totals ?? []) {
        const v = (last as Record<string, unknown>)[k]
        if (typeof v === 'number' && Number.isFinite(v)) totals[k] += v
      }
    } catch (err) {
      console.error(`cron ${job}: звено ${links}`, err)
      упало = reason(err)
    }
    ended = o.verdict({ result: last, failed: упало !== null })
    // Промежуточная отметка — только если запуск идёт дальше: итоговую
    // напишет код ниже
    if (!ended) await mark()
  }

  await mark()
  try {
    // Чужую аренду (ended === 'lease') этот вызов не тронет: отдаёт по holder
    await releaseLease(db, o.lease.key, o.lease.holder)
  } catch (err) {
    // Не отдали — истечёт сама к концу вызова плюс LEASE_SLACK_SEC
    logSwallowed('chain:release', err, { cron: job })
  }

  const line = chainEndLine({
    cron: job,
    links,
    ended,
    ms: Date.now() - o.startedAt,
    ...(упало ? { упало } : {}),
  })
  // lease и failed — не норма: второй поток к Steam или сбой базы
  if (ended === 'lease' || ended === 'failed') console.error(line)
  else console.log(line)

  const end: ChainEnd<R> = {
    ended,
    links,
    last,
    totals,
    упало,
    hardLeftMs: () => o.startedAt + o.maxDurationSec * 1000 - Date.now(),
  }
  if (o.onEnd) {
    try {
      await o.onEnd(end)
    } catch (err) {
      logSwallowed('chain:end', err, { cron: job })
    }
  }
  return end
}

/**
 * Строка в Runtime Logs о каждом запуске: сколько звеньев, почему кончился,
 * сколько длился.
 *
 * Отметка в catalog_meta отвечает на вопрос «что сейчас», а Runtime Logs — «что
 * было и когда». Одна строка JSON, потому что многострочное в сборщике логов
 * разъезжается на отдельные записи и перестаёт искаться (тот же довод, что у
 * serverErrorLine в lib/errlog). Троттлинг не нужен: запусков единицы в час.
 */
export function chainEndLine(e: {
  cron: CronJob
  links: number
  ended: ChainStop
  ms: number
  упало?: string
}): string {
  return JSON.stringify({ event: 'cron-run', ...e })
}

const RETRY_DELAY_MS = 1500

/** Пауза, вынесена ради теста: он не должен ждать полторы секунды. */
export type KickOpts = {
  fetchFn?: typeof fetch
  delayMs?: number
}

export type KickResult = { ok: true } | { ok: false; reason: string }

/**
 * Пнуть соседний крон — единственный HTTP-запрос кронов к самим себе.
 *
 * Пинок — не звено: его делает конец запуска новостей, которых зовёт
 * воркфлоу или расписание Vercel, то есть это один шаг от корневого вызова.
 * 508 Vercel отвечал со второго шага (замер: первое звено цепочки передавало
 * второе без отказов), а пнутый крон дальше никого не зовёт. Зачем пинки —
 * pagesNeedKick и sliceLooksStale в lib/cron.
 *
 * Отказ пинка не глотается. Когда-то тут стояло
 *
 *     await fetch(url, { headers }).catch(() => {})
 *
 * — не-2xx не проверялся, отказ сети пропадал, и за этим тихо умирали сутки
 * работы. Поэтому res.ok и ВОЗВРАТ ПРИЧИНЫ: вызывающий пишет её строкой
 * kickFailLine.
 *
 * ПОВТОР ТОЛЬКО НА ОТВЕТЕ. Пришедший не-2xx доказывает, что пнутый роут ответил
 * и работы не начал: after() планируется только на пути, который отвечает 202.
 * Отказ сети ничего не доказывает: запрос мог дойти, крон мог уйти работать.
 * Второй пинок тогда упёрся бы в его аренду — вреда нет, но нет и толку, а
 * отказ сети к собственному хосту за полторы секунды не проходит.
 *
 * Не бросает никогда: пинок не имеет права уронить конец запуска.
 */
export async function kickCron(url: string, secret: string, opts: KickOpts = {}): Promise<KickResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const delayMs = opts.delayMs ?? RETRY_DELAY_MS

  for (let попытка = 0; попытка < 2; попытка++) {
    if (попытка) await new Promise((r) => setTimeout(r, delayMs))
    try {
      const res = await fetchFn(url, { headers: { 'x-cron-secret': secret } })
      if (res.ok) return { ok: true }
      // Ответ пришёл — работы крон не начал. Второй заход безопасен.
      if (попытка) return { ok: false, reason: `HTTP ${res.status}` }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message.slice(0, 120) : 'сеть' }
    }
  }
  // сюда не доходим: цикл возвращает на обеих итерациях
  return { ok: false, reason: 'неизвестно' }
}

/** Строка для stderr, когда пинок не дошёл. Формат — как у chainEndLine. */
export function kickFailLine(e: { cron: CronJob; reason: string }): string {
  return JSON.stringify({ event: 'cron-kick-fail', ...e })
}
