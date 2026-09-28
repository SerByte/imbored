import { describe, expect, test } from 'vitest'
import { LIVE_DEFAULT, liveLineFrom } from './liveline'

describe('живая строка карточки на главной', () => {
  test('нечего сказать или мусор — дверь в библиотеку', () => {
    for (const raw of [undefined, null, 'x', 1, {}, { ask: null, daily: null }]) {
      expect(liveLineFrom(raw), JSON.stringify(raw)).toEqual(LIVE_DEFAULT)
    }
  })

  test('«как тебе?» важнее игры дня и ведёт в «Твои вечера»', () => {
    const line = liveLineFrom({
      ask: { appid: 1145360, name: 'Hades', shownAt: 1_700_000_000, minutes: 135, bought: false },
      daily: { appid: 620, name: 'Portal 2' },
    })
    expect(line).toEqual({
      href: '/library#evenings',
      text: 'Как тебе «Hades»? 2 ч 15 мин после совета',
    })
  })

  test('игра дня уже выбрана — ссылка на /daily', () => {
    expect(liveLineFrom({ ask: null, daily: { appid: 620, name: 'Portal 2' } })).toEqual({
      href: '/daily',
      text: 'Игра дня уже выбрана — «Portal 2»',
    })
  })

  test('битая форма не показывается', () => {
    expect(liveLineFrom({ ask: { appid: 1, name: '' }, daily: { appid: 0, name: 'X' } })).toEqual(LIVE_DEFAULT)
    expect(liveLineFrom({ daily: { appid: 620, name: '   ' } })).toEqual(LIVE_DEFAULT)
  })
})
