import type { GameMeta } from './types'

/**
 * Оценка игроков для карточки игры — из того источника, который есть.
 *
 * Модуль появился из замера по проду. В карте сайта пять тысяч адресов, и на
 * них:
 *
 *   reviews_total + reviews_percent   5000 из 5000   100 %
 *   reviews_summary_json               726 из 5000    14,5 %
 *
 * Карточка читала ТОЛЬКО второе. То есть 4274 страницы — 85,5 % всего
 * органического входа — показывали игру без единой оценки, хотя доля
 * положительных отзывов и их число лежали в той же строке той же таблицы,
 * прочитанные тем же запросом. Заодно это лишало их и aggregateRating в
 * микроразметке, ради которого она и добавлялась.
 *
 * Источники разные и меряют разное: сводка приходит из appreviews по всем
 * языкам, каталожный сигнал — из выдачи магазина с её фильтром по умолчанию.
 * Проценты обычно сходятся в пределах пары пунктов, числа отзывов отличаются
 * в разы. Поэтому источник не смешивается: берём целиком тот или другой и
 * помним, какой именно.
 *
 * Сводка идёт первой не из-за точности, а потому что у неё есть словесная
 * оценка самого Steam. Вычислять её из процента нельзя: пороги Steam зависят
 * ещё и от числа отзывов, и «посчитанная» подпись могла бы не совпасть с той,
 * что стоит на странице игры в самом магазине.
 */

export type Rating = {
  /** доля положительных отзывов, 0..100 — то же число, что рисует кольцо */
  percent: number
  /** сколько отзывов учтено */
  total: number
  /** словесная оценка Steam как есть; у каталожного сигнала её нет */
  label?: string
  source: 'summary' | 'catalog'
}

export type ReviewsSummary = {
  scoreDesc: string
  totalPositive: number
  totalNegative: number
}

export function ratingOf(
  meta: Pick<GameMeta, 'reviewsPercent' | 'reviewsTotal'>,
  summary: ReviewsSummary | null,
): Rating | null {
  if (summary) {
    const total = summary.totalPositive + summary.totalNegative
    // Ноль отзывов в сводке — не повод прятать каталожный сигнал: обогащение
    // доходило, а считать было нечего.
    if (total > 0) {
      return {
        percent: Math.round((summary.totalPositive / total) * 100),
        total,
        label: summary.scoreDesc,
        source: 'summary',
      }
    }
  }

  const { reviewsPercent, reviewsTotal } = meta
  // Ноль процентов — это оценка, а не отсутствие данных; проверяем на
  // undefined, а не на истинность.
  if (reviewsPercent === undefined || !reviewsTotal || reviewsTotal <= 0) return null
  return { percent: reviewsPercent, total: reviewsTotal, source: 'catalog' }
}

/**
 * Словесная оценка Steam по-русски.
 *
 * Steam отдаёт scoreDesc только по-английски — язык запроса на него не влияет.
 * Жило локальной константой в app/game/[appid]/page.tsx, пока потребитель был
 * один; со вторым (карточка ссылки) переехало сюда, к ratingOf, который эту
 * метку и достаёт. Незнакомую строку возвращаем как есть: список Steam может
 * пополниться, и лучше английское слово, чем пустое место.
 */
const SCORE_RU: Record<string, string> = {
  'Overwhelmingly Positive': 'Крайне положительные',
  'Very Positive': 'Очень положительные',
  Positive: 'Положительные',
  'Mostly Positive': 'В основном положительные',
  Mixed: 'Смешанные',
  'Mostly Negative': 'В основном отрицательные',
  Negative: 'Отрицательные',
  'Very Negative': 'Очень отрицательные',
  'Overwhelmingly Negative': 'Крайне отрицательные',
}

export function scoreRu(label: string | undefined): string | null {
  if (!label) return null
  return SCORE_RU[label] ?? label
}
