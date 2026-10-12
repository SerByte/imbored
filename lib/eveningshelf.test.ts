import { describe, expect, test } from 'vitest'
import { eveningKey, keepOnShelf } from './eveningshelf'

/**
 * Полка «Твоих вечеров» не выдёргивает карточку из-под пальца
 * (components/Evenings, lib/eveningshelf.ts).
 *
 * Сервер держит на полке двенадцать свежих советов и, сверх них, те, о которых
 * можно спросить «как тебе?» (askableNow). Тринадцатый без ответа стоит
 * только поэтому: «Зацепило» — и он уже не спрашиваемый, «Уже прошёл» зовёт
 * router.refresh(), и пересчитанная полка его не несёт. Карточка с фокусом на
 * строке «Пройдено — больше не предложу» размонтировалась — фокус в body.
 */

type Card = { appid: number; shownAt: number; name: string }
const card = (appid: number, shownAt: number, name = `Игра ${appid}`): Card => ({ appid, shownAt, name })

describe('полка «Твоих вечеров» после пересчёта', () => {
  test('ключ карточки — игра и совет: одну игру советуют и дважды', () => {
    expect(eveningKey(card(620, 100))).toBe('620:100')
    expect(eveningKey(card(620, 100))).not.toBe(eveningKey(card(620, 200)))
  })

  test('нечего держать — та же полка, тем же массивом', () => {
    const items = [card(1, 300), card(2, 200)]
    expect(keepOnShelf(items, new Map())).toBe(items)
    // удержанная и так на полке — дубля нет, и полка та же
    expect(keepOnShelf(items, new Map([['2:200', card(2, 200, 'старое имя')]]))).toBe(items)
  })

  test('карточку, которую пересчёт уронил, полка держит на её месте', () => {
    const before = [card(1, 500), card(2, 400), card(3, 300)]
    const after = [card(1, 500), card(3, 300)]
    const kept = new Map([[eveningKey(before[1]), before[1]]])
    expect(keepOnShelf(after, kept).map(eveningKey)).toEqual(['1:500', '2:400', '3:300'])
  })

  // Порядок — как у listEvenings: свежие первыми, при равном времени — по appid
  test('порядок тот же, что у сервера: свежие первыми, равные — по appid', () => {
    const after = [card(5, 300), card(9, 300)]
    const kept = new Map([['7:300', card(7, 300)], ['4:100', card(4, 100)]])
    expect(keepOnShelf(after, kept).map(eveningKey)).toEqual(['5:300', '7:300', '9:300', '4:100'])
  })
})
