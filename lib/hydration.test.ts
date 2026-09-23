import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож дат без часового пояса.
 *
 * toLocaleDateString, toLocaleTimeString и Intl.DateTimeFormat без timeZone
 * берут зону процесса. На сервере Vercel это UTC, в браузере — зона читателя,
 * и для всего, что случилось после 21:00 UTC, стороны печатают РАЗНЫЕ дни.
 * React на таком расхождении падает с #418 и перерисовывает документ целиком:
 * границы Suspense у этих страниц нет (см. lib/firstpaint.test.ts). Так было с
 * датами патчей на /game и /whatsnew. Починено в lib/freshness (dateLabel,
 * dayLabel), а здесь следят, чтобы новая подпись не прошла мимо.
 *
 * Смотрим весь код, который может попасть в разметку: app, components и lib,
 * серверный тоже. Страницы кэшируются, и зона процесса — договорённость
 * хостинга, а не кода: стоит кому-нибудь задать TZ, и подпись разъедется с
 * ключом суток (см. dayLabel).
 *
 * Number#toLocaleString сюда не относится — у числа зоны нет, поэтому
 * toLocaleString проверяется, только когда его явно зовут у new Date(…).
 */

const ROOT = path.join(__dirname, '..')

/** Исходник без комментариев: иначе сторож ловит объяснение, зачем его завели. */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const DATE_CALL = /\b(toLocaleDateString|toLocaleTimeString|toLocaleString)\s*\(|\bnew\s+Intl\.DateTimeFormat\s*\(/g

/** Хвост текста перед вызовом кончается на `new Date(…).` — значит, это дата. */
const DATE_RECEIVER = /new\s+Date\s*\((?:[^()]|\([^()]*\))*\)\s*\.\s*$/

/** Аргументы вызова от открывающей скобки до парной ей закрывающей. */
function argsFrom(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i)
  }
  return src.slice(open + 1)
}

/** Номера строк, где дата форматируется без timeZone. */
function zonelessDateCalls(src: string): number[] {
  const code = withoutComments(src)
  const out: number[] = []
  DATE_CALL.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = DATE_CALL.exec(code))) {
    if (m[1] === 'toLocaleString' && !DATE_RECEIVER.test(code.slice(Math.max(0, m.index - 120), m.index))) {
      continue
    }
    const open = m.index + m[0].length - 1
    if (!/\btimeZone\b/.test(argsFrom(code, open))) {
      out.push(code.slice(0, m.index).split('\n').length)
    }
  }
  return out
}

function sourceFiles(): [string, string][] {
  const out: [string, string][] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
        out.push([path.relative(ROOT, p).replace(/\\/g, '/'), fs.readFileSync(p, 'utf8')])
      }
    }
  }
  for (const dir of ['app', 'components', 'lib']) walk(path.join(ROOT, dir))
  return out
}

describe('даты в разметке', () => {
  test('сторож видит дату без зоны и пропускает дату с зоной', () => {
    // Сторож, который всегда зелёный, хуже отсутствия сторожа: сначала
    // убеждаемся, что он вообще умеет ловить
    expect(zonelessDateCalls(`d.toLocaleDateString('ru-RU', { day: 'numeric' })`)).toEqual([1])
    expect(zonelessDateCalls(`x\nd.toLocaleTimeString()`)).toEqual([2])
    expect(zonelessDateCalls(`new Intl.DateTimeFormat('ru-RU', { month: 'long' })`)).toEqual([1])
    expect(zonelessDateCalls(`new Date(at * 1000).toLocaleString('ru-RU')`)).toEqual([1])

    expect(
      zonelessDateCalls(`d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        ...(y ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
      })`),
    ).toEqual([])
    expect(zonelessDateCalls(`new Intl.DateTimeFormat('en-US', { timeZone: tz })`)).toEqual([])
    // у числа зоны нет
    expect(zonelessDateCalls(`n.toLocaleString('ru-RU')`)).toEqual([])
    // объяснение в комментарии — не вызов
    expect(zonelessDateCalls(`// toLocaleDateString без timeZone берёт зону процесса`)).toEqual([])
  })

  test('toLocaleDateString, toLocaleTimeString и Intl.DateTimeFormat — только с timeZone', () => {
    const offenders: string[] = []
    for (const [file, src] of sourceFiles()) {
      for (const line of zonelessDateCalls(src)) offenders.push(`${file}:${line}`)
    }
    expect(offenders).toEqual([])
  })
})
