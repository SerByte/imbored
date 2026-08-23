import type { Db } from './db'

/**
 * Ограничение частоты для дорогих ручек.
 *
 * Почему Turso, а не Redis. Все ручки, которые надо ограничивать, и так ждут
 * базу до первой полезной строки — значит лимитер не добавляет ни вендора, ни
 * второго сетевого хопа. Идиома атомарной условной записи в проекте уже
 * обкатана (acquireLease в lib/db.ts), и держать рядом с ней вторую систему
 * координат было бы дороже, чем один INSERT ... ON CONFLICT.
 *
 * Почему не только память. Модульный Map живёт на инстанс, а инстансов у
 * Fluid Compute столько, сколько нужно нагрузке: такой счётчик видит 1/N
 * трафика и с ростом популярности слабеет ровно тогда, когда должен крепнуть.
 * Ровно эта ловушка описана в lib/db.ts у pace() — повторять её не будем.
 *
 * Поэтому два яруса. Память гасит очевидный флуд, не сходив никуда. База
 * считает по-настоящему.
 */

export type RateVerdict = { ok: true } | { ok: false; retryAfterSec: number }

export type RateOptions = {
  /** Пространство имён: 'connect', 'recommend', … — чтобы лимиты не смешивались */
  bucket: string
  /** Кого считаем: IP, steamid, что угодно стабильное */
  id: string
  /** Сколько попыток разрешено в окне */
  limit: number
  /** Длина окна в секундах */
  windowSec: number
  nowSec: number
}

/**
 * Окно фиксированное, а не скользящее, и это осознанный выбор. Скользящее
 * требует либо хранить отметки времени каждой попытки, либо два счётчика с
 * интерполяцией — и то и другое дороже по записи, а покупает лишь сглаживание
 * стыка окон. Стык здесь ничего не стоит: худшее, что даёт злоумышленник, —
 * двойной лимит на границе, а лимиты и так выставлены с запасом.
 */
function windowStart(nowSec: number, windowSec: number): number {
  return Math.floor(nowSec / windowSec) * windowSec
}

function keyFor(o: RateOptions): string {
  return `${o.bucket}:${o.id}:${windowStart(o.nowSec, o.windowSec)}`
}

/**
 * Префильтр в памяти.
 *
 * Потолок кратно выше настоящего: задача не «посчитать», а «перестать писать в
 * базу, когда по одному ключу с ЭТОГО инстанса уже прилетело столько, что
 * вердикт очевиден». Turso тарифицирует и записи тоже, и под ботом лимитер без
 * префильтра сам становится статьёй расхода.
 */
const PREFILTER_FACTOR = 10
const MEMORY_MAX_KEYS = 10_000
const memory = new Map<string, number>()

/**
 * Ключи уже содержат номер окна, поэтому старые записи не мешают счёту — они
 * просто занимают память. Чистим оптом при переполнении: точечное вычищение
 * по времени стоило бы прохода по всей карте, а цена сброса — недосчёт за одно
 * окно на одном инстансе, что для потолка ×10 роли не играет.
 */
function memoryHits(key: string): number {
  if (memory.size > MEMORY_MAX_KEYS) memory.clear()
  const n = (memory.get(key) ?? 0) + 1
  memory.set(key, n)
  return n
}

/** Только для тестов: префильтр живёт на модуле и иначе течёт между случаями */
export function resetRateMemory(): void {
  memory.clear()
}

/**
 * Проверить и сразу засчитать попытку.
 *
 * Fail open — по той же причине, что и у resolveSession в lib/sessions.ts:
 * недоступная база не должна превращаться в «сайт закрыт для всех». Отказ в
 * обслуживании из-за собственного сбоя хуже, чем пропущенный всплеск.
 */
export async function checkRate(db: Db, o: RateOptions): Promise<RateVerdict> {
  const key = keyFor(o)
  const retryAfterSec = windowStart(o.nowSec, o.windowSec) + o.windowSec - o.nowSec

  if (memoryHits(key) > o.limit * PREFILTER_FACTOR) return { ok: false, retryAfterSec }

  try {
    const res = await db.execute({
      sql: `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET count = count + 1
            RETURNING count`,
      // Живём вдвое дольше окна: подметание идёт из крона раз в час, и строка,
      // умершая ровно в конце окна, всё равно дождалась бы его.
      args: [key, o.nowSec + o.windowSec * 2],
    })
    const count = Number(res.rows[0]?.count ?? 0)
    return count > o.limit ? { ok: false, retryAfterSec } : { ok: true }
  } catch {
    return { ok: true }
  }
}

/** Сколько попыток уже засчитано в текущем окне (без засчитывания новой) */
export async function rateUsage(db: Db, o: RateOptions): Promise<number> {
  try {
    const res = await db.execute({
      sql: 'SELECT count FROM rate_limits WHERE key = ?',
      args: [keyFor(o)],
    })
    return Number(res.rows[0]?.count ?? 0)
  } catch {
    return 0
  }
}

/** Подметание истёкших окон. Зовётся из крона, никогда — из запроса */
export async function sweepRateLimits(db: Db, nowSec: number): Promise<void> {
  try {
    await db.execute({ sql: 'DELETE FROM rate_limits WHERE expires_at < ?', args: [nowSec] })
  } catch {
    // Мусор в таблице лимитов ничего не ломает: ключи содержат номер окна,
    // поэтому старые строки не влияют на счёт, а лишь занимают место.
  }
}

/**
 * Адрес клиента.
 *
 * x-forwarded-for приходит списком, и доверять можно только ПЕРВОМУ элементу —
 * его подставляет прокси Vercel, всё остальное клиент может написать сам.
 * Без прокси (локальная разработка) адреса нет вовсе, и общий ключ 'local'
 * честнее, чем выдуманный уникальный: локально лимит просто общий на всех.
 */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')
  const first = fwd?.split(',')[0]?.trim()
  return first || headers.get('x-real-ip')?.trim() || 'local'
}

/** Стандартный отказ. Retry-After — чтобы честный клиент знал, когда вернуться */
export function rateLimitedResponse(retryAfterSec: number): Response {
  return Response.json(
    { error: 'ratelimited' },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, retryAfterSec)) } },
  )
}
