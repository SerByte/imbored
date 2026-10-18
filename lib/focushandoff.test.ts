import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { focusAdrift } from './focushandoff'

/**
 * Сторож фокуса, из-под которого уходит экран.
 *
 * Для /play, квиза и экрана ожидания пати перенос фокуса был решён, а три
 * перехода с колоды остались без него. Последний голос в /explore уносил
 * колоду вместе с кнопкой в фокусе, и панель «Колода кончилась» — голый
 * абзац — не принимала его; «Ещё колоду» уходила вместе со своей панелью;
 * матч заменял комнату церемонией, и незрячий участник не узнавал, что матч
 * случился. Цель фокуса на экране ожидания была div с display: contents: без
 * бокса кольцо не рисуется, имени нет, а в части движков такой элемент фокус
 * не принимает вовсе.
 *
 * Правило проверяется в node (focusAdrift), разметка — чтением исходников:
 * перенос фокуса без браузера не увидеть, а возвращается поломка одной
 * правкой — атрибутом, ролью, лишним узлом над строкой.
 */

const ROOT = path.join(__dirname, '..')

/** Комментарии гасятся пробелами: докблоки цитируют сами правила. Номера строк остаются настоящими. */
const strip = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre: string, c: string) => pre + ' '.repeat(c.length))

const read = (rel: string) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

/** Открывающие теги с именем name — целиком, до `>` вне {} и строк (как в liveregion.test.ts) */
function tags(code: string, name: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(new RegExp(`<${name}(?=[\\s/>])`, 'g'))) {
    let depth = 0
    let q: string | null = null
    for (let j = m.index; j < code.length; j++) {
      const c = code[j]
      if (q) {
        if (c === q && code.charCodeAt(j - 1) !== 92) q = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') q = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) {
        out.push(code.slice(m.index, j + 1).replace(/\s+/g, ' '))
        break
      }
    }
  }
  return out
}

describe('focusAdrift: фокус забирается, только если его некому держать', () => {
  const body = { id: 'body' }
  const header = { id: 'шапка' }
  const button = { id: 'Ещё колоду' }
  const panel = { contains: (n: { id: string }) => n === button }

  test('фокус в body или нигде — туда его роняет браузер, когда узел уходит', () => {
    expect(focusAdrift({ activeElement: body, body })).toBe(true)
    expect(focusAdrift({ activeElement: null, body })).toBe(true)
  })

  test('человек стоит где-то сам — фокус остаётся при нём', () => {
    // матч приехал опросом, пока человек в шапке: о матче скажет живая строка
    expect(focusAdrift({ activeElement: header, body })).toBe(false)
    expect(focusAdrift({ activeElement: header, body }, panel)).toBe(false)
  })

  test('фокус ещё внутри того, что вот-вот уйдёт, — тоже потерян', () => {
    // выключенная на время запроса кнопка в части браузеров держит фокус до размонтирования
    expect(focusAdrift({ activeElement: button, body }, panel)).toBe(true)
    expect(focusAdrift({ activeElement: button, body }, null)).toBe(false)
  })
})

describe('цель программного фокуса', () => {
  /** Все tabIndex={-1} в app/ и components/: [файл, тег] */
  const targets: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx')) {
        const rel = path.relative(ROOT, p).split(path.sep).join('/')
        for (const t of tags(read(rel), '[A-Za-z][\\w.]*')) {
          if (/\stabIndex=\{-1\}/.test(t)) targets.push([rel, t])
        }
      }
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))

  test('скан видит цели фокуса продукта', () => {
    // без этого тест ниже зеленел бы и тогда, когда поиск сломался
    const files = new Set(targets.map(([f]) => f))
    for (const f of ['app/[lang]/explore/page.tsx', 'components/EchoTitle.tsx', 'components/room/RoomWaiting.tsx']) {
      expect(files, f).toContain(f)
    }
  })

  test('у цели есть бокс: не display: contents', () => {
    // утилита целиком, а не хвост чужого класса вроде smooth-contents
    const offenders = targets.filter(([, t]) => /className=["{`][^>]*(?<![\w-])contents(?![\w-])/.test(t))
    expect(
      offenders.map(([f, t]) => `${f} — ${t}`),
      'у display: contents нет бокса — кольцо не рисуется, имени нет, и не везде такой узел принимает фокус; ' +
        'цель — настоящий заголовок экрана',
    ).toEqual([])
  })
})

describe('/explore: колода уходит — фокус остаётся на странице', () => {
  const page = read('app/[lang]/explore/page.tsx')
  const deck = read('components/SwipeDeck.tsx')

  test('конец колоды — заголовок, который принимает фокус', () => {
    expect(page).toMatch(/<h2 ref=\{deckEndHead\} tabIndex=\{-1\}[^>]*>\s*Колода кончилась/)
  })

  test('голос с клавиатуры по последней карте отдаёт фокус этому заголовку', () => {
    // колода сообщает, чем голосовали; страница знает, что карта последняя.
    // Кнопки, жест и стрелки (deckKeyVote в lib/deckvote) голосуют через один
    // commitCard: стрелке нужна карта из колоды в момент нажатия, а не top
    // рендера, — поэтому сообщение странице живёт там, а commit его зовёт
    expect(deck).toMatch(/onVote\(card, yes, keyboard\)/)
    expect(deck).toMatch(/const commit = \(yes: boolean, keyboard: boolean\) => commitCard\(top, yes, keyboard\)/)
    expect(page).toMatch(/if \(keyboard && cards\.length === 1\) pendingFocus\.current = 'end'/)
    expect(page).toMatch(/target === 'end'\s*\?\s*deckEndHead\.current/)
  })

  test('новая колода забирает фокус из уходящей панели — если он там и остался', () => {
    // initialFocus читается при монтировании: первая карта ставит фокус, как после голоса
    expect(deck).toMatch(/useState<'yes' \| 'no' \| null>\(initialFocus\)/)
    expect(page).toMatch(/initialFocus=\{dealFocus \? 'yes' : null\}/)
    // решение — после ответа и до того, как колода встанет на место панели
    const redeal = page.slice(page.indexOf('const redeal = async (keyboard: boolean)'))
    const decide = redeal.indexOf('setDealFocus(keyboard && focusAdrift(document, deckEnd.current))')
    expect(decide, 'решение о фокусе новой колоды пропало').toBeGreaterThan(-1)
    expect(redeal.indexOf("await fetch('/api/explore'")).toBeLessThan(decide)
    expect(redeal.indexOf('await show(res')).toBeGreaterThan(decide)
    expect(page).toMatch(/<div ref=\{deckEnd\} className="panel-lift/)
  })

  /**
   * Экран отказа встаёт на место прогрева или уносит нажатую «Попробовать
   * снова» (повтор пришёл с другой причиной, у которой повтора нет), и фокус
   * оказывается в body. Тогда его забирает заголовок отказа — следующий Tab
   * ведёт к кнопке экрана, а не в начало шапки. Если человек стоит где-то
   * сам, фокус остаётся при нём: об отказе скажет строка статуса.
   */
  test('экран отказа: заголовок забирает потерянный фокус', () => {
    expect(page).toMatch(/<h1 ref=\{failHead\} tabIndex=\{-1\}[^>]*>\s*\{fail\.title\}/)
    expect(page).toMatch(/if \(focusAdrift\(document\)\) failHead\.current\?\.focus\(\)/)
  })

  test('удачный повтор отдаёт фокус новой колоде — как «Ещё колоду»', () => {
    const retry = page.slice(page.indexOf('const retry = async (keyboard: boolean)'))
    const decide = retry.indexOf('setDealFocus(keyboard && focusAdrift(document, failBox.current))')
    expect(decide, 'решение о фокусе после повтора пропало').toBeGreaterThan(-1)
    expect(retry.indexOf("await fetch('/api/explore'")).toBeLessThan(decide)
    expect(retry.indexOf('await show(res')).toBeGreaterThan(decide)
  })
})

describe('пати: матч и экран ожидания', () => {
  const room = read('app/[lang]/room/[id]/page.tsx')

  /**
   * Строка матча — одним узлом через подмену. React сверяет детей по месту:
   * строка переживает переход лобби → церемония, только если стоит первым
   * ребёнком фрагмента в обоих return. Поставь что-нибудь над ней в одном из
   * них — и область смонтируется заново вместе с текстом «Матч: …», а такую
   * скринридер объявляет не везде (components/StatusLine).
   */
  test('строка матча стоит первой в return лобби и церемонии', () => {
    expect(room).toMatch(/const matchStatus = \(\s*<StatusLine\s+text=\{matchLine\(/)
    // return, внутри которого стоит церемония, и return лобби
    for (const mark of ['<MatchCeremony', '<div className="room-page']) {
      const at = room.indexOf(mark)
      expect(at, `${mark} не найдено — сторож ослеп`).toBeGreaterThan(-1)
      expect(room.indexOf(mark, at + 1), `${mark} встречается не раз`).toBe(-1)
      const ret = room.lastIndexOf('return (', at)
      expect(room.slice(ret, at + mark.length), mark).toMatch(
        new RegExp(`^return \\(\\s*<>\\s*\\{matchStatus\\}\\s*${mark}$`),
      )
    }
  })

  test('о матче говорят только тому, на чьих глазах комната была открыта', () => {
    expect(room).toMatch(/if \(next\.room\.status === 'open'\) setSawOpen\(true\)/)
    expect(room).toMatch(/<MatchCeremony[^>]*takeFocus=\{sawOpen\}/)
  })

  test('церемония забирает фокус заголовком — только потерянный', () => {
    const ceremony = read('components/MatchCeremony.tsx')
    expect(ceremony).toMatch(/<EchoTitle[^>]*headRef=\{titleRef\}/)
    expect(ceremony).toMatch(/if \(el && takeFocus && focusAdrift\(document\)\) el\.focus\(\)/)
    // «Это матч!» — в обеих ветках EchoTitle: и с движением, и без
    const h1 = tags(read('components/EchoTitle.tsx'), 'h1')
    expect(h1.length).toBe(2)
    for (const t of h1) expect(t).toMatch(/ref=\{headRef\} tabIndex=\{-1\}/)
  })

  test('экран ожидания отдаёт фокус заголовку своего режима', () => {
    const waiting = read('components/room/RoomWaiting.tsx')
    // alone — в AloneInvite, others и empty — здесь
    expect(waiting).toMatch(/<AloneInvite[^>]*headRef=\{headRef\}/)
    const own = tags(waiting, 'h2')
    expect(own.length).toBe(2)
    for (const t of own) expect(t).toMatch(/ref=\{headRef\} tabIndex=\{-1\}/)
    const alone = tags(read('components/room/AloneInvite.tsx'), 'h2')
    expect(alone.length).toBe(1)
    expect(alone[0]).toMatch(/ref=\{headRef\} tabIndex=\{-1\}/)
  })
})

/**
 * Пати и её двери: шаги, на которых нажатая кнопка уходит вместе со своим
 * куском экрана. «Дальше» и «Ещё раунд» в викторине, ✕ хоста в ростере,
 * прерывание викторины опросом, экран отказа на месте спиннера в /room/new —
 * везде фокус падал в body, и клавиатура начинала со страницы сверху.
 */
describe('пати: нажатая кнопка уходит — фокус остаётся на экране', () => {
  test('викторина: шаг отдаёт фокус голове панели — вопросу, итогу или загрузке', () => {
    const trivia = read('components/room/PartyTrivia.tsx')
    const heads = tags(trivia, 'p').filter((t) => /ref=\{headRef\}/.test(t))
    // загрузка, отказ/пусто, вопрос и итог раунда — взаимоисключающие
    expect(heads.length).toBe(4)
    for (const t of heads) expect(t).toMatch(/tabIndex=\{-1\}/)
    expect(heads.some((t) => /id="trivia-q"/.test(t)), 'вопрос — не цель фокуса').toBe(true)
    // и «Дальше», и «Ещё раунд» просят фокус до смены вопроса
    expect(trivia).toMatch(/onClick=\{\(\) => \{\s*wantFocus\.current = true\s*setAt\(\(n\) => n \+ 1\)/)
    expect(trivia).toMatch(/onClick=\{\(\) => \{\s*wantFocus\.current = true\s*const next = round \+ 1/)
    expect(trivia).toMatch(/\}, \[at, questions\]\)/)
  })

  test('викторина: прерывание отдаёт фокус переключателю — только из панели или потерянный', () => {
    const trivia = read('components/room/PartyTrivia.tsx')
    expect(trivia).toMatch(/if \(interrupted && focusAdrift\(document, panelRef\.current\)\) toggleRef\.current\?\.focus\(\)/)
    expect(trivia).toMatch(/<m\.div\s+ref=\{panelRef\}\s+id="trivia-body"/)
  })

  test('ростер: ✕ отдаёт фокус соседней ✕ или заголовку «Кто где»', () => {
    const roster = read('components/room/MemberRoster.tsx')
    const h2 = tags(roster, 'h2')
    expect(h2.length).toBe(1)
    expect(h2[0]).toMatch(/ref=\{headRef\} tabIndex=\{-1\}/)
    // фокус берётся, только когда строки и правда не стало, и только потерянный:
    // в body или на ✕ уходящей строки. Дом — эта ✕, а не весь список: на ✕
    // соседа хост мог уйти сам, и Enter, нажатый ради неё, убрал бы другого
    expect(roster).toMatch(/if \(!focusAdrift\(document, removeButtons\.current\.get\(h\.gone\)\)\) return/)
    expect(roster, 'дом переноса — снова весь список').not.toMatch(/focusAdrift\(document, listRef/)
  })

  test('ростер: перенос ждёт, пока строка уйдёт, и забывается только на отказе этой ✕', () => {
    const roster = read('components/room/MemberRoster.tsx')
    // флаг «в пути» держится ровно на POST, а ростер без строки приносит
    // следующий снимок — перенос не может забываться по removing
    expect(roster).toMatch(/if \(missed === h\.gone\) handoff\.current = null/)
    expect(roster).toMatch(/\}, \[members, missed\]\)/)
    const rosters = tags(read('components/room/RoomWaiting.tsx'), 'MemberRoster')
    expect(rosters.some((t) => /\sisHost=\{isHost\}/.test(t) && /\smissed=\{missedMember\}/.test(t))).toBe(true)
    expect(read('app/[lang]/room/[id]/page.tsx')).toMatch(/missedMember=\{leaveMiss\?\.memberId \?\? null\}/)
  })

  /*
   * «Войти в комнату» и «Демо-друг (без Steam)»: удачный вход уносит экран
   * приглашения вместе с нажатой кнопкой, и на месте лобби с колодой фокус
   * лежал в body — следующий Tab начинал с «К содержанию», а скринридер не
   * слышал, что вход удался.
   */
  test('вход по приглашению отдаёт фокус заголовку лобби — после своего нажатия и только потерянный', () => {
    const room = read('app/[lang]/room/[id]/page.tsx')
    const h1 = tags(room, 'h1').filter((t) => /ref=\{lobbyHead\}/.test(t))
    expect(h1.length, 'заголовок «Пати …» — не цель фокуса').toBe(1)
    expect(h1[0]).toMatch(/ref=\{lobbyHead\} tabIndex=\{-1\}/)
    // Именно заголовок лобби: он стоит в return с колодой и называет экран
    const lobby = room.slice(room.indexOf('<div className="room-page'))
    expect(lobby.indexOf('<h1 ref={lobbyHead}'), 'цель ушла из лобби').toBeGreaterThan(-1)
    // Перенос — по смене членства, по отметке нажатия, и только потерянного фокуса
    expect(room).toMatch(
      /if \(notMember \|\| !joinHandoff\.current\) return\s*joinHandoff\.current = false\s*if \(focusAdrift\(document\)\) lobbyHead\.current\?\.focus\(\)\s*\}, \[notMember\]\)/,
    )
    // Отметку ставят обе двери — до запроса: опрос может принести членство
    // раньше ответа на вход, и экран уйдёт из-под кнопки ещё до него
    for (const door of ['async function join()', 'async function joinAsDemoFriend()']) {
      const at = room.indexOf(door)
      expect(at, `${door} не найдено — сторож ослеп`).toBeGreaterThan(-1)
      const fn = room.slice(at, room.indexOf('await fetch(', at))
      expect(fn, door).toMatch(/joinHandoff\.current = true/)
    }
  })

  test('экран ожидания: смена режима под фокусом отдаёт его новому заголовку', () => {
    const waiting = read('components/room/RoomWaiting.tsx')
    expect(waiting).toMatch(/if \(focusAdrift\(document\)\) headRef\.current\?\.focus\(\)\s*\}, \[mode\]\)/)
  })

  test('/room/new: экран отказа на месте спиннера забирает фокус заголовком', () => {
    const fresh = read('app/[lang]/room/new/page.tsx')
    const h1 = tags(fresh, 'h1')
    // выбор настроения — без переноса: это первый экран, фокус у открывшего не отнимаем
    expect(h1.filter((t) => /ref=\{focusFailure\} tabIndex=\{-1\}/.test(t)).length).toBe(2)
    expect(fresh).toMatch(/\(picked !== null \|\| started\.current\) && focusAdrift\(document\)\) el\.focus\(\)/)
    // строка попытки переживает подмену экранов: первая во всех return
    const returns = [...fresh.matchAll(/\breturn \(/g)]
    expect(returns.length).toBe(4)
    for (const r of returns) expect(fresh.slice(r.index), String(r.index)).toMatch(/^return \(\s*<>\s*\{status\}/)
  })
})

/*
 * «Выйти на всех устройствах» спрашивает подтверждение, и вопрос встаёт НА
 * МЕСТО нажатой кнопки: «Да, везде» и «Отмена» — новые узлы, а нажатая ушла
 * из DOM. Фокус падал в body в обе стороны — и на вопросе, и на «Отмене», —
 * клавиатура начинала со страницы сверху, а скринридер вопроса («Ссылка на
 * RSS тоже перестанет работать») не слышал вовсе. У FeedLink подтверждение —
 * та же кнопка, и вопроса там нет (докблок FeedLink).
 */
describe('выход «везде»: вопрос и «Отмена» не роняют фокус', () => {
  const src = read('components/SignOut.tsx')
  const buttons = tags(src, 'button')

  test('«Да, везде» и «Выйти на всех устройствах» — цели переноса', () => {
    expect(buttons.some((t) => /ref=\{yesRef\}/.test(t)), '«Да, везде» без ref').toBe(true)
    expect(buttons.some((t) => /ref=\{allRef\}/.test(t)), '«Выйти на всех устройствах» без ref').toBe(true)
  })

  /*
   * Перенос — после коммита, когда новый узел уже в DOM, и только по отметке
   * нажатия: без неё эффект на монтировании забрал бы фокус у страницы (там
   * он ещё в body — focusAdrift сказал бы «потерян»).
   */
  test('перенос — эффектом по confirmAll, по отметке нажатия и только потерянного фокуса', () => {
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*const to = handoff\.current\s*handoff\.current = null\s*if \(to && focusAdrift\(document, homeRef\.current\)\) \(to === 'yes' \? yesRef : allRef\)\.current\?\.focus\(\)\s*\}, \[confirmAll\]\)/,
    )
    expect(src).toMatch(/setConfirmAll\(true\)\s*handoff\.current = 'yes'/)
    expect(src).toMatch(/setConfirmAll\(false\)\s*handoff\.current = 'all'/)
  })

  /** Фокус встаёт на «Да, везде» — и вопрос звучит вместе с ним */
  test('вопрос — описание «Да, везде»', () => {
    const yes = buttons.find((t) => /ref=\{yesRef\}/.test(t)) ?? ''
    expect(yes).toMatch(/aria-describedby=\{askId\}/)
    expect(src).toMatch(/<span id=\{askId\}>/)
  })
})

/*
 * «Удалить всё обо мне» (components/ForgetMe) спрашивает тем же приёмом, что
 * «Выйти везде?»: нажатая кнопка уходит, вопрос со списком встаёт ниже, и
 * фокус без переноса падал бы в body. Отличие одно и намеренное: фокус встаёт
 * на «Отмену», а не на «Да». Выход повторяется входом, удаление — ничем, и
 * второй Enter, нажатый по привычке, обязан попасть в безопасную кнопку.
 */
describe('«Удалить всё обо мне»: фокус на безопасной кнопке', () => {
  const src = read('components/ForgetMe.tsx')
  const buttons = tags(src, 'button')

  test('перенос — эффектом по asked, по отметке нажатия и только потерянного фокуса', () => {
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*const to = handoff\.current\s*handoff\.current = null\s*if \(to && focusAdrift\(document, homeRef\.current\)\) \(to === 'cancel' \? cancelRef : openRef\)\.current\?\.focus\(\)\s*\}, \[asked\]\)/,
    )
    expect(src).toMatch(/handoff\.current = 'cancel'\s*setAsked\(\{/)
    expect(src).toMatch(/handoff\.current = 'open'[\s\S]*?setAsked\(null\)/)
  })

  test('вопрос со списком — описание «Отмены», а «Да» фокус не получает', () => {
    const cancel = buttons.find((t) => /ref=\{cancelRef\}/.test(t)) ?? ''
    expect(cancel, '«Отмена» без ref').not.toBe('')
    expect(cancel).toMatch(/aria-describedby=\{askId\}/)
    expect(src).toMatch(/<div id=\{askId\}/)
    const yes = buttons.find((t) => /void erase\(\)/.test(t)) ?? ''
    expect(yes, '«Да, удалить всё» не найдена').not.toBe('')
    expect(yes).not.toMatch(/\sref=/)
  })
})

/*
 * После «Удалить всё обо мне» (components/ForgetMe) единственное
 * подтверждение необратимого — строка «всё удалено» над заголовком главной
 * (components/landing/HeroNotice). Нажатая «Да, удалить всё» уходит вместе с
 * /library, фокус падает в body, а объявитель маршрутов Next читает только
 * заголовок вкладки: скринридер не слышал, что удаление прошло, и искать
 * ответ приходилось обходом героя. Строка забирает потерянный фокус —
 * только потерянный: стоящий в шапке остаётся там. Живой областью она не
 * становится — область, рождённая вместе с текстом, звучит не везде
 * (докблок StatusLine), а цель фокуса живой быть не может (liveregion.test).
 */
describe('«всё удалено»: строка забирает потерянный фокус', () => {
  const src = read('components/landing/HeroNotice.tsx')

  test('строка — цель фокуса, но не живая область', () => {
    const line = tags(src, 'p').find((t) => /ref=\{line\}/.test(t)) ?? ''
    expect(line, 'строка без ref').not.toBe('')
    expect(line).toMatch(/\stabIndex=\{-1\}/)
    expect(line).not.toMatch(/\srole=|\saria-live=/)
  })

  test('перенос — эффектом по forgot и только потерянного фокуса, без прокрутки', () => {
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*if \(forgot && focusAdrift\(document\)\) line\.current\?\.focus\(\{ preventScroll: true \}\)\s*\}, \[forgot\]\)/,
    )
    // хуки — до раннего return: иначе их порядок менялся бы вместе со строкой
    expect(src.indexOf('useEffect(')).toBeLessThan(src.indexOf('if (!promise) return null'))
  })
})
