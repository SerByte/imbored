import { describe, expect, test } from 'vitest'
import {
  claimVote,
  deckCardLine,
  deckPosition,
  deckStuck,
  VOTE_TIMEOUT_MS,
  voteMiss,
  voteSignal,
} from './deckvote'

/**
 * Сторож голоса колоды пати.
 *
 * Две вещи, которые стоили живой комнаты. Двойной Enter по улетающей карте
 * засчитывал голос дважды — полоса убегала вперёд и под конец за сто
 * процентов. А отказ с кодом, на который повтор ответит тем же, возвращал
 * карту со строкой «свайпни ещё раз» — предложение жеста, который снова
 * откажет.
 */
describe('голос уходит один раз', () => {
  test('повторный жест по той же карте — пустышка', () => {
    const voted = new Set<number>()
    expect(claimVote(voted, 570)).toBe(true)
    expect(claimVote(voted, 570), 'второй Enter по улетающей карте проголосовал бы ещё раз').toBe(false)
  })

  test('другая карта голосуется как обычно', () => {
    const voted = new Set<number>()
    claimVote(voted, 570)
    expect(claimVote(voted, 730)).toBe(true)
  })

  test('вернувшаяся после отказа карта снова голосуется', () => {
    const voted = new Set<number>()
    claimVote(voted, 570)
    // так страница откатывает голос, который не записался
    voted.delete(570)
    expect(claimVote(voted, 570), 'карта вернулась, а жест по ней мёртв').toBe(true)
  })
})

describe('разбор отказа голоса', () => {
  test('повтор предлагается только там, где он может помочь', () => {
    expect(voteMiss(0), 'обрыв сети — повторяемо').toBe('retry')
    expect(voteMiss(500)).toBe('retry')
    expect(voteMiss(429)).toBe('retry')
  })

  test('409 — карта уходит: комната договорилась или карты нет в колоде', () => {
    expect(voteMiss(409)).toBe('gone')
  })

  test('401 — на вход, а не «свайпни ещё раз»', () => {
    expect(voteMiss(401)).toBe('bounce')
  })

  test('403 — участника убрали, карту в колоду не возвращаем', () => {
    expect(voteMiss(403)).toBe('removed')
  })

  test('голос не висит бесконечно: у запроса есть потолок', () => {
    const signal = voteSignal()
    expect(signal, 'повисший POST держал бы карту «улетевшей» навсегда').toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)
    expect(VOTE_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

describe('застрявшая колода', () => {
  test('на руках пусто, а сервер говорит «не дошёл» — перечитать', () => {
    expect(deckStuck({ left: 0, meDone: false, deckSize: 20 })).toBe(true)
  })

  test('дошёл до конца — перечитывать нечего', () => {
    expect(deckStuck({ left: 0, meDone: true, deckSize: 20 })).toBe(false)
  })

  test('карты ещё есть или колода не загружена — не застряла', () => {
    expect(deckStuck({ left: 3, meDone: false, deckSize: 20 })).toBe(false)
    expect(deckStuck({ left: null, meDone: false, deckSize: 20 })).toBe(false)
  })

  test('не участник — не наша колода', () => {
    expect(deckStuck({ left: 0, meDone: undefined, deckSize: 20 })).toBe(false)
  })

  test('без размера колоды признака конца нет — «не дошёл» ничего не значит', () => {
    expect(deckStuck({ left: 0, meDone: false, deckSize: 0 })).toBe(false)
    expect(deckStuck({ left: 0, meDone: false, deckSize: null })).toBe(false)
  })
})

describe('позиция в колоде', () => {
  test('обычная дробь', () => {
    expect(deckPosition(4, 20)).toEqual({ n: 5, total: 20, label: '5/20', pct: 25 })
  })

  test('числитель не убегает за знаменатель, полоса — за сто процентов', () => {
    const pos = deckPosition(15, 12)
    expect(pos.label, 'после схлопнувшейся колоды было «16/12»').toBe('12/12')
    expect(pos.pct).toBe(100)
  })

  test('пустой знаменатель — одна позиция без дроби', () => {
    expect(deckPosition(0, 0)).toEqual({ n: 1, total: null, label: '1', pct: 0 })
  })
})

describe('строка для скринридера', () => {
  test('номер тот же, что на полосе, и название игры', () => {
    expect(deckCardLine(deckPosition(2, 20), 'Dota 2')).toBe('Карта 3 из 20: Dota 2')
  })

  test('без знаменателя — без «из 0»', () => {
    expect(deckCardLine(deckPosition(0, 0), 'Dota 2')).toBe('Карта 1: Dota 2')
  })
})
