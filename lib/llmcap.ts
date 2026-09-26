import type { Db } from './db'
import { logSwallowed } from './errlog'

/**
 * Суточный потолок вызовов модели — один на весь сервис.
 *
 * У каждой двери к модели свои ограничители: у подбора и портрета — потолки
 * на человека и на адрес, у кронов — длина цепочки и аренда. Но сумма по
 * всем ничем не ограничена: демо-сессии бесплатны, адресов много, и счёт за
 * неудачный день приходил бы постфактум. Здесь — общий бюджет на сутки UTC.
 *
 * Проверяется у вызывающих, последним — когда вызов точно состоится (ключ
 * есть, личные потолки пройдены, есть из чего выбирать). Иначе отказанные и
 * пустые запросы тратили бы общий бюджет.
 *
 * ЗАКРЫТ ПРИ СБОЕ. Потолки на человека (lib/ratelimit) пропускают при
 * недоступной базе: отказать живому человеку из-за сбоя учёта хуже, чем
 * пропустить лишний запрос. Здесь наоборот: сбой учёта — ровно тот момент,
 * когда расход не видно, а у каждой двери есть эвристика, которая отвечает
 * и без модели. Поэтому при ошибке — «нет».
 *
 * Счётчик живёт в rate_limits (ключ без SteamID — забывать в forgetUser
 * нечего) и чистится тем же sweepRateLimits.
 */

/** Сколько вызовов в сутки, если LLM_DAILY_CAP не задан */
export const LLM_DAILY_CAP_DEFAULT = 2000

const DAY_SEC = 86_400

/**
 * LLM_DAILY_CAP из окружения. Читается при каждом вызове: vi.stubEnv и смена
 * переменной без передеплоя. Пусто, мусор и отрицательное — значение по
 * умолчанию (в .env.example переменные стоят пустыми, а Number('') — это 0,
 * то есть молча выключенная модель). 0 — модель выключена намеренно.
 */
export function llmDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LLM_DAILY_CAP?.trim()
  if (!raw) return LLM_DAILY_CAP_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return LLM_DAILY_CAP_DEFAULT
  return Math.floor(n)
}

const dayStart = (nowSec: number) => Math.floor(nowSec / DAY_SEC) * DAY_SEC
const keyFor = (nowSec: number) => `llm-daily:all:${dayStart(nowSec)}`

/**
 * Взять из бюджета один вызов. true — звать модель, false — обойтись
 * эвристикой: бюджет выбран, модель выключена нулём или учёт недоступен.
 *
 * Считается попытка, а не успех: таймаут и отказ модели тоже стоят денег
 * (или по меньшей мере запроса), и граница суток — те же 00:00 UTC, что у
 * rate_limits.
 */
export async function takeLlmBudget(db: Db, nowSec: number): Promise<boolean> {
  const cap = llmDailyCap()
  if (cap === 0) return false
  try {
    const res = await db.execute({
      sql: `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET count = count + 1
            RETURNING count`,
      args: [keyFor(nowSec), dayStart(nowSec) + 2 * DAY_SEC],
    })
    const count = Number(res.rows[0]?.count)
    return Number.isFinite(count) && count <= cap
  } catch (err) {
    logSwallowed('llm-cap:take', err)
    return false
  }
}

/**
 * Сколько вызовов потрачено сегодня — без записи. Для решения «звать ли
 * вообще» до начала работы (крон карточек) и для /api/cron/health. null —
 * учёт недоступен.
 */
export async function llmBudgetUsed(db: Db, nowSec: number): Promise<number | null> {
  try {
    const res = await db.execute({
      sql: 'SELECT count FROM rate_limits WHERE key = ?',
      args: [keyFor(nowSec)],
    })
    return Number(res.rows[0]?.count ?? 0)
  } catch (err) {
    logSwallowed('llm-cap:used', err)
    return null
  }
}

/** Есть ли сегодня что тратить. Сбой учёта — «нет», как у takeLlmBudget. */
export async function llmBudgetLeft(db: Db, nowSec: number): Promise<boolean> {
  const cap = llmDailyCap()
  if (cap === 0) return false
  const used = await llmBudgetUsed(db, nowSec)
  return used !== null && used < cap
}
