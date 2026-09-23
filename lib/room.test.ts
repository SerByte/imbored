import { describe, expect, test } from 'vitest'
import { memberLabel, parseRoomCode, rosterHint, waitingMode } from './room'

describe('waitingMode', () => {
  test('один в комнате — «ты тут один», а не «ждём остальных»', () => {
    // findRoomMatch требует минимум двух участников, поэтому комната на одного
    // не может разрешиться никогда: «матч появится сам» здесь — обещание,
    // которое сервер не выполнит
    expect(waitingMode({ memberCount: 1, deckTotal: 20, myVotes: 20 })).toBe('alone')
  })

  test('колода была, ты закончил, есть другие — ждём их', () => {
    expect(waitingMode({ memberCount: 3, deckTotal: 20, myVotes: 20 })).toBe('others')
  })

  test('участники есть, а карт не было вовсе — это не «ты всё отсвайпал»', () => {
    // Пустая колода бывает, когда у участника нет снапшота библиотеки, а пул
    // ничего не дал. Человек не отсвайпал ничего — говорить обратное нельзя
    expect(waitingMode({ memberCount: 2, deckTotal: 0, myVotes: 0 })).toBe('empty')
  })

  test('колода опустела после того, как я всё отсвайпал, — это НЕ «выбирать не из чего»', () => {
    // Колода пересобирается при входе нового человека, и от неё может не
    // остаться ничего: у новичка нет библиотеки, «есть у всех» больше не
    // выполняется ни для одной игры. Но я-то десять карт отсвайпал — и экран,
    // сообщающий «в ваших библиотеках не нашлось ничего», прямо над ростером
    // с моими 10 из 10, противоречит сам себе
    expect(waitingMode({ memberCount: 3, deckTotal: 0, myVotes: 10 })).toBe('others')
  })

  test('один и колода пуста — всё равно «ты один»: позвать людей чинит и то, и другое', () => {
    // Библиотеки участников — сырьё для колоды, поэтому второй человек
    // одновременно снимает и запрет на матч, и пустоту колоды
    expect(waitingMode({ memberCount: 1, deckTotal: 0, myVotes: 0 })).toBe('alone')
  })

  test('нулевой состав не ломает выбор режима', () => {
    expect(waitingMode({ memberCount: 0, deckTotal: 0, myVotes: 0 })).toBe('alone')
  })
})

describe('memberLabel', () => {
  const SID = '76561198012345678'

  test('настоящее имя возвращается как есть', () => {
    expect(memberLabel('ABC123', SID, 'Дима')).toBe('Дима')
  })

  test('без имени steamid НАРУЖУ НЕ УХОДИТ — ни куском, ни целиком', () => {
    // Шапка lib/room объявляет это инвариантом, а запасное имя строилось как
    // `Игрок ${steamid.slice(-4)}` и раздавалось всем в комнате, а через доску
    // «Пати» — анонимам.
    const метка = memberLabel('ABC123', SID, null)
    for (let n = 3; n <= SID.length; n++) {
      for (let i = 0; i + n <= SID.length; i++) {
        expect(метка).not.toContain(SID.slice(i, i + n))
      }
    }
  })

  test('метка стабильна в пределах комнаты', () => {
    expect(memberLabel('ABC123', SID, null)).toBe(memberLabel('ABC123', SID, null))
  })

  test('в разных комнатах метки разные — сшить человека нельзя', () => {
    expect(memberLabel('ABC123', SID, undefined)).not.toBe(memberLabel('XYZ789', SID, undefined))
  })

  test('разных участников одной комнаты метка различает', () => {
    const a = memberLabel('ABC123', SID, null)
    const b = memberLabel('ABC123', '76561198087654321', null)
    expect(a).not.toBe(b)
  })
})

describe('parseRoomCode', () => {
  test('код как есть', () => {
    expect(parseRoomCode('FCPK8G')).toBe('FCPK8G')
  })

  test('надиктованное: регистр, пробелы и дефисы — не часть кода', () => {
    expect(parseRoomCode('fcp k8g')).toBe('FCPK8G')
    expect(parseRoomCode('FCP-K8G')).toBe('FCPK8G')
    expect(parseRoomCode('  fcpk8g ')).toBe('FCPK8G')
  })

  test('вставленная целиком ссылка тоже годится', () => {
    expect(parseRoomCode('https://imbored.cc/room/FCPK8G')).toBe('FCPK8G')
    expect(parseRoomCode('imbored.cc/room/fcpk8g?utm=chat')).toBe('FCPK8G')
  })

  test('не шесть знаков или чужие символы — не код', () => {
    expect(parseRoomCode('')).toBeNull()
    expect(parseRoomCode('FCPK8')).toBeNull()
    expect(parseRoomCode('FCPK8GG')).toBeNull()
    expect(parseRoomCode('FCPK8Ж')).toBeNull()
    expect(parseRoomCode('../api')).toBeNull()
  })
})

describe('rosterHint', () => {
  test('кто-то ещё свайпает — матч правда может прийти сам', () => {
    expect(rosterHint({ swiping: 1, hasMore: true })).toBe('Матч появится сам — обновлять не надо.')
    expect(rosterHint({ swiping: 2, hasMore: false })).toBe('Матч появится сам — обновлять не надо.')
  })

  test('все закончили — «появится сам» под «ни разу не совпали» было враньём', () => {
    const hint = rosterHint({ swiping: 0, hasMore: true })
    expect(hint).not.toMatch(/появится сам/)
    expect(hint).toBe('Совпадения нет — возьмите ещё игр кнопкой ниже.')
  })

  test('все закончили и карт больше нет — совет взять ещё был бы тупиком', () => {
    expect(rosterHint({ swiping: 0, hasMore: false })).toBeNull()
  })
})
