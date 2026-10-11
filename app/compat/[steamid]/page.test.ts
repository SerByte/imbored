import type { InStatement } from '@libsql/client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { saveLibrarySnapshot, upsertGamesMeta, upsertUser, type Db } from '@/lib/db'
import { hiddenLibrary, hiddenLibraryMetas } from '@/lib/testing/hiddenlibrary'
import { freshDb, params, signIn } from '@/lib/testing/route'
import CompatPage, { generateMetadata } from './page'

/**
 * Память cache() из react на один «запрос».
 *
 * Вне сервера Next cache() — сквозной вызов: памяти запроса у него нет, и
 * то, ради чего страница его зовёт, в тесте не видно вовсе. Подмена делает
 * то же, что настоящий cache в рендере: помнит промис по функции и по
 * аргументам — объекты по ссылке, остальное по значению, число аргументов
 * тоже различается. Сбрасывается перед каждым тестом: один тест — один запрос.
 */
const request = vi.hoisted(() => {
  const RESULT = Symbol('результат')
  type Node = Map<unknown, unknown>
  let memo = new Map<unknown, Node>()
  return {
    reset: () => {
      memo = new Map()
    },
    cache: <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R => {
        let node = memo.get(fn)
        if (!node) memo.set(fn, (node = new Map()))
        for (const arg of args) {
          let next = node.get(arg) as Node | undefined
          if (!next) node.set(arg, (next = new Map()))
          node = next
        }
        if (!node.has(RESULT)) node.set(RESULT, fn(...args))
        return node.get(RESULT) as R
      },
  }
})

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: request.cache,
}))
vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /compat/[steamid] — сколько раз запрос платит за владельца ссылки.
 *
 * Страница объявлена force-dynamic, и на каждый заход её метаданные и тело
 * собираются заново. Обоим нужен владелец ссылки: метаданным — для превью в
 * чате, телу — для приглашения или расчёта. Тело читало его снапшот, ник и
 * обложки ещё раз в обход памяти запроса, и гость по разосланной ссылке —
 * главный путь этой страницы — платил за games_json владельца дважды: у
 * большой библиотеки это блоб на сотни килобайт.
 */

const OWNER = '76561198000000041'
const VIEWER = '76561198000000042'
const NOW = 1_780_000_000

let db: Db

beforeEach(async () => {
  db = await freshDb()
  request.reset()
  await upsertGamesMeta(db, hiddenLibraryMetas(), NOW)
  await upsertUser(db, { steamid: OWNER, personaName: 'Владелец' }, NOW)
  await saveLibrarySnapshot(db, OWNER, hiddenLibrary(12), NOW)
})

/** Счётчик чтений по виду: снапшоты по steamid, ники по steamid, метаданные игр */
function countReads(): { snapshots: string[]; personas: string[]; metas: number } {
  const seen = { snapshots: [] as string[], personas: [] as string[], metas: 0 }
  const spy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'execute') return Reflect.get(target, prop, receiver)
      return (q: InStatement) => {
        const sql = typeof q === 'string' ? q : q.sql
        const first = typeof q === 'string' || !Array.isArray(q.args) ? undefined : String(q.args[0])
        if (sql.includes('FROM library_snapshots')) seen.snapshots.push(first ?? '')
        if (sql.includes('SELECT persona_name FROM users')) seen.personas.push(first ?? '')
        if (sql.startsWith('SELECT g.appid')) seen.metas++
        return target.execute(q)
      }
    },
  })
  ;(globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }).__imboredDb = Promise.resolve(spy)
  return seen
}

/** Один заход: метаданные и тело страницы в одном «запросе», как их зовёт Next */
async function visit(steamid: string): Promise<void> {
  await generateMetadata(params({ steamid }))
  await CompatPage(params({ steamid }))
}

describe('/compat/[steamid]: владелец ссылки — один раз на запрос', () => {
  test('гость: снапшот, ник и обложки владельца читаются по разу', async () => {
    const reads = countReads()
    await visit(OWNER)
    expect(reads.snapshots).toEqual([OWNER])
    expect(reads.personas).toEqual([OWNER])
    expect(reads.metas).toBe(1)
  })

  test('вошедший с библиотекой: снапшот владельца — один на метаданные и расчёт', async () => {
    await saveLibrarySnapshot(db, VIEWER, hiddenLibrary(8), NOW)
    await signIn(db, VIEWER, { verified: true })
    const reads = countReads()
    await visit(OWNER)
    expect(reads.snapshots.filter((s) => s === OWNER)).toHaveLength(1)
    expect(reads.snapshots.filter((s) => s === VIEWER)).toHaveLength(1)
    expect(reads.personas.filter((s) => s === OWNER)).toHaveLength(1)
    // Метаданные игр — одним чтением, объединением двух библиотек. Обложки
    // приглашения превью не нужны, а экран посчитанного сравнения красит героя
    // из того же объединения: раньше их читали метаданные страницы — вторым
    // чтением на каждый такой заход
    expect(reads.metas).toBe(1)
  })

  test('своя ссылка: обложки фона читаются один раз — телом, не метаданными', async () => {
    await signIn(db, OWNER, { verified: true })
    const reads = countReads()
    await visit(OWNER)
    expect(reads.snapshots).toEqual([OWNER])
    expect(reads.personas).toEqual([OWNER])
    expect(reads.metas).toBe(1)
  })
})
