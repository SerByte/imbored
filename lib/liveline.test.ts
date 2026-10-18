import { describe, expect, test } from 'vitest'
import { LIVE_DEFAULT, liveDefault, liveLineFrom } from './liveline'

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

/*
 * Английская главная: тот же порядок по цене вопроса, те же адреса (без
 * префикса — его ставит Link), свои шаблоны целиком.
 */
describe('живая строка по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/
  const plan = { appid: 1145360, name: 'Hades', intent: 'install' }

  test('дверь по умолчанию — своя, постоянным объектом', () => {
    expect(liveDefault('en')).toEqual({ href: '/library', text: 'Your evenings and what you liked — in your library' })
    expect(liveDefault('en')).toBe(liveDefault('en'))
    expect(liveDefault()).toBe(LIVE_DEFAULT)
    for (const raw of [undefined, null, 'x', 1, {}, { ask: null, daily: null }]) {
      expect(liveLineFrom(raw, 'en'), JSON.stringify(raw)).toBe(liveDefault('en'))
    }
  })

  test('план — словами нажатия, без обещания запуска', () => {
    expect(liveLineFrom({ plan }, 'en')).toEqual({
      href: '/game/1145360',
      text: "You started downloading “Hades” — it's waiting for you",
    })
    expect(liveLineFrom({ plan: { ...plan, intent: 'tonight' } }, 'en').text).toBe(
      "You saved “Hades” for tonight — it's waiting for you",
    )
    for (const intent of ['install', 'tonight']) {
      const { text } = liveLineFrom({ plan: { ...plan, intent } }, 'en')
      expect(text, intent).not.toMatch(/launch/i)
      expect(text, intent).not.toMatch(CYRILLIC)
    }
  })

  test('игра дня — ссылка на /daily', () => {
    expect(liveLineFrom({ daily: { appid: 620, name: 'Portal 2' } }, 'en')).toEqual({
      href: '/daily',
      text: 'Your game of the day is ready — “Portal 2”',
    })
  })

  // Шаблон вокруг сыгранного, порядок — и само сыгранное на языке строки
  // (playedLine из lib/outcome): «2 h 15 min», а не «2 ч 15 мин»
  test('«как тебе?» — своим шаблоном и раньше плана', () => {
    const ask = { appid: 1145360, name: 'Hades', shownAt: 1_700_000_000, minutes: 135, bought: false }
    const line = liveLineFrom({ ask, plan, daily: { appid: 620, name: 'Portal 2' } }, 'en')
    expect(line.href).toBe('/library#evenings')
    expect(line.text).toMatch(/^How's “Hades”\? .+ played since our pick$/)
    expect(line.text).toBe("How's “Hades”? 2 h 15 min played since our pick")
    expect(line.text).not.toMatch(/[А-Яа-яЁё]/)
    // от десяти часов — целыми, с разрядами
    const long = liveLineFrom({ ask: { ...ask, minutes: 146_040 } }, 'en')
    expect(long.text).toBe("How's “Hades”? 2,434 h played since our pick")
    // русская строка — прежняя
    expect(liveLineFrom({ ask }).text).toBe('Как тебе «Hades»? 2 ч 15 мин после совета')
  })
})
