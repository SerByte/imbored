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
    for (const f of ['app/explore/page.tsx', 'components/EchoTitle.tsx', 'components/room/RoomWaiting.tsx']) {
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
  const page = read('app/explore/page.tsx')
  const deck = read('components/SwipeDeck.tsx')

  test('конец колоды — заголовок, который принимает фокус', () => {
    expect(page).toMatch(/<h2 ref=\{deckEndHead\} tabIndex=\{-1\}[^>]*>\s*Колода кончилась/)
  })

  test('голос с клавиатуры по последней карте отдаёт фокус этому заголовку', () => {
    // колода сообщает, чем голосовали; страница знает, что карта последняя
    expect(deck).toMatch(/onVote\(top, yes, keyboard\)/)
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
})

describe('пати: матч и экран ожидания', () => {
  const room = read('app/room/[id]/page.tsx')

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
