import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  captureRef,
  currentSource,
  eventKey,
  parseRef,
  parseTrackEvent,
  stepKey,
  track,
  TRACK_PATH,
  trackWait,
  WAIT_BUCKETS,
  WAIT_PATHS,
  waitBucket,
  withRef,
} from './track'

describe('разбор маяка', () => {
  test('знакомое событие и источник проходят', () => {
    expect(parseTrackEvent({ event: 'quiz_done', source: 'compat' })).toEqual({ event: 'quiz_done', source: 'compat' })
    expect(parseTrackEvent({ event: 'launch_click' })).toEqual({ event: 'launch_click', source: 'direct' })
  })

  test('чужой источник — direct, чужое событие — null', () => {
    expect(parseTrackEvent({ event: 'pick_shown', source: '76561197960287930' })).toEqual({
      event: 'pick_shown',
      source: 'direct',
    })
    // серверные шаги браузеру не доверены: их считает сервер сам
    expect(parseTrackEvent({ event: 'connect_ok' })).toBeNull()
    expect(parseTrackEvent({ event: 'drop table' })).toBeNull()
    expect(parseTrackEvent(null)).toBeNull()
    expect(parseTrackEvent([{ event: 'quiz_done' }])).toBeNull()
  })

  // Полоса демо (components/DemoBar): показ и две двери — отдельными шагами,
  // чтобы видеть не только «нажали», но и какую дверь выбирают
  test('шаги полосы демо браузеру доверены', () => {
    for (const event of ['demo_door_shown', 'demo_door_steam', 'demo_door_link'] as const) {
      expect(parseTrackEvent({ event, source: 'pick' })).toEqual({ event, source: 'pick' })
    }
  })

  test('ключ счётчика — событие:источник', () => {
    expect(eventKey('share_click', 'portrait')).toBe('share_click:portrait')
    expect(eventKey('connect_ok', 'openid')).toBe('connect_ok:openid')
  })
})

/**
 * Ожидание первой выдачи (pick_wait). Время уходит с устройства только
 * корзиной из закрытого списка — в таблицу счётчиков не должно пролезть ни
 * число, ни что-то, что сделает ключ уникальным для одного человека.
 */
describe('ожидание первой выдачи', () => {
  test('корзины режутся по верхней границе, всё долгое — одна корзина', () => {
    expect(waitBucket(0)).toBe('lt2')
    expect(waitBucket(1_999)).toBe('lt2')
    expect(waitBucket(2_000)).toBe('lt5')
    expect(waitBucket(9_999)).toBe('lt10')
    expect(waitBucket(10_000)).toBe('lt20')
    expect(waitBucket(20_000)).toBe('ge20')
    expect(waitBucket(3_600_000)).toBe('ge20')
  })

  test('отрицательное и не число — ноль, а не «долго»', () => {
    expect(waitBucket(-5_000)).toBe('lt2')
    expect(waitBucket(Number.NaN)).toBe('lt2')
    expect(waitBucket(Number.POSITIVE_INFINITY)).toBe('lt2')
  })

  test('маяк с корзиной из списка — ключ «pick_wait:путь.корзина», без источника', () => {
    const step = parseTrackEvent({ event: 'pick_wait', source: 'room', wait: 'prewarm.lt5' })
    expect(step).toEqual({ event: 'pick_wait', source: 'room', wait: 'prewarm.lt5' })
    expect(stepKey(step!)).toBe('pick_wait:prewarm.lt5')
    // у остальных шагов ключ прежний
    expect(stepKey(parseTrackEvent({ event: 'pick_shown', source: 'room' })!)).toBe('pick_shown:room')
  })

  /*
   * Вторая половина ключа — по событию: маршрут пишет в таблицу тот ключ, что
   * получил. Проверяет tsc (npx tsc --noEmit), а не vitest: бессмысленная пара
   * обязана не собираться, а собравшись, дала бы строку, которую никто не ждёт.
   */
  test('ключ ожидания — только pick_wait с корзиной', () => {
    expect(eventKey('pick_wait', 'prewarm.lt5')).toBe('pick_wait:prewarm.lt5')
    // @ts-expect-error у показа вторая половина — источник, а не корзина
    eventKey('pick_shown', 'cold.lt2')
    // @ts-expect-error у ожидания — корзина, а не источник
    eventKey('pick_wait', 'direct')
  })

  test('каждая пара пути и корзины принимается', () => {
    for (const p of WAIT_PATHS) {
      for (const b of WAIT_BUCKETS) {
        expect(parseTrackEvent({ event: 'pick_wait', wait: `${p}.${b}` })).toEqual({
          event: 'pick_wait',
          source: 'direct',
          wait: `${p}.${b}`,
        })
      }
    }
  })

  test.each([
    ['без корзины', {}],
    ['число вместо корзины', { wait: 4200 }],
    ['миллисекунды строкой', { wait: '4200' }],
    ['чужой путь', { wait: 'steam.lt5' }],
    ['чужая корзина', { wait: 'cold.lt3' }],
    ['SteamID', { wait: '76561197960287930' }],
  ])('pick_wait %s — не принимается', (_name, extra) => {
    expect(parseTrackEvent({ event: 'pick_wait', ...extra })).toBeNull()
  })

  test('корзина у другого шага игнорируется', () => {
    expect(parseTrackEvent({ event: 'pick_shown', wait: 'cold.lt5' })).toEqual({
      event: 'pick_shown',
      source: 'direct',
    })
  })

  /*
   * pick_wait — пара к pick_shown: шлётся в том же месте и только там. И не
   * с каждым показом, а с первым на заходе (round === 0): «Подобрать заново»
   * ждёт на уже тронутом каталоге и размыл бы холодный путь. Разъедутся —
   * и корзины перестанут складываться в число заходов.
   */
  test('/play шлёт ожидание ровно рядом с показом и только на заходе', () => {
    const src = fs
      .readFileSync(path.join(__dirname, '..', 'app', 'play', 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect([...src.matchAll(/track\('pick_shown'\)/g)]).toHaveLength(1)
    expect([...src.matchAll(/trackWait\(/g)]).toHaveLength(1)
    expect(src).toMatch(/track\('pick_shown'\)\s*if \(round === 0\) \{\s*trackWait\(/)
    // round — счётчик «Подобрать заново», с нуля на каждом заходе
    expect(src).toMatch(/const \[round, setRound\] = useState\(0\)/)
  })
})

describe('метка ref', () => {
  test('закрытый список', () => {
    expect(parseRef('room')).toBe('room')
    expect(parseRef('evil')).toBeNull()
    expect(parseRef(null)).toBeNull()
  })

  test('withRef ставит метку и не трогает остальное', () => {
    expect(withRef('https://imbored.cc/compat/76561197960287930', 'compat')).toBe(
      'https://imbored.cc/compat/76561197960287930?ref=compat',
    )
    expect(withRef('https://imbored.cc/room/ABC234?x=1&ref=pick', 'room')).toBe(
      'https://imbored.cc/room/ABC234?x=1&ref=room',
    )
    expect(withRef('не адрес', 'room')).toBe('не адрес')
  })
})

describe('браузер', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function browser() {
    const store = new Map<string, string>()
    const sent: Array<{ path: string; body: unknown }> = []
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    vi.stubGlobal('navigator', {
      sendBeacon: (path: string, blob: Blob) => {
        sent.push({ path, body: blob })
        return true
      },
    })
    const bodies = async () => Promise.all(sent.map(async (s) => JSON.parse(await (s.body as Blob).text())))
    return { store, sent, bodies }
  }

  test('первая метка запоминается и отмечает приход, вторая не перебивает', async () => {
    const b = browser()
    captureRef('?ref=compat&x=1')
    captureRef('?ref=room')
    expect(currentSource()).toBe('compat')
    expect(b.sent.map((s) => s.path)).toEqual([TRACK_PATH])
    expect(await b.bodies()).toEqual([{ event: 'ref_open', source: 'compat' }])
  })

  test('чужая метка — ничего не пишем и не шлём', () => {
    const b = browser()
    captureRef('?ref=76561197960287930')
    expect(b.store.size).toBe(0)
    expect(b.sent).toEqual([])
    expect(currentSource()).toBe('direct')
  })

  test('шаг уходит с источником вкладки', async () => {
    const b = browser()
    b.store.set('imbored-ref', 'portrait')
    track('launch_click')
    expect(await b.bodies()).toEqual([{ event: 'launch_click', source: 'portrait' }])
  })

  test('ожидание уходит корзиной, а не числом, и проходит разбор сервера', async () => {
    const b = browser()
    trackWait('prewarm', 3_400)
    const [body] = await b.bodies()
    expect(body).toEqual({ event: 'pick_wait', source: 'direct', wait: 'prewarm.lt5' })
    expect(JSON.stringify(body)).not.toContain('3400')
    expect(parseTrackEvent(body)).toEqual(body)
  })

  test('сломанное хранилище и отказ маяка страницу не роняют', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    })
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('nope')
      },
    })
    expect(() => captureRef('?ref=room')).not.toThrow()
    expect(() => track('quiz_done')).not.toThrow()
    expect(currentSource()).toBe('direct')
  })
})
