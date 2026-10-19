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
 *
 * Страницы живут в app/[lang], и Next пишет маршруты как /[lang]/play. Ключи
 * бюджета остаются прежними (/play, «/» — главная): язык не меняет веса
 * бандла, код у обеих версий один — см. budgetRoute.
 */
import { LOCALES } from '../lib/i18n'

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

/** Маршрут сборки — ключом бюджета: '/[lang]/play' → '/play', '/[lang]' → '/' */
export function budgetRoute(route: string): string {
  if (route === '/[lang]') return '/'
  return route.startsWith('/[lang]/') ? route.slice('/[lang]'.length) : route
}

/**
 * Какие адреса обязаны лежать в пререндере, чтобы маршрут бюджета считался
 * статическим: на КАЖДОМ языке — '/' это /ru и /en. Статикой должна быть
 * главная обоих языков: её обеих отдаёт CDN.
 */
export function prerenderedAs(route: string): string[] {
  return LOCALES.map((locale) => (route === '/' ? `/${locale}` : `/${locale}${route}`))
}

export function checkBudget(stats: RouteStat[], budget: Budget, prerendered: string[]): Verdict {
  const rows = stats
    .map((s) => {
      const route = budgetRoute(s.route)
      return { route, kb: kb(s.firstLoadUncompressedJsBytes), limitKb: budget.routes[route] ?? budget.defaultKb }
    })
    .sort((a, b) => b.kb - a.kb)
  const seen = new Set(rows.map((r) => r.route))
  const pre = new Set(prerendered)
  return {
    over: rows.filter((r) => r.kb > r.limitKb),
    stale: Object.keys(budget.routes).filter((r) => !seen.has(r)),
    notStatic: (budget.static ?? []).filter((r) => !prerenderedAs(r).every((p) => pre.has(p))),
    rows,
  }
}
