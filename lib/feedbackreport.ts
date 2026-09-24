import type { FeedbackCtx } from './feedbackctx'
import type { FeedbackAction } from './feedbackkinds'
import { playedEnough, playedLine } from './outcome'
import { plural } from './plural'

/*
 * ОТЧЁТ ПО СНИМКАМ ВЫДАЧИ — ЧИСТАЯ ЧАСТЬ.
 *
 * Строки фидбека со снимком (lib/feedbackctx) → попадания по осям: слот,
 * движок, подталкивание, вид выдачи, источник кандидата. Строки исходов
 * (lib/outcome.ts) → сколько после совета на самом деле сыграли. Базу читает
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

/* ---------- исход совета ---------- */

/** Строка outcomes для отчёта — то, что прочитал скрипт */
export type OutcomeReportRow = {
  /** Источник кандидата (untouched, new…) или null */
  source: string | null
  ctx: FeedbackCtx | null
  minutesBefore: number | null
  minutesAfter: number | null
  ownedAfter: boolean | null
  /** Сверен ли со снапшотом после совета */
  checked: boolean
  verdict: string | null
}

export type OutcomeLine = {
  key: string
  /** Советов, принятых в работу */
  total: number
  /** Из них уже сверены со снапшотом — только по ним доли что-то значат */
  checked: number
  /** Сыграно не меньше OUTCOME_PLAYED_MIN после совета */
  played: number
  /** Игры не было до совета, а теперь она в библиотеке */
  bought: number
  /** Медиана сыгранного у тех, кто сыграл, минут; null — никто */
  medianMinutes: number | null
  hooked: number
  meh: number
}

/** Оси исходов: источник кандидата и то, откуда и с какого места совет */
export const OUTCOME_AXES = ['candidate', 'source', 'slot', 'engine'] as const

export type OutcomeAxis = (typeof OUTCOME_AXES)[number]

/**
 * Сводка исходов по оси. Доли считаются от сверенных: несверенный совет не
 * «не сыграл», а «ещё неизвестно» — снапшот после него не приходил.
 */
export function outcomeStats(rows: readonly OutcomeReportRow[], axis: OutcomeAxis): OutcomeLine[] {
  const groups = new Map<string, OutcomeReportRow[]>()
  for (const r of rows) {
    const raw = axis === 'candidate' ? (r.source ?? r.ctx?.candidate) : r.ctx?.[axis]
    const key = raw === undefined || raw === null ? NO_VALUE : String(raw)
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups]
    .map(([key, list]) => {
      const checked = list.filter((r) => r.checked)
      const deltas = checked
        .map((r) => (r.minutesAfter === null ? null : r.minutesAfter - (r.minutesBefore ?? 0)))
        .filter((d): d is number => d !== null && playedEnough(d))
        .sort((a, b) => a - b)
      const mid = deltas.length ? deltas[Math.floor((deltas.length - 1) / 2)] : null
      return {
        key,
        total: list.length,
        checked: checked.length,
        played: deltas.length,
        bought: checked.filter((r) => r.minutesBefore === null && r.ownedAfter === true).length,
        medianMinutes: mid ?? null,
        hooked: list.filter((r) => r.verdict === 'hooked').length,
        meh: list.filter((r) => r.verdict === 'meh').length,
      }
    })
    .sort((a, b) => b.checked - a.checked || a.key.localeCompare(b.key))
}

/** Таблица исходов одной оси — строками для консоли */
export function formatOutcomes(axis: string, lines: readonly OutcomeLine[]): string[] {
  const out = [`${axis}:`]
  if (!lines.length) return [...out, '  (пусто)']
  for (const l of lines) {
    const share = l.checked ? `${Math.round((l.played / l.checked) * 100)}%`.padStart(4) : '   —'
    const median = l.medianMinutes === null ? '' : `, медиана ${playedLine(l.medianMinutes)}`
    const thin = l.checked > 0 && l.checked < MIN_RATED ? '  (мало данных)' : ''
    out.push(
      `  ${l.key.padEnd(10)} ${share} сыграли  ` +
        `${l.played} из ${l.checked} сверенных (всего ${l.total})${median}; ` +
        `купили ${l.bought}; «зацепило» ${l.hooked}, «так себе» ${l.meh}${thin}`,
    )
  }
  return out
}
