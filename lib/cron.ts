import { timingSafeEqual } from 'node:crypto'

/**
 * Авторизация фоновых задач. Первый в проекте путь, не завязанный на куку
 * imbored_session: у крона сессии нет и быть не может.
 *
 * Vercel сам подставляет заголовок Authorization: Bearer $CRON_SECRET, когда
 * переменная задана в окружении проекта. x-cron-secret оставлен для ручного
 * curl и внешнего пингера.
 *
 * Без секрета в проде — закрыто наглухо: иначе публичный роут, дёргающий
 * Steam и Claude, становится бесплатным усилителем для любого желающего.
 * Локально без секрета открыто, чтобы не мешать разработке.
 */
export function cronAuthorized(headers: Headers): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return !process.env.VERCEL && process.env.NODE_ENV !== 'production'

  const given =
    headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? headers.get('x-cron-secret') ?? ''

  // сравнение длин до timingSafeEqual: на разной длине он бросает
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Запас на хвост вызова крона — то, что идёт ПОСЛЕ среза.
 *
 * Хвост — это finally: отметка в catalog_meta, отдача аренды и передача звена.
 * Передача самая долгая: passChain делает до двух запросов с паузой 1.5 с, а
 * ребёнок отвечает не сразу, а после getDb и взятия аренды — на холодном старте
 * это секунды. Не уложился хвост — инстанс снимают на maxDuration, и finally
 * не выполняется: цепочка молча рвётся, аренда висит ещё TTL.
 */
export const CRON_TAIL_MS = 12_000

/**
 * Срок среза — от НАЧАЛА вызова, а не от старта after().
 *
 * Стояло `Date.now() + 50_000` внутри after(), то есть уже после ответа. До
 * него на холодном старте проходят getDb с миграциями, взятие аренды и счёт
 * очереди — секунды, которых в бюджете не было. А maxDuration считает их все:
 * after живёт не дольше maxDuration маршрута (docs Next, after.md, Duration).
 * Бюджет 50 с плюс неучтённое начало плюс хвост выходили за 60.
 *
 * startedAt берётся первой строкой GET; maxDurationSec — экспорт того же роута,
 * чтобы срок не разъехался с потолком при его правке.
 */
export function sliceDeadline(startedAt: number, maxDurationSec: number): number {
  return startedAt + maxDurationSec * 1000 - CRON_TAIL_MS
}

export type SliceClock = {
  /**
   * Зовётся в начале каждой итерации. false — следующая, если окажется не
   * короче самой долгой из уже пройденных, до срока не уложится.
   */
  next(): boolean
  /** Самая долгая итерация среза на сейчас, мс */
  readonly longestMs: number
}

/**
 * Часы среза: не пускают в итерацию, которая заведомо не уложится.
 *
 * Срок проверялся только на входе в итерацию: «прошёл ли он». Итерация
 * карточки — это два похода в Steam через пейсер (1.7 с на шаг, таймаут по
 * 10 с) и вызов модели; начатая за секунду до срока, она выходила за него на
 * всю свою длину — ровно в хвост, отведённый под finally.
 *
 * Вопрос теперь другой: «уложится ли ещё одна». Длина итерации заранее не
 * известна, поэтому берётся самая долгая из уже пройденных в этом срезе —
 * оценка сверху по фактам, а не по худшему случаю (худший — двадцать с лишним
 * секунд на таймаутах — урезал бы срез вдвое ради редкого события). Первая
 * итерация идёт по-старому, по одному сроку: сравнить её ещё не с чем.
 *
 * Итерация меряется от начала до начала следующей, поэтому в неё попадает всё,
 * включая ветки с continue.
 */
export function sliceClock(deadlineAt: number): SliceClock {
  let longest = 0
  let prev: number | null = null
  return {
    next() {
      const t = Date.now()
      if (prev !== null) longest = Math.max(longest, t - prev)
      prev = t
      return t + longest <= deadlineAt
    },
    get longestMs() {
      return longest
    },
  }
}

type Stopped = 'done' | 'budget' | 'blocked'

/**
 * Передавать ли звено крона карточек дальше.
 *
 * Работа есть у среза карточек (hasMore) ИЛИ у сверки сигналов каталога
 * (lib/catalogsignals: budget — устаревшие остались). Второе нужно, когда
 * очередь карточек выбрана: без него цепочка кончалась бы первым звеном, и
 * сверка шла бы одной пачкой в сутки — круг по пулу в месяц вместо недели.
 *
 * Блок Steam у карточек останавливает цепочку и при работе у сверки:
 * следующее звено всё равно начало бы с похода в закрывшийся магазин.
 *
 * Упавшее звено передаёт эстафету всегда — довод в роуте, у «упало». И
 * всегда нужны секрет (без него ребёнка не позвать) и место до maxChain.
 */
export function pagesChainGoesOn(s: {
  failed: boolean
  slice: { hasMore: boolean; stopped: Stopped } | null
  signals: { stopped: Stopped } | null
  chain: number
  maxChain: number
  hasSecret: boolean
}): boolean {
  if (!s.hasSecret || s.chain >= s.maxChain) return false
  if (s.failed) return true
  if (s.slice?.stopped === 'blocked') return false
  return Boolean(s.slice?.hasMore) || s.signals?.stopped === 'budget'
}

/** Сколько крон пересказов может молчать, прежде чем его считают отвалившимся */
export const DIGEST_STALE_SEC = 3 * 3600

/**
 * Сколько может молчать крон новостей. Ходит ежечасно из GitHub (и раз в сутки
 * из vercel.json), так что три часа — это два пропущенных слота подряд.
 */
export const NEWS_STALE_SEC = 3 * 3600

/**
 * Сколько может молчать крон карточек.
 *
 * Расписание у него одно — суточное в vercel.json, 05:00 с разбросом внутри
 * часа на Hobby, — и ни одного внешнего. Сутки плюс два часа: на этот разброс и
 * на то, что последнее звено цепочки пишет отметку минут через двадцать после
 * первого.
 */
export const PAGES_STALE_SEC = 26 * 3600

export type CronJob = 'news' | 'digest' | 'pages'

type CronJobMeta = {
  /** Ключ catalog_meta, куда каждое звено пишет отметку о себе */
  lastKey: string
  /** Килл-свитч: '1' — крон стоит */
  pausedKey: string
  /** Сколько крону можно молчать, секунд */
  staleSec: number
}

/**
 * Где каждый крон оставляет след и сколько ему можно молчать.
 *
 * Одно место и для роутов, которые пишут отметку, и для тех, кто её читает
 * (пинок из /api/cron/news, /api/cron/health). Ключ, записанный одной
 * строкой, а прочитанный другой, — тот самый молчаливый обрыв, от которого
 * всё это и строится.
 */
export const CRON_JOBS: Record<CronJob, CronJobMeta> = {
  news: { lastKey: 'news_last_slice', pausedKey: 'news_paused', staleSec: NEWS_STALE_SEC },
  digest: { lastKey: 'digest_last_slice', pausedKey: 'digest_paused', staleSec: DIGEST_STALE_SEC },
  pages: { lastKey: 'pages_last_slice', pausedKey: 'pages_paused', staleSec: PAGES_STALE_SEC },
}

/**
 * Отметка суточной уборки (sweepStale): пишет крон новостей, читает
 * /api/cron/health. Одно имя на обоих — по той же причине, что CRON_JOBS.
 */
export const SWEEP_KEY = 'sweep_last'

/**
 * То, что крон пишет о себе в *_last_slice. Поля среза сверх этих не нужны.
 * llm — отказ сервиса модели внутри среза (DigestResult, PageSliceResult):
 * срез при этом отработал эвристикой и сам не «упал».
 */
type SliceMark = { at: number; упало?: string; обрыв?: string; llm?: 'down'; llmStatus?: number | null }

/** null — записи нет или в ней мусор: подтверждения, что крон жив, нет. */
function readMark(raw: string | null): SliceMark | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as {
      at?: unknown
      упало?: unknown
      обрыв?: unknown
      llm?: unknown
      llmStatus?: unknown
    }
    const at = Number(o?.at ?? 0)
    if (!Number.isFinite(at) || at <= 0) return null
    return {
      at,
      ...(typeof o.упало === 'string' ? { упало: o.упало } : {}),
      ...(typeof o.обрыв === 'string' ? { обрыв: o.обрыв } : {}),
      ...(o.llm === 'down'
        ? { llm: 'down' as const, llmStatus: typeof o.llmStatus === 'number' ? o.llmStatus : null }
        : {}),
    }
  } catch {
    return null
  }
}

/**
 * Сколько отказ модели в отметке считается новостью. Пересказы пишут отметку
 * каждый час, и живой отказ там не устаревает. А отметка карточек живёт сутки
 * (PAGES_STALE_SEC): мимолётный сбой в утреннем звене красил бы health весь
 * день — и присылал письмо «воркфлоу упал» каждый час.
 */
export const LLM_DOWN_FRESH_SEC = 3 * 3600

/**
 * Пора ли пнуть крон вручную: последний срез старше maxAgeSec.
 *
 * Началось с пересказов. У новостей есть подстраховка — суточный крон в
 * vercel.json, — а у пересказов нет: на Hobby лимит два расписания на проект,
 * и оба заняты. Значит пересказы висят на одном GitHub Actions, а он глушит
 * расписания после шестидесяти дней тишины в репозитории и вообще ничего не
 * обещает по срокам. Отвалиться это может молча. Три часа (DIGEST_STALE_SEC) —
 * с запасом на обычные опоздания GitHub (10–15 минут) и на пропущенный
 * слот-другой.
 *
 * Неразобранный JSON, отсутствующая запись и мусор в поле означают одно и то
 * же: подтверждения, что крон жив, у нас нет. Значит пинаем.
 */
export function sliceLooksStale(raw: string | null, nowSec: number, maxAgeSec: number): boolean {
  const mark = readMark(raw)
  return !mark || nowSec - mark.at >= maxAgeSec
}

/**
 * Пора ли крону новостей пнуть крон карточек.
 *
 * У карточек расписание одно, суточное, и повтора не было вовсе: не пришёл
 * вызов из vercel.json, пришёл в момент, когда аренду Steam держали новости
 * (ответ skipped: locked), или цепочка оборвалась на передаче звена — и сутки
 * потеряны. Так и выглядело «с 25.08 нет записей».
 *
 * Поводов два:
 *   • отметка старше PAGES_STALE_SEC — вызова не было вовсе;
 *   • последняя отметка — обрыв. Значит очередь не кончилась (звено передают
 *     только при hasMore), а продолжать некому до завтра. Пинок начинает
 *     цепочку заново — работа та же, что сделал бы следующий день, только
 *     раньше.
 * «упало» поводом не считается: упавшее звено само передаёт эстафету дальше,
 * и последней такая отметка остаётся, только когда цепочка дошла до MAX_CHAIN —
 * суточная норма выбрана, торопить нечего.
 *
 * Долбёжки нет: пинает только конец цепочки новостей (раз в час), а сам крон
 * карточек берёт ту же аренду Steam, что и новости.
 */
export function pagesNeedKick(raw: string | null, nowSec: number): boolean {
  if (sliceLooksStale(raw, nowSec, PAGES_STALE_SEC)) return true
  return Boolean(readMark(raw)?.обрыв)
}

export type SliceHealth =
  | { ok: true; ageSec?: number; paused?: true }
  | {
      ok: false
      problem: 'нет записи' | 'протух' | 'упало' | 'обрыв' | 'модель недоступна' | 'ключ Steam'
      ageSec?: number
      /** Причина из самой отметки: текст исключения или отказ передачи */
      detail?: string
    }

/**
 * Здоров ли крон по его последней отметке — для /api/cron/health.
 *
 * Отказ крона не оставлял следов снаружи: воркфлоу проверял только код
 * первого ответа, а это 202 ДО after(), то есть до всякой работы. Узнавали по
 * пустым карточкам неделями позже.
 *
 * Нездоров, если отметки нет, она старше staleSec, либо последнее, что крон о
 * себе записал, — «упало» или «обрыв». И если в свежей отметке (моложе
 * LLM_DOWN_FRESH_SEC) сервис модели отказал: пустой баланс или отозванный
 * ключ иначе видно только по тому, что пересказы перестали появляться, а
 * карточки собираются эвристикой. «Ключа нет вовсе» отказом не считается —
 * это настройка (без ключа сервис работает на эвристике), а не авария.
 *
 * Пауза (килл-свитч *_paused) — здорова, но видна. Паузу ставят руками и во
 * время разбора аварии, и ежечасное письмо «воркфлоу упал» в это время —
 * шум, а не сигнал. Забытую паузу показывает отчёт (scripts/news-report.ts,
 * раздел J) и поле paused в ответе.
 */
export function sliceHealth(
  raw: string | null,
  nowSec: number,
  staleSec: number,
  paused = false,
): SliceHealth {
  const mark = readMark(raw)
  const ageSec = mark ? nowSec - mark.at : undefined
  if (paused) return { ok: true, paused: true, ...(ageSec !== undefined ? { ageSec } : {}) }
  if (!mark || ageSec === undefined) return { ok: false, problem: 'нет записи' }
  if (mark.обрыв) return { ok: false, problem: 'обрыв', ageSec, detail: mark.обрыв }
  if (mark.упало) return { ok: false, problem: 'упало', ageSec, detail: mark.упало }
  if (ageSec >= staleSec) return { ok: false, problem: 'протух', ageSec }
  if (mark.llm === 'down' && ageSec < LLM_DOWN_FRESH_SEC) {
    const detail = mark.llmStatus == null ? 'нет связи' : `HTTP ${mark.llmStatus}`
    return { ok: false, problem: 'модель недоступна', ageSec, detail }
  }
  return { ok: true, ageSec }
}

/**
 * Жив ли ключ Steam Web API — по отметке пробы (lib/steamprobe.ts), которую
 * пишет конец цепочки новостей раз в час. Отозванный или просроченный ключ
 * иначе виден только как проглоченные строки в логе входа: люди просто не
 * могут войти.
 *
 * Отметки нет или она старше staleSec — пробы не было: цепочка новостей не
 * доходит до конца (это же покажет и сам news). Пауза новостей — здорово,
 * как у кронов: проба стоит вместе с ними.
 */
export function steamKeyHealth(
  raw: string | null,
  nowSec: number,
  staleSec: number,
  paused = false,
): SliceHealth {
  let mark: { at: number; ok: boolean; transient: boolean; detail?: string } | null = null
  try {
    const o = raw
      ? (JSON.parse(raw) as { at?: unknown; ok?: unknown; detail?: unknown; transient?: unknown })
      : null
    const at = Number(o?.at ?? 0)
    if (o && Number.isFinite(at) && at > 0) {
      mark = {
        at,
        ok: o.ok === true,
        transient: o.transient === true,
        ...(typeof o.detail === 'string' ? { detail: o.detail } : {}),
      }
    }
  } catch {
    mark = null
  }
  const ageSec = mark ? nowSec - mark.at : undefined
  if (paused) return { ok: true, paused: true, ...(ageSec !== undefined ? { ageSec } : {}) }
  if (!mark || ageSec === undefined) return { ok: false, problem: 'нет записи' }
  if (ageSec >= staleSec) return { ok: false, problem: 'протух', ageSec }
  // Мигание Steam (5xx, 429, таймаут) про ключ ничего не говорит
  if (!mark.ok && !mark.transient) {
    return { ok: false, problem: 'ключ Steam', ageSec, ...(mark.detail ? { detail: mark.detail } : {}) }
  }
  return { ok: true, ageSec }
}
