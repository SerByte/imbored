import fs from 'node:fs'
import path from 'node:path'
import { plural } from './plural'
import { describe, expect, test } from 'vitest'
import { buildLikes, LIKES_MINE_MAX, pickLeader, type MemberRef } from './roomlikes'
import type { RoomVote } from './db'

const MEMBERS: MemberRef[] = [
  { steamid: 'me', name: 'Ты' },
  { steamid: 'dima', name: 'Дима' },
  { steamid: 'sasha', name: 'Саша' },
]

function vote(steamid: string, appid: number, v: 0 | 1, at = 0): RoomVote {
  return { steamid, appid, vote: v, createdAt: at }
}

describe('buildLikes: свои лайки', () => {
  test('отдаёт только мои «играем», свежие первыми', () => {
    const votes = [
      vote('me', 570, 1, 10),
      vote('me', 620, 0, 20), // «не хочу» — не лайк
      vote('me', 730, 1, 30),
      vote('dima', 999, 1, 40), // чужой лайк
    ]
    const { mineAppids } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(mineAppids).toEqual([730, 570])
  })

  test('ограничивает список', () => {
    const votes = Array.from({ length: LIKES_MINE_MAX + 5 }, (_, i) => vote('me', i + 1, 1, i))
    const { mineAppids } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(mineAppids).toHaveLength(LIKES_MINE_MAX)
  })
})

describe('buildLikes: почти совпали', () => {
  test('двое за, третий ещё не голосовал — это почти совпадение', () => {
    const votes = [vote('me', 570, 1), vote('dima', 570, 1)]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(near).toHaveLength(1)
    expect(near[0].forNames).toEqual(['Ты', 'Дима'])
    expect(near[0].pendingNames).toEqual(['Саша'])
    expect(near[0].meFor).toBe(true)
    expect(near[0].games).toBe(1)
  })

  test('один голос «против» убивает почти-совпадение', () => {
    // Иначе «вы почти совпали» — это ровно то же враньё про мёртвую карту,
    // от которого мы уходим, только переехавшее в новую секцию
    const votes = [vote('me', 570, 1), vote('dima', 570, 1), vote('sasha', 570, 0)]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(near).toEqual([])
  })

  test('все за — это уже матч, а не почти', () => {
    const votes = [vote('me', 570, 1), vote('dima', 570, 1), vote('sasha', 570, 1)]
    expect(buildLikes({ votes, members: MEMBERS, me: 'me' }).near).toEqual([])
  })

  test('один за — ещё не «вы»', () => {
    const votes = [vote('me', 570, 1)]
    expect(buildLikes({ votes, members: MEMBERS, me: 'me' }).near).toEqual([])
  })

  test('одинаковый расклад по разным играм схлопывается в один пункт', () => {
    const votes = [
      vote('me', 570, 1),
      vote('dima', 570, 1),
      vote('me', 730, 1),
      vote('dima', 730, 1),
    ]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(near).toHaveLength(1)
    expect(near[0].games).toBe(2)
  })

  test('«ждём тебя» — самый сильный случай: двое сошлись без меня', () => {
    const votes = [vote('dima', 570, 1), vote('sasha', 570, 1)]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(near[0].mePending).toBe(true)
    expect(near[0].meFor).toBe(false)
    expect(near[0].pendingNames).toEqual(['Ты'])
  })

  test('НИ НАЗВАНИЯ, НИ appid в почти-совпадении', () => {
    // Матч — самая большая эмоция продукта, и подпись «вы с Димой оба за
    // Deep Rock Galactic» сообщает финал заранее всем, кто уже «за». Плюс на
    // доске «Пати» в открытую комнату подсаживаются незнакомые, и «двое за X»
    // при двух участниках — точное раскрытие чужого голоса.
    //
    // Поля appid здесь нет вовсе — не потому что клиенту не нужно, а чтобы его
    // нельзя было случайно вывести на экран.
    const votes = [vote('me', 570, 1), vote('dima', 570, 1)]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(Object.keys(near[0])).not.toContain('appid')
    expect(JSON.stringify(near)).not.toContain('570')
  })

  test('сортировка: сначала где больше согласных, потом где больше игр', () => {
    const four: MemberRef[] = [...MEMBERS, { steamid: 'kat', name: 'Катя' }]
    const votes = [
      // 2 за, 1 игра
      vote('me', 100, 1),
      vote('dima', 100, 1),
      // 3 за, 1 игра — должно быть первым
      vote('me', 200, 1),
      vote('dima', 200, 1),
      vote('sasha', 200, 1),
    ]
    const { near } = buildLikes({ votes, members: four, me: 'me' })
    expect(near[0].forNames).toHaveLength(3)
    expect(near[1].forNames).toHaveLength(2)
  })

  test('onlyMine: только расклады, где я «за», — и отсев до среза в maxNear', () => {
    // «Ждём тебя» — это зонд: «нет» на такую карту убирает её расклад, и по
    // упавшему счёту видно, кто за неё (lib/roomlikes, likes/route.ts)
    const four: MemberRef[] = [...MEMBERS, { steamid: 'kat', name: 'Катя' }]
    const votes = [
      // три расклада «ждём тебя», и у каждого больше «за», чем у моего
      vote('dima', 100, 1),
      vote('sasha', 100, 1),
      vote('kat', 100, 1),
      vote('dima', 200, 1),
      vote('sasha', 200, 1),
      vote('dima', 300, 1),
      vote('kat', 300, 1),
      // мой — двое за
      vote('me', 400, 1),
      vote('dima', 400, 1),
    ]
    const all = buildLikes({ votes, members: four, me: 'me', maxNear: 1 }).near
    expect(all[0].mePending).toBe(true)

    const mine = buildLikes({ votes, members: four, me: 'me', maxNear: 1, onlyMine: true }).near
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ meFor: true, forNames: ['Ты', 'Дима'] })

    // «нет» на чужую карту — мой блок тот же
    const after = buildLikes({
      votes: [...votes, vote('me', 200, 0)],
      members: four,
      me: 'me',
      maxNear: 1,
      onlyMine: true,
    }).near
    expect(after).toEqual(mine)
  })

  test('в комнате на одного почти-совпадений не бывает', () => {
    const solo: MemberRef[] = [{ steamid: 'me', name: 'Ты' }]
    const votes = [vote('me', 570, 1)]
    expect(buildLikes({ votes, members: solo, me: 'me' }).near).toEqual([])
  })
})

/**
 * Строка «почти совпали» не выбирает род за чужого человека.
 *
 * В комнате произвольный ник из Steam, и «Аня сошёлся на трёх играх» —
 * ошибка рядом с именем, а не стилистика. Тот же довод уже записан в
 * RoomWaiting, где имя намеренно не подставляется в «ждём». Согласовываться
 * глагол может только с тем, что мы знаем, — с числом игр.
 */
describe('почти совпали: род и число', () => {
  const line = (games: number) =>
    `${plural(games, 'совпала', 'совпало', 'совпало')} ${games} ${plural(games, 'игра', 'игры', 'игр')}`

  test('глагол согласован с числом, а не с человеком', () => {
    expect(line(1)).toBe('совпала 1 игра')
    expect(line(2)).toBe('совпало 2 игры')
    expect(line(4)).toBe('совпало 4 игры')
    expect(line(5)).toBe('совпало 5 игр')
    expect(line(11)).toBe('совпало 11 игр')
    expect(line(21)).toBe('совпала 21 игра')
  })

  /** Мужского рода в строке не остаётся ни при каком числе. */
  test('в разметке нет глагола, выбирающего род за игрока', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'room', 'LikesStrips.tsx'),
      'utf8',
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const bad of ['сошёлся', 'сошлись', 'выбрала']) {
      expect(code, `«${bad}» выбирает род за человека с чужим ником`).not.toContain(bad)
    }
  })
})

/**
 * Род того, кто смотрит на экран, нам неизвестен так же, как род ника.
 *
 * Правило записано в самой комнате: «Колода пройдена», а не «ты всё
 * отсвайпал» (RoomWaiting), «В комнате только ты», а не «ты тут один»
 * (AloneInvite), «всё» и «свайпает» вместо «готов» и «закончил» (MemberRoster).
 * А приглашение, пришедшее позже, снова говорило «Здесь ты зашёл по ссылке»
 * и «свайпай, во что готов играть», рельс своих «играем» — «Ты выбрал 5 игр»:
 * девушка, открывшая пати, читала о себе в мужском роде. Сторож — по
 * формам, которыми это возвращается: прошедшее время сразу за «ты» и
 * краткое «готов/один/сам» о том, кто смотрит.
 */
describe('пати: слова о том, кто смотрит, — без рода', () => {
  const ROOM_FILES = [
    path.join('app', 'room', '[id]', 'page.tsx'),
    ...fs
      .readdirSync(path.join(__dirname, '..', 'components', 'room'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => path.join('components', 'room', f)),
  ]
  /** Код без комментариев: докблоки цитируют именно запретные формы */
  const code = (rel: string) =>
    fs
      .readFileSync(path.join(__dirname, '..', rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const GENDERED = [
    // «ты зашёл», «Ты выбрал», «ты всё отсвайпал», «ты вошёл»
    /(?<![а-яё])[Тт]ы\s+(?:всё\s+|уже\s+|сам\s+)?[а-яё]+(?:л|лся|ёл)(?![а-яё])/,
    // «во что готов играть», «ты тут один», «сам выбирай» — краткие формы мужского рода
    /(?<![а-яё])(?:готов|один|сам|уверен|рад|должен)(?![а-яё])/,
  ]

  test('скан видит файлы комнаты', () => {
    expect(ROOM_FILES.length).toBeGreaterThan(10)
    expect(ROOM_FILES).toContain(path.join('components', 'room', 'LikesStrips.tsx'))
  })

  test('ни прошедшего времени после «ты», ни «готов» в тексте комнаты', () => {
    const offenders = ROOM_FILES.flatMap((rel) => {
      const src = code(rel)
      return GENDERED.flatMap((re) => {
        const m = re.exec(src)
        return m ? [`${rel}: «${m[0]}»`] : []
      })
    })
    expect(offenders, 'род того, кто смотрит на экран, нам неизвестен — переформулируй без него').toEqual([])
  })

  // Сторож выше слеп ровно настолько, насколько слеп его разбор
  test('разбор ловит прежние формы и не трогает правильные', () => {
    const hit = (s: string) => GENDERED.some((re) => re.test(s))
    for (const bad of ['Здесь ты зашёл по ссылке', 'во что готов играть', 'Ты выбрал 5 игр', 'ты всё отсвайпал']) {
      expect(hit(bad), bad).toBe(true)
    }
    for (const ok of ['Здесь вход по ссылке', 'во что не против сыграть', 'Твой выбор — 5 игр', 'Все отсвайпали', 'готовы', 'одинаково']) {
      expect(hit(ok), ok).toBe(false)
    }
  })
})

/**
 * «Берём «X»? 3 из 4 за». Предлагается, только когда все отсвайпали: пока
 * кто-то свайпает, название — спойлер развязки. Наружу — только счёт.
 */
describe('pickLeader', () => {
  const FOUR: MemberRef[] = [...MEMBERS, { steamid: 'kat', name: 'Катя' }]

  /** Каждый участник проголосовал за всю колоду: за — из списка, остальное против */
  function allSwiped(members: MemberRef[], deck: number[], likes: Record<string, number[]>) {
    return members.flatMap((m) =>
      deck.map((appid) => vote(m.steamid, appid, likes[m.steamid]?.includes(appid) ? 1 : 0)),
    )
  }

  test('все отсвайпали, двое из трёх за — лидер со счётом', () => {
    const votes = allSwiped(MEMBERS, [570, 620], { me: [570], dima: [570] })
    expect(pickLeader({ votes, members: MEMBERS, deckSize: 2 })).toEqual({
      appid: 570,
      forCount: 2,
      memberCount: 3,
    })
  })

  test('кто-то ещё свайпает — лидера нет: для него это спойлер', () => {
    const votes = allSwiped(MEMBERS, [570, 620], { me: [570], dima: [570] }).filter(
      (v) => !(v.steamid === 'sasha' && v.appid === 620),
    )
    expect(pickLeader({ votes, members: MEMBERS, deckSize: 2 })).toBeNull()
  })

  test('колоды не было или её ещё не раздавали — лидера нет', () => {
    const votes = allSwiped(MEMBERS, [570], { me: [570], dima: [570] })
    expect(pickLeader({ votes, members: MEMBERS, deckSize: 0 })).toBeNull()
    expect(pickLeader({ votes, members: MEMBERS, deckSize: null })).toBeNull()
  })

  test('половина — достаточно, меньше половины — нет', () => {
    const half = allSwiped(FOUR, [570], { me: [570], dima: [570] })
    expect(pickLeader({ votes: half, members: FOUR, deckSize: 1 })).toMatchObject({
      appid: 570,
      forCount: 2,
      memberCount: 4,
    })
    const five: MemberRef[] = [...FOUR, { steamid: 'lev', name: 'Лев' }]
    const minority = allSwiped(five, [570], { me: [570], dima: [570] })
    expect(pickLeader({ votes: minority, members: five, deckSize: 1 })).toBeNull()
  })

  test('в комнате на двоих «один из двух» — ничья, а не лидер', () => {
    // и точное раскрытие: второй знает свой голос и по счёту узнал бы чужой
    const pair = MEMBERS.slice(0, 2)
    const votes = allSwiped(pair, [570], { me: [570] })
    expect(pickLeader({ votes, members: pair, deckSize: 1 })).toBeNull()
  })

  test('один за — не лидер даже в комнате на двоих', () => {
    const pair = MEMBERS.slice(0, 2)
    expect(pickLeader({ votes: [vote('me', 570, 1)], members: pair, deckSize: 1 })).toBeNull()
  })

  test('в комнате на одного лидера не бывает', () => {
    const solo = MEMBERS.slice(0, 1)
    expect(pickLeader({ votes: [vote('me', 570, 1)], members: solo, deckSize: 1 })).toBeNull()
  })

  test('больше «за» побеждает', () => {
    const votes = allSwiped(FOUR, [570, 620], {
      me: [570, 620],
      dima: [570, 620],
      sasha: [620],
    })
    expect(pickLeader({ votes, members: FOUR, deckSize: 2 })?.appid).toBe(620)
  })

  test('при равном «за» — меньше «против»: голос мог остаться с прошлой колоды', () => {
    const votes = [
      ...allSwiped(FOUR, [570], { me: [570], dima: [570] }),
      // 620 Катя не видела — её голоса по ней нет вовсе
      vote('me', 620, 1),
      vote('dima', 620, 1),
      vote('sasha', 620, 0),
      vote('kat', 999, 0),
    ]
    expect(pickLeader({ votes, members: FOUR, deckSize: 2 })?.appid).toBe(620)
  })

  test('при полном равенстве — та, что добрала счёт раньше, потом меньший appid', () => {
    const early = [
      vote('me', 620, 1, 10),
      vote('dima', 620, 1, 20),
      vote('sasha', 620, 0, 30),
      vote('me', 570, 1, 40),
      vote('dima', 570, 1, 50),
      vote('sasha', 570, 0, 60),
    ]
    expect(pickLeader({ votes: early, members: MEMBERS, deckSize: 2 })?.appid).toBe(620)
    const sameSecond = early.map((v) => ({ ...v, createdAt: 0 }))
    expect(pickLeader({ votes: sameSecond, members: MEMBERS, deckSize: 2 })?.appid).toBe(570)
  })

  test('голоса вышедших не считаются ни в «за», ни в «все отсвайпали»', () => {
    const votes = [
      ...allSwiped(MEMBERS, [570, 620], { me: [570] }),
      // ушедший был за 570 — без него за только один
      vote('gone', 570, 1),
    ]
    expect(pickLeader({ votes, members: MEMBERS, deckSize: 2 })).toBeNull()
  })

  test('НИ ИМЁН, НИ steamid — только игра и счёт', () => {
    const real: MemberRef[] = [
      { steamid: '76561197960287930', name: 'Аня' },
      { steamid: '76561197960287931', name: 'Боря' },
      { steamid: '76561197960287932', name: 'Вика' },
    ]
    const votes = allSwiped(real, [570, 620], {
      '76561197960287930': [570],
      '76561197960287931': [570],
    })
    const leader = pickLeader({ votes, members: real, deckSize: 2 })
    expect(leader).not.toBeNull()
    expect(Object.keys(leader ?? {}).sort()).toEqual(['appid', 'forCount', 'memberCount'])
    const json = JSON.stringify(leader)
    expect(json).not.toMatch(/\d{17}/)
    for (const m of real) expect(json).not.toContain(m.name)
  })
})
