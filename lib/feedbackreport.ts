import type { FeedbackCtx } from './feedbackctx'
import type { FeedbackAction } from './feedbackkinds'
import { plural } from './plural'

/*
 * ОТЧЁТ ПО СНИМКАМ ВЫДАЧИ — ЧИСТАЯ ЧАСТЬ.
 *
 * Строки фидбека со снимком (lib/feedbackctx) → попадания по осям: слот,
 * движок, подталкивание, вид выдачи, источник кандидата. Базу читает
 * scripts/feedback-report.ts, считает — это: подсчёт обязан совпадать с тем,
 * как точность видит сам продукт (feedbackStats в lib/db.ts), и проверяется он
 * тестами, а не глазами на проде.
 */

export type ReportRow = {
  steamid: string
  appid: number
  action: FeedbackAction
  reason: string | null
  ctx: FeedbackCtx | null
}

/** Оси, по которым отчёт режет попадания */
export const REPORT_AXES = ['slot', 'engine', 'nudge', 'variant', 'candidate', 'source', 'scope', 'lean'] as const

export type ReportAxis = (typeof REPORT_AXES)[number]

export type RateLine = {
  /** Значение оси; «—» — в снимке его не было (обычная выдача, без подталкивания…) */
  key: string
  /** «Зашло» — по играм, а не по нажатиям, как в feedbackStats */
  liked: number
  /** «Не то» без бросков рулетки и свайпов колоды */
  skipped: number
  /** Запуски — отдельно: запуск ещё не оценка */
  launched: number
  /** liked / (liked + skipped); null — оценок нет */
  rate: number | null
}

/** Ось без значения в снимке */
export const NO_VALUE = '—'

/**
 * Попадания по одной оси.
 *
 * Счёт тот же, что у feedbackStats: «Зашло» — одна игра одного человека один
 * раз, сколько бы раз её ни отметили; «Крутить ещё» и «Мимо» в колоде — не
 * промах подбора, а бросок и листание, в знаменатель не идут. Строки по
 * убыванию числа оценок: сверху то, чему можно верить.
 */
export function hitRates(rows: readonly ReportRow[], axis: ReportAxis): RateLine[] {
  const groups = new Map<string, { liked: Set<string>; skipped: number; launched: number }>()
  for (const r of rows) {
    const raw = r.ctx?.[axis]
    const key = raw === undefined || raw === null ? NO_VALUE : String(raw)
    let g = groups.get(key)
    if (!g) {
      g = { liked: new Set(), skipped: 0, launched: 0 }
      groups.set(key, g)
    }
    if (r.action === 'liked') g.liked.add(`${r.steamid}:${r.appid}`)
    else if (r.action === 'skipped' && r.reason !== 'spin' && r.reason !== 'explore') g.skipped++
    else if (r.action === 'launched') g.launched++
  }
  return [...groups]
    .map(([key, g]) => {
      const liked = g.liked.size
      const total = liked + g.skipped
      return { key, liked, skipped: g.skipped, launched: g.launched, rate: total ? liked / total : null }
    })
    .sort((a, b) => b.liked + b.skipped - (a.liked + a.skipped) || a.key.localeCompare(b.key))
}

/**
 * Меньше стольких оценок — доля ничего не говорит, и отчёт её прямо так и
 * помечает: «60%» из пяти нажатий выглядит выводом, а это шум.
 */
export const MIN_RATED = 30

/** Таблица одной оси — строками для консоли */
export function formatRates(axis: string, lines: readonly RateLine[]): string[] {
  const out = [`${axis}:`]
  if (!lines.length) return [...out, '  (пусто)']
  for (const l of lines) {
    const rated = l.liked + l.skipped
    const rate = l.rate === null ? '   —' : `${Math.round(l.rate * 100)}%`.padStart(4)
    const thin = rated > 0 && rated < MIN_RATED ? '  (мало данных)' : ''
    out.push(
      `  ${l.key.padEnd(10)} ${rate}  ` +
        `${l.liked} зашло / ${l.skipped} не то, ` +
        `${l.launched} ${plural(l.launched, 'запуск', 'запуска', 'запусков')}${thin}`,
    )
  }
  return out
}
