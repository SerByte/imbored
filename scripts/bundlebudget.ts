/**
 * Бюджет веса первой загрузки — логика без файловой системы.
 *
 * Вес скриптов растёт незаметно: один импорт не того модуля (motion/react
 * вместо framer-motion, gsap в заголовке) добавляет 30–90 КБ сразу всем
 * страницам раздела, а сборка проходит зелёной. Замеры есть — Next пишет их
 * в .next/diagnostics/route-bundle-stats.json, — но их никто не читает.
 * Здесь их читает CI и сверяет с bundle-budget.json.
 *
 * Потолок — на маршрут, в КБ без сжатия: так пишет Next, и так число не
 * зависит от уровня brotli. Маршрут, которого нет в списке, получает общий
 * потолок: новая тяжёлая страница обязана завести себе строку осознанно.
 */

export type RouteStat = { route: string; firstLoadUncompressedJsBytes: number }

export type Budget = {
  defaultKb: number
  routes: Record<string, number>
  static?: string[]
}

export type Verdict = {
  /** Превышения — валят проверку */
  over: { route: string; kb: number; limitKb: number }[]
  /** Строки бюджета без маршрута: переименовали или удалили страницу */
  stale: string[]
  /** Маршруты, которые обязаны быть статикой, а стали динамикой */
  notStatic: string[]
  /** Всё, что проверено, — для отчёта */
  rows: { route: string; kb: number; limitKb: number }[]
}

const kb = (bytes: number) => Math.round(bytes / 1024)

export function checkBudget(stats: RouteStat[], budget: Budget, prerendered: string[]): Verdict {
  const rows = stats
    .map((s) => ({ route: s.route, kb: kb(s.firstLoadUncompressedJsBytes), limitKb: budget.routes[s.route] ?? budget.defaultKb }))
    .sort((a, b) => b.kb - a.kb)
  const seen = new Set(stats.map((s) => s.route))
  const pre = new Set(prerendered)
  return {
    over: rows.filter((r) => r.kb > r.limitKb),
    stale: Object.keys(budget.routes).filter((r) => !seen.has(r)),
    notStatic: (budget.static ?? []).filter((r) => !pre.has(r)),
    rows,
  }
}
