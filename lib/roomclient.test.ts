import fs from 'node:fs'
import path from 'node:path'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { CeremonyBoundary, CeremonyFallback } from '../components/room/CeremonyBoundary'
import { NearMissList } from '../components/room/LikesStrips'

/**
 * Сторож клиента комнаты пати.
 *
 * Страница комнаты — один большой клиентский компонент на рефах, эффектах и
 * опросе, и её ошибки жили в порядке строк: где пишется ключ колоды, до или
 * после запроса берётся номер снимка, кто чистит набор отсвайпанного. Решения,
 * которые вынимаются в чистые функции, проверены там (lib/deckvote,
 * lib/roompoll). Здесь — то, что вынуть нельзя: место вызова. Разметка и
 * порядок читаются как текст, как в lib/roompoll.test.ts и
 * lib/focushandoff.test.ts, — без браузера порядок эффектов не увидеть, а
 * возвращается поломка одной перестановкой строк.
 */

const ROOT = path.join(__dirname, '..')

/** Комментарии гасятся пробелами: докблоки цитируют сами правила */
const strip = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre: string, c: string) => pre + ' '.repeat(c.length))

const read = (rel: string) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

/** Тело функции от её начала до парной фигурной скобки — строки пропускаются */
function body(code: string, start: string): string {
  const at = code.indexOf(start)
  expect(at, `«${start}» не найдено — сторож ослеп`).toBeGreaterThan(-1)
  expect(code.indexOf(start, at + 1), `«${start}» встречается не раз`).toBe(-1)
  let depth = 0
  let q: string | null = null
  for (let j = code.indexOf('{', at + start.length - 1); j < code.length; j++) {
    const c = code[j]
    if (q) {
      if (c === q && code.charCodeAt(j - 1) !== 92) q = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return code.slice(at, j + 1)
  }
  throw new Error(`${start}: нет парной скобки`)
}

const room = read('app/[lang]/room/[id]/page.tsx')

/**
 * Хост убирает участника вместе со ВСЕМИ его голосами (removeRoomMember), а
 * страница помнила каждую отсвайпанную карту и после повторного входа
 * колоду не перечитывала: ключ «состав:раунд» возвращался к прежнему. Карты
 * со стёртыми голосами отсеивались из каждого /deck — комната вставала
 * навсегда, до перезагрузки у удалённого. Вернуться можно и из второй
 * вкладки — тогда своя кнопка входа в этой не нажимается вовсе.
 */
describe('повторный вход после удаления — колода с нуля', () => {
  test('сброс забывает всё, что колода помнит', () => {
    const reset = body(room, 'const resetDeck = useCallback(')
    for (const step of [
      'votedLocally.current.clear()',
      "deckKey.current = ''",
      "healKey.current = ''",
      'setCards(null)',
      'setLocalVotes(0)',
      'setDeckFailed(false)',
    ]) {
      expect(reset, step).toContain(step)
    }
  })

  test('обе двери входа сбрасывают колоду после успеха и до перечитывания', () => {
    for (const start of ['async function join()', 'async function joinAsDemoFriend()']) {
      const fn = body(room, start)
      const ok = fn.lastIndexOf('if (!res.ok)')
      const reset = fn.indexOf('resetDeck()')
      const refresh = fn.lastIndexOf('void refresh()')
      expect(reset, `${start}: колода не сбрасывается — карты со стёртыми голосами не вернутся`).toBeGreaterThan(ok)
      expect(reset, `${start}: сброс после перечитывания разъедется с новым ключом`).toBeLessThan(refresh)
    }
  })

  test('снимок, где членство прервалось, сбрасывает колоду — вход из другой вкладки её не застанет', () => {
    const refresh = body(room, 'const refresh = useCallback(')
    const keep = refresh.indexOf("fate === 'keep') return")
    const lapse = refresh.indexOf('membershipLapsed(')
    const reset = refresh.indexOf('resetDeck()')
    expect(lapse, 'удаление видит только своя кнопка входа — вход из второй вкладки оставит колоду стухшей').toBeGreaterThan(keep)
    expect(reset).toBeGreaterThan(lapse)
    expect(reset, 'сброс после setState — первый рендер участника увидит старый ключ').toBeLessThan(
      refresh.indexOf('setState(next)'),
    )
    // сброс — зависимость refresh, а тот — опроса: новый сброс на каждом
    // рендере перезапускал бы опрос
    const after = (start: string) => room.slice(room.indexOf(start) + body(room, start).length)
    expect(after('const resetDeck = useCallback(')).toMatch(/^, \[\]\)/)
    expect(after('const refresh = useCallback(')).toMatch(/^,\s*\[roomId, resetDeck\],\s*\)/)
  })
})

/**
 * Защита от наложения была только у опроса. refresh мимо него (вход, голос,
 * «Ещё 20 игр», ✕, доска) ставил ответ, пришедший последним, — и «open»,
 * прочитанный до матча, возвращал комнату в ожидание при остановленном опросе.
 */
describe('снимки комнаты встают по порядку чтения', () => {
  const refresh = body(room, 'const refresh = useCallback(')

  test('номер запроса берётся до fetch', () => {
    expect(refresh.indexOf('++reqSeq.current')).toBeGreaterThan(-1)
    expect(refresh.indexOf('++reqSeq.current')).toBeLessThan(refresh.indexOf('await fetch('))
  })

  test('решает snapshotFate, и отброшенный снимок на экран не встаёт', () => {
    const fate = refresh.indexOf('snapshotFate(')
    const keep = refresh.indexOf("fate === 'keep') return")
    expect(fate, 'порядок снимков никто не проверяет').toBeGreaterThan(-1)
    expect(keep).toBeGreaterThan(fate)
    expect(keep, 'отброшенный снимок всё равно попал в setState').toBeLessThan(refresh.indexOf('setState(next)'))
  })
})

/**
 * Запрос колоды в полёте глотал заход за ДРУГИМ ключом, а эффект ключ всё
 * равно двигал: друг, вошедший в те 2 секунды, пока строился /deck, в колоду
 * не попадал вовсе.
 */
describe('ключ колоды не теряется за запросом в полёте', () => {
  const effect = room.slice(room.indexOf('useEffect(() => {\n    if (!deckWant'))

  test('эффект колоды ключ в полёте не трогает и просыпается к концу запроса', () => {
    expect(effect.slice(0, effect.indexOf('deckKey.current = deckWant'))).toContain('deckInFlight.current) return')
    const deps = effect.match(/\}, \[([^\]]*)\]\)/)
    expect(deps?.[1] ?? '', 'конец запроса не будит эффект — отставший ключ останется').toMatch(/\bdeckLoads\b/)
  })

  test('конец любого запроса колоды — в finally', () => {
    const load = body(room, 'const loadDeck = useCallback(')
    const fin = load.slice(load.lastIndexOf('finally'))
    expect(fin).toContain('deckInFlight.current = false')
    expect(fin).toContain('setDeckLoads(')
  })

  test('«Ещё 20 игр» пишет ключ только своего запроса — иначе двойной GET /deck', () => {
    const pull = body(room, 'async function pullMore()')
    expect(pull).toMatch(/if \(got\.ok && !deckInFlight\.current\) deckKey\.current = deckKeyOf\(got\.state\)\s*await loadDeck\(\)/)
    // одна формула ключа на эффект и на добор
    expect(room).toMatch(/const deckWant = deckKeyOf\(state\)/)
  })
})

/**
 * Самолечение срабатывало на каждом штатном конце колоды: последний голос в
 * пути, done в снимке ещё false. Теперь оно ждёт снимок, запрошенный после
 * ответа на последний голос (pollCaughtUp — в lib/deckvote, под тестом).
 */
describe('самолечение ждёт, пока опрос догонит свои голоса', () => {
  test('признак застрявшей колоды — только при caughtUp', () => {
    expect(room).toMatch(/const stuck =\s*caughtUp &&\s*deckStuck\(/)
  })

  test('голос считается в пути с первой строки и отпускается в finally', () => {
    const vote = body(room, 'async function vote(')
    const claim = vote.indexOf('claimVote(')
    const up = vote.indexOf('votesInFlight.current += 1')
    expect(up).toBeGreaterThan(claim)
    expect(up, 'счёт голоса в пути — до запроса').toBeLessThan(vote.indexOf('await fetch('))
    const fin = vote.slice(vote.indexOf('finally'))
    expect(fin).toContain('votesInFlight.current -= 1')
    expect(fin).toContain('votesSettledAt.current = Date.now()')
  })

  test('снимок помнит, когда его запросили, а не когда он пришёл', () => {
    const refresh = body(room, 'const refresh = useCallback(')
    expect(refresh.indexOf('const askedAt = Date.now()')).toBeLessThan(refresh.indexOf('await fetch('))
    expect(refresh).toMatch(/setCaughtUp\(\s*pollCaughtUp\(/)
  })
})

/**
 * Жест голосует решением deckSwipeVote: сторона по смещению при скорости
 * против него записывала отмену как голос.
 */
describe('голос жестом — решение под тестом', () => {
  test('onDragEnd отдаёт решение deckSwipeVote', () => {
    const deck = read('components/SwipeDeck.tsx')
    expect(deck).toMatch(/onDragEnd=\{\(_, info\) => \{\s*const yes = deckSwipeVote\(info\.offset\.x, info\.velocity\.x\)/)
    expect(deck, 'сторона снова берётся по смещению мимо решения').not.toMatch(/send\(info\.offset\.x > 0/)
  })
})

/**
 * Церемония приезжает отдельным куском в минуту матча. Не пришёл — React.lazy
 * без своей границы уводил комнату в app/error.tsx, где повтор не помогает.
 */
describe('матч переживает не пришедший кусок церемонии', () => {
  const game = { appid: 620, name: 'Portal 2', store: null, storeUrl: null }

  test('церемония на странице — внутри своей границы', () => {
    expect(room).toMatch(
      /function MatchCeremony\([^)]*\) \{\s*return \(\s*<CeremonyBoundary[^>]*>\s*<LazyCeremony \{\.\.\.props\} \/>/,
    )
  })

  test('кусок прогревается, пока комната открыта, и его отказ не роняет страницу', () => {
    expect(room).toMatch(/const warmCeremony = state\?\.isMember === true && state\.room\.status === 'open'/)
    expect(room).toMatch(/loadCeremony\(\)\.catch\(/)
    // прогрев и next/dynamic тянут один и тот же кусок
    expect(room).toMatch(/dynamic\(\(\) => loadCeremony\(\)\.then/)
  })

  test('отказ куска — запасной экран матча, а не поломка', () => {
    expect(CeremonyBoundary.getDerivedStateFromError()).toEqual({ failed: true })
    const boundary = new CeremonyBoundary({ game, memberCount: 2, takeFocus: false, children: 'церемония' })
    expect(boundary.render(), 'без отказа граница — прозрачна').toBe('церемония')
    boundary.state = { failed: true }
    const shown = boundary.render() as ReactElement
    expect(shown.type).toBe(CeremonyFallback)
  })

  test('запасной экран: что выбрали, где взять и честный повтор', () => {
    const html = renderToStaticMarkup(createElement(CeremonyFallback, { game, memberCount: 2, takeFocus: false }))
    expect(html).toMatch(/<h1 tabindex="-1"[^>]*>Это матч: «Portal 2»<\/h1>/)
    expect(html).toContain('href="https://store.steampowered.com/app/620/"')
    expect(html).toContain('Обновить страницу')
    const epic = renderToStaticMarkup(
      createElement(CeremonyFallback, {
        game: { ...game, store: 'epic', storeUrl: 'https://store.epicgames.com/x' },
        memberCount: 2,
        takeFocus: false,
      }),
    )
    expect(epic).toContain('href="https://store.epicgames.com/x"')
    expect(epic).toContain('Открыть в Epic Games')
  })

  test('матч, взятый лидером, и на запасном экране — «Договорились», а не «Это матч»', () => {
    // «все хотят одного и того же» здесь неправда — церемония её не говорит, и запасной экран тоже
    const html = renderToStaticMarkup(
      createElement(CeremonyFallback, { game: { ...game, forCount: 3 }, memberCount: 4, takeFocus: false }),
    )
    expect(html).toMatch(/<h1 tabindex="-1"[^>]*>Договорились: «Portal 2»<\/h1>/)
    expect(html).toContain('3 из 4 за')
    expect(html).not.toContain('Это матч')
    // все за — обычный матч
    const all = renderToStaticMarkup(
      createElement(CeremonyFallback, { game: { ...game, forCount: 4 }, memberCount: 4, takeFocus: false }),
    )
    expect(all).toContain('Это матч: «Portal 2»')
  })

  test('граница знает счёт голосов, а заголовок не отнимает фокус на каждом рендере', () => {
    expect(room).toMatch(/<CeremonyBoundary[^>]*memberCount=\{props\.memberCount\}/)
    const boundary = read('components/room/CeremonyBoundary.tsx')
    // колбэк в разметке новый на каждом рендере — React зовёт его снова, и
    // возврат на вкладку снова тянул бы фокус из body в заголовок
    expect(boundary).toMatch(
      /const head = useCallback\(\s*\(el: HTMLHeadingElement \| null\) => \{\s*if \(el && takeFocus && focusAdrift\(document\)\) el\.focus\(\)\s*\},\s*\[takeFocus\],?\s*\)/,
    )
    expect(boundary).toMatch(/<h1 ref=\{head\} tabIndex=\{-1\}/)
    // одно правило «за не все» на церемонию и запасной экран
    expect(boundary).toMatch(/matchByLeader\(forCount, memberCount\)/)
    expect(read('components/MatchCeremony.tsx')).toMatch(/const byLeader = matchByLeader\(forCount, memberCount\)/)
  })
})

/**
 * Имена в «Вы почти совпали» не уникальны: каждый демо-друг — «Демо-друг».
 * Ключ из имён склеивал разные расклады в один, и React на опросе ронял или
 * дублировал строки.
 */
describe('строки «Вы почти совпали» различаются и при одинаковых именах', () => {
  const keysOf = (node: ReactNode): string[] => {
    if (Array.isArray(node)) return node.flatMap(keysOf)
    if (!isValidElement(node)) return []
    const el = node as ReactElement<{ children?: ReactNode }>
    if (el.type === 'li') return [String(el.key)]
    return keysOf(el.props.children)
  }

  test('два расклада с одинаковыми именами — два разных ключа', () => {
    const near = [
      { forNames: ['Аня', 'Демо-друг'], pendingNames: ['Демо-друг'], meFor: true, mePending: false, games: 2 },
      { forNames: ['Аня', 'Демо-друг'], pendingNames: ['Демо-друг'], meFor: true, mePending: false, games: 1 },
    ]
    const keys = keysOf(NearMissList({ near }))
    expect(keys.length).toBe(2)
    expect(new Set(keys).size, `ключи совпали: ${keys.join(' / ')}`).toBe(2)
  })
})

/**
 * Створки кода прерывались на полпути — и кадр «QM    » оставался на экране,
 * пока строка доски жива: сброса к коду не было.
 */
describe('код комнаты не застревает на кадре створок', () => {
  const flap = read('components/FlapCode.tsx')

  test('без анимации на экране сам код, а не последний кадр', () => {
    expect(flap).toMatch(/const display = animate \? shown : code/)
    expect(flap).toMatch(/\{display\[i\] \?\? /)
    expect(flap, 'створки снова рисуют shown напрямую').not.toMatch(/\{shown\[i\]/)
  })
})

/**
 * «На доске» у гостя значило «твой ник виден на /rooms» — но только в title,
 * которого тач-браузеры не показывают. Факт обязан быть текстом.
 */
describe('гость видит, что его ник на доске', () => {
  test('индикатор гостя говорит о нём самом текстом, а не подсказкой', () => {
    const at = room.indexOf(') : state.room.isPublic ? (')
    expect(at, 'ветка гостя не найдена — сторож ослеп').toBeGreaterThan(-1)
    const badge = room.slice(at, room.indexOf(') : null}', at))
    expect(badge).toContain('Ты на доске')
    expect(badge).toContain('твой ник виден')
    expect(badge, 'смысл снова живёт в title — на телефоне его не видно').not.toMatch(/\stitle=/)
  })
})

/**
 * Выход, ✕ хоста и доска держат флаг «в пути», который гасит повтор, — а
 * запросы под ним не имели срока. Телефон сменил Wi-Fi на LTE, запрос повис,
 * и кнопки оставались aria-disabled пустышками без строки отказа.
 */
describe('кнопки комнаты не висят на повисшем запросе', () => {
  const remove = body(room, 'async function removeMember(')
  const toggle = body(room, 'async function togglePublic()')

  test('у POST выхода, ✕ и доски — потолок', () => {
    for (const [name, fn] of [
      ['removeMember', remove],
      ['togglePublic', toggle],
    ] as const) {
      const at = fn.indexOf('await fetch(')
      expect(at, `${name}: запрос не найден — сторож ослеп`).toBeGreaterThan(-1)
      // опции запроса — до первой строки после него: тело само содержит «{})»
      const post = fn.slice(at, fn.indexOf('\n      if (', at))
      expect(post, `${name}: повисший POST держит флаг «в пути» до сдачи браузера`).toMatch(
        /signal: cappedSignal\(POLL_TIMEOUT_MS\),\s*\}\)$/,
      )
    }
  })

  test('✕ отпускает флаг сразу после POST — перечитывание никто не ждёт', () => {
    expect(remove, 'await refresh держал «Выйти из пати» и все ✕ на втором, не ограниченном запросе').not.toMatch(
      /await refresh\(/,
    )
    // Убрал другого — строка «Пустить обратно» и перечитывание, которого не ждут
    expect(remove).toMatch(/if \(memberId\) \{[\s\S]*?void refresh\(\)\.catch\(/)
  })

  test('доска ждёт свой снимок, но тоже с потолком', () => {
    expect(toggle).toMatch(/await refresh\(cappedSignal\(POLL_TIMEOUT_MS\)\)\.catch\(/)
  })

  test('«Пустить обратно» — тоже с потолком', () => {
    // Пришла слиянием из другой ветки без него: фаза 'busy' держит undoLocked,
    // и кроме ответа её не гасит ничто — «Пускаю…» висел aria-disabled без
    // строки отказа. Свой срез: запрос кончается «.catch(», а не «if (»
    const undo = body(room, 'async function unkick()')
    expect(undo, 'повисший POST держит «Пускаю…» до сдачи браузера').toMatch(
      /await fetch\([\s\S]*?signal: cappedSignal\(POLL_TIMEOUT_MS\),\s*\}\)\.catch\(/,
    )
  })
})

/**
 * «Пустить обратно» жила только в RoomWaiting, а ✕ сам уводит экран
 * ожидания: состав меньше — ключ колоды (deckKeyOf) другой, /deck собирает
 * колоду на оставшихся, игр «есть у всех» без убранного больше — и новые
 * карты ставят SwipeDeck на место RoomWaiting. Отмена исчезала через пару
 * секунд после ✕ — в пати на двоих ровно тогда, когда промах стоил другу
 * получаса.
 */
describe('«Пустить обратно» переживает колоду, пришедшую после ✕', () => {
  test('пока RoomWaiting нет на экране, строку ставит сама страница — ровно в дополнение к нему', () => {
    // одно условие на обе развилки: строка не пропадает и не стоит дважды
    expect(room).toMatch(/const waitingShown = !deckFailed && cards !== null && !card\b/)
    expect(room).toMatch(/const aloneInvite = alone && waitingShown\b/)
    expect(room).toMatch(/\{!waitingShown && kickUndo && <div className="kick-undo[^"]*">\{kickUndo\}<\/div>\}/)
    // а ветка, в которой стоит RoomWaiting, — та же, что waitingShown
    expect(room).toMatch(/\{deckFailed \? \([\s\S]*?\) : cards === null \? \([\s\S]*?\) : card \? \(\s*<SwipeDeck[\s\S]*?\) : \(\s*<RoomWaiting/)
    const page = room.indexOf('{!waitingShown && kickUndo && <div')
    expect(page, 'строка страницы — над колодой, под составом').toBeLessThan(room.indexOf('{deckFailed ? ('))
    expect(page).toBeGreaterThan(room.indexOf('{card && ('))
  })

  test('фокус, упавший с экрана ожидания, встаёт на «Пустить обратно»', () => {
    expect(room).toMatch(/ref=\{undoRef\}/)
    expect(room).toMatch(/useEffect\(\(\) => \{\s*handOffUndo\(waitingShown\)\s*\}, \[waitingShown\]\)/)
    const handoff = body(room, 'const handOffUndo = useEffectEvent(')
    expect(handoff).toMatch(/if \(due && focusAdrift\(document\)\) undoRef\.current\?\.focus\(\)/)
    // единственный перенос на строку отмены — этот
    expect(room.match(/undoRef\.current\?\.focus\(\)/g)).toHaveLength(1)
  })

  test('…но только с колодой, которую принёс сам ✕, и не на выключенную «Пустили обратно»', () => {
    // Строка живёт весь заход, а экран ожидания сменяют и «Ещё 20 игр», и
    // раунд соседа: фокус с «Добираю…» переезжал на строку про ✕ — в 'done'
    // на мёртвую кнопку, в 'shown' на живую, и второй Enter снимал нарочный ✕
    const handoff = body(room, 'const handOffUndo = useEffectEvent(')
    // квитанция гаснет до первого return: любая смена экрана ожидания — её
    // единственный шанс, и пережившая пустую колоду не дождётся чужой
    const spent = handoff.indexOf('undoHandoff.current = null')
    expect(spent, 'квитанция одноразовая').toBeGreaterThan(-1)
    expect(spent).toBeLessThan(handoff.indexOf('return'))
    // решение — чистое правило: состав без убранного, тот же раунд, не 'done'
    expect(handoff).toMatch(
      /kickHandoffDue\(ticket, \{\s*members: state\.members\.length,\s*round: state\.room\.deckRound,\s*phase: kicked\?\.phase \?\? null,?\s*\}\)/,
    )
    // квитанцию выписывает только удавшийся ✕ — не добор раунда и не опрос
    expect(room.match(/undoHandoff\.current = \{/g)).toHaveLength(1)
    const kick = body(room, 'async function removeMember(')
    expect(kick).toMatch(
      /setKicked\(\{ id: memberId[^\n]*\n\s*if \(state\) undoHandoff\.current = \{ members: state\.members\.length, round: state\.room\.deckRound \}/,
    )
  })
})

/**
 * Высота карты на телефоне — бюджет от верха экрана (.room-page .deck-stack
 * в globals.css: 340 px на шапку и всё прочее), и что над колодой, обязано в
 * него влезать: лишний ряд над ней уводит кнопки голоса под нижнюю панель.
 * Состав переносился уже двумя обычными никами, а пати из трёх — всегда:
 * замер на 390×844 — кнопки 743–803 при верхе панели 794.
 */
describe('над колодой на телефоне — не больше, чем заложено в высоту карты', () => {
  test('состав — один ряд с прокруткой вбок, перенос — только от md', () => {
    const at = room.indexOf('{card && (')
    const roster = room.slice(at, room.indexOf('</div>', at))
    const row = (roster.match(/<div className="([^"]+)">/)?.[1] ?? '').split(' ')
    expect(row).toContain('max-md:overflow-x-auto')
    expect(row, 'перенос на телефоне — второй ряд над картой').not.toContain('flex-wrap')
    expect(row).toContain('md:flex-wrap')
    // без них пилюля в ряду без переноса сжимается и ломает свой текст
    expect(roster).toMatch(/className=\{`pill shrink-0 whitespace-nowrap /)
  })

  test('строка «Пустить обратно» над колодой отнимает у карты свою высоту', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/\.room-page \.deck-stack \{\s*--deck-h: clamp\(330px, 100svh - 340px, 560px\);/)
    // 28 = один ряд строки (16) и её отступ (gap-6 минус -mt-3, 12) — и с
    // формулы, и с пола: на 375×667 оба правила стоят на полу, и поправка в
    // одной формуле возвращала там 40 из 60, которые стоили три ряда
    expect(css).toMatch(/\.room-page:has\(\.kick-undo\) \.deck-stack \{\s*--deck-h: clamp\(302px, 100svh - 368px, 560px\);/)
  })

  test('…и эта высота — ровно один ряд: фраза обрезается, кнопка — нет', () => {
    // Переносом строка стоила от одного до трёх рядов (длинный ник из Steam,
    // «Не дошло — нажми ещё раз» не рвётся), а поправка у карты одна
    const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
    const at = css.indexOf('.room-page:has(.kick-undo) .deck-stack')
    const phone = css.lastIndexOf('@media (max-width: 767px)', at)
    expect(phone, 'правила строки — в том же телефонном блоке, что и поправка').toBeGreaterThan(-1)
    const block = css.slice(phone, css.indexOf('\n}\n', at))
    expect(block).toMatch(/\.kick-undo > p \{[^}]*display: flex;/)
    expect(block).toMatch(/\.kick-undo > p > span \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
    expect(block).toMatch(/\.kick-undo > p > button \{[^}]*flex-shrink: 0;/)
    // а разметка даёт правилам их детей: фраза — в своём span, кнопка за ним
    const at2 = room.indexOf('const kickUndo = kickShown ? (')
    const line = room.slice(at2, room.indexOf(') : null', at2))
    expect(line).toMatch(/<p className="[^"]*">\s*<span>\s*\{kickShown\.phase === 'done'[\s\S]*?<\/span>\{' '\}\s*<button\b/)
  })
})

/**
 * Строки отказа гасли только со следующей попыткой: звали нажать ✕ у
 * ушедшего, говорили «доска не переключилась» под переключённой доской.
 * Решение — roomMissText (lib/room, под тестом); здесь — что страница
 * хранит отказ вместе с его предметом и выводит строку через него.
 */
describe('отказ кнопки комнаты гаснет, когда перестал быть правдой', () => {
  test('отказ помнит, кого убирали и какой была доска', () => {
    const remove = body(room, 'async function removeMember(')
    expect(remove).toMatch(/setLeaveMiss\(\{ text: leaveFailure\(res\.status, !memberId\), deck, memberId \}\)/)
    const toggle = body(room, 'async function togglePublic()')
    expect(toggle).toMatch(/wasPublic: was/)
    expect(toggle).toMatch(/body: JSON\.stringify\(\{ public: !was \}\)/)
  })

  test('на экран обе строки идут через roomMissText', () => {
    expect(room).toMatch(/const publicMissText = roomMissText\(publicMiss, missNow\)/)
    expect(room).toMatch(/const leaveMissText = roomMissText\(leaveMiss, missNow\)/)
    expect(room).toMatch(/leaveMiss=\{leaveMissText\}/)
    expect(room).toMatch(/publicMiss=\{publicMissText\}/)
    // ключ экрана — тот же, что у колоды: новый раунд или гость гасят строку
    expect(room).toMatch(/const missNow = \{ deck: deckWant,/)
  })
})
