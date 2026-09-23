import { STALE_AFTER_FAILS } from './roompoll'

/**
 * РИТМ ОПРОСА ДОСКИ ПАТИ (/rooms).
 *
 * Здесь решения, а не таймеры — как в lib/roompoll.ts и lib/feedpoll.ts:
 * setTimeout и visibilitychange живут в app/rooms/page.tsx, а СКОЛЬКО ждать
 * до следующего запроса и КОГДА признать доску устаревшей решается здесь и
 * проверяется тестом.
 *
 * Доска опрашивалась setInterval'ом, и у него было три слабости. Интервал не
 * ждёт ответа: стоит ответу задержаться дольше восьми секунд, и следующий
 * запрос уходит поверх ещё не вернувшегося. Отказ сервера не замедлял ничего —
 * лежащий origin получал тот же поток, что и живой. И пустая доска, а она почти
 * всегда пустая, опрашивалась с той же частотой, что и доска, на которой
 * прямо сейчас появляются комнаты.
 */

/** Обычный темп. Ответ кэшируется на краю пятью секундами (app/api/rooms/public). */
export const BOARD_POLL_MS = 8_000

/**
 * Темп доски, которая давно не меняется. Двенадцать опросов по восемь секунд —
 * полторы минуты тишины: дальше тот, кто смотрит на пустую доску, ждёт
 * комнату, а не секунды.
 */
export const BOARD_IDLE_MS = 30_000
export const BOARD_IDLE_AFTER = 12

/** Потолок отката после отказов: 16 с, потом 32 с и дальше не реже. */
export const BOARD_BACKOFF_MAX_MS = 32_000

export type BoardPoll = {
  /** Отказов подряд. Сбрасывается первым же ответом. */
  fails: number
  /** Ответов подряд, в которых доска не изменилась. */
  unchanged: number
  /** Отпечаток последней полученной доски; null — доски ещё не было. */
  key: string | null
}

export function initialBoardPoll(): BoardPoll {
  return { fails: 0, unchanged: 0, key: null }
}

/**
 * Отпечаток доски: какие комнаты и кто в них. «N минут назад» в него не
 * входит намеренно — эта подпись меняется каждую минуту сама по себе, и
 * доска считалась бы живой вечно.
 */
export function boardKey(rooms: ReadonlyArray<{ id: string; memberNames: readonly string[] }>): string {
  return rooms.map((r) => `${r.id}:${r.memberNames.join(',')}`).join('|')
}

export type BoardAnswer = { ok: true; key: string } | { ok: false }

export function afterBoardAnswer(s: BoardPoll, answer: BoardAnswer): BoardPoll {
  if (!answer.ok) return { ...s, fails: s.fails + 1 }
  const same = s.key !== null && s.key === answer.key
  return { fails: 0, unchanged: same ? s.unchanged + 1 : 0, key: answer.key }
}

/**
 * Сколько ждать до следующего запроса.
 *
 * Один отказ — ещё не повод: это может быть оборванный запрос или холодный
 * старт, и темп не меняется. Со второго подряд — удвоение, но не реже раза в
 * 32 секунды: доска — это «кто ищет прямо сейчас», и вернуться она должна
 * сама, без перезагрузки.
 */
export function boardDelayMs(s: BoardPoll): number {
  if (s.fails >= STALE_AFTER_FAILS) {
    return Math.min(BOARD_POLL_MS * 2 ** (s.fails - STALE_AFTER_FAILS + 1), BOARD_BACKOFF_MAX_MS)
  }
  if (s.unchanged >= BOARD_IDLE_AFTER) return BOARD_IDLE_MS
  return BOARD_POLL_MS
}

/** Показывать ли, что доска на экране устарела. Порог тот же, что у комнаты. */
export function boardStale(s: Pick<BoardPoll, 'fails'>): boolean {
  return s.fails >= STALE_AFTER_FAILS
}

/**
 * Вернулись во вкладку: снова обычный темп. Человек только что посмотрел на
 * доску — самое время показать её свежей, а не через тридцать секунд.
 * Отказы не прощаются: сервер от переключения вкладки не ожил.
 */
export function onBoardVisible(s: BoardPoll): BoardPoll {
  return { ...s, unchanged: 0 }
}
