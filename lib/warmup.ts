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
 *     вызовов по десять секунд — это больше тринадцати минут ожидания.
 */

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

export type WarmupResult = 'done' | 'unauthorized' | 'error'

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
    fetchFn?: typeof fetch
    /** подменяется в тестах, иначе предел по времени не проверить */
    nowMs?: () => number
    maxCalls?: number
    maxMs?: number
  } = {},
): Promise<WarmupResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const nowMs = opts.nowMs ?? (() => Date.now())
  const maxCalls = opts.maxCalls ?? WARMUP_MAX_CALLS
  const maxMs = opts.maxMs ?? WARMUP_MAX_MS
  const yieldAfter = opts.yieldAfter ?? WARMUP_YIELD_AFTER
  let yielded = false

  const startedAt = nowMs()
  let total = 0
  let library: LibraryFacts | null = null

  for (let i = 0; i < maxCalls; i++) {
    let res: Response
    try {
      res = await fetchFn('/api/prepare', { method: 'POST' })
    } catch {
      // сеть отвалилась — это не «прогрев закончен»
      return 'error'
    }

    // 401 без сессии, 409 без снапшота библиотеки: обоим лечение одно —
    // отправить человека подключаться заново, а не показывать ошибку
    if (res.status === 401 || res.status === 409) return 'unauthorized'
    if (!res.ok) return 'error'

    let remaining: number
    try {
      const data = (await res.json()) as { remaining?: number; library?: unknown }
      remaining = data.remaining ?? 0
      // Единожды: числа не меняются в течение цикла, а вот пропасть в ответе
      // могут — тогда экран продолжит показывать то, что уже знает
      library ??= parseFacts(data.library)
    } catch {
      return 'error'
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
    // Предел по времени проверяем ПОСЛЕ прогресса: пусть человек увидит, до
    // какого места дошло, прежде чем мы сдадимся.
    if (nowMs() - startedAt >= maxMs) return 'done'
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
