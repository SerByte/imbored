import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Строку сессии берут клиентские экраны — герой /play и колода пати, — поэтому
 * модуль обязан оставаться клиентобезопасным: ни базы, ни сервера, ни node:
 * даже через цепочку импортов. Поведение строки проверяет lib/gamepage.test.ts
 * (там её показывает карточка игры); здесь — только то, откуда она может брать.
 */

const LIB = __dirname

/** Модули, которые тянут за собой базу, сервер или сеть */
const SERVER_ONLY = /^(\.\/(db|server|gamepage|pagejob|reviews|catalog|llm)|node:|@libsql\/)/

/** Импорты с рантаймом (не `import type`) — рекурсивно по lib */
function runtimeClosure(file: string, seen = new Set<string>()): Set<string> {
  const src = fs.readFileSync(path.join(LIB, file), 'utf8')
  for (const m of src.matchAll(/^import (?!type )[^\n]*?from '([^']+)'/gm)) {
    const spec = m[1]
    if (seen.has(spec)) continue
    seen.add(spec)
    if (spec.startsWith('./') && !SERVER_ONLY.test(spec)) runtimeClosure(`${spec.slice(2)}.ts`, seen)
  }
  return seen
}

describe('клиентобезопасность', () => {
  test('lib/gametraits.ts не тянет ни базы, ни сервера — даже через цепочку', () => {
    const closure = [...runtimeClosure('gametraits.ts')]
    expect(closure.length).toBeGreaterThan(0)
    expect(closure.filter((spec) => SERVER_ONLY.test(spec))).toEqual([])
  })
})
