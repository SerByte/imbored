import type { Db } from './db'
import { logSwallowed } from './errlog'
import { llmBudgetLeft, takeLlmBudget } from './llmcap'

/**
 * Доля английского догона в суточном бюджете модели.
 *
 * Английская версия появилась, когда в базе уже лежали тысячи русских
 * пересказов патчей и pros/cons, собранных моделью. Новые тексты пишутся
 * сразу на двух языках одним вызовом, а старым нужен догон — и он один
 * выбрал бы общий бюджет (LLM_DAILY_CAP) за утро: подбор и портреты до
 * полуночи шли бы эвристикой и шаблоном. Поэтому у догона своя доля, и
 * берётся она ПЕРЕД общим бюджетом: отказ по доле общий не тратит.
 *
 * Догон — это английский пересказ по сохранённому телу патча (runDigestSlice,
 * режим 'en') и пересборка pros/cons модели без английского слота
 * (runPageSlice). Новые тексты в долю не входят: они платят обычный вызов,
 * как и до английской версии.
 *
 * Счётчик — в rate_limits, рядом с общим (lib/llmcap): ключ без SteamID,
 * сутки UTC, уборка — тем же sweepRateLimits.
 */

/** Сколько вызовов догона в сутки, если LLM_EN_BACKFILL_DAILY не задан */
export const LLM_EN_BACKFILL_DAILY_DEFAULT = 400

const DAY_SEC = 86_400

/**
 * LLM_EN_BACKFILL_DAILY из окружения — по правилам LLM_DAILY_CAP: пусто,
 * мусор и отрицательное — значение по умолчанию, 0 — догон выключен
 * намеренно. Читается на каждом вызове: смена без передеплоя и vi.stubEnv.
 */
export function enBackfillDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LLM_EN_BACKFILL_DAILY?.trim()
  if (!raw) return LLM_EN_BACKFILL_DAILY_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return LLM_EN_BACKFILL_DAILY_DEFAULT
  return Math.floor(n)
}

const dayStart = (nowSec: number) => Math.floor(nowSec / DAY_SEC) * DAY_SEC
const keyFor = (nowSec: number) => `llm-daily:en:${dayStart(nowSec)}`

/**
 * Чем кончилась попытка взять вызов догона:
 *   ok     — звать модель;
 *   share  — доля догона на сегодня выбрана (или выключена нулём): догон
 *            ждёт завтра, а остальная работа модели идёт как шла;
 *   capped — общий суточный бюджет выбран: молчит вся модель, и это то же
 *            'capped', что у остальных дверей (lib/llmcap).
 * Сбой учёта — 'share': закрыто, как и у общего бюджета, но без тревоги
 * health — догон подождёт, а остальной работе сбой доли не помеха.
 */
export type EnBackfillTake = 'ok' | 'share' | 'capped'

export async function takeEnBackfillBudget(db: Db, nowSec: number): Promise<EnBackfillTake> {
  const cap = enBackfillDailyCap()
  if (cap === 0) return 'share'
  try {
    const res = await db.execute({
      sql: `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET count = count + 1
            RETURNING count`,
      args: [keyFor(nowSec), dayStart(nowSec) + 2 * DAY_SEC],
    })
    const count = Number(res.rows[0]?.count)
    if (!Number.isFinite(count) || count > cap) return 'share'
  } catch (err) {
    logSwallowed('llm-cap:en-take', err)
    return 'share'
  }
  return (await takeLlmBudget(db, nowSec)) ? 'ok' : 'capped'
}

/**
 * Есть ли сегодня что тратить на догон — без записи: и доля, и общий бюджет.
 * Для решения «брать ли в работу то, что нужно только догону» до выборки
 * (очередь карточек, redoEnglish). Сбой учёта — «нет».
 */
export async function enBackfillLeft(db: Db, nowSec: number): Promise<boolean> {
  const cap = enBackfillDailyCap()
  if (cap === 0) return false
  try {
    const res = await db.execute({ sql: 'SELECT count FROM rate_limits WHERE key = ?', args: [keyFor(nowSec)] })
    const used = Number(res.rows[0]?.count ?? 0)
    if (!(used < cap)) return false
  } catch (err) {
    logSwallowed('llm-cap:en-used', err)
    return false
  }
  return llmBudgetLeft(db, nowSec)
}
