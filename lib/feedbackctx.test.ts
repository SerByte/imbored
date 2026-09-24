import { describe, expect, test } from 'vitest'
import { parseFeedbackCtx, partsView, roundPart } from './feedbackctx'
import { SCORE_FACTORS, type ScoreParts } from './types'

const PARTS = Object.fromEntries(SCORE_FACTORS.map((k, i) => [k, 1 + i / 7])) as ScoreParts

describe('parseFeedbackCtx', () => {
  test('знакомые поля с допустимыми значениями проходят как есть', () => {
    const ctx = {
      source: 'play',
      slot: 'picked',
      rank: 3,
      engine: 'heuristic',
      variant: 'seed',
      scope: 'library',
      lean: 'familiar',
      nudge: 'shorter',
      candidate: 'comeback',
      intent: 'launch',
      parts: { taste: 0.5, mood: 1.2 },
    }
    expect(parseFeedbackCtx(ctx)).toEqual(ctx)
  })

  test('неизвестные ключи и мусорные значения отбрасываются молча', () => {
    expect(
      parseFeedbackCtx({
        source: 'play',
        slot: 'sidebar',
        rank: 2.5,
        engine: 'gpt',
        steamid: '76561197960287930',
        note: 'x'.repeat(10_000),
        intent: 'launch',
      }),
    ).toEqual({ source: 'play', intent: 'launch' })
  })

  test('место — целое от нуля до 99', () => {
    for (const rank of [-1, 100, 1e9, Number.NaN, '3', null]) {
      expect(parseFeedbackCtx({ rank, source: 'play' }), String(rank)).toEqual({ source: 'play' })
    }
    expect(parseFeedbackCtx({ rank: 0 })).toEqual({ rank: 0 })
    expect(parseFeedbackCtx({ rank: 99 })).toEqual({ rank: 99 })
  })

  test('части скора — только множители реестра, конечные, от нуля до сотни, округлённые', () => {
    const ctx = parseFeedbackCtx({
      parts: {
        taste: 0.123456789,
        mood: -1,
        deal: Infinity,
        entry: 101,
        cooldown: '0.5',
        hacked: 1,
        __proto__: { nudge: 1 },
      },
    })
    expect(ctx).toEqual({ parts: { taste: 0.1235 } })
  })

  test('части без единого годного числа — снимка частей нет вовсе', () => {
    expect(parseFeedbackCtx({ source: 'daily', parts: { hacked: 1 } })).toEqual({ source: 'daily' })
    expect(parseFeedbackCtx({ parts: [1, 2, 3] })).toBeNull()
  })

  test('не объект или ничего годного — null, и оценка пишется без снимка', () => {
    for (const raw of [null, undefined, 'play', 42, [], {}, { slot: 'x' }]) {
      expect(parseFeedbackCtx(raw), JSON.stringify(raw)).toBeNull()
    }
  })
})

describe('части скора для карточки', () => {
  test('partsView отдаёт все множители реестра, округлённые до четырёх знаков', () => {
    const view = partsView(PARTS)
    expect(Object.keys(view)).toEqual([...SCORE_FACTORS])
    for (const k of SCORE_FACTORS) expect(view[k]).toBe(roundPart(PARTS[k]))
    expect(view.mood).toBe(1.1429)
  })

  test('то, что отдала карточка, проходит белый список без потерь', () => {
    const view = partsView(PARTS)
    expect(parseFeedbackCtx({ parts: view })).toEqual({ parts: view })
  })
})
