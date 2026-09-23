import { axisBucket, TAGS_MAX_CONFIDENCE, type AxisBucket } from '../lib/semantics'
import type { GameSemantics } from '../lib/types'

/**
 * Сверка семантики с ручной разметкой (scripts/semantics-golden.json) и сводка
 * для semantics:report. Чистые функции: скрипт только читает базу и печатает.
 *
 * Зачем ручная разметка, если есть отзывы. Приор по тегам — таблица, которую
 * написал человек, и ошибиться в ней легко: один лишний вклад, и все пошаговые
 * стратегии становятся «на вечер». Тесты lib/semantics проверяют форму правил
 * (монотонность, потолки уверенности), но не то, совпадают ли ответы с тем,
 * что скажет игрок. Тридцать игр, размеченных руками, — дешёвый способ это
 * узнать до того, как семантика попадёт в скоринг.
 */

/** Ниже этого согласия отчёт выходит с кодом 1: приор в скоринг рано */
export const GOLDEN_MIN_AGREEMENT = 0.7

/** Время до веселья в разметке: mid — «ни быстро, ни медленно» (bucket null) */
export type TtfLabel = 'fast' | 'mid' | 'slow'

/**
 * Одна размеченная игра. Любое поле, кроме appid и name, можно не заполнять:
 * сверяется только то, в чём разметчик уверен. checked — разметку проверил
 * человек; черновые метки сверяются так же, а отчёт напоминает, сколько их.
 */
export type GoldenGame = {
  appid: number
  name: string
  checked?: boolean
  session?: GameSemantics['session']['bucket']
  timeToFun?: TtfLabel
  stopAnytime?: boolean
  challenge?: AxisBucket
  complexity?: AxisBucket
  pace?: AxisBucket
}

export const GOLDEN_FIELDS = [
  'session',
  'timeToFun',
  'stopAnytime',
  'challenge',
  'complexity',
  'pace',
] as const

export type GoldenField = (typeof GOLDEN_FIELDS)[number]

const ALLOWED: Record<GoldenField, ReadonlySet<unknown>> = {
  session: new Set(['short', 'medium', 'long']),
  timeToFun: new Set(['fast', 'mid', 'slow']),
  stopAnytime: new Set([true, false]),
  challenge: new Set(['low', 'mid', 'high']),
  complexity: new Set(['low', 'mid', 'high']),
  pace: new Set(['low', 'mid', 'high']),
}

/**
 * Разметка из JSON с проверкой формы. Опечатка в метке («hgh») — исключение с
 * именем игры, а не молча несравнимое поле: иначе согласие считалось бы по
 * меньшему числу меток, чем кажется разметчику.
 */
export function parseGolden(json: unknown): GoldenGame[] {
  const games = (json as { games?: unknown } | null)?.games
  if (!Array.isArray(games)) throw new Error('в разметке нет массива games')
  const seen = new Set<number>()
  return (games as Array<Record<string, unknown> | null>).map((g, i) => {
    const where = `games[${i}]${typeof g?.name === 'string' ? ` (${g.name})` : ''}`
    if (!g || !Number.isInteger(g.appid) || typeof g.name !== 'string') {
      throw new Error(`${where}: нужны целый appid и name`)
    }
    const appid = g.appid as number
    if (seen.has(appid)) throw new Error(`${where}: appid ${appid} размечен дважды`)
    seen.add(appid)
    for (const f of GOLDEN_FIELDS) {
      if (g[f] !== undefined && !ALLOWED[f].has(g[f])) {
        throw new Error(`${where}: ${f} = ${JSON.stringify(g[f])}, можно ${[...ALLOWED[f]].join(' | ')}`)
      }
    }
    if (g.checked !== undefined && typeof g.checked !== 'boolean') {
      throw new Error(`${where}: checked — true или false`)
    }
    return g as unknown as GoldenGame
  })
}

/** Семантика в словах разметки */
export function labelsOf(s: GameSemantics): Record<GoldenField, string | boolean> {
  return {
    session: s.session.bucket,
    timeToFun: s.timeToFun.bucket ?? 'mid',
    stopAnytime: s.session.canStopAnytime,
    challenge: axisBucket(s.axes.challenge),
    complexity: axisBucket(s.axes.complexity),
    pace: axisBucket(s.axes.pace),
  }
}

export type GoldenMismatch = {
  appid: number
  name: string
  field: GoldenField
  expected: string | boolean
  actual: string | boolean
}

export type GoldenReport = {
  /** Сколько меток сверено (игр в базе × заполненных полей) */
  compared: number
  agreed: number
  /** agreed / compared; null — сверять нечего */
  agreement: number | null
  byField: Record<GoldenField, { compared: number; agreed: number }>
  /** Размеченные игры, у которых семантики нет */
  missing: GoldenGame[]
  mismatches: GoldenMismatch[]
  /** Сколько игр разметки проверено человеком (checked: true) */
  checked: number
}

export function compareGolden(
  golden: readonly GoldenGame[],
  got: ReadonlyMap<number, GameSemantics>,
): GoldenReport {
  const byField = Object.fromEntries(
    GOLDEN_FIELDS.map((f) => [f, { compared: 0, agreed: 0 }]),
  ) as GoldenReport['byField']
  const missing: GoldenGame[] = []
  const mismatches: GoldenMismatch[] = []
  for (const g of golden) {
    const s = got.get(g.appid)
    if (!s) {
      missing.push(g)
      continue
    }
    const actual = labelsOf(s)
    for (const f of GOLDEN_FIELDS) {
      const expected = g[f]
      if (expected === undefined) continue
      byField[f].compared++
      if (actual[f] === expected) byField[f].agreed++
      else mismatches.push({ appid: g.appid, name: g.name, field: f, expected, actual: actual[f] })
    }
  }
  const compared = GOLDEN_FIELDS.reduce((n, f) => n + byField[f].compared, 0)
  const agreed = GOLDEN_FIELDS.reduce((n, f) => n + byField[f].agreed, 0)
  return {
    compared,
    agreed,
    agreement: compared ? agreed / compared : null,
    byField,
    missing,
    mismatches,
    checked: golden.filter((g) => g.checked === true).length,
  }
}

/** Счётчики по корзинам — всё, что отчёт печатает о каталоге целиком */
export type SemanticsSummary = {
  total: number
  basis: Record<GameSemantics['basis'], number>
  session: Record<GameSemantics['session']['bucket'], number>
  stopAnytime: number
  timeToFun: Record<TtfLabel, number>
  /** с числом часов, названным в отзывах */
  ttfHours: number
  axes: Record<'challenge' | 'complexity' | 'pace', Record<AxisBucket, number>>
  /**
   * Уверенность: < 0.2, до 0.4 включительно (потолок одних тегов,
   * TAGS_MAX_CONFIDENCE), до 0.7, выше. Граница по потолку — чтобы вторая
   * корзина читалась как «только теги», а дальние — как «помогли отзывы».
   */
  confidence: [number, number, number, number]
}

export function summarize(all: readonly GameSemantics[]): SemanticsSummary {
  const axis = () => ({ low: 0, mid: 0, high: 0 })
  const out: SemanticsSummary = {
    total: all.length,
    basis: { tags: 0, 'tags+reviews': 0 },
    session: { short: 0, medium: 0, long: 0 },
    stopAnytime: 0,
    timeToFun: { fast: 0, mid: 0, slow: 0 },
    ttfHours: 0,
    axes: { challenge: axis(), complexity: axis(), pace: axis() },
    confidence: [0, 0, 0, 0],
  }
  for (const s of all) {
    out.basis[s.basis]++
    out.session[s.session.bucket]++
    if (s.session.canStopAnytime) out.stopAnytime++
    out.timeToFun[s.timeToFun.bucket ?? 'mid']++
    if (s.timeToFun.hours !== null) out.ttfHours++
    for (const a of ['challenge', 'complexity', 'pace'] as const) out.axes[a][axisBucket(s.axes[a])]++
    const c = s.confidence
    out.confidence[c < 0.2 ? 0 : c <= TAGS_MAX_CONFIDENCE ? 1 : c <= 0.7 ? 2 : 3]++
  }
  return out
}
