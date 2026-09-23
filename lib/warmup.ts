/**
 * Прогрев каталога перед первой выдачей.
 *
 * Клиент дёргает /api/prepare в цикле, пока тот не скажет «больше нечего
 * разбирать»: один вызов укладывается примерно в десять секунд, а у человека
 * с большой библиотекой таких вызовов набирается несколько десятков.
 *
 * Логика живёт здесь, а не в странице, по двум причинам. Первая: её гоняли
 * ДВЕ страницы (/play и /daily) двумя почти одинаковыми копиями, и копии
 * успели разойтись — на /daily не было ни прогресса, ни обработки ошибок.
 * Вторая: цикл, который ходит в сеть по несколько минут, обязан быть покрыт
 * тестами, а vitest собирает только lib/.
 *
 * Что здесь важно и чего не было в копиях:
 *   • ответ проверяется на ok — 500 больше не читается как «прогрев закончен»;
 *   • любое исключение возвращается как 'error', а не оставляет страницу
 *     в вечном спиннере (на /daily экран ошибки был недостижим в принципе);
 *   • есть предел по ВРЕМЕНИ, а не только по числу вызовов: восемьдесят
 *     вызовов по десять секунд — это больше тринадцати минут ожидания;
 *   • цикл замечает, что работа не движется (см. WARMUP_STALL_LIMIT), и
 *     уходит вместе со страницей (opts.signal).
 */

import { plural } from './plural'

/**
 * Два факта о библиотеке, которые /api/prepare отдаёт с первого же ответа.
 * Считаются по снапшоту без метаданных, поэтому доступны раньше, чем каталог
 * вообще тронут, — экрану ожидания есть что сказать с первой секунды.
 */
export type LibraryFacts = {
  games: number
  untouched: number
}

export type WarmupProgress = {
  /** сколько игр ещё осталось разобрать */
  remaining: number
  /** сколько их было в самом начале — знаменатель для процента */
  total: number
  /** появляется с первого ответа; null, пока ответа не было */
  library: LibraryFacts | null
}

/**
 * Ответ прогрева бывает и от старой версии приложения (человек держал вкладку
 * открытой через деплой), поэтому факты валидируются, а не приводятся: экран
 * ожидания не должен показывать «NaN игр».
 */
function parseFacts(raw: unknown): LibraryFacts | null {
  if (!raw || typeof raw !== 'object') return null
  const { games, untouched } = raw as { games?: unknown; untouched?: unknown }
  if (typeof games !== 'number' || !Number.isFinite(games) || games < 0) return null
  if (typeof untouched !== 'number' || !Number.isFinite(untouched) || untouched < 0) return null
  return { games, untouched }
}

/**
 * 'aborted' — страница ушла сама (opts.signal): ни выдачу, ни ошибку
 * показывать уже некому, и вызывающий обязан просто выйти.
 */
export type WarmupResult = 'done' | 'unauthorized' | 'error' | 'aborted'

/** Потолок вызовов. Дальше почти наверняка что-то зациклилось. */
export const WARMUP_MAX_CALLS = 80

/**
 * Потолок ожидания. Три минуты — это уже за гранью терпения, но лучше отдать
 * выдачу по неполному каталогу, чем не отдать ничего: /api/recommend и
 * /api/daily работают и на частично прогретых данных.
 */
export const WARMUP_MAX_MS = 3 * 60_000

/**
 * После скольких вызовов отдать управление странице.
 *
 * Один. За первый вызов ensureMeta разбирает 200 игр (GetItems берёт их пачкой),
 * а scoreCandidates большего и не требует — этого хватает на пять карточек.
 * Всё остальное время цикла оплачивало данные для ШЕСТОЙ карточки и дальше,
 * при том что до трёх минут (WARMUP_MAX_MS) человек смотрел на экран ожидания
 * и уходил. Премиса, что выдача работает на частично прогретых данных, не
 * новая — она записана в докблоке выше и на ней уже держатся оба предела.
 *
 * Что при этом ХУЖЕ и с чем надо считаться: онлайн и цены обновляются в
 * /api/prepare только когда remaining дошёл до нуля. Значит первая выдача судит
 * о живости по старым замерам, а цены может не показать вовсе. Поэтому догрев
 * не молчит: полоса внизу и предложение обновить выдачу, когда он закончится.
 */
export const WARMUP_YIELD_AFTER = 1

/**
 * Сколько ответов ПОДРЯД без продвижения терпим, прежде чем сдаться.
 *
 * Steam отвечает 429 на GetItems или не отдаёт словарь тегов — ensureMeta
 * глотает сбой, метаданные не двигаются, и /api/prepare честно отдаёт тот же
 * остаток. Цикл этого не замечал: три минуты «Осталось разобрать 412 игр» с
 * неподвижной цифрой и до восьмидесяти пачек GetItems по двести appid от
 * одного человека — ровно пока нас ограничивают.
 *
 * Два, а не один: остаток законно стоит на месте, если вызов успел только
 * освежить снапшот библиотеки или засеять пул. Если же сервер сам говорит,
 * что Steam не ответил (stalled), второго раза не ждём — выходим сразу.
 * Выход — 'done', как и у пределов ниже: выдача работает и на неполном каталоге.
 */
export const WARMUP_STALL_LIMIT = 2

/**
 * Пауза перед повтором после ответа без продвижения. Повтор сразу же упёрся
 * бы в тот же отказ Steam; пара секунд — шанс, что окно лимита сдвинулось, и
 * заодно на один запрос меньше в то же окно.
 */
export const WARMUP_STALL_PAUSE_MS = 2_000

/**
 * Потолок одного вызова /api/prepare. Честный вызов укладывается в десять
 * секунд с небольшим (одна пачка GetItems — до семи); без потолка зависшее
 * соединение держало экран ожидания столько, сколько его держит браузер, —
 * мимо WARMUP_MAX_MS, который проверяется только между вызовами.
 */
export const WARMUP_CALL_TIMEOUT_MS = 30_000

/**
 * Сигнал одного вызова: ушла страница или вызов вышел за свой потолок.
 *
 * AbortSignal.any есть не во всех живых браузерах (Safari до 17.4), а
 * исключение здесь уронило бы прогрев целиком — там остаётся сигнал страницы:
 * уход важнее потолка.
 */
function callSignal(page: AbortSignal | undefined): AbortSignal | undefined {
  const timeout =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(WARMUP_CALL_TIMEOUT_MS) : undefined
  if (!page || !timeout) return page ?? timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([page, timeout]) : page
}

/** Пауза, которую прерывает уход страницы: ждать ради ушедшего незачем. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export async function runWarmup(
  opts: {
    onProgress?: (p: WarmupProgress) => void
    /**
     * Вызывается ОДИН раз, когда прогрева уже достаточно для первой выдачи, а
     * работа ещё не кончилась. Если работа кончилась раньше — не вызывается
     * вовсе: страница получит обычный 'done' и покажет выдачу как раньше.
     */
    onYield?: (p: WarmupProgress) => void
    yieldAfter?: number
    /**
     * Уход страницы. Без него цикл переживал уход с /play и продолжал ходить
     * в /api/prepare, а новый заход запускал второй такой же параллельно.
     * Отменяет и текущий вызов, и паузу между вызовами.
     */
    signal?: AbortSignal
    fetchFn?: typeof fetch
    /** подменяется в тестах, иначе предел по времени не проверить */
    nowMs?: () => number
    /** подменяется в тестах, чтобы паузы не ждать по-настоящему */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
    maxCalls?: number
    maxMs?: number
  } = {},
): Promise<WarmupResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const nowMs = opts.nowMs ?? (() => Date.now())
  const sleep = opts.sleep ?? pause
  const { signal } = opts
  const maxCalls = opts.maxCalls ?? WARMUP_MAX_CALLS
  const maxMs = opts.maxMs ?? WARMUP_MAX_MS
  const yieldAfter = opts.yieldAfter ?? WARMUP_YIELD_AFTER
  let yielded = false

  const startedAt = nowMs()
  let total = 0
  let library: LibraryFacts | null = null
  /** Остаток прошлого ответа — с ним сравнивается продвижение */
  let prevRemaining: number | null = null
  /** Ответов подряд без продвижения */
  let stalls = 0

  for (let i = 0; i < maxCalls; i++) {
    if (signal?.aborted) return 'aborted'
    let res: Response
    try {
      res = await fetchFn('/api/prepare', { method: 'POST', signal: callSignal(signal) })
    } catch {
      // Ушла страница — не сбой, а конец разговора. Иначе сеть отвалилась
      // или вызов вышел за потолок — и это не «прогрев закончен»
      return signal?.aborted ? 'aborted' : 'error'
    }

    // 401 без сессии, 409 без снапшота библиотеки: обоим лечение одно —
    // отправить человека подключаться заново, а не показывать ошибку
    if (res.status === 401 || res.status === 409) return 'unauthorized'
    if (!res.ok) return 'error'

    let remaining: number
    let stalled: boolean
    try {
      const data = (await res.json()) as { remaining?: number; library?: unknown; stalled?: unknown }
      remaining = data.remaining ?? 0
      // Флаг сервера: Steam не отдал метаданные, и повтор прямо сейчас упрётся
      // в тот же отказ (см. ensureMeta и /api/prepare)
      stalled = data.stalled === true
      // Единожды: числа не меняются в течение цикла, а вот пропасть в ответе
      // могут — тогда экран продолжит показывать то, что уже знает
      library ??= parseFacts(data.library)
    } catch {
      return signal?.aborted ? 'aborted' : 'error'
    }

    // Первый замер — он же общий объём работы: дальше остаток только убывает.
    if (remaining > total) total = remaining
    const progress: WarmupProgress = { remaining, total, library }
    opts.onProgress?.(progress)

    if (remaining <= 0) return 'done'

    // Порог пройден, а работа осталась — пора показать выдачу. Строго после
    // проверки remaining: если всё разобралось за один вызов, никакого «догрева
    // в фоне» нет и обещать его нечего.
    if (!yielded && i + 1 >= yieldAfter) {
      yielded = true
      opts.onYield?.(progress)
    }

    // Работа стоит — см. WARMUP_STALL_LIMIT. Как и предел по времени ниже,
    // проверяется ПОСЛЕ прогресса и сигнала отдачи: выдача по тому, что успело
    // доехать, лучше ещё минуты неподвижной цифры.
    if (stalled) return 'done'
    stalls = prevRemaining !== null && remaining >= prevRemaining ? stalls + 1 : 0
    prevRemaining = remaining
    if (stalls >= WARMUP_STALL_LIMIT) return 'done'

    // Предел по времени проверяем ПОСЛЕ прогресса: пусть человек увидит, до
    // какого места дошло, прежде чем мы сдадимся.
    if (nowMs() - startedAt >= maxMs) return 'done'

    if (stalls > 0) {
      await sleep(WARMUP_STALL_PAUSE_MS, signal)
      if (signal?.aborted) return 'aborted'
    }
  }

  // Вызовы кончились, а работа нет. Это всё равно 'done': выдача по неполному
  // каталогу лучше, чем экран ошибки на ровном месте.
  return 'done'
}

/**
 * Доля выполненного, 0…100. Отдельно, потому что нужна и в UI, и в тестах.
 *
 * Принимает только те два поля, которые считает: факты о библиотеке к проценту
 * отношения не имеют, и требовать их от вызывающего значило бы заставлять
 * выдумывать данные ради арифметики.
 */
export function warmupPercent(p: Pick<WarmupProgress, 'remaining' | 'total'> | null): number {
  if (!p || p.total <= 0) return 0
  const done = p.total - p.remaining
  return Math.max(0, Math.min(100, (done / p.total) * 100))
}

/**
 * Строка статуса, пока идёт разбор. Одна на /play и /daily: по ней экран
 * ожидания узнаёт счётчик и не отдаёт его скринридеру (см. warmupStage).
 */
export function remainingLine(remaining: number): string {
  return `Осталось разобрать ${remaining} ${plural(remaining, 'игру', 'игры', 'игр')}`
}

/** Этап разбора для скринридера — вместо счётчика, который меняется на каждом ответе */
export const COUNTING_STAGE = 'Разбираю библиотеку…'

/**
 * Что экран ожидания отдаёт в живую область: этап, а не счётчик.
 *
 * Видимая строка меняется с каждым ответом /api/prepare — «Осталось разобрать
 * 812 игр», «…790…», «…765…», — и в живой области это была бы очередь чисел
 * на минуту, из которой не услышать, когда начался подбор. Скринридеру
 * достаётся только смена этапа: «Изучаю библиотеку», «Разбираю», «Подбираю».
 * Сколько разобрано, говорит кольцо — своим именем, по запросу, а не вслух.
 *
 * Счётчик опознаётся точным совпадением с remainingLine, а не по началу
 * строки: подпись, которой нет в этом модуле, проходит как есть.
 */
export function warmupStage(
  message: string,
  p: Pick<WarmupProgress, 'remaining'> | null,
): string {
  if (p && p.remaining > 0 && message === remainingLine(p.remaining)) return COUNTING_STAGE
  return message
}
