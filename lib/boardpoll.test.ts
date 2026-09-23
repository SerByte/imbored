import { describe, expect, test } from 'vitest'
import {
  afterBoardAnswer,
  BOARD_BACKOFF_MAX_MS,
  BOARD_IDLE_AFTER,
  BOARD_IDLE_MS,
  BOARD_POLL_MS,
  boardDelayMs,
  boardKey,
  boardStale,
  initialBoardPoll,
  onBoardVisible,
  type BoardPoll,
} from './boardpoll'

/**
 * Сторож ритма доски пати. Таймеров здесь нет — только решения, которые
 * app/rooms/page.tsx применяет: сколько ждать и когда признать доску
 * устаревшей.
 */

const ok = (key: string) => ({ ok: true as const, key })
const fail = { ok: false as const }
const run = (answers: Array<ReturnType<typeof ok> | typeof fail>, s: BoardPoll = initialBoardPoll()) =>
  answers.reduce(afterBoardAnswer, s)

describe('ритм опроса доски', () => {
  test('живая доска опрашивается в обычном темпе', () => {
    expect(boardDelayMs(initialBoardPoll())).toBe(BOARD_POLL_MS)
    expect(boardDelayMs(run([ok('a'), ok('b'), ok('c')]))).toBe(BOARD_POLL_MS)
  })

  test('один отказ темп не меняет и устаревшей доску не делает', () => {
    const s = run([ok(''), fail])
    expect(boardDelayMs(s)).toBe(BOARD_POLL_MS)
    expect(boardStale(s)).toBe(false)
  })

  test('со второго отказа подряд — откат 16 с, потом 32 с и не реже', () => {
    const two = run([fail, fail])
    expect(boardStale(two)).toBe(true)
    expect(boardDelayMs(two)).toBe(16_000)
    expect(boardDelayMs(run([fail, fail, fail]))).toBe(32_000)
    expect(boardDelayMs(run(Array(20).fill(fail)))).toBe(BOARD_BACKOFF_MAX_MS)
  })

  test('первый же ответ снимает и откат, и признак устаревания', () => {
    const s = run([fail, fail, fail, ok('')])
    expect(boardStale(s)).toBe(false)
    expect(boardDelayMs(s)).toBe(BOARD_POLL_MS)
  })

  test('после двенадцати ответов без перемен — раз в 30 с', () => {
    // Первый ответ задаёт отпечаток, следующие двенадцать его повторяют
    const quiet = run(Array(BOARD_IDLE_AFTER + 1).fill(ok('')))
    expect(boardDelayMs(quiet)).toBe(BOARD_IDLE_MS)
    const almost = run(Array(BOARD_IDLE_AFTER).fill(ok('')))
    expect(boardDelayMs(almost)).toBe(BOARD_POLL_MS)
  })

  test('первое изменение возвращает обычный темп', () => {
    const quiet = run(Array(BOARD_IDLE_AFTER + 5).fill(ok('')))
    expect(boardDelayMs(afterBoardAnswer(quiet, ok('ABC123:Дима')))).toBe(BOARD_POLL_MS)
  })

  test('отказ посреди тишины счёт тишины не сбрасывает', () => {
    // Тишина — свойство доски, а не связи: сервер икнул, доска не ожила
    const quiet = run(Array(BOARD_IDLE_AFTER + 1).fill(ok('')))
    const s = run([fail, ok('')], quiet)
    expect(boardDelayMs(s)).toBe(BOARD_IDLE_MS)
  })

  test('возвращение во вкладку — снова обычный темп, но отказы помнятся', () => {
    const quiet = run(Array(BOARD_IDLE_AFTER + 3).fill(ok('')))
    expect(boardDelayMs(onBoardVisible(quiet))).toBe(BOARD_POLL_MS)
    const down = run([fail, fail, fail])
    expect(boardDelayMs(onBoardVisible(down))).toBe(32_000)
  })
})

describe('отпечаток доски', () => {
  test('меняется, когда меняются комнаты или состав', () => {
    const a = boardKey([{ id: 'ABC123', memberNames: ['Дима'] }])
    expect(boardKey([{ id: 'ABC123', memberNames: ['Дима', 'Катя'] }])).not.toBe(a)
    expect(boardKey([{ id: 'XYZ789', memberNames: ['Дима'] }])).not.toBe(a)
    expect(boardKey([])).not.toBe(a)
  })

  test('«N минут назад» доску живой не делает', () => {
    // Лишние поля ответа (minutesAgo) в отпечаток не попадают
    const at = (minutesAgo: number) => {
      const rooms = [{ id: 'ABC123', memberNames: ['Дима'], minutesAgo }]
      return boardKey(rooms)
    }
    expect(at(1)).toBe(at(7))
  })
})
