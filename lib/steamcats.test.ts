import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import { judgeLiveness, playMode } from './liveness'
import { isMultiplayerMeta } from './recommend'
import {
  COOP_IDS,
  isMultiplayerCategories,
  MULTIPLAYER_CATEGORY_IDS,
  MULTIPLAYER_CATEGORY_SQL,
  ONLINE_IDS,
  SINGLE_PLAYER,
} from './steamcats'
import type { GameMeta } from './types'

/** Все id, какие Steam вообще выдаёт в категориях, с запасом */
const ALL_IDS = Array.from({ length: 64 }, (_, i) => i)

const META: GameMeta = {
  appid: 1,
  name: 'Игра',
  tags: {},
  genres: [],
  categories: [],
}

describe('steamcats', () => {
  test('кооп и сетевая игра не пересекаются и вместе дают мультиплеер', () => {
    expect(COOP_IDS.filter((c) => ONLINE_IDS.includes(c))).toEqual([])
    expect([...MULTIPLAYER_CATEGORY_IDS].sort((a, b) => a - b)).toEqual(
      [...COOP_IDS, ...ONLINE_IDS].sort((a, b) => a - b),
    )
    expect(MULTIPLAYER_CATEGORY_IDS.has(SINGLE_PLAYER)).toBe(false)
  })

  test('SQL-список бэкфилла is_multiplayer отвечает так же, как функция', async () => {
    const db = createClient({ url: ':memory:' })
    for (const id of ALL_IDS) {
      const res = await db.execute({
        sql: `SELECT EXISTS (
                SELECT 1 FROM json_each(?) WHERE value IN (${MULTIPLAYER_CATEGORY_SQL})
              ) AS mp`,
        args: [JSON.stringify([SINGLE_PLAYER, id])],
      })
      expect(Number(res.rows[0].mp) === 1, String(id)).toBe(isMultiplayerCategories([id]))
    }
    db.close()
  })

  test('движок рекомендаций судит о компании по тем же категориям', () => {
    for (const id of ALL_IDS) {
      expect(isMultiplayerMeta({ ...META, categories: [id] }), String(id)).toBe(
        isMultiplayerCategories([id]),
      )
    }
  })

  test('режимы игры и фильтр компании разрезают тот же список', () => {
    for (const id of COOP_IDS) expect(playMode([id])).toBe('coop')
    for (const id of ONLINE_IDS) expect(playMode([id])).toBe('online')
    expect(playMode([SINGLE_PLAYER, ...ONLINE_IDS])).toBe('solo-capable')
    for (const id of ALL_IDS) {
      const party = judgeLiveness({ categories: [id], ccu: 10_000 }, 'party')
      expect(party.reason === 'solo-only', String(id)).toBe(!isMultiplayerCategories([id]))
    }
  })
})

/**
 * Сторож копий.
 *
 * Список жил шестью копиями (см. шапку lib/steamcats.ts). Здесь ловится самый
 * частый способ завести копию снова: выписать три id подряд из списка —
 * массивом, множеством или в SQL `IN (…)` — где-то кроме модуля-списка.
 * Тесты не проверяются: там категории выписаны нарочно, как данные игр.
 * По той же причине пропущены DATA — витрины с категориями конкретных игр:
 * `[1, 36, 49]` у Dota 2 совпадает с ONLINE_IDS, но это её режимы, а не
 * правило, и за списком ей следовать незачем.
 */
describe('сторож копий категорий Steam', () => {
  const ROOT = path.join(__dirname, '..')

  function sourceFiles(): [string, string][] {
    const out: [string, string][] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue
          walk(p)
        } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
          out.push([path.relative(ROOT, p).replace(/\\/g, '/'), fs.readFileSync(p, 'utf8')])
        }
      }
    }
    for (const dir of ['app', 'lib', 'components', 'scripts']) walk(path.join(ROOT, dir))
    return out
  }

  /** Три соседних id списка подряд, через запятую */
  const runs = (list: readonly number[]) =>
    list
      .slice(2)
      .map((c, i) => new RegExp(`\\b${list[i]}\\s*,\\s*${list[i + 1]}\\s*,\\s*${c}\\b`))

  /** Комментарии выкидываем: рассказ о списке — не копия списка */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')

  const HOME = 'lib/steamcats.ts'
  const DATA = new Set(['lib/demo.ts', 'lib/otherstores.ts'])
  const patterns = [
    ...runs([...MULTIPLAYER_CATEGORY_IDS].sort((a, b) => a - b)),
    ...runs(COOP_IDS),
    ...runs(ONLINE_IDS),
  ]

  test('сторож видит исходники и сам модуль-список', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(100)
    const home = files.find(([f]) => f === HOME)?.[1] ?? ''
    expect(patterns.some((re) => re.test(code(home)))).toBe(true)
    for (const f of DATA) expect(files.some(([name]) => name === f), f).toBe(true)
  })

  test('мультиплеерные категории выписаны только в lib/steamcats.ts', () => {
    const copies = sourceFiles()
      .filter(([f]) => f !== HOME && !DATA.has(f))
      .filter(([, src]) => patterns.some((re) => re.test(code(src))))
      .map(([f]) => f)
    expect(
      copies,
      'список категорий Steam выписан заново — бери MULTIPLAYER_CATEGORY_IDS, COOP_IDS, ' +
        'ONLINE_IDS и isMultiplayerCategories из lib/steamcats.ts',
    ).toEqual([])
  })
})
