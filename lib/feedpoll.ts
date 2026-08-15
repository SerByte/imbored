/**
 * Опрос головы ленты «Что нового».
 *
 * Здесь решения, а не таймеры. setTimeout, visibilitychange и router.refresh
 * живут в components/whatsnew/FeedWatch.tsx — но КОГДА спрашивать, СКОЛЬКО
 * ждать после сбоя, КОГДА замолчать и СКОЛЬКО записей человек ещё не видел
 * решается здесь, потому что vitest собирает только lib/, а поддельных
 * таймеров в проекте нет по соглашению (см. lib/warmup.ts и его тест: часы и
 * fetch внедряются, а не подменяются глобально).
 */

/**
 * Интервал опроса видимой вкладки. Единственная ручка частоты.
 *
 * Две минуты, а не пять секунд, как у комнат: там на том конце живой человек,
 * который прямо сейчас голосует, здесь — крон, который в лучшем случае ходит
 * раз в час. Опрос раз в тридцать секунд сделал бы 2880 запросов в сутки на
 * вкладку, чтобы увидеть одно изменение.
 */
export const PROBE_INTERVAL_MS = 120_000

/** Потолок отката после сбоёв. Полчаса — дальше проще перезагрузить страницу. */
export const PROBE_BACKOFF_MAX_MS = 30 * 60_000

/**
 * Потолок по времени НЕПРЕРЫВНОГО чтения. Вкладка, забытая на втором мониторе
 * на неделю, опрашивать сервер неделю не должна. Отсчёт сбрасывается при
 * возвращении во вкладку: двенадцать часов означают «двенадцать часов подряд
 * смотрел на ленту», а не «свернул двенадцать часов назад».
 */
export const PROBE_MAX_MS = 12 * 3_600_000

/** Страховка от сорванного таймера и переведённых часов. Временем не заменяется. */
export const PROBE_MAX_CALLS = 500

export type PollState = {
  calls: number
  failures: number
  lastAt: number
  startedAt: number
  stopped: boolean
}

export function initialPollState(nowMs: number): PollState {
  return { calls: 0, failures: 0, lastAt: nowMs, startedAt: nowMs, stopped: false }
}

/** Интервал, либо удвоение после каждого сбоя, но не дальше потолка. */
export function nextDelayMs(s: PollState): number {
  if (s.failures === 0) return PROBE_INTERVAL_MS
  return Math.min(PROBE_INTERVAL_MS * 2 ** s.failures, PROBE_BACKOFF_MAX_MS)
}

export function shouldProbe(s: PollState, o: { visible: boolean; nowMs: number }): boolean {
  if (s.stopped || !o.visible) return false
  return o.nowMs - s.lastAt >= nextDelayMs(s)
}

/** Считает вызов и ставит stopped, если упёрлись в любой из потолков. */
export function afterProbe(s: PollState, ok: boolean, nowMs: number): PollState {
  const calls = s.calls + 1
  const failures = ok ? 0 : s.failures + 1
  const stopped = calls >= PROBE_MAX_CALLS || nowMs - s.startedAt >= PROBE_MAX_MS
  return { calls, failures, lastAt: nowMs, startedAt: s.startedAt, stopped }
}

/**
 * Вернулись во вкладку: бюджет ВРЕМЕНИ с нуля, счётчик вызовов — нет.
 *
 * Асимметрия и есть причина держать оба потолка. Время ограничивает сеанс
 * чтения, а он честно начинается заново. Счётчик ловит разнос — сорванный
 * таймер, который молотит вызовы, обнулением по каждому переключению вкладки
 * маскировался бы бесконечно.
 */
export function onVisible(s: PollState, nowMs: number): PollState {
  return { ...s, startedAt: nowMs }
}

export type FeedHead = {
  showPopular: boolean
  now: number
  items: Array<{ k: string; at: number }>
}

export type ProbeResult = { kind: 'ok'; head: FeedHead } | { kind: 'error' } | { kind: 'stop' }

function validHead(v: unknown): v is FeedHead {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.showPopular !== 'boolean' || typeof o.now !== 'number') return false
  if (!Array.isArray(o.items)) return false
  return o.items.every(
    (i) =>
      typeof i === 'object' &&
      i !== null &&
      typeof (i as Record<string, unknown>).k === 'string' &&
      typeof (i as Record<string, unknown>).at === 'number',
  )
}

/**
 * Спросить голову ленты.
 *
 * 401 здесь НЕ означает «разлогинился»: маршрут обслуживает и гостей, так что
 * отказ авторизации — это поломка, а не состояние. 404 значит другое: старый
 * JS против нового деплоя, и долбить мёртвый маршрут до конца сессии незачем.
 *
 * Форма ответа проверяется, а не только парсится: структурно неверный, но
 * валидный JSON не должен доехать до countFresh и нарисовать «999 новых».
 */
export async function probeFeedHead(
  opts: { fetchFn?: typeof fetch; feed?: 'popular' | 'mine' } = {},
): Promise<ProbeResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const qs = opts.feed === 'popular' ? '?feed=popular' : ''
  let res: Response
  try {
    // no-store и на клиенте: Next патчит только серверный fetch, а
    // эвристическое кэширование браузера отдало бы устаревшую голову
    res = await fetchFn(`/api/whatsnew/head${qs}`, { cache: 'no-store' })
  } catch {
    return { kind: 'error' }
  }
  if (res.status === 404 || res.status === 410) return { kind: 'stop' }
  if (!res.ok) return { kind: 'error' }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { kind: 'error' }
  }
  if (!validHead(body)) return { kind: 'error' }
  return { kind: 'ok', head: body }
}

/**
 * Сколько записей в голове ленты человек ещё не видел.
 *
 * tailAt — время самой старой отрисованной записи, и без него счёт врёт. Окно
 * ленты фиксировано в тридцать строк, поэтому когда запись из него ВЫПАДАЕТ —
 * ранг игры упал ниже порога или пересказ переклассифицировал патч в hotfix
 * (setNewsDigest переписывает scale) — снизу подтягивается СТАРЫЙ патч,
 * которого в отрисованном наборе не было. Простая разность множеств посчитает
 * его новым обновлением, и плашка пообещает то, чего наверху не появится.
 * Порог по времени это снимает: чтобы считаться новым, надо обогнать хвост.
 */
export function countFresh(
  known: ReadonlySet<string>,
  tailAt: number,
  head: ReadonlyArray<{ k: string; at: number }>,
): number {
  let n = 0
  for (const it of head) if (!known.has(it.k) && it.at > tailAt) n++
  return n
}
