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

const room = read('app/room/[id]/page.tsx')

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
    expect(remove).toMatch(/if \(memberId\) void refresh\(\)\.catch\(/)
  })

  test('доска ждёт свой снимок, но тоже с потолком', () => {
    expect(toggle).toMatch(/await refresh\(cappedSignal\(POLL_TIMEOUT_MS\)\)\.catch\(/)
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
