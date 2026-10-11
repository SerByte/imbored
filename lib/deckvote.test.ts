import { describe, expect, test } from 'vitest'
import {
  cappedSignal,
  claimVote,
  deckKeyVote,
  type DeckKeyEvent,
  deckOnScreen,
  OWN_ARROWS_SELECTOR,
  deckCardLine,
  deckPosition,
  deckStuck,
  deckSwipeVote,
  membershipLapsed,
  pollCaughtUp,
  VOTE_TIMEOUT_MS,
  voteMiss,
  voteSignal,
} from './deckvote'

/**
 * Сторож голоса колоды пати.
 *
 * Две вещи, которые стоили живой комнаты. Двойной Enter по улетающей карте
 * засчитывал голос дважды — полоса убегала вперёд и под конец за сто
 * процентов. А отказ с кодом, на который повтор ответит тем же, возвращал
 * карту со строкой «свайпни ещё раз» — предложение жеста, который снова
 * откажет.
 */
describe('голос уходит один раз', () => {
  test('повторный жест по той же карте — пустышка', () => {
    const voted = new Set<number>()
    expect(claimVote(voted, 570)).toBe(true)
    expect(claimVote(voted, 570), 'второй Enter по улетающей карте проголосовал бы ещё раз').toBe(false)
  })

  test('другая карта голосуется как обычно', () => {
    const voted = new Set<number>()
    claimVote(voted, 570)
    expect(claimVote(voted, 730)).toBe(true)
  })

  test('вернувшаяся после отказа карта снова голосуется', () => {
    const voted = new Set<number>()
    claimVote(voted, 570)
    // так страница откатывает голос, который не записался
    voted.delete(570)
    expect(claimVote(voted, 570), 'карта вернулась, а жест по ней мёртв').toBe(true)
  })
})

describe('разбор отказа голоса', () => {
  test('повтор предлагается только там, где он может помочь', () => {
    expect(voteMiss(0), 'обрыв сети — повторяемо').toBe('retry')
    expect(voteMiss(500)).toBe('retry')
    expect(voteMiss(429)).toBe('retry')
  })

  test('409 — карта уходит: комната договорилась или карты нет в колоде', () => {
    expect(voteMiss(409)).toBe('gone')
  })

  test('401 — на вход, а не «свайпни ещё раз»', () => {
    expect(voteMiss(401)).toBe('bounce')
  })

  test('403 — участника убрали, карту в колоду не возвращаем', () => {
    expect(voteMiss(403)).toBe('removed')
  })

  test('голос не висит бесконечно: у запроса есть потолок', () => {
    const signal = voteSignal()
    expect(signal, 'повисший POST держал бы карту «улетевшей» навсегда').toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)
    expect(VOTE_TIMEOUT_MS).toBeGreaterThan(0)
  })

  test('потолок общий для кнопок комнаты: повисший запрос отменяется и становится отказом', async () => {
    // выход, ✕ хоста и доска держат флаг «в пути» — без потолка он висел бы до сдачи браузера
    const signal = cappedSignal(5)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)
    await new Promise((r) => setTimeout(r, 30))
    expect(signal?.aborted, 'потолок не сработал — кнопка осталась бы мёртвой').toBe(true)
  })
})

/**
 * Хост убрал участника — сервер стёр все его голоса, а вкладка помнила
 * отсвайпанное. Вернулся он из второй вкладки — эта следующим опросом снова
 * видела себя участником с прежним ключом колоды и колоду не перечитывала:
 * карты со стёртыми голосами отсеивались навсегда, комната вставала.
 */
describe('членство прервалось между снимками — память колоды с нуля', () => {
  const member = (myVotes: number) => ({ isMember: true, myVotes })
  const outsider = { isMember: false, myVotes: null }

  test('участник → не участник: удаление видно прямо', () => {
    expect(membershipLapsed({ seq: 5, shown: { seq: 4, ...member(7) }, next: outsider })).toBe(true)
  })

  test('свои голоса убыли: было удаление и вход из другой вкладки, а «не участник» эта не застала', () => {
    expect(
      membershipLapsed({ seq: 5, shown: { seq: 4, ...member(7) }, next: member(0) }),
      'ключ «состав:раунд» прежний — колода со стёртыми голосами не перечитается',
    ).toBe(true)
  })

  test('голоса растут или стоят — членство непрерывно, колоду не трогаем', () => {
    expect(membershipLapsed({ seq: 5, shown: { seq: 4, ...member(7) }, next: member(7) })).toBe(false)
    expect(membershipLapsed({ seq: 5, shown: { seq: 4, ...member(7) }, next: member(9) })).toBe(false)
  })

  test('не участник → участник — это вход, его сбрасывает сам вход', () => {
    expect(membershipLapsed({ seq: 5, shown: { seq: 4, ...outsider }, next: member(0) })).toBe(false)
  })

  test('первый снимок — сравнивать не с чем', () => {
    expect(membershipLapsed({ seq: 1, shown: null, next: outsider })).toBe(false)
  })

  test('снимок старше показанного — прошлое, а не новость', () => {
    // так встаёт снимок с матчем, прочитанный до показанного (snapshotFate)
    expect(membershipLapsed({ seq: 3, shown: { seq: 4, ...member(7) }, next: outsider })).toBe(false)
    expect(membershipLapsed({ seq: 3, shown: { seq: 4, ...member(7) }, next: member(6) })).toBe(false)
  })
})

describe('застрявшая колода', () => {
  test('на руках пусто, а сервер говорит «не дошёл» — перечитать', () => {
    expect(deckStuck({ left: 0, meDone: false, deckSize: 20 })).toBe(true)
  })

  test('дошёл до конца — перечитывать нечего', () => {
    expect(deckStuck({ left: 0, meDone: true, deckSize: 20 })).toBe(false)
  })

  test('карты ещё есть или колода не загружена — не застряла', () => {
    expect(deckStuck({ left: 3, meDone: false, deckSize: 20 })).toBe(false)
    expect(deckStuck({ left: null, meDone: false, deckSize: 20 })).toBe(false)
  })

  test('не участник — не наша колода', () => {
    expect(deckStuck({ left: 0, meDone: undefined, deckSize: 20 })).toBe(false)
  })

  test('без размера колоды признака конца нет — «не дошёл» ничего не значит', () => {
    expect(deckStuck({ left: 0, meDone: false, deckSize: 0 })).toBe(false)
    expect(deckStuck({ left: 0, meDone: false, deckSize: null })).toBe(false)
  })
})

/**
 * Застрявшей колоду можно назвать, только когда опрос догнал свои голоса.
 *
 * Сразу после последнего свайпа на руках пусто, а done в последнем снимке
 * ещё false: голос в пути, и опрос о нём не знает. deckStuck в эту секунду
 * истинно на КАЖДОМ штатном конце колоды, и самолечение уходило полной
 * пересборкой /deck — самого дорогого маршрута — у каждого участника в каждом
 * раунде, тратя заодно единственное лечение на ключ.
 */
describe('опрос догнал свои голоса', () => {
  test('голос в пути — снимок о нём не знает', () => {
    expect(pollCaughtUp({ votesInFlight: 1, askedAt: 2_000, votesSettledAt: 1_000 })).toBe(false)
  })

  test('снимок запрошен до ответа на последний голос — тоже не знает', () => {
    expect(
      pollCaughtUp({ votesInFlight: 0, askedAt: 1_000, votesSettledAt: 1_500 }),
      'опрос, ушедший раньше ответа голоса, звал лечение на штатном конце колоды',
    ).toBe(false)
  })

  test('снимок запрошен после ответа на последний голос — знает', () => {
    expect(pollCaughtUp({ votesInFlight: 0, askedAt: 1_501, votesSettledAt: 1_500 })).toBe(true)
  })

  test('та же миллисекунда — ещё не знает: подождать один опрос дешевле, чем пересобрать колоду', () => {
    expect(pollCaughtUp({ votesInFlight: 0, askedAt: 1_500, votesSettledAt: 1_500 })).toBe(false)
  })

  test('голосов ещё не было — любой снимок свежий', () => {
    expect(pollCaughtUp({ votesInFlight: 0, askedAt: 1, votesSettledAt: 0 })).toBe(true)
  })
})

/**
 * Голос жестом. Скорость у framer-motion — за последние 100 мс движения, и
 * быстрый возврат пальца к центру легко даёт больше 500 px/с В ДРУГУЮ
 * сторону от остаточного смещения. Раньше порог проходил по скорости, а
 * сторона бралась по смещению — и отмена голосовала за ту сторону, от
 * которой палец уходил. Голос не отменить, а «да» последнего несогласного
 * сводит матч сразу.
 *
 * Числа — замеры жестов с getVelocity framer-motion.
 */
describe('голос жестом', () => {
  test('быстрый возврат к центру — отмена, а не голос', () => {
    expect(deckSwipeVote(20, -1300), 'дёрнул вправо и передумал — записалось «Играем!»').toBeNull()
    expect(deckSwipeVote(20, -520)).toBeNull()
    expect(deckSwipeVote(-20, 1300), 'зеркально — записалось «Не хочу»').toBeNull()
  })

  test('за порогом, но палец резко уходит назад — тоже отмена, и уж точно не другая сторона', () => {
    expect(deckSwipeVote(153, -917)).toBeNull()
  })

  test('отмена, перелетевшая центр, не голосует за противоположную сторону', () => {
    expect(deckSwipeVote(-5, -1033)).toBeNull()
  })

  test('настоящий щелчок в одну сторону — голос этой стороны', () => {
    expect(deckSwipeVote(74, 889)).toBe(true)
    expect(deckSwipeVote(40, 900)).toBe(true)
    expect(deckSwipeVote(-58, -875)).toBe(false)
  })

  test('медленный увод за порог — голос по смещению', () => {
    expect(deckSwipeVote(130, 162)).toBe(true)
    expect(deckSwipeVote(150, 0)).toBe(true)
    expect(deckSwipeVote(-140, -20)).toBe(false)
  })

  test('мало и медленно, или вовсе без смещения — карта возвращается', () => {
    expect(deckSwipeVote(50, 100)).toBeNull()
    expect(deckSwipeVote(0, 900)).toBeNull()
    expect(deckSwipeVote(0, 0)).toBeNull()
  })
})

describe('позиция в колоде', () => {
  test('обычная дробь', () => {
    expect(deckPosition(4, 20)).toEqual({ n: 5, total: 20, label: '5/20', pct: 25 })
  })

  test('числитель не убегает за знаменатель, полоса — за сто процентов', () => {
    const pos = deckPosition(15, 12)
    expect(pos.label, 'после схлопнувшейся колоды было «16/12»').toBe('12/12')
    expect(pos.pct).toBe(100)
  })

  test('пустой знаменатель — одна позиция без дроби', () => {
    expect(deckPosition(0, 0)).toEqual({ n: 1, total: null, label: '1', pct: 0 })
  })
})

describe('строка для скринридера', () => {
  test('номер тот же, что на полосе, и название игры', () => {
    expect(deckCardLine(deckPosition(2, 20), 'Dota 2')).toBe('Карта 3 из 20: Dota 2')
  })

  test('без знаменателя — без «из 0»', () => {
    expect(deckCardLine(deckPosition(0, 0), 'Dota 2')).toBe('Карта 1: Dota 2')
  })
})

describe('голос стрелкой', () => {
  const key = (over: Partial<DeckKeyEvent>): DeckKeyEvent => ({
    key: 'ArrowRight',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    ownArrows: false,
    onScreen: true,
    ...over,
  })

  test('вправо — да, влево — нет, как у жеста', () => {
    expect(deckKeyVote(key({ key: 'ArrowRight' }))).toBe(true)
    expect(deckKeyVote(key({ key: 'ArrowLeft' }))).toBe(false)
  })

  test('прочие клавиши — не голос', () => {
    for (const k of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'a']) {
      expect(deckKeyVote(key({ key: k })), k).toBeNull()
    }
  })

  test('зажатая стрелка не пролистывает колоду очередью', () => {
    expect(deckKeyVote(key({ repeat: true }))).toBeNull()
  })

  test('Alt+← остаётся «Назад» браузера, Shift+→ — выделением', () => {
    expect(deckKeyVote(key({ key: 'ArrowLeft', altKey: true }))).toBeNull()
    expect(deckKeyVote(key({ shiftKey: true }))).toBeNull()
    expect(deckKeyVote(key({ ctrlKey: true }))).toBeNull()
    expect(deckKeyVote(key({ metaKey: true }))).toBeNull()
  })

  test('стрелку, занятую полем или каруселью, колода не отнимает', () => {
    expect(deckKeyVote(key({ ownArrows: true }))).toBeNull()
    expect(deckKeyVote(key({ defaultPrevented: true }))).toBeNull()
  })

  test('колода вне экрана не голосует за невидимую карту', () => {
    expect(deckKeyVote(key({ onScreen: false }))).toBeNull()
  })

  test('в экране — это хотя бы 120 px карты', () => {
    expect(deckOnScreen({ top: 200, bottom: 700 }, 900)).toBe(true)
    // уехала вверх под шапку: видна полоска в 60 px
    expect(deckOnScreen({ top: -500, bottom: 60 }, 900)).toBe(false)
    // ещё ниже сгиба: торчит край в 80 px
    expect(deckOnScreen({ top: 820, bottom: 1400 }, 900)).toBe(false)
    expect(deckOnScreen({ top: 780, bottom: 1400 }, 900)).toBe(true)
  })

  test('карусель скриншотов и лайтбокс держат свои стрелки', () => {
    expect(OWN_ARROWS_SELECTOR).toContain('[aria-roledescription]')
    expect(OWN_ARROWS_SELECTOR).toContain('[aria-modal="true"]')
    expect(OWN_ARROWS_SELECTOR).toContain('input')
  })
})
