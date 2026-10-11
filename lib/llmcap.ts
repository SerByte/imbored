import type { Db } from './db'
import { logSwallowed } from './errlog'
import { checkRate } from './ratelimit'

/**
 * Суточный потолок вызовов модели — один на весь сервис.
 *
 * У каждой двери к модели свои ограничители: у подбора и портрета — потолки
 * на человека и на адрес, у кронов — потолки звеньев и аренда. Но сумма по
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
 * Общий бюджет берётся первым пришедшим, поэтому у дверей, открытых
 * посетителю, — подбора и портрета — перед ним стоит ещё доля адреса
 * (takeLlmBudgetForIp, одна на обе двери): один адрес не выбирает сутки за
 * всех. Кроны берут бюджет напрямую: адреса у них нет, а свои потолки
 * звеньев есть.
 *
 * Счётчики живут в rate_limits (ключи без SteamID — забывать в forgetUser
 * нечего) и чистятся тем же sweepRateLimits. Адрес в доле — как у любого
 * потолка по IP: строка живёт до конца своих суток UTC (срок — конец окна,
 * checkRate) и уходит с ближайшим запуском крона новостей — в пределах двух
 * суток, обещанных на /privacy.
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
 * Доля одного адреса в суточном бюджете: какая часть LLM_DAILY_CAP и не
 * меньше какого числа.
 *
 * Потолки подбора на человека и на адрес (/api/recommend) стерегут Turso и
 * чужие руки на кнопке, а не бюджет модели: шестьдесят подборов на адрес за
 * десять минут — это до 360 вызовов в час с одного адреса. У портрета
 * (/portrait/<steamid>) потолок адреса стережёт ключ от перебора steamid —
 * и пропускает до шестидесяти холодных текстов в час. Скрипт с тремя
 * сессиями по ссылке на чужие публичные профили выбирал LLM_DAILY_CAP=2000
 * часов за пять, а 150 — минут за двадцать пять, и до полуночи UTC модель
 * молчала для всех: подбор шёл эвристикой, пересказы патчей вставали на
 * 'llm', карточки игр — тоже. Денег сверх потолка это не стоило, но отнимало
 * модель у всех остальных — каждый день заново.
 *
 * Пять процентов: один адрес выбирает не больше двадцатой доли суток. Десять
 * снизу: при маленьком бюджете доля в семь-восемь вызовов отняла бы
 * настоящий подбор и у честного человека, который пару раз сменил
 * настроение. Цена — соседям по большому NAT: выбрав долю адреса, они до
 * полуночи получают ту же выдачу эвристикой, а портрет — шаблоном. Отказа
 * нет, как и у общего бюджета: это не их личный потолок, и отказывать им не
 * за что.
 */
export const LLM_IP_SHARE = 0.05
export const LLM_IP_MIN = 10

export function llmIpDailyLimit(env: Record<string, string | undefined> = process.env): number {
  return Math.max(LLM_IP_MIN, Math.ceil(llmDailyCap(env) * LLM_IP_SHARE))
}

/**
 * Взять вызов из бюджета от имени адреса: сначала его доля, потом общий
 * бюджет. Порядок тот же, что у checkRatesInOrder: отказанный по доле запрос
 * общий бюджет не тратит. Личные потолки (демо-квота) — у вызывающего, до
 * этого вызова.
 *
 * Модель выключена нулём — доля не трогается: вызова всё равно не будет, и
 * писать в базу незачем. Сбой учёта доли пропускает (checkRate открыт при
 * сбое), но общий бюджет при том же сбое закрыт — значит, и ответ «нет».
 */
export async function takeLlmBudgetForIp(db: Db, ip: string, nowSec: number): Promise<boolean> {
  if (llmDailyCap() === 0) return false
  const share = await checkRate(db, {
    bucket: 'llm-ip',
    id: ip,
    limit: llmIpDailyLimit(),
    // Окно — те же сутки UTC, что у общего бюджета: windowStart в
    // lib/ratelimit режет по кратному 86 400, как и dayStart здесь
    windowSec: DAY_SEC,
    nowSec,
  })
  return share.ok && takeLlmBudget(db, nowSec)
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
