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
