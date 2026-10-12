import type { Db } from './db'
import { logSwallowed } from './errlog'

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

export type RateVerdict =
  | { ok: true }
  | {
      ok: false
      retryAfterSec: number
      /**
       * Первый отказ этому id в этом окне. Счётчику «сколько раз упёрлись в
       * потолок» нужен он, а не каждый отказ: человек, давящий «ещё» после
       * первого 429, раздул бы число, а скрипт за потолком писал бы в базу на
       * каждый запрос — ровно то, от чего бережёт префильтр.
       */
      first: boolean
    }

export type RateOptions = {
  /** Пространство имён: 'connect', 'recommend', … — чтобы лимиты не смешивались */
  bucket: string
  /** Кого считаем: IP, личный id (personalRateId), что угодно стабильное */
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

/**
 * Потолок только в памяти инстанса — для ручек, где адрес незачем хранить.
 *
 * checkRate пишет адрес в rate_limits до конца окна и уборки за ним: для входа и
 * подбора это честная плата за общий на все инстансы потолок. Счётчикам
 * воронки (/api/event, начало входа) такая точность не нужна — им надо лишь,
 * чтобы один скрипт не жёг записи Turso без предела, — а адрес рядом с числом
 * шагов в базе противоречил бы обещанию «шаги не связаны с тобой». Здесь
 * адрес живёт только в памяти, в пределах окна, и никуда не пишется.
 *
 * Ключ — имя ручки и адрес; окно фиксированное. Карта чистится оптом при
 * переполнении, как префильтр выше.
 */
export function memoryGate(o: { bucket: string; id: string; limit: number; windowSec: number; nowSec: number }): boolean {
  const key = `${o.bucket}:${o.id}:${Math.floor(o.nowSec / o.windowSec) * o.windowSec}`
  return memoryHits(`gate:${key}`) <= o.limit
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
  const windowEnd = windowStart(o.nowSec, o.windowSec) + o.windowSec
  const retryAfterSec = windowEnd - o.nowSec

  // Префильтр срабатывает, когда с этого инстанса в базу ушло уже десять
  // потолков: первый отказ к тому времени выдала она. Или она лежит — и тогда
  // счётчику отказов писать всё равно некуда
  if (memoryHits(key) > o.limit * PREFILTER_FACTOR) return { ok: false, retryAfterSec, first: false }

  try {
    const res = await db.execute({
      sql: `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET count = count + 1
            RETURNING count`,
      // Строка живёт ровно до конца своего окна: ключ содержит номер окна,
      // и после его конца она на счёт уже не влияет. Подметает её каждый
      // запуск крона новостей (sweepRateLimits) — значит, адрес лежит в базе
      // не дольше своего окна и ещё часа. Раньше срок был «вдвое дольше окна
      // от первой записи», и суточной доле адреса в бюджете модели
      // (lib/llmcap) это давало до трёх суток — мимо обещания «не позже чем
      // через двое суток» на /privacy.
      args: [key, windowEnd],
    })
    const count = Number(res.rows[0]?.count ?? 0)
    // Счёт в базе общий на все инстансы, поэтому «первый» — один на окно, а
    // не по одному на каждый инстанс, куда попал человек
    return count > o.limit ? { ok: false, retryAfterSec, first: count === o.limit + 1 } : { ok: true }
  } catch (err) {
    // Ворота открыты, и это решение — но не тайна: пока база лежит, защита
    // от чужого счёта за Steam и Claude держится на одном префильтре в памяти
    logSwallowed('ratelimit:check', err, { bucket: o.bucket })
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
  } catch (err) {
    logSwallowed('ratelimit:usage', err, { bucket: o.bucket })
    return 0
  }
}

/**
 * Подметание истёкших окон. Зовётся из крона новостей на каждом запуске
 * (onEnd в app/api/cron/news), никогда — из запроса.
 *
 * Каждый запуск, а не раз в сутки, — из-за обещания на /privacy: счётчик по
 * адресу стирается не позже чем через двое суток. Суточная доля адреса в
 * бюджете модели живёт до конца суток UTC, и при суточной уборке строка,
 * записанная сразу после полуночи, ждала бы её до сорока девяти часов. Цена
 * — один DELETE в час по таблице, в которой теперь лежат лишь живые окна.
 */
export async function sweepRateLimits(db: Db, nowSec: number): Promise<void> {
  try {
    await db.execute({ sql: 'DELETE FROM rate_limits WHERE expires_at < ?', args: [nowSec] })
  } catch (err) {
    logSwallowed('ratelimit:sweep', err)
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
 *
 * Честен этот адрес, только пока перед Vercel нет чужого прокси. За оранжевым
 * облаком Cloudflare Vercel пишет сюда адрес узла Cloudflare, и лимиты по IP
 * сливаются в общий на всю его площадку (DEPLOY.md, §5; сторож — в
 * .github/workflows/cron.yml). cf-connecting-ip вслепую не лекарство: его
 * подделает любой прямой запрос на 76.76.21.21 или *.vercel.app.
 */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')
  const first = fwd?.split(',')[0]?.trim()
  return first || headers.get('x-real-ip')?.trim() || 'local'
}

/**
 * Чей личный потолок тратит запрос — id для личного гейта дорогой ручки.
 *
 * Раньше личный потолок считался по steamid: «один steamid — один человек,
 * который завис на кнопке «ещё»». Сессии по вставленной ссылке это сломали.
 * /api/connect выдаёт их на ЛЮБОЙ публичный профиль без доказательства
 * владения (Resolved.verified в lib/sessions), и чужой со ссылкой делил
 * счётчик с владельцем: двадцать запросов в начале окна — и настоящий
 * владелец получал 429 на /play, /daily и /explore до конца окна, окно за
 * окном. Тот же перевёртыш прав, что уже закрыт для выхода со всех устройств:
 * кука, полученная без доказательства, вредит кукам, полученным с ним.
 *
 * Поэтому:
 *   • writer (вход через Steam или демо-личность, isWriter в lib/server) —
 *     по steamid. Это и правда один человек, и его телефон с ноутбуком делят
 *     один потолок, как задумано. Демо-личность и так своя у каждого
 *     посетителя (demoSteamId);
 *   • сессия по ссылке — по своей строке sessions: каждая тратит только своё.
 *     Владелец, вошедший по ссылке, — тоже: с чужой ссылкой на его профиль
 *     он счёт не делит.
 *
 * Свежая сессия по ссылке — свежий личный потолок. Дырой это не становится,
 * пока рядом стоит потолок адреса: /api/connect чеканит сессии не чаще своего
 * лимита по IP, а маршрут, считающий по этому id, ОБЯЗАН держать и гейт по
 * адресу — вторым, через checkRatesInOrder.
 *
 * steamid остаётся в ключе и у сессии по ссылке: forgetUser находит строки
 * rate_limits по ':' + steamid + ':' (USER_ROWS в lib/db), и потолки чужих
 * сессий на удалённый профиль уходят вместе с остальным. С ключом writer
 * такой не совпадёт: у того сразу за steamid идёт номер окна.
 *
 * Каждый потолок по SteamID — этот или голый steamid — назван в /privacy,
 * раздел 06, вместе с номером сессии: в базе лежит идентификатор человека, и
 * политика обязана это сказать. Новый такой bucket без слова там уронит
 * сторож (BY_STEAMID в lib/policy.test.ts).
 */
export function personalRateId(session: { steamid: string; sid: string }, writer: boolean): string {
  return writer ? session.steamid : `${session.steamid}:${session.sid}`
}

/**
 * Несколько гейтов ПО ОЧЕРЕДИ: следующий спрашивается, только если прошёл
 * предыдущий. Первый отказ — и дальше не считаем.
 *
 * Порядок здесь смысловой, а не для красоты: checkRate отмечает запрос в
 * счётчике ДО решения. Спроси гейты разом (Promise.all), и запрос, уже
 * отказанный по личному потолку, всё равно съедал бы место в потолке адреса:
 * один человек, давящий «ещё» после отказа, выедал бы общий на адрес бюджет
 * соседям по квартире или мобильному NAT. Ставь личный гейт первым.
 *
 * Отказ называет свой bucket: личный потолок и потолок адреса значат разное,
 * и тот, кто считает отказы (/api/recommend), их различает.
 */
export async function checkRatesInOrder(
  db: Db,
  gates: Array<Omit<Parameters<typeof checkRate>[1], 'nowSec'>>,
  nowSec: number,
): Promise<{ ok: true } | (Extract<RateVerdict, { ok: false }> & { bucket: string })> {
  for (const gate of gates) {
    const verdict = await checkRate(db, { ...gate, nowSec })
    if (!verdict.ok) return { ...verdict, bucket: gate.bucket }
  }
  return { ok: true }
}

/** Стандартный отказ. Retry-After — чтобы честный клиент знал, когда вернуться */
export function rateLimitedResponse(retryAfterSec: number): Response {
  return Response.json(
    { error: 'ratelimited' },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, retryAfterSec)) } },
  )
}
