import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { legacyArtUrl } from './art'
import { WALL_MAX } from './warmup'
import {
  CHOSEN_POSTER_WAIT_MS,
  chosenPoster,
  posterReady,
  stopWallLoads,
  WALL_MIN,
  WALL_NARROW,
  wallPool,
} from './warmupwall'

/**
 * Стена экрана ожидания и такт «из многих — одна» не держат канал.
 *
 * Замер на проде (/play в демо, телефон, 1.6 Мбит/с): 24 постера стены
 * (≈1.45 МБ) доезжали через 4–7 с после того, как стены не стало, постер
 * такта брал свой второй файл мимо кэша стены и показывался пустой рамкой, а
 * арт героя выдачи приходил на 18–21 с. Каждое правило ниже — одна из этих
 * трёх причин.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('wallPool', () => {
  test('широкий экран — вся стена, как пришла', () => {
    expect(wallPool(ids(WALL_MAX), false)).toEqual(ids(WALL_MAX))
  })

  test('телефон — пятнадцать: по пять в ряду, дальше края стекла не видно', () => {
    const pool = wallPool(ids(WALL_MAX), true)
    expect(pool).toEqual(ids(WALL_NARROW))
    expect(new Set(pool).size).toBe(WALL_NARROW)
  })

  test('маленькая библиотека добирается повтором — ряд шире экрана, файлов не больше', () => {
    expect(wallPool(ids(5), false)).toHaveLength(WALL_MIN)
    expect(new Set(wallPool(ids(5), false)).size).toBe(5)
    expect(wallPool(ids(5), true)).toHaveLength(WALL_NARROW)
    expect(new Set(wallPool(ids(5), true)).size).toBe(5)
  })

  test('ряды телефона не повторяют постер встык на шве петли', () => {
    // Ряд — каждый третий из пула, повторённый дважды: [...row, ...row]
    for (const n of [WALL_NARROW, WALL_MAX]) {
      const pool = wallPool(ids(n), true)
      for (const r of [0, 1, 2]) {
        const row = pool.filter((_, i) => i % 3 === r)
        const loop = [...row, ...row]
        for (let i = 1; i < loop.length; i++) expect(loop[i]).not.toBe(loop[i - 1])
      }
    }
  })

  test('пустая стена остаётся пустой', () => {
    expect(wallPool([], true)).toEqual([])
    expect(wallPool([], false)).toEqual([])
  })
})

describe('stopWallLoads', () => {
  /** Плитка стены: снятие src и есть обрыв её запроса */
  const tile = (complete: boolean) => {
    const attrs = new Map([['src', 'https://cdn.example/p.jpg']])
    return { complete, removeAttribute: (k: string) => attrs.delete(k), has: () => attrs.has('src') }
  }

  test('недокачанные плитки теряют адрес, доехавшие остаются на экране', () => {
    const done = tile(true)
    const loading = [tile(false), tile(false)]
    const root = { querySelectorAll: () => [done, ...loading] } as unknown as ParentNode
    expect(stopWallLoads(root)).toBe(2)
    expect(done.has()).toBe(true)
    for (const t of loading) expect(t.has()).toBe(false)
  })
})

describe('chosenPoster', () => {
  test('без своего постера в базе — тот же плоский адрес, что у плитки стены', () => {
    // В проде у строк каталога ключей poster нет — значит, это кэш стены
    expect(chosenPoster({ appid: 105600, art: { header: 'h', hero: 'x' } })).toBe(legacyArtUrl(105600, 'poster'))
  })

  test('свой постер из базы — он, а не его вдвое тяжёлый 2x', () => {
    expect(chosenPoster({ appid: 1, art: { poster: 'p300', poster2x: 'p600' } })).toBe('p300')
  })

  test('у игры не из Steam постера нет — и такта нет', () => {
    expect(chosenPoster({ appid: -3, art: null })).toBeUndefined()
  })
})

describe('posterReady', () => {
  /** Image с управляемым decode(): исход загрузки решает тест */
  function stubImage(decode: () => Promise<void>) {
    const made: Array<{ src?: string; fetchPriority?: string; removed: boolean }> = []
    class FakeImage {
      fetchPriority = 'auto'
      decoding = 'auto'
      removed = false
      private _src = ''
      constructor() {
        made.push(this as unknown as (typeof made)[number])
      }
      set src(v: string) {
        this._src = v
      }
      get src() {
        return this._src
      }
      removeAttribute(k: string) {
        if (k === 'src') this.removed = true
      }
      decode() {
        return decode()
      }
    }
    vi.stubGlobal('Image', FakeImage)
    return made
  }

  test('постер раскодирован в срок — такт будет, и просили его первым', async () => {
    const made = stubImage(() => Promise.resolve())
    await expect(posterReady('p.jpg', CHOSEN_POSTER_WAIT_MS)).resolves.toBe(true)
    expect(made[0]?.src).toBe('p.jpg')
    expect(made[0]?.fetchPriority).toBe('high')
    expect(made[0]?.removed).toBe(false)
  })

  test('не успел — такта нет, а загрузка обрывается: канал нужен герою', async () => {
    vi.useFakeTimers()
    const made = stubImage(() => new Promise<void>(() => {}))
    const ready = posterReady('p.jpg', CHOSEN_POSTER_WAIT_MS)
    await vi.advanceTimersByTimeAsync(CHOSEN_POSTER_WAIT_MS)
    await expect(ready).resolves.toBe(false)
    expect(made[0]?.removed).toBe(true)
  })

  test('битый постер — такта нет, без исключения наружу', async () => {
    stubImage(() => Promise.reject(new Error('EncodingError')))
    await expect(posterReady('p.jpg', CHOSEN_POSTER_WAIT_MS)).resolves.toBe(false)
  })
})

/*
 * Само условие такта живёт в странице, а она клиентская и здесь не
 * рендерится. Сторож по тексту: такт начинается только после posterReady
 * и показывает тот самый адрес, которого дождался.
 */
describe('/play: такт выбора ждёт свой постер', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'play', 'page.tsx'), 'utf8')

  test('setChosen — только после posterReady и с тем же адресом', () => {
    const gate = src.indexOf('await posterReady(poster, CHOSEN_POSTER_WAIT_MS)')
    expect(gate, 'такт больше не ждёт постер').toBeGreaterThan(0)
    const chosen = src.indexOf('setChosen({', gate)
    expect(chosen).toBeGreaterThan(gate)
    expect(src.slice(chosen, src.indexOf('})', chosen))).toMatch(/\bposter\b/)
  })

  /*
   * Ожидание постера — новый await посреди reveal(). Ушёл со страницы за эти
   * доли секунды — и без проверки сразу за ним выдача всё равно вставала бы,
   * а голос называл бы игру тому, кого здесь уже нет.
   */
  test('за ожиданием постера — проверка ухода, до такта и до выдачи', () => {
    const gate = src.indexOf('await posterReady(poster, CHOSEN_POSTER_WAIT_MS)')
    const check = src.indexOf('if (ac.signal.aborted) return false', gate)
    expect(check).toBeGreaterThan(gate)
    // снаружи условия такта: внутри него проверку обходил бы как раз
    // пропущенный такт — тот случай, где ожидание и было
    const ceremony = src.indexOf('if (ceremony', gate)
    expect(ceremony, 'условие такта не найдено').toBeGreaterThan(0)
    expect(check).toBeLessThan(ceremony)
    expect(check).toBeLessThan(src.indexOf('setChosen({', gate))
    expect(check).toBeLessThan(src.indexOf("setPhase(roulette ? 'spin' : 'reveal')", gate))
  })

  test('экран ожидания рисует постер такта одним адресом, без srcSet', () => {
    const screen = fs.readFileSync(path.join(__dirname, '..', 'components', 'WarmupScreen.tsx'), 'utf8')
    expect(screen).toMatch(/<img src=\{chosen\.poster\}/)
    expect(screen).not.toMatch(/variant="poster"/)
  })
})
