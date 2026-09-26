import { describe, expect, test } from 'vitest'
import {
  cleanReason,
  parseSharePickBody,
  pickCopy,
  pickShareUrl,
  quoted,
  shareText,
  SHARED_REASON_MAX,
} from './sharedpick'

describe('shareText', () => {
  const reason = '«Hades» в твоей библиотеке нет, но теги твои.'
  const tail = ' Сейчас −40%: $14.99 — до 17 августа.'

  test('ценовой хвост отрезается: страница живёт месяц, скидка — нет', () => {
    expect(shareText(reason + tail, tail)).toBe(reason)
  })

  test('хвост не в конце или пустой — текст без него как есть', () => {
    expect(shareText(reason, tail)).toBe(reason)
    expect(shareText(reason, '')).toBe(reason)
  })

  test('о деньгах словами модели — предложение выпадает, остальное на месте', () => {
    const model =
      '«Hades» — рогалик, где каждая смерть двигает сюжет. Это покупка: $24.99, сейчас со скидкой −40%. Зайдёт на часовые заходы.'
    expect(shareText(model, '')).toBe('«Hades» — рогалик, где каждая смерть двигает сюжет. Зайдёт на часовые заходы.')
    for (const money of [
      'Стоит 499 ₽.',
      'Сейчас дешевле обычного.',
      'Она бесплатная.',
      'Цена кусается, но оно того стоит.',
      'Идёт распродажа.',
      'Скидка — до пятницы.',
    ]) {
      expect(shareText(`Первое. ${money} Последнее.`, ''), money).toBe('Первое. Последнее.')
    }
  })

  test('не про деньги — не трогаем: проценты отзывов, «ценит», «стоит попробовать»', () => {
    for (const keep of [
      '92% отзывов — положительные.',
      'Её ценят за атмосферу.',
      'Стоит попробовать хотя бы час.',
      'Кооператив на 2-4 игроков.',
    ]) {
      expect(shareText(keep, ''), keep).toBe(keep)
    }
  })

  test('всё объяснение про цену — пустая строка: делиться нечем', () => {
    expect(shareText('Сейчас −40%: $14.99 вместо $24.99.', '')).toBe('')
  })
})

describe('parseSharePickBody', () => {
  const ok = { appid: 620, source: 'untouched', kind: 'play', text: 'Причина', sig: 'x'.repeat(22) }

  test('форма в порядке — те же поля', () => {
    expect(parseSharePickBody(ok)).toEqual(ok)
    // игра чужого магазина — отрицательный appid, это законно
    expect(parseSharePickBody({ ...ok, appid: -101, kind: 'daily' })).toMatchObject({ appid: -101 })
  })

  test('мусор — null, а не приведение типом', () => {
    const bad: unknown[] = [
      null,
      'строка',
      [],
      { ...ok, appid: 0 },
      { ...ok, appid: 1.5 },
      { ...ok, appid: '620' },
      { ...ok, appid: 2 ** 60 },
      { ...ok, source: 'catalog' },
      { ...ok, source: undefined },
      { ...ok, kind: 'room' },
      { ...ok, text: '' },
      { ...ok, text: '   ' },
      { ...ok, text: 'я'.repeat(2001) },
      { ...ok, text: 42 },
      { ...ok, sig: undefined },
      { ...ok, sig: 42 },
    ]
    for (const b of bad) expect(parseSharePickBody(b), JSON.stringify(b)).toBeNull()
  })
})

describe('cleanReason', () => {
  test('управляющие знаки и двунаправленные метки — пробел, пробелы схлопнуты', () => {
    expect(cleanReason('  Раз\n\tдва‮ три​четыре\u0007 ')).toBe('Раз два три четыре')
  })

  test('длинное режется по слову до SHARED_REASON_MAX', () => {
    const long = 'слово '.repeat(200)
    const got = cleanReason(long)
    expect(got.length).toBeLessThanOrEqual(SHARED_REASON_MAX)
    expect(got.endsWith('…')).toBe(true)
  })
})

describe('quoted', () => {
  test('«ёлочки» снаружи, „лапки“ внутри — без «««', () => {
    expect(quoted('просто текст')).toBe('«просто текст»')
    expect(quoted('«Hades» ждёт')).toBe('«„Hades“ ждёт»')
  })
})

describe('pickShareUrl', () => {
  test('адрес с меткой воронки', () => {
    expect(pickShareUrl('https://imbored.cc', 'abcdefghjkmn')).toBe('https://imbored.cc/pick/abcdefghjkmn?ref=pick')
  })
})

describe('pickCopy', () => {
  test('нет выбора — приглашение, а не пустота', () => {
    const c = pickCopy(null)
    expect(c.title).toMatch(/imbored/)
    expect(c.description.length).toBeGreaterThan(0)
  })

  test('заголовок говорит, чей выбор: дня или вечера', () => {
    expect(pickCopy({ name: 'Hades', reason: 'Коротко.', kind: 'daily' }).title).toBe('«Hades» — моя игра дня')
    expect(pickCopy({ name: 'Hades', reason: 'Коротко.', kind: 'play' }).title).toBe(
      '«Hades» — imbored выбрал мне на вечер',
    )
  })

  test('описание — причина, обрезанная под сниппет', () => {
    const reason = 'Слово '.repeat(60).trim()
    const c = pickCopy({ name: 'Hades', reason, kind: 'play' })
    expect(c.description.length).toBeLessThanOrEqual(155)
  })
})
