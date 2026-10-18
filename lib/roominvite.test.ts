import { describe, expect, test } from 'vitest'
import { ROOM_PRESETS } from './presets'
import { DOOR_NAMES, inviteCopy, inviteDoor, NEW_ROOM_HINT, newRoomHint, type RoomInvite } from './roominvite'

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

  /*
   * Ник в заголовке — одно слово без пробелов, и h1 его не переносит: на
   * телефоне в 390 px «xXx_DarkLordOfTheNight_2009» уезжал за рамку панели
   * и обрезался краем экрана. Режет сервер тем же потолком, что «Уже здесь».
   */
  test('длинный ник хоста режется и в заголовке', () => {
    const host = 'xXx_DarkLordOfTheNight_2009_xXx!'
    expect(Array.from(host)).toHaveLength(32) // потолок ника в Steam
    const d = inviteDoor({ host, names: [host, 'Аня'], seed: null })
    expect(d.title).toBe('xXx_DarkLordOfTheNi… зовёт выбрать игру на вечер')
    // тем же потолком, что в «Уже здесь»: один ник — одно написание
    expect(d.here).toBe('Уже здесь: xXx_DarkLordOfTheNi… и Аня')
    // ник ровно в потолок — целиком
    expect(inviteDoor({ host: 'xXx_DarkLordOfTheNig', names: ['Аня'], seed: null }).title).toBe(
      'xXx_DarkLordOfTheNig зовёт выбрать игру на вечер',
    )
  })

  /*
   * Эмодзи за пределами BMP — пара суррогатов, и срез по единицам UTF-16
   * рвал её: «Уже здесь» показывал «�» на нике, который и резать-то было не
   * за что — двадцать знаков ровно.
   */
  test('эмодзи в нике не рвётся пополам и не считается за два знака', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    const fits = 'xXx_Sn1per_King_xX🔥🔥' // 20 знаков, 22 единицы UTF-16
    const d = inviteDoor({ host: fits, names: [fits, 'Аня'], seed: null })
    expect(d.title).toBe(`${fits} зовёт выбрать игру на вечер`)
    expect(d.here).toBe(`Уже здесь: ${fits} и Аня`)

    const long = 'xXx_Sn1per_King_xX🔥🔥🔥'
    const cut = inviteDoor({ host: long, names: [long, 'Аня'], seed: null })
    expect(cut.title).toBe('xXx_Sn1per_King_xX🔥… зовёт выбрать игру на вечер')
    for (const s of [cut.title, cut.here]) expect(s).not.toMatch(lone)

    // карточка в чате режет ник на восемнадцати — тоже знаками
    const card = inviteCopy('ABC234', { ...open, host: 'Серёга_Убийца_Дра🔥🔥' })
    expect(card.headline).toBe('Серёга_Убийца_Дра🔥 зовёт выбрать игру на вечер')
    expect(card.headline).not.toMatch(lone)
  })

  test('игра, в которую звали, — той же фразой, что в описании превью', () => {
    const d = inviteDoor({ host: 'Серёга', names: ['Серёга'], seed: valheim })
    expect(d.seed).toEqual({ ...valheim, line: 'Первой картой — «Valheim»; не зайдёт — дальше колода из ваших библиотек.' })
    expect(inviteCopy('ABC234', { ...open, seedName: 'Valheim' }).description.startsWith(d.seed!.line)).toBe(true)
    expect(inviteDoor({ host: 'Серёга', names: ['Серёга'], seed: null }).seed).toBeNull()
  })
})

/** Кириллица в строке — на английской странице это непереведённый кусок */
const CYRILLIC = /[А-Яа-яЁё]/

/**
 * Английское превью: целые фразы на каждое состояние, а не перевод русских
 * кусков. Ник и игры латиницей — тогда во всём, что прочтут в чате, не
 * должно остаться ни одной русской буквы.
 */
describe('превью приглашения по-английски', () => {
  const openEn: RoomInvite = { ...open, host: 'Sergey' }
  const matchedEn: RoomInvite = { ...openEn, matched: true, matchedName: 'Hades' }

  test('русский — по умолчанию и до буквы прежний', () => {
    expect(inviteCopy('ABC234', open)).toEqual(inviteCopy('ABC234', open, 'ru'))
    expect(newRoomHint()).toBe(NEW_ROOM_HINT)
    expect(NEW_ROOM_HINT).toBe('Собери свою комнату — imbored.cc/room/new')
  })

  test('комната ждёт — кто зовёт и сколько уже внутри', () => {
    const c = inviteCopy('ABC234', openEn, 'en')
    expect(c.title).toBe('Sergey invites you to party ABC234')
    expect(c.description).toBe(
      "3 people are already in the room. Connect your Steam library and swipe on what you'd play. When everyone's votes line up, it's a match.",
    )
    expect(c.eyebrow).toBe('PARTY · INVITE')
    expect(c.headline).toBe('Sergey wants to pick a game for tonight')
    expect(c.foot).toBe('3 people in the room · connect your library and swipe')
    expect(everything(c)).not.toMatch(CYRILLIC)
  })

  test('без ника хоста — безлично, и один человек — в единственном числе', () => {
    const c = inviteCopy('ABC234', { ...openEn, host: null, members: 1 }, 'en')
    expect(c.title).toBe("You're invited to party ABC234")
    expect(c.headline).toBe("You're invited to pick a game for tonight")
    expect(c.description).toMatch(/^1 person is already in the room\. Connect/)
    expect(c.foot).toBe('1 person in the room · connect your library and swipe')
  })

  test('после матча — игра и своя комната по английскому адресу, без точки после него', () => {
    const c = inviteCopy('ABC234', matchedEn, 'en')
    expect(c.title).toBe('Party ABC234 matched on “Hades”')
    expect(c.headline).toBe('Matched on “Hades”')
    expect(c.eyebrow).toBe('PARTY · MATCH')
    expect(c.foot).toBe('Start your own room — imbored.cc/en/room/new')
    expect(c.description).toBe(
      'The votes landed on “Hades” — this room already has its game. Start your own room — imbored.cc/en/room/new',
    )
    expect(c.description.endsWith(newRoomHint('en'))).toBe(true)
    expect(everything(c)).not.toMatch(/swipe|connect/i)
    expect(everything(c)).not.toMatch(CYRILLIC)
  })

  test('матч без названия — «already picked», без пустых кавычек', () => {
    const c = inviteCopy('ABC234', { ...matchedEn, matchedName: null }, 'en')
    expect(c.title).toBe('Party ABC234 already picked a game')
    expect(c.headline).toBe('Game already picked')
    expect(c.description).toBe(
      'The votes are in — this room already has its game. Start your own room — imbored.cc/en/room/new',
    )
    expect(everything(c)).not.toContain('“”')
  })

  test('о комнате ничего не известно — нейтрально, без призыва', () => {
    const c = inviteCopy('ZZZZZZ', null, 'en')
    expect(c).toEqual({
      title: 'Party ZZZZZZ',
      description:
        'Party on imbored: your group picks one game for tonight from your Steam libraries — by vote, no arguing in chat.',
      eyebrow: 'PARTY',
      headline: 'Friends pick a game for tonight',
      foot: 'One game for all — from your Steam libraries',
    })
    expect(everything(c)).not.toMatch(/swipe|connect|invite/i)
  })

  test('настроение приходит русским названием и встаёт английским', () => {
    const c = inviteCopy('ABC234', { ...openEn, preset: 'Пара быстрых каток' }, 'en')
    expect(c.title).toBe('Sergey invites you to party ABC234 · A few quick rounds')
    expect(c.headline).toBe('Sergey: a few quick rounds')
    expect(c.eyebrow).toBe('PARTY · INVITE')
    expect(c.foot).toBe(inviteCopy('ABC234', openEn, 'en').foot)

    const nobody = inviteCopy('ABC234', { ...openEn, host: null, preset: 'Уютно и надолго' }, 'en')
    expect(nobody.title).toBe("You're invited to party ABC234 · Cozy and long")
    expect(nobody.headline).toBe("You're invited: cozy and long")
  })

  test('у каждого пресета комнаты есть английское название', () => {
    // Новый пресет без пары молча выпал бы из английского превью
    for (const p of ROOM_PRESETS) {
      const c = inviteCopy('ABC234', { ...openEn, preset: p.label }, 'en')
      expect(c.title, p.key).not.toBe(inviteCopy('ABC234', openEn, 'en').title)
      expect(everything(c), p.key).not.toMatch(CYRILLIC)
    }
  })

  test('незнакомое название настроения — как комната без него, а не русское слово в английской фразе', () => {
    expect(inviteCopy('ABC234', { ...openEn, preset: 'Своё настроение' }, 'en')).toEqual(
      inviteCopy('ABC234', openEn, 'en'),
    )
  })

  test('длинный ник режется в карточке и рядом с настроением, в заголовке — целиком', () => {
    const host = 'Very-very long player nickname'
    const c = inviteCopy('ABC234', { ...openEn, host, preset: 'Спокойно, под разговор' }, 'en')
    expect(c.headline).toBe('Very-very long pla: chill, while we talk')
    expect(c.title).toBe(`${host} invites you to party ABC234 · Chill, while we talk`)
  })

  test('предложенная игра — зовут в неё, и честно сказано, что это предложение', () => {
    const c = inviteCopy('ABC234', { ...openEn, seedName: 'Deep Rock Galactic' }, 'en')
    expect(c.title).toBe('Sergey invites you to “Deep Rock Galactic” · party ABC234')
    expect(c.headline).toBe('Sergey invites you to “Deep Rock Galactic”')
    expect(c.description).toBe(
      'First card: “Deep Rock Galactic”. Not into it? Next up is a deck from your libraries. ' +
        "3 people are already in the room. Connect your Steam library and swipe on what you'd play. When everyone's votes line up, it's a match.",
    )
    expect(c.eyebrow).toBe('PARTY · INVITE')
    expect(everything(c)).not.toMatch(CYRILLIC)

    const nobody = inviteCopy('ABC234', { ...openEn, host: null, seedName: 'Valheim' }, 'en')
    expect(nobody.title).toBe("You're invited to “Valheim” · party ABC234")
    expect(nobody.headline).toBe("You're invited to “Valheim”")
  })

  test('игра и настроение вместе: игра — крупно, настроение — в надзаголовке', () => {
    const c = inviteCopy('ABC234', { ...openEn, seedName: 'Deep Rock Galactic', preset: 'Весь вечер вместе' }, 'en')
    expect(c.headline).toBe('Sergey invites you to “Deep Rock Galactic”')
    expect(c.eyebrow).toBe('PARTY · ALL EVENING TOGETHER')
  })

  /*
   * «invites you to “”» шире «зовёт в «»» на 123 px кеглем 44, и название
   * игры в английской карточке короче на пять знаков: самая длинная строка
   * не длиннее русской. В заголовке вкладки — целиком.
   */
  test('длинное название предложенной игры в английской карточке режется раньше русской', () => {
    const name = 'Warhammer 40,000: Dawn of War – Definitive Edition Remastered'
    const c = inviteCopy('ABC234', { ...openEn, seedName: name }, 'en')
    expect(c.headline).toBe('Sergey invites you to “Warhammer 40,000: Dawn of War –…”')
    expect(c.title).toContain(name)
    expect(c.description).toContain(name)
    // после матча фраза уже русской — потолок общий
    expect(inviteCopy('ABC234', { ...matchedEn, matchedName: name }, 'en').headline).toBe(
      'Matched on “Warhammer 40,000: Dawn of War – Defin…”',
    )
  })

  test('после матча предложенная игра молчит и по-английски', () => {
    const c = inviteCopy('ABC234', { ...matchedEn, seedName: 'Valheim', preset: 'Весь вечер вместе' }, 'en')
    expect(c).toEqual(inviteCopy('ABC234', matchedEn, 'en'))
  })
})

describe('экран приглашения по-английски', () => {
  const valheim = { appid: 892970, name: 'Valheim', headerImage: null, art: null }

  test('кто зовёт — той же фразой, что крупная строка карточки', () => {
    expect(inviteDoor({ host: 'Sergey', names: ['Sergey'], seed: null }, 'en')).toEqual({
      title: 'Sergey wants to pick a game for tonight',
      here: null,
      seed: null,
    })
    expect(inviteDoor({ host: null, names: ['Player 3f9a'], seed: null }, 'en').title).toBe(
      "You're invited to pick a game for tonight",
    )
    expect(inviteDoor({ host: 'Sergey', names: ['Sergey', 'Anna'], seed: null }, 'en').title).toBe(
      inviteCopy('ABC234', { ...open, host: 'Sergey' }, 'en').headline,
    )
  })

  test('кто уже здесь — через запятую и «and», остальные числом', () => {
    const here = (names: string[]) => inviteDoor({ host: 'Sergey', names, seed: null }, 'en').here
    expect(here(['Sergey', 'Anna'])).toBe('Already here: Sergey and Anna')
    expect(here(['Sergey', 'Anna', 'Dima'])).toBe('Already here: Sergey, Anna and Dima')
    expect(here(['Sergey', 'Anna', 'Dima', 'Sasha', 'Player 3f9a'])).toBe(
      'Already here: Sergey, Anna, Dima and 2 more',
    )
    expect(inviteDoor({ host: null, names: ['Anna'], seed: null }, 'en').here).toBe('Already here: Anna')
  })

  test('длинный ник хоста режется тем же потолком, что по-русски', () => {
    const host = 'xXx_DarkLordOfTheNight_2009_xXx!'
    const d = inviteDoor({ host, names: [host, 'Anna'], seed: null }, 'en')
    expect(d.title).toBe('xXx_DarkLordOfTheNi… wants to pick a game for tonight')
    expect(d.here).toBe('Already here: xXx_DarkLordOfTheNi… and Anna')
  })

  test('игра, в которую звали, — той же фразой, что в описании превью', () => {
    const d = inviteDoor({ host: 'Sergey', names: ['Sergey'], seed: valheim }, 'en')
    expect(d.seed).toEqual({
      ...valheim,
      line: 'First card: “Valheim”. Not into it? Next up is a deck from your libraries.',
    })
    expect(
      inviteCopy('ABC234', { ...open, host: 'Sergey', seedName: 'Valheim' }, 'en').description.startsWith(d.seed!.line),
    ).toBe(true)
    for (const s of [d.title, d.seed!.line]) expect(s).not.toMatch(CYRILLIC)
  })
})
