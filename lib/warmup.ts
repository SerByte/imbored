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

export type WarmupProgress = {
  /** сколько игр ещё осталось разобрать */
  remaining: number
  /** сколько их было в самом начале — знаменатель для процента */
  total: number
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

export async function runWarmup(
  opts: {
    onProgress?: (p: WarmupProgress) => void
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

  const startedAt = nowMs()
  let total = 0

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
      const data = (await res.json()) as { remaining?: number }
      remaining = data.remaining ?? 0
    } catch {
      return 'error'
    }

    // Первый замер — он же общий объём работы: дальше остаток только убывает.
    if (remaining > total) total = remaining
    opts.onProgress?.({ remaining, total })

    if (remaining <= 0) return 'done'
    // Предел по времени проверяем ПОСЛЕ прогресса: пусть человек увидит, до
    // какого места дошло, прежде чем мы сдадимся.
    if (nowMs() - startedAt >= maxMs) return 'done'
  }

  // Вызовы кончились, а работа нет. Это всё равно 'done': выдача по неполному
  // каталогу лучше, чем экран ошибки на ровном месте.
  return 'done'
}

/** Доля выполненного, 0…100. Отдельно, потому что нужна и в UI, и в тестах. */
export function warmupPercent(p: WarmupProgress | null): number {
  if (!p || p.total <= 0) return 0
  const done = p.total - p.remaining
  return Math.max(0, Math.min(100, (done / p.total) * 100))
}
