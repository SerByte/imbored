/**
 * Переходы выдачи /play, которые можно проверить без браузера.
 *
 * Страница выдачи держит два десятка useState, а vitest видит только lib/.
 * До этого файла переходы между ними проверялись одним регэкспом по исходнику,
 * и это аукнулось: новую выдачу приносят четыре пути — первая выдача, «Попробовать
 * снова», переключатели «Любые игры / Только моё» и «хочется …», «Обновить
 * выдачу» после догрева, — и каждый сбрасывал СВОЁ. Переключатель сбрасывал
 * шесть полей, «Обновить выдачу» — одно индекс. Нажал «Не то — дальше», открылся
 * ряд причин, в этот момент догрев закончился и ты нажал «Обновить» — новая
 * пятёрка приходила с открытым вопросом «Почему не то?» под новым героем и со
 * счётчиком пропусков из прошлой выдачи, так что экран «не игровой вечер»
 * наступал раньше пяти пролистанных игр.
 *
 * Здесь то, что у всех путей общее: что такое выдача (Deal), с какого героя
 * она начинается и в каком состоянии экрана (FRESH_TURN), куда ведёт «дальше»
 * (nextStep). Страница применяет выдачу одной функцией — applyDeal в
 * app/play/page.tsx, — и сторож в playflow.test.ts не даёт завести вторую дверь.
 */

import type { GameArtUrls } from './art'
import type { PickEdge } from './badges'
import type { Discount } from './discount'
import type { GameTrait } from './gametraits'
import { parseLean, type Lean } from './mood'
import { plural } from './plural'
import type { ContinueGame, OwnAnchor, Scope } from './recommend'
import type { CandidateSource } from './types'

export type PickSignals = {
  matchPercent: number | null
  sharedTags: string[]
  moodTags: string[]
  /**
   * Настроение словами из семантики (explainMatch). Необязательно: выдача,
   * сохранённая на устройстве до этого поля (lib/playcache.ts), его не несёт.
   */
  moodWords?: string[]
} | null

/** Карточка выдачи — как её отдаёт /api/recommend (enrich в app/api/recommend/route.ts). */
export type PlayPick = {
  appid: number
  name: string
  source: CandidateSource
  reason: string
  headerImage: string | null
  art: GameArtUrls | null
  /** Кадры для морфа в герое. Приходят только у picks: карточки открытий
      героем не становятся, им они не нужны. */
  screenshots?: string[]
  ccu: number | null
  ccuAt: number | null
  shortDescription: string | null
  tags: string[]
  hoursPlayed: number | null
  /**
   * Длина захода из уверенной семантики (sessionTrait): «Сессия ~20 мин»,
   * «Матч ~15 мин». null — не знаем; нет поля — выдача из кэша устройства,
   * сохранённая до него.
   */
  session?: GameTrait | null
  store: string | null
  storeUrl: string | null
  priceFinal: number | null
  isFree: boolean | null
  discount: Discount | null
  signals: PickSignals
  /** Своя игра, на которую эта похожа сильнее всего (buildAnchorFinder) */
  via: OwnAnchor | null
  /** Вернувшееся «Просто не сейчас» (deferredOf): сколько дней назад отложил */
  deferred: { daysAgo: number } | null
  /** Чем она лучше соседних по выдаче (assignEdges) — у героя фразой, у плитки бейджем */
  edge: PickEdge | null
  /** Можно ли обещать возврат Steam (refundEligible) — только у не купленного */
  refund: boolean
}

/**
 * Выдача целиком: то, что пришло, плюс то, о чём спрашивали.
 *
 * scope — из запроса, а не из эха сервера: при фокусе «нераспакованное» сервер
 * сам подменяет его на 'library', а переключатель на странице при фокусе
 * спрятан и помнить эту подмену ему незачем. lean, наоборот, из эха: кнопки
 * обязаны показывать, под что собрана выдача на экране, а не что мы просили.
 */
export type Deal = {
  picks: PlayPick[]
  discoveries: PlayPick[]
  continueGame: ContinueGame | null
  engine: string
  lean: Lean | null
  scope: Scope
  /** Серверные часы ответа — по ним PlayersNow решает, можно ли сказать «сейчас» */
  nowSec: number
  /**
   * Чья выдача — steamid сессии, для которой её собрали. Нужен записи на
   * устройстве (lib/playcache.ts): вкладка переживает смену входа, и выдачу
   * по чужой библиотеке показывать нельзя. null — сервер старой версии.
   */
  viewer: string | null
}

/**
 * Ответ /api/recommend → выдача. Пустая выдача — не выдача: показывать нечего,
 * и вызывающий обязан уйти в ветку отказа, а не рисовать героя из undefined.
 */
export function dealFrom(body: unknown, scope: Scope): Deal | null {
  if (!body || typeof body !== 'object') return null
  const d = body as {
    picks?: unknown
    discoveries?: unknown
    engine?: unknown
    lean?: unknown
    continue?: unknown
    nowSec?: unknown
    viewer?: unknown
  }
  if (!Array.isArray(d.picks) || d.picks.length === 0) return null
  return {
    picks: d.picks as PlayPick[],
    discoveries: Array.isArray(d.discoveries) ? (d.discoveries as PlayPick[]) : [],
    continueGame: (d.continue as ContinueGame | null | undefined) ?? null,
    engine: typeof d.engine === 'string' ? d.engine : '',
    lean: parseLean(d.lean),
    scope,
    nowSec: typeof d.nowSec === 'number' && Number.isFinite(d.nowSec) ? d.nowSec : 0,
    viewer: typeof d.viewer === 'string' && d.viewer ? d.viewer : null,
  }
}

/**
 * Почему выдача не пришла. Раньше вызывающий получал голый null и на экране
 * выдачи не мог сказать ничего: 429 и оборванная сеть выглядели одинаково.
 */
export type Miss =
  /** 429 — потолок частоты; waitSec — из Retry-After, если он был */
  | { miss: 'limited'; waitSec: number | null }
  /** 401 — сессии нет, страница уже уходит на вход, и говорить нечего */
  | { miss: 'gone' }
  /** Отказ с кодом из тела, сеть, пустой ответ — выдача на экране прежняя */
  | { miss: 'failed'; code: string | null }

/**
 * Строка под переключателями «Любые игры / Только моё» и «хочется …», когда
 * пересобрать не вышло.
 *
 * Раньше в этом случае не было ничего: кнопка отжималась, выдача стояла
 * прежней, и продукт выглядел сломанным. Чаще всего это потолок частоты —
 * двадцать подборов за десять минут, а каждое нажатие переключателя и есть
 * подбор, — и тогда честнее всего назвать срок.
 */
export function switchLine(m: Miss): string | null {
  switch (m.miss) {
    case 'limited': {
      if (m.waitSec === null) return 'Слишком часто — попробуй чуть позже'
      const min = Math.max(1, Math.ceil(m.waitSec / 60))
      return `Слишком часто — попробуй через ${min} ${plural(min, 'минуту', 'минуты', 'минут')}`
    }
    case 'gone':
      return null
    case 'failed':
      // Кандидатов не осталось — не сбой, и «попробуй ещё» тут не поможет
      return m.code === 'nocandidates'
        ? 'Под это ничего не нашлось, выдача прежняя'
        : 'Не получилось переключить, выдача прежняя'
  }
}

/** Состояние экрана вокруг героя — то, что сбрасывает каждая новая выдача. */
export type Turn = {
  /** Откуда пришёл герой — задаёт направление анимации смены (HERO в page.tsx) */
  dir: 'next' | 'pick'
  /** Открыт ряд «Почему не то?» */
  askReason: boolean
  /** Раскрыто «Почему она?» */
  showWhy: boolean
  /** Пропусков подряд — после BURNOUT_AFTER_SKIPS экран «не игровой вечер» */
  skipCount: number
}

/**
 * Новая выдача начинается с чистого листа, какой бы кнопкой она ни пришла.
 *
 * dir — 'pick': новая пятёрка поднимается снизу, как карточка, выбранная из
 * «Ещё вариантов», а не уезжает вбок, как «дальше» по той же ленте. Лента-то
 * новая. Вопрос о причине и «Почему она?» относились к прежнему герою, а
 * счётчик пропусков — к прежней выдаче: в этой человек ещё ничего не листал.
 */
export const FRESH_TURN: Readonly<Turn> = Object.freeze({
  dir: 'pick',
  askReason: false,
  showWhy: false,
  skipCount: 0,
})

/**
 * После скольких пропусков подряд выдача сдаётся и спрашивает, игровой ли вообще
 * вечер. Пять — ровно выдача: пролистал всё, что предложили, значит дело не в
 * играх.
 */
export const BURNOUT_AFTER_SKIPS = 5

/** Случайный индекс, где ранние (лучше отранжированные) позиции весят больше. */
export function weightedRandomIndex(
  length: number,
  exclude?: number,
  random: () => number = Math.random,
): number {
  const weights = Array.from({ length }, (_, i) => length - i)
  if (exclude !== undefined && length > 1) weights[exclude] = 0
  const total = weights.reduce((s, w) => s + w, 0)
  let r = random() * total
  for (let i = 0; i < length; i++) {
    r -= weights[i]
    if (r <= 0 && weights[i] > 0) return i
  }
  // Сюда приводит только random() === 1 или хвост плавающей арифметики —
  // последняя позиция с весом, а не та, которую просили исключить
  for (let i = length - 1; i >= 0; i--) if (weights[i] > 0) return i
  return 0
}

/** С какой карточки начинается новая выдача: в рулетке — бросок, иначе лучшая. */
export function landingIndex(
  length: number,
  roulette: boolean,
  random: () => number = Math.random,
): number {
  return roulette ? weightedRandomIndex(length, undefined, random) : 0
}

/**
 * «Не то — дальше», причина пропуска, «Крутить ещё».
 *
 * Пятый пропуск подряд — не следующая карточка, а экран выгорания. В рулетке
 * «дальше» — новый бросок, который не выбросит ту же игру; без рулетки —
 * следующая по ленте, с последней на первую.
 */
export function nextStep(
  s: { from: number; length: number; roulette: boolean; skipCount: number },
  random: () => number = Math.random,
): { burnout: true; skipCount: number } | { burnout: false; skipCount: number; to: number } {
  const skipCount = s.skipCount + 1
  if (skipCount >= BURNOUT_AFTER_SKIPS) return { burnout: true, skipCount }
  const to = s.roulette ? weightedRandomIndex(s.length, s.from, random) : (s.from + 1) % s.length
  return { burnout: false, skipCount, to }
}
