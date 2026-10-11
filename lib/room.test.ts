import { describe, expect, test } from 'vitest'
import {
  awaitingOthers,
  deckBehind,
  matchLine,
  matchNoticeDue,
  memberLabel,
  pageNotices,
  parseRoomCode,
  roomTabTitle,
  rosterHint,
  waitingMode,
  waitsInBackground,
} from './room'

/**
 * Сторож «ждём остальных». Фразу уже однажды убирали со страницы: в двух
 * режимах ожидания из трёх она врала (WaitingMode). Заголовок вкладки и фон
 * обязаны говорить то же, что экран.
 */
describe('кого ждём из фона', () => {
  // отсвайпал своё, двое в комнате, сосед ещё свайпает
  const base = { waiting: true, memberCount: 2, deckTotal: 20, myVotes: 20, othersSwiping: 1 }

  test('кто-то ещё свайпает — ждём остальных', () => {
    expect(awaitingOthers(base)).toBe(true)
    expect(waitsInBackground(base)).toBe(true)
  })

  test('один в комнате — ждать некого: ни заголовка, ни опроса', () => {
    expect(awaitingOthers({ ...base, memberCount: 1, othersSwiping: 0 })).toBe(false)
    expect(waitsInBackground({ ...base, memberCount: 1 })).toBe(false)
  })

  test('колоды не было — ждать нечего: ни заголовка, ни опроса', () => {
    expect(awaitingOthers({ ...base, deckTotal: 0, myVotes: 0 })).toBe(false)
    expect(waitsInBackground({ ...base, deckTotal: 0, myVotes: 0 })).toBe(false)
  })

  test('все отсвайпали — не «ждём остальных», но чужое «Берём» фон ещё увидит', () => {
    const allDone = { ...base, othersSwiping: 0 }
    expect(awaitingOthers(allDone)).toBe(false)
    expect(waitsInBackground(allDone)).toBe(true)
  })

  test('пока своя колода не кончилась — ни то ни другое', () => {
    expect(awaitingOthers({ ...base, waiting: false })).toBe(false)
    expect(waitsInBackground({ ...base, waiting: false })).toBe(false)
  })

  /*
   * Сосед нажал «Ещё 20 игр», пока эта вкладка скрыта. Колоду нового раунда
   * скрытая вкладка не грузит (app/room/[id]), и на руках пусто — но не
   * потому, что всё отсвайпано. Двое таких ждущих видят друг друга «ещё
   * свайпает»: с «ждём остальных» у обоих комната встала бы.
   */
  test('сосед поднял раунд, колода нового ещё не догружена — ни заголовка, ни фонового опроса', () => {
    const behind = { ...base, deckSize: 40 }
    expect(deckBehind(behind)).toBe(true)
    expect(awaitingOthers(behind)).toBe(false)
    expect(waitsInBackground(behind)).toBe(false)
  })

  test('колода догружена и отсвайпана — снова ждём', () => {
    const caught = { ...base, deckTotal: 40, myVotes: 40, deckSize: 40 }
    expect(deckBehind(caught)).toBe(false)
    expect(awaitingOthers(caught)).toBe(true)
    expect(waitsInBackground(caught)).toBe(true)
  })

  test('голос в пути после последнего свайпа (сервер ещё не видит done) — это не отставание, фон нужен', () => {
    // deckStuck здесь истинно, но колода на руках актуальна: именно фоновый
    // опрос принесёт done. Отключи его — скрытая вкладка ждала бы молча час
    const inFlight = { ...base, myVotes: 19, deckSize: 20 }
    expect(deckBehind(inFlight)).toBe(false)
    expect(waitsInBackground(inFlight)).toBe(true)
    expect(awaitingOthers(inFlight)).toBe(true)
  })

  test('серверная колода больше, но свои голоса её уже покрывают — свайпать нечего, не отставание', () => {
    expect(deckBehind({ deckTotal: 20, myVotes: 40, deckSize: 40 })).toBe(false)
  })

  test('колоду ещё никто не запрашивал — отставания нет', () => {
    expect(deckBehind({ deckTotal: 20, myVotes: 20, deckSize: null })).toBe(false)
    expect(deckBehind({ deckTotal: 20, myVotes: 20 })).toBe(false)
  })
})

describe('roomTabTitle', () => {
  const open = {
    roomId: 'ABC123',
    status: 'open' as const,
    isMember: true,
    awaiting: false,
    sawOpen: true,
    unseen: false,
    matchedName: null,
  }
  const matched = { ...open, status: 'matched' as const, matchedName: 'Hades' }

  test('ждёт других, комната открыта — «ждём остальных» с кодом пати', () => {
    expect(roomTabTitle({ ...open, awaiting: true })).toBe('Ждём остальных · Пати ABC123')
  })

  test('пока свайпает — заголовок не трогаем: прогресса на каждый голос нет', () => {
    expect(roomTabTitle(open)).toBeNull()
  })

  test('матч, пришедший в скрытую вкладку, — с точкой; вернулся — без', () => {
    expect(roomTabTitle({ ...matched, unseen: true })).toBe('● Сошлись: Hades')
    expect(roomTabTitle(matched)).toBe('Сошлись: Hades')
  })

  test('открыл ссылку на уже сошедшуюся комнату — новости нет', () => {
    expect(roomTabTitle({ ...matched, sawOpen: false, unseen: true })).toBeNull()
  })

  test('у не-участника заголовок не трогается ни в одном состоянии', () => {
    // приглашение называется так, как его назвал сервер; чужой матч — не его новость
    expect(roomTabTitle({ ...open, isMember: false, awaiting: true })).toBeNull()
    expect(roomTabTitle({ ...matched, isMember: false, unseen: true })).toBeNull()
  })

  test('ни в одном состоянии нет «Берём» и счётчиков', () => {
    for (const t of [roomTabTitle({ ...open, awaiting: true }), roomTabTitle({ ...matched, unseen: true })]) {
      expect(t).not.toMatch(/Берём|\d+\s*\/\s*\d+|\?/)
    }
  })
})

describe('pageNotices', () => {
  const desk = { hasNotification: true, uaMobile: undefined, coarsePointer: false }

  test('десктоп с Notification — переключатель есть', () => {
    expect(pageNotices(desk)).toBe(true)
    expect(pageNotices({ ...desk, uaMobile: false })).toBe(true)
  })

  test('телефон — нет, даже если window.Notification определён', () => {
    // Android Chrome: объект есть, а new Notification() без сервис-воркера бросает TypeError
    expect(pageNotices({ ...desk, uaMobile: true })).toBe(false)
    // iOS Safari не сообщает userAgentData — ловится по пальцу
    expect(pageNotices({ ...desk, coarsePointer: true })).toBe(false)
  })

  test('без Notification — нет', () => {
    expect(pageNotices({ ...desk, hasNotification: false })).toBe(false)
  })
})

describe('matchNoticeDue', () => {
  const due = { enabled: true, permission: 'granted' as const, visible: false, selfCaused: false }

  test('включено, разрешено, вкладка скрыта, матч чужой — сообщаем', () => {
    expect(matchNoticeDue(due)).toBe(true)
  })

  test('свой матч не уведомляет — даже из скрытой вкладки', () => {
    expect(matchNoticeDue({ ...due, selfCaused: true })).toBe(false)
  })

  test('видимую вкладку уже заняла церемония', () => {
    expect(matchNoticeDue({ ...due, visible: true })).toBe(false)
  })

  test('без согласия человека — никогда', () => {
    expect(matchNoticeDue({ ...due, enabled: false })).toBe(false)
    expect(matchNoticeDue({ ...due, permission: 'default' })).toBe(false)
    expect(matchNoticeDue({ ...due, permission: 'denied' })).toBe(false)
  })
})

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

describe('matchLine', () => {
  const matched = { status: 'matched' as const, isMember: true, game: { name: 'Hades' } }

  test('комната сошлась на глазах — строка называет игру', () => {
    // ради названия строка и звучит: заголовок церемонии говорит только «Это матч!»
    expect(matchLine({ sawOpen: true, ...matched })).toBe('Матч: «Hades»')
  })

  test('открыл ссылку на уже сошедшуюся комнату — новости нет', () => {
    // церемония здесь и есть страница, её читают как страницу
    expect(matchLine({ sawOpen: false, ...matched })).toBeNull()
  })

  test('пока комната открыта — сказать нечего', () => {
    expect(matchLine({ sawOpen: true, ...matched, status: 'open' })).toBeNull()
  })

  test('те же условия, что у церемонии: только своим и только с игрой', () => {
    // чужому рисуется «эта пати уже договорилась», а не церемония
    expect(matchLine({ sawOpen: true, ...matched, isMember: false })).toBeNull()
    expect(matchLine({ sawOpen: true, ...matched, game: null })).toBeNull()
  })
})
