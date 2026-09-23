import { describe, expect, test } from 'vitest'
import { inviteCopy, NEW_ROOM_HINT, type RoomInvite } from './roominvite'

const open: RoomInvite = { id: 'ABC234', members: 3, host: 'Серёга', matched: false, matchedName: null }
const matched: RoomInvite = { ...open, matched: true, matchedName: 'Hades' }

/** Всё, что человек прочтёт в чате: заголовок, описание и три строки карточки. */
const everything = (c: ReturnType<typeof inviteCopy>) =>
  [c.title, c.description, c.eyebrow, c.headline, c.foot].join('\n')

describe('превью приглашения в пати', () => {
  test('комната ждёт — зовём тем, кто позвал, и числом вошедших', () => {
    const c = inviteCopy('ABC234', open)
    expect(c.title).toBe('Серёга зовёт в пати ABC234')
    expect(c.description).toMatch(/^3 человека уже в комнате\. Подключи/)
    expect(c.foot).toBe('3 человека в комнате · подключи библиотеку и свайпай')
    expect(c.eyebrow).toBe('ПАТИ · ПРИГЛАШЕНИЕ')
  })

  test('без ника хоста зовёт безлично', () => {
    const c = inviteCopy('ABC234', { ...open, host: null, members: 1 })
    expect(c.title).toBe('Тебя зовут в пати ABC234')
    expect(c.foot).toMatch(/^1 человек в комнате/)
  })

  /**
   * Статус matched навсегда, а ссылку пересылают и после матча: превью звало
   * свайпать туда, где выбирать уже нечего.
   */
  test('после матча называем игру и зовём собрать свою комнату', () => {
    const c = inviteCopy('ABC234', matched)
    expect(c.title).toBe('Пати ABC234 сошлась на «Hades»')
    expect(c.headline).toBe('Сошлись на «Hades»')
    expect(c.foot).toBe(NEW_ROOM_HINT)
    expect(c.description.endsWith(NEW_ROOM_HINT), 'точка после адреса может уехать в ссылку').toBe(true)
    expect(c.eyebrow).toBe('ПАТИ · МАТЧ')
    expect(everything(c)).not.toMatch(/свайп|подключи/i)
  })

  test('матч без названия в каталоге — «уже выбрала», без пустых кавычек', () => {
    const c = inviteCopy('ABC234', { ...matched, matchedName: null })
    expect(c.title).toBe('Пати ABC234 уже выбрала игру')
    expect(everything(c)).not.toContain('«»')
    expect(c.foot).toBe(NEW_ROOM_HINT)
  })

  test('длинное название в карточке режется, в заголовке — нет', () => {
    const name = 'Warhammer 40,000: Dawn of War – Definitive Edition Remastered'
    const c = inviteCopy('ABC234', { ...matched, matchedName: name })
    expect(c.title).toContain(name)
    expect(c.headline.length).toBeLessThanOrEqual('Сошлись на «»'.length + 38)
    expect(c.headline).toMatch(/…»$/)
  })

  /**
   * null — это и «комнаты нет», и «база молчит». Звать подключиться и
   * свайпать в комнату, которой, возможно, нет, нельзя.
   */
  test('о комнате ничего не известно — нейтрально, без призыва свайпать', () => {
    const c = inviteCopy('ZZZZZZ', null)
    expect(c.title).toBe('Пати ZZZZZZ')
    expect(everything(c)).not.toMatch(/свайп|подключи|зовут/i)
  })
})
