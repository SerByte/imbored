import { LEANS, type Lean } from './mood'
import { NUDGES, type Nudge } from './nudge'
import type { Scope } from './recommend'
import { CANDIDATE_SOURCES, SCORE_FACTORS, type CandidateSource, type ScoreParts } from './types'

/*
 * СНИМОК ВЫДАЧИ К ФИДБЕКУ.
 *
 * Психологические гипотезы Stage 1 и 2 — «одна игра лучше пяти», «подталкивание
 * лучше пересборки», «знакомое вечером заходит чаще» — нечем было проверить:
 * строка фидбека знала игру, действие и настроение, но не знала, ГДЕ стояла
 * карточка, каким движком собрана выдача и чем она обогнала соседей. «Зашло»
 * у героя и «Зашло» у пятой карточки «Ещё вариантов» выглядели одинаково.
 *
 * Здесь белый список того, что клиент вправе приложить к оценке. Всё прочее
 * отбрасывается молча — как мусорные mood и reason в роуте: снимок нужен
 * отчёту (scripts/feedback-report.ts), а не подбору, и сорвать оценку из-за
 * него было бы хуже, чем потерять его.
 *
 * Части скора (parts) хранятся без показа: решение владельца — для анализа
 * да, на экран нет. Раздел 01 и 06 в /privacy говорят об этом прямо, а
 * хранится снимок девяносто дней (FEEDBACK_CTX_TTL_SEC, sweepStale).
 *
 * Модуль клиентский: словари берутся из lib/types, lib/mood и lib/nudge, в
 * которых нет ничего серверного, — копия списка здесь разъехалась бы с ними.
 */

/** Откуда оценка: основная выдача или «Игра дня» */
export const CTX_SOURCES = ['play', 'daily'] as const

/**
 * Где стояла карточка. hero — герой, до которого дошли «дальше» или с
 * которого выдача началась; picked — герой, выбранный из «Ещё вариантов»;
 * discovery — полка «Нет в библиотеке»; continue — строка «Продолжить».
 */
export const CTX_SLOTS = ['hero', 'picked', 'discovery', 'continue'] as const

export const CTX_ENGINES = ['claude', 'heuristic'] as const

/** Особый вид выдачи; обычная — без поля */
export const CTX_VARIANTS = ['roulette', 'untouched', 'seed'] as const

/**
 * Что значило нажатие, когда одного действия мало.
 *
 * launch  — запуск (steam://run или своя игра в чужом магазине);
 * store   — переход в магазин за не купленной игрой;
 * details — карточка игры на сайте;
 * install — «Поставить на загрузку» (steam://install): план, а не оценка,
 *           вкус и паузы его не видят (listFeedback);
 * ask     — ответ на вопрос после запуска («Не зацепило?»).
 */
export const CTX_INTENTS = ['launch', 'store', 'details', 'install', 'ask'] as const

export type CtxSource = (typeof CTX_SOURCES)[number]
export type CtxSlot = (typeof CTX_SLOTS)[number]
export type CtxEngine = (typeof CTX_ENGINES)[number]
export type CtxVariant = (typeof CTX_VARIANTS)[number]
export type CtxIntent = (typeof CTX_INTENTS)[number]

export type FeedbackCtx = {
  source?: CtxSource
  slot?: CtxSlot
  /** Место карточки в своём списке ответа /api/recommend, с нуля */
  rank?: number
  engine?: CtxEngine
  variant?: CtxVariant
  scope?: Scope
  lean?: Lean
  nudge?: Nudge
  /** Источник кандидата: заброшенное, бэклог, каталог… */
  candidate?: CandidateSource
  intent?: CtxIntent
  parts?: Partial<ScoreParts>
}

const SCOPES: readonly Scope[] = ['all', 'library']

/** Сколько карточек бывает в одном списке ответа — с запасом */
const MAX_RANK = 99

/** Потолок части скора: множители живут около единицы, вкус — от нуля до единицы */
const MAX_PART = 100

/**
 * Часть скора — четыре знака после запятой. Больше отчёту не нужно, а в
 * ответе /api/recommend одиннадцать карточек по десять частей.
 */
export function roundPart(x: number): number {
  return Math.round(x * 10_000) / 10_000
}

/** Части скора для карточки: только известные множители, округлённые */
export function partsView(parts: ScoreParts): Partial<ScoreParts> {
  const out: Partial<ScoreParts> = {}
  for (const k of SCORE_FACTORS) {
    const v = parts[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = roundPart(v)
  }
  return out
}

function oneOf<T extends string>(list: readonly T[], x: unknown): T | undefined {
  return typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : undefined
}

function parseParts(x: unknown): Partial<ScoreParts> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined
  const raw = x as Record<string, unknown>
  const out: Partial<ScoreParts> = {}
  for (const k of SCORE_FACTORS) {
    // Только собственные поля: унаследованное — не то, что прислали
    const v = Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] : undefined
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PART) out[k] = roundPart(v)
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Снимок из тела запроса — только известные ключи с допустимыми значениями.
 * null — не пришло ничего годного: строка фидбека пишется без снимка.
 */
export function parseFeedbackCtx(raw: unknown): FeedbackCtx | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const rank =
    typeof r.rank === 'number' && Number.isInteger(r.rank) && r.rank >= 0 && r.rank <= MAX_RANK
      ? r.rank
      : undefined
  const ctx: FeedbackCtx = {
    source: oneOf(CTX_SOURCES, r.source),
    slot: oneOf(CTX_SLOTS, r.slot),
    rank,
    engine: oneOf(CTX_ENGINES, r.engine),
    variant: oneOf(CTX_VARIANTS, r.variant),
    scope: oneOf(SCOPES, r.scope),
    lean: oneOf(LEANS, r.lean),
    nudge: oneOf(NUDGES, r.nudge),
    candidate: oneOf(CANDIDATE_SOURCES, r.candidate),
    intent: oneOf(CTX_INTENTS, r.intent),
    parts: parseParts(r.parts),
  }
  const kept = Object.fromEntries(
    Object.entries(ctx).filter(([, v]) => v !== undefined),
  ) as FeedbackCtx
  return Object.keys(kept).length ? kept : null
}
