import { describe, expect, test } from 'vitest'
import { DOOR_NAMES, inviteCopy, inviteDoor, NEW_ROOM_HINT, type RoomInvite } from './roominvite'

const open: RoomInvite = {
  id: 'ABC234',
  members: 3,
  host: 'Серёга',
  matched: false,
  matchedName: null,
  preset: null,
  seedName: null,
}
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

  /**
   * Настроение хост выбирал до создания, и колода собрана под него, — а
   * превью звало «выбрать игру на вечер», одинаково для «пары быстрых каток»
   * и «весь вечер вместе». Друг узнавал, на какой вечер его зовут, только
   * войдя в комнату.
   */
  test('настроение комнаты — в заголовке и крупной строкой карточки', () => {
    const c = inviteCopy('ABC234', { ...open, preset: 'Пара быстрых каток' })
    expect(c.title).toBe('Серёга зовёт в пати ABC234 · Пара быстрых каток')
    expect(c.headline).toBe('Серёга зовёт: пара быстрых каток')
    // остальное — как у приглашения без настроения
    expect(c.eyebrow).toBe('ПАТИ · ПРИГЛАШЕНИЕ')
    expect(c.foot).toBe(inviteCopy('ABC234', open).foot)
  })

  test('настроение без ника хоста — безлично', () => {
    const c = inviteCopy('ABC234', { ...open, host: null, preset: 'Уютно и надолго' })
    expect(c.title).toBe('Тебя зовут в пати ABC234 · Уютно и надолго')
    expect(c.headline).toBe('Тебя зовут: уютно и надолго')
  })

  test('без настроения (старая комната, своё настроение) — прежний текст до буквы', () => {
    const c = inviteCopy('ABC234', open)
    expect(c.title).toBe('Серёга зовёт в пати ABC234')
    expect(c.headline).toBe('Серёга зовёт выбрать игру на вечер')
  })

  test('длинный ник режется и рядом с настроением', () => {
    const c = inviteCopy('ABC234', { ...open, host: 'Очень-очень длинный ник игрока', preset: 'Спокойно, под разговор' })
    expect(c.headline).toBe('Очень-очень длинны зовёт: спокойно, под разговор')
    // в заголовке вкладки ник целиком: там ширину держит браузер, а не кегль 44
    expect(c.title).toContain('Очень-очень длинный ник игрока')
  })

  /**
   * «Позвать в эту игру»: хост пришёл со страницы игры, и первая карта колоды
   * — она. Самое частое сообщение в чате пати — «го в X?», и превью обязано
   * говорить ровно это, а не звать «выбрать игру на вечер».
   */
  test('комната с предложенной игрой зовёт в неё', () => {
    const c = inviteCopy('ABC234', { ...open, seedName: 'Deep Rock Galactic' })
    expect(c.title).toBe('Серёга зовёт в «Deep Rock Galactic» · пати ABC234')
    expect(c.headline).toBe('Серёга зовёт в «Deep Rock Galactic»')
    // без давления: сказано, что игра — предложение, а не решение
    expect(c.description).toMatch(/^Первой картой — «Deep Rock Galactic»; не зайдёт — дальше колода из ваших библиотек\. 3 человека уже в комнате\. Подключи/)
    expect(c.eyebrow).toBe('ПАТИ · ПРИГЛАШЕНИЕ')
  })

  test('предложенная игра без ника хоста — безлично', () => {
    const c = inviteCopy('ABC234', { ...open, host: null, seedName: 'Valheim' })
    expect(c.title).toBe('Тебя зовут в «Valheim» · пати ABC234')
    expect(c.headline).toBe('Тебя зовут в «Valheim»')
  })

  /**
   * Крупная строка одна, и с предложенной игрой она уходит игре. Настроение
   * при этом не теряется — поднимается в надзаголовок.
   */
  test('игра и настроение вместе: игра — крупно, настроение — в надзаголовке', () => {
    const c = inviteCopy('ABC234', { ...open, seedName: 'Deep Rock Galactic', preset: 'Весь вечер вместе' })
    expect(c.headline).toBe('Серёга зовёт в «Deep Rock Galactic»')
    expect(c.eyebrow).toBe('ПАТИ · ВЕСЬ ВЕЧЕР ВМЕСТЕ')
    expect(c.title).toBe('Серёга зовёт в «Deep Rock Galactic» · пати ABC234')
  })

  test('длинное название предложенной игры в карточке режется, в заголовке — нет', () => {
    const name = 'Warhammer 40,000: Dawn of War – Definitive Edition Remastered'
    const c = inviteCopy('ABC234', { ...open, seedName: name })
    expect(c.title).toContain(name)
    expect(c.description).toContain(name)
    expect(c.headline.length).toBeLessThanOrEqual('Серёга зовёт в «»'.length + 38)
    expect(c.headline).toMatch(/…»$/)
  })

  test('после матча предложенная игра молчит: говорит та, на которой сошлись', () => {
    const c = inviteCopy('ABC234', { ...matched, seedName: 'Valheim', preset: 'Весь вечер вместе' })
    expect(c).toEqual(inviteCopy('ABC234', matched))
  })
})

/**
 * Экран приглашения — то, на что человек попадает, нажав карточку в чате.
 * Карточка говорила «Серёга зовёт в «Valheim»», «3 человека в комнате», а
 * экран — «Тебя зовут выбрать игру на вечер» и код: кто зовёт, во что и кто
 * уже внутри, забывалось ровно в минуту решения. Теперь экран говорит то же
 * теми же словами.
 */
describe('экран приглашения', () => {
  const valheim = { appid: 892970, name: 'Valheim', headerImage: null, art: null }

  test('кто зовёт — тем же ником, что в превью; без ника — безлично', () => {
    expect(inviteDoor({ host: 'Серёга', names: ['Серёга'], seed: null }).title).toBe(
      'Серёга зовёт выбрать игру на вечер',
    )
    expect(inviteDoor({ host: null, names: ['Игрок 3f9a'], seed: null }).title).toBe(
      'Тебя зовут выбрать игру на вечер',
    )
    // та же строка, что крупной строкой в карточке без настроения и игры
    expect(inviteDoor({ host: 'Серёга', names: ['Серёга', 'Аня'], seed: null }).title).toBe(
      inviteCopy('ABC234', open).headline,
    )
  })

  test('кто уже здесь — хост первым, имена через запятую и «и»', () => {
    expect(inviteDoor({ host: 'Серёга', names: ['Серёга', 'Аня'], seed: null }).here).toBe('Уже здесь: Серёга и Аня')
    expect(inviteDoor({ host: 'Серёга', names: ['Серёга', 'Аня', 'Дима'], seed: null }).here).toBe(
      'Уже здесь: Серёга, Аня и Дима',
    )
  })

  test('больше трёх — остальные числом, без рода и склонения ника', () => {
    const names = ['Серёга', 'Аня', 'Дима', 'Саша', 'Игрок 3f9a']
    expect(DOOR_NAMES).toBe(3)
    expect(inviteDoor({ host: 'Серёга', names, seed: null }).here).toBe('Уже здесь: Серёга, Аня, Дима и ещё 2')
  })

  test('один хост — заголовок его уже назвал, строки нет', () => {
    expect(inviteDoor({ host: 'Серёга', names: ['Серёга'], seed: null }).here).toBeNull()
  })

  test('хост ушёл — зовут безлично, а здесь те, кто остался', () => {
    const d = inviteDoor({ host: null, names: ['Аня'], seed: null })
    expect(d.title).toBe('Тебя зовут выбрать игру на вечер')
    expect(d.here).toBe('Уже здесь: Аня')
    expect(inviteDoor({ host: null, names: [], seed: null }).here).toBeNull()
  })

  test('длинный ник режется: строка одна', () => {
    const d = inviteDoor({ host: 'Серёга', names: ['Серёга', 'Очень-очень длинный ник игрока'], seed: null })
    expect(d.here).toBe('Уже здесь: Серёга и Очень-очень длинный…')
  })

  test('игра, в которую звали, — той же фразой, что в описании превью', () => {
    const d = inviteDoor({ host: 'Серёга', names: ['Серёга'], seed: valheim })
    expect(d.seed).toEqual({ ...valheim, line: 'Первой картой — «Valheim»; не зайдёт — дальше колода из ваших библиотек.' })
    expect(inviteCopy('ABC234', { ...open, seedName: 'Valheim' }).description.startsWith(d.seed!.line)).toBe(true)
    expect(inviteDoor({ host: 'Серёга', names: ['Серёга'], seed: null }).seed).toBeNull()
  })
})
