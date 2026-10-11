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

  /*
   * План на вечер (lib/eveningplan.ts) — между вопросом и игрой дня: «как
   * тебе?» бывает редко и нужен подбору, а план — решение самого человека,
   * и оно важнее того, что сегодня выбрали за него. Ведёт на страницу игры:
   * «Запустить» там дорисовывает владельцу OwnedLaunch и закрывает план. Но
   * только под мышью — поэтому строка не спрашивает «запустить?»: на
   * телефоне она вела бы к странице без такой кнопки.
   */
  test('план на вечер — после вопроса, раньше игры дня, и ведёт к игре', () => {
    const plan = { appid: 1145360, name: 'Hades', intent: 'install' }
    const daily = { appid: 620, name: 'Portal 2' }
    expect(liveLineFrom({ ask: null, plan, daily })).toEqual({
      href: '/game/1145360',
      text: 'Ставил «Hades» на загрузку — ждёт тебя',
    })
    expect(liveLineFrom({ plan: { ...plan, intent: 'tonight' } })?.text).toBe(
      'Отложил «Hades» на вечер — ждёт тебя',
    )
    const ask = { appid: 570, name: 'Dota 2', shownAt: 1_700_000_000, minutes: 135, bought: false }
    expect(liveLineFrom({ ask, plan, daily }).href).toBe('/library#evenings')
    // битый план — дальше по порядку, а не пустая строка
    expect(liveLineFrom({ plan: { ...plan, name: '' }, daily }).href).toBe('/daily')
  })

  test('строка плана не обещает запуска, которого на телефоне нет', () => {
    for (const intent of ['install', 'tonight']) {
      const { text } = liveLineFrom({ plan: { appid: 1145360, name: 'Hades', intent } })
      expect(text, intent).not.toMatch(/запуст/i)
    }
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
