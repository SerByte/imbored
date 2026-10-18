import { describe, expect, test } from 'vitest'
import { newPickId, pickShareOk, pickShareSig, shareView, type PickShareFields } from './pickshare'
import { SHARED_PICK_ID_RE } from './sharedpick'

/**
 * Подпись выбора держит /api/pick от публикации чужого текста: сохраняется
 * только то, что сервер выдал ЭТОЙ сессии. Здесь — что подпись привязана к
 * каждому полю, а мусор вместо неё не роняет сверку.
 */

const SECRET = 'test-secret-0123456789'
const BASE: PickShareFields = {
  steamid: '76561197960287930',
  appid: 620,
  source: 'untouched',
  text: '«Portal 2» ждёт с покупки — вечер на головоломки.',
}

describe('pickShareSig', () => {
  test('детерминирована и укладывается в 22 знака base64url', () => {
    const sig = pickShareSig(SECRET, BASE)
    expect(sig).toBe(pickShareSig(SECRET, { ...BASE }))
    expect(sig).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  test('меняется от любого поля и от секрета', () => {
    const sig = pickShareSig(SECRET, BASE)
    const variants: PickShareFields[] = [
      { ...BASE, steamid: '76561197960287931' },
      { ...BASE, appid: 621 },
      { ...BASE, source: 'new' },
      { ...BASE, text: BASE.text + ' ' },
    ]
    for (const v of variants) expect(pickShareSig(SECRET, v), JSON.stringify(v)).not.toBe(sig)
    expect(pickShareSig(SECRET + 'x', BASE)).not.toBe(sig)
  })
})

describe('pickShareOk', () => {
  test('своя подпись — да, чужая — нет', () => {
    const sig = pickShareSig(SECRET, BASE)
    expect(pickShareOk(SECRET, BASE, sig)).toBe(true)
    expect(pickShareOk(SECRET, { ...BASE, steamid: '76561197960287931' }, sig)).toBe(false)
    expect(pickShareOk(SECRET, { ...BASE, text: 'Любой другой текст' }, sig)).toBe(false)
    expect(pickShareOk('другой секрет', BASE, sig)).toBe(false)
  })

  test('мусор вместо подписи — false, а не исключение', () => {
    const sig = pickShareSig(SECRET, BASE)
    for (const bad of [undefined, null, 42, {}, '', sig.slice(1), sig + 'a', 'я'.repeat(22)]) {
      expect(pickShareOk(SECRET, BASE, bad), String(bad)).toBe(false)
    }
  })
})

describe('newPickId', () => {
  test('двенадцать знаков без похожих — и страница его узнаёт', () => {
    for (let i = 0; i < 200; i++) {
      const id = newPickId()
      expect(id).toMatch(SHARED_PICK_ID_RE)
      expect(id).not.toMatch(/[01ilo]/)
    }
  })

  test('не повторяется', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newPickId()))
    expect(ids.size).toBe(500)
  })
})

describe('shareView', () => {
  test('поле share — текст как есть и подпись к нему', () => {
    const { share } = shareView(SECRET, BASE)
    expect(share?.text).toBe(BASE.text)
    expect(pickShareOk(SECRET, BASE, share?.sig)).toBe(true)
  })

  test('пустой текст — поля нет, и кнопки у героя не будет', () => {
    expect(shareView(SECRET, { ...BASE, text: '' })).toEqual({})
    expect(shareView(SECRET, { ...BASE, text: '  ' })).toEqual({})
  })
})

/**
 * Язык — в подписи. Страница выбора говорит на языке ссылки, и подпись
 * одного языка другому не годится. Русские подписи, выданные до английской
 * версии, проходят как русские: сообщение у них то же.
 */
describe('подпись по языку', () => {
  const EN: PickShareFields = {
    ...BASE,
    text: 'Bought it and never opened it: a night of puzzles.',
    lang: 'en',
  }

  test('русская подпись без lang и с lang: ru — одна и та же', () => {
    expect(pickShareSig(SECRET, { ...BASE, lang: 'ru' })).toBe(pickShareSig(SECRET, BASE))
    expect(pickShareOk(SECRET, { ...BASE, lang: 'ru' }, pickShareSig(SECRET, BASE))).toBe(true)
  })

  test('подпись английского текста русской ссылке не годится, и наоборот', () => {
    const sig = pickShareSig(SECRET, EN)
    expect(pickShareOk(SECRET, EN, sig)).toBe(true)
    expect(pickShareOk(SECRET, { ...EN, lang: undefined }, sig)).toBe(false)
    expect(pickShareOk(SECRET, { ...BASE, lang: 'en' }, pickShareSig(SECRET, BASE))).toBe(false)
  })

  test('shareView английского героя несёт lang, русского — прежнюю форму', () => {
    const { share } = shareView(SECRET, EN)
    expect(share).toEqual({ text: EN.text, sig: pickShareSig(SECRET, EN), lang: 'en' })
    expect(/[А-Яа-яЁё]/.test(share!.text)).toBe(false)
    expect(Object.keys(shareView(SECRET, BASE).share!)).toEqual(['text', 'sig'])
  })
})
