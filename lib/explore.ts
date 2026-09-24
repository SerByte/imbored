/*
 * РЕЖИМ ИССЛЕДОВАТЕЛЯ: ПОЛИСТАТЬ БЕЗ ОБЯЗАТЕЛЬСТВ.
 *
 * /play отвечает на «во что сесть сейчас» одной игрой — и спрашивает
 * настроение, а свайп там что-то значит: «не то» прячет игру, «зашло» двигает
 * вкус. Бывает вечер, когда человек не готов ни отвечать, ни выбирать: хочется
 * просто посмотреть, что вообще есть, и, может быть, зацепиться за одну.
 *
 * Колода /explore — для такого вечера: пятнадцать карт своего и каталога
 * вперемешку, без вопросов о настроении, свайпом «Интересно» / «Мимо».
 * «Интересно» кладёт игру на полку «Приглянулось», откуда один шаг до
 * карточки игры, — и это единственный след: «Мимо» не прячет игру на /play и
 * не считается промахом подбора (lib/db: listFeedback, feedbackStats).
 *
 * Модуль чистый: колода собирается из готовых кандидатов (lib/candidates).
 */

import type { CandidateSource } from './types'

/** Карт в колоде за заход */
export const EXPLORE_DECK = 15

/** Сколько игр держит полка «Приглянулось» */
export const EXPLORE_SHELF = 12

/**
 * Сколько «Мимо» не возвращается в колоду. Неделя, а не навсегда: пролистанное
 * без обязательств — не бан, и через неделю вечер другой.
 */
export const EXPLORE_PASS_SEC = 7 * 86_400

/** Причина фидбека, которой пишутся свайпы колоды (SkipReason в lib/db) */
export const EXPLORE_REASON = 'explore'

/**
 * Колода — своё и каталог по очереди, каждое в порядке скора.
 *
 * Не общий порядок по скору: у нетронутого наклон 1.25 (SOURCE_WEIGHT), и
 * колода по скору была бы той же «разгреби бэклог», что /play, только
 * длиннее. Здесь смысл в том, чтобы посмотреть и своё, и то, чего нет, —
 * поэтому они чередуются, начиная с того, у кого голова сильнее. Кончилась
 * одна сторона — добирает другая.
 */
export function exploreDeck<T extends { source: CandidateSource; score: number }>(
  own: readonly T[],
  discovery: readonly T[],
  size = EXPLORE_DECK,
): T[] {
  const out: T[] = []
  let i = 0
  let j = 0
  let ownTurn = (own[0]?.score ?? -Infinity) >= (discovery[0]?.score ?? -Infinity)
  while (out.length < size && (i < own.length || j < discovery.length)) {
    if ((ownTurn && i < own.length) || j >= discovery.length) out.push(own[i++])
    else out.push(discovery[j++])
    ownTurn = !ownTurn
  }
  return out
}

/**
 * Что из пролистанного не показывать в колоде снова: приглянувшееся — оно
 * на полке, и «Мимо» моложе EXPLORE_PASS_SEC.
 */
export function exploredAppids(
  rows: ReadonlyArray<{ appid: number; at: number; liked: boolean }>,
  nowSec: number,
): number[] {
  return rows.filter((r) => r.liked || nowSec - r.at < EXPLORE_PASS_SEC).map((r) => r.appid)
}
