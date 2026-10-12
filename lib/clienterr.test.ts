import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  CLIENT_ERROR_PATH,
  CLIENT_REPORTS_PER_SESSION,
  buildClientReport,
  clientErrorCode,
  createReportGate,
  isChunkLoadError,
  parseClientReport,
  reportKey,
} from './clienterr'

const HREF = 'https://imbored.cc/room/K7Q2PX?compat=76561198000000000&join=ABC123'

function boom(message = 'Cannot read properties of undefined (reading "appid")'): Error {
  const err = new TypeError(message)
  err.stack = [
    `TypeError: ${message}`,
    '    at Player (https://imbored.cc/_next/static/chunks/app/play/page-1a2b.js?dpl=dpl_SECRET:1:2345)',
    ...Array.from({ length: 30 }, (_, i) => `    at frame${i} (https://imbored.cc/_next/static/chunks/x.js:1:${i})`),
  ].join('\n')
  return err
}

describe('buildClientReport', () => {
  test('отчёт несёт то, по чему поломку можно найти: текст, имя, кадры, страницу, код', () => {
    const r = buildClientReport({ kind: 'boundary', error: boom(), href: 'https://imbored.cc/play', code: 'c0abc123' })
    expect(r).toMatchObject({
      kind: 'boundary',
      name: 'TypeError',
      message: 'Cannot read properties of undefined (reading "appid")',
      page: '/play',
      code: 'c0abc123',
    })
    // стек есть, но обрезан и без строки запроса у файлов чанков
    expect(r?.stack?.split('\n').length).toBe(6)
    expect(r?.stack).toContain('at Player (https://imbored.cc/_next/static/chunks/app/play/page-1a2b.js')
    expect(r?.stack).not.toContain('dpl_SECRET')
  })

  /*
   * Тот же обет, что у серверного лога: чужих steamid и кодов пати в логе
   * нет. Код пати — это доступ: по нему входят в комнату.
   */
  test('страница под масками и без строки запроса', () => {
    const r = buildClientReport({ kind: 'error', error: boom(), href: HREF })
    expect(r?.page).toBe('/room/:id')
    const line = JSON.stringify(r)
    expect(line).not.toContain('K7Q2PX')
    expect(line).not.toContain('ABC123')
    expect(line).not.toContain('76561198000000000')
    expect(buildClientReport({ kind: 'error', error: boom(), href: 'https://imbored.cc/compat/76561198000000000' })?.page).toBe(
      '/compat/:steamid',
    )
  })

  test('steamid в тексте ошибки — тоже под маской', () => {
    const r = buildClientReport({
      kind: 'rejection',
      error: new Error('нет снимка 76561198000000000 для /api/room/K7Q2PX/vote?join=ABC123'),
      href: 'https://imbored.cc/play',
    })
    expect(r?.message).toBe('нет снимка :steamid для /api/room/:id/vote?join=…')
  })

  test('событие без error: текст, файл и позиция берутся из события', () => {
    const r = buildClientReport({
      kind: 'error',
      message: 'Uncaught ReferenceError: foo is not defined',
      filename: 'https://imbored.cc/_next/static/chunks/a.js?v=1',
      lineno: 12,
      colno: 34,
      href: 'https://imbored.cc/quiz',
    })
    expect(r).toEqual({
      kind: 'error',
      message: 'Uncaught ReferenceError: foo is not defined',
      page: '/quiz',
      source: 'https://imbored.cc/_next/static/chunks/a.js',
      line: 12,
      col: 34,
    })
  })

  test('бросить можно что угодно', () => {
    expect(buildClientReport({ kind: 'rejection', error: 'строка', href: 'https://imbored.cc/' })?.message).toBe('строка')
    expect(buildClientReport({ kind: 'rejection', error: { message: 'как ошибка' }, href: 'https://imbored.cc/' })?.message).toBe(
      'как ошибка',
    )
    // пустой reject() — читать нечего
    expect(buildClientReport({ kind: 'rejection', error: undefined, href: 'https://imbored.cc/' })).toBeNull()
  })

  test('шум, который чинить не нам, не отправляется', () => {
    const at = (over: Partial<Parameters<typeof buildClientReport>[0]>) =>
      buildClientReport({ kind: 'error', href: 'https://imbored.cc/play', ...over })
    // чужой скрипт: браузер прячет подробности
    expect(at({ message: 'Script error.' })).toBeNull()
    // расширение посетителя
    expect(at({ error: boom(), filename: 'chrome-extension://abcdef/content.js' })).toBeNull()
    expect(at({ error: boom(), filename: 'moz-extension://abcdef/content.js' })).toBeNull()
    // предупреждение браузера, а не поломка
    expect(at({ message: 'ResizeObserver loop completed with undelivered notifications.' })).toBeNull()
    // fetch отменён уходом со страницы
    expect(
      buildClientReport({ kind: 'rejection', error: new DOMException('aborted', 'AbortError'), href: 'https://imbored.cc/' }),
    ).toBeNull()
  })

  test('длинное режется, мусорный код не проходит', () => {
    const r = buildClientReport({ kind: 'error', error: new Error('x'.repeat(5000)), href: 'https://imbored.cc/', code: 'не код!' })
    expect(r?.message.length).toBeLessThanOrEqual(300)
    expect(r?.code).toBeUndefined()
  })

  /*
   * Отказ чанка островка (components/lazyIsland): текст называет чанк по
   * хешу, а хеш меняется с каждым деплоем и ни о чём не говорит. Тег — имя
   * островка: по нему отказ «Уже прошёл» после деплоя ищется в логе как
   * mark-finished, а не как 0f3a9c.js.
   */
  test('отказ островка несёт его тег; не тег — мимо', () => {
    const err = new Error('Failed to load chunk /_next/static/chunks/0f3a9c.js from module 41234')
    const r = buildClientReport({ kind: 'boundary', error: err, island: 'mark-finished', href: 'https://imbored.cc/library' })
    expect(r).toMatchObject({ kind: 'boundary', island: 'mark-finished', page: '/library' })
    for (const island of ['', 'Mark Finished', '<script>', '-snow', 'x'.repeat(40)]) {
      expect(buildClientReport({ kind: 'boundary', error: err, island, href: HREF }), island).not.toHaveProperty('island')
    }
  })
})

/*
 * Отказ доставки чанка против отказа его кода. Закулисье
 * (components/BackstageLazy) о первом молчит — сеть и деплой, чинить нечего, —
 * а о втором отчитывается: это наша поломка у каждого с тем же браузером.
 */
describe('isChunkLoadError', () => {
  const named = (message: string) => Object.assign(new Error(message), { name: 'ChunkLoadError' })
  const TURBOPACK = 'Failed to load chunk /_next/static/chunks/0f3a9c.js from module 41234'
  const WEBPACK = 'Loading chunk 812 failed.\n(error: https://imbored.cc/_next/static/chunks/812.js)'

  test('рантайм Turbopack и webpack: по имени и по тексту', () => {
    expect(isChunkLoadError(named(TURBOPACK))).toBe(true)
    expect(isChunkLoadError(named(WEBPACK))).toBe(true)
    // имя потерялось по дороге — узнаётся текстом
    expect(isChunkLoadError(new Error(TURBOPACK))).toBe(true)
    expect(isChunkLoadError(new Error(WEBPACK))).toBe(true)
    expect(isChunkLoadError(new Error('Loading CSS chunk 77 failed.\n(/_next/static/css/77.css)'))).toBe(true)
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'x' }), 'не Error, а похожее').toBe(true)
  })

  test('завёрнутый в чужую ошибку — всё ещё отказ доставки', () => {
    const wrapped = new Error('[vitest] There was an error when mocking a module.', { cause: named(TURBOPACK) })
    expect(isChunkLoadError(wrapped)).toBe(true)
  })

  test('код, упавший при вычислении, — не отказ доставки', () => {
    expect(isChunkLoadError(boom())).toBe(false)
    expect(isChunkLoadError(new SyntaxError('Unexpected token')), 'синтаксис доехавшего чанка').toBe(false)
    expect(isChunkLoadError(new Error('wrapper', { cause: boom() }))).toBe(false)
    // слово chunk посреди чужого текста — не повод молчать
    expect(isChunkLoadError(new Error('Cannot read chunk size: Failed to load chunk metadata'))).toBe(false)
  })

  test('не падает на чём угодно и на петле причин', () => {
    const loop = new Error('loop')
    ;(loop as { cause?: unknown }).cause = loop
    for (const x of [undefined, null, 0, '', 'строка', 42, {}, [], loop]) {
      expect(isChunkLoadError(x), String(x)).toBe(false)
    }
  })
})

describe('clientErrorCode', () => {
  test('короткий, с буквой c впереди — не спутать с серверным digest', () => {
    expect(clientErrorCode(boom())).toMatch(/^c[0-9a-z]{7}$/)
  })

  /*
   * Код считается в рендере границы: случайное число там дало бы новый код
   * на каждом рендере и разный код у экрана и отчёта.
   */
  test('одна и та же ошибка — один и тот же код, другая — другой', () => {
    expect(clientErrorCode(boom())).toBe(clientErrorCode(boom()))
    expect(clientErrorCode(boom('другое'))).not.toBe(clientErrorCode(boom()))
  })

  test('steamid в тексте не меняет код: тот же баг у разных людей — один код', () => {
    // стек тот же: поломка одна и бросает из одного места
    const at = (steamid: string) =>
      Object.assign(new Error(`нет снимка ${steamid}`), { stack: `Error: нет снимка ${steamid}\n    at load (a.js:1:2)` })
    expect(clientErrorCode(at('76561198000000000'))).toBe(clientErrorCode(at('76561198000000001')))
  })

  test('не падает на чём угодно', () => {
    for (const v of [undefined, null, 'строка', 42, { message: 'm' }]) {
      expect(clientErrorCode(v)).toMatch(/^c[0-9a-z]{7}$/)
    }
  })
})

describe('parseClientReport', () => {
  test('честный отчёт проходит как есть', () => {
    const r = buildClientReport({ kind: 'boundary', error: boom(), href: HREF, code: 'c0abc123' })
    expect(parseClientReport(JSON.parse(JSON.stringify(r)))).toEqual(r)
  })

  test('тег островка доходит до лога, а не тег — нет', () => {
    const r = buildClientReport({ kind: 'boundary', error: boom(), href: HREF, island: 'hero-slider' })
    expect(parseClientReport(JSON.parse(JSON.stringify(r)))).toEqual(r)
    expect(parseClientReport({ kind: 'boundary', message: 'x', page: '/play', island: '<img src=x>' })).toEqual({
      kind: 'boundary',
      message: 'x',
      page: '/play',
    })
  })

  /*
   * Тело шлёт чей угодно браузер: старая вкладка до масок, консоль, скрипт.
   * Сервер маски накладывает заново и пропускает только белый список.
   */
  test('сервер не верит браузеру: маски заново, лишние поля — мимо', () => {
    const r = parseClientReport({
      kind: 'error',
      message: 'boom at https://imbored.cc/play?join=ABC123',
      page: '/compat/76561198000000000?next=%2Fplay',
      source: 'https://imbored.cc/_next/static/chunks/a.js?token=T',
      stack: 'Error\n at /room/K7Q2PX',
      cookie: 'imbored_session=SECRET',
      steamid: '76561198000000000',
      line: 3,
    })
    expect(r).toEqual({
      kind: 'error',
      message: 'boom at https://imbored.cc/play',
      page: '/compat/:steamid',
      source: 'https://imbored.cc/_next/static/chunks/a.js',
      stack: 'Error\n at /room/:id',
      line: 3,
    })
  })

  test('мусор не проходит', () => {
    expect(parseClientReport(null)).toBeNull()
    expect(parseClientReport('boom')).toBeNull()
    expect(parseClientReport([])).toBeNull()
    expect(parseClientReport({ kind: 'error' })).toBeNull()
    expect(parseClientReport({ kind: 'hack', message: 'x' })).toBeNull()
    // чужая страница и кривые числа не ломают разбор
    expect(
      parseClientReport({ kind: 'error', message: 'x', page: 'https://evil.example/', line: -1, col: 1.5, code: '<script>' }),
    ).toEqual({ kind: 'error', message: 'x', page: 'unknown' })
  })
})

describe('отсечка повторов', () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>()
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      get length() {
        return m.size
      },
    }
  }

  test('одна и та же поломка — один отчёт за сессию вкладки', () => {
    const storage = memoryStorage()
    const gate = createReportGate(() => storage)
    expect(gate('a')).toBe(true)
    expect(gate('a')).toBe(false)
    expect(gate('b')).toBe(true)
    // перезагрузка: новый модуль, та же сессия вкладки
    expect(createReportGate(() => storage)('a')).toBe(false)
  })

  test('всего не больше потолка: страница, которая сыплется, лог не зальёт', () => {
    const gate = createReportGate(() => memoryStorage())
    const sent = Array.from({ length: 50 }, (_, i) => gate(`k${i}`)).filter(Boolean)
    expect(sent).toHaveLength(CLIENT_REPORTS_PER_SESSION)
  })

  test('хранилище бросает (приватный режим) — отсечка живёт в памяти', () => {
    const gate = createReportGate(() => {
      throw new Error('SecurityError')
    })
    expect(gate('a')).toBe(true)
    expect(gate('a')).toBe(false)
  })

  test('ключ различает место, а страница в него не входит', () => {
    const r = buildClientReport({ kind: 'error', error: boom(), href: 'https://imbored.cc/room/AAAAAA' })!
    const other = buildClientReport({ kind: 'error', error: boom(), href: 'https://imbored.cc/room/BBBBBB' })!
    expect(reportKey(r)).toBe(reportKey(other))
  })

  // Два островка на одной странице (/daily: слайдер героя и снег) с одним и
  // тем же текстом отказа — две поломки, а не одна
  test('островок — тоже место', () => {
    const at = (island: string) =>
      buildClientReport({ kind: 'boundary', error: new TypeError('Load failed'), island, href: 'https://imbored.cc/daily' })!
    expect(reportKey(at('hero-slider'))).not.toBe(reportKey(at('snow')))
  })
})

/**
 * Сторож проводки: чистая логика выше бесполезна, если её никто не зовёт.
 */
describe('проводка', () => {
  const ROOT = path.join(__dirname, '..')
  const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

  test('instrumentation-client в корне и слушает оба события', () => {
    const src = read('instrumentation-client.ts')
    expect(src).toMatch(/addEventListener\('error'/)
    expect(src).toMatch(/addEventListener\('unhandledrejection'/)
    expect(src).toContain('reportClientError')
  })

  test('обе границы ошибок показывают код всегда и шлют отчёт без digest', () => {
    for (const file of ['app/error.tsx', 'app/global-error.tsx']) {
      const src = read(file)
      expect(src, file).toContain('clientErrorCode(error)')
      expect(src, file).toContain("kind: 'boundary'")
      // код больше не прячется за error.digest &&
      expect(src, file).not.toMatch(/error\.digest\s*&&/)
    }
  })

  /*
   * Тег — второй аргумент lazyIsland, и без него не соберётся. Но тег с
   * заглавной или пробелом отчёт молча отбросит, а один тег у двух островков
   * склеит их отказы в логе — поэтому сторож читает все вызовы.
   */
  test('у каждого островка свой тег, и отчёт его пропускает', () => {
    const tags: string[] = []
    for (const dir of ['app', 'components']) {
      for (const file of fs.readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })) {
        if (!file.endsWith('.tsx') || path.basename(file) === 'lazyIsland.tsx') continue
        const src = read(dir, file).replace(/\/\*[\s\S]*?\*\//g, '')
        for (const [, args] of src.matchAll(/\blazyIsland(?:<[^>]*>)?\(([\s\S]*?)\)\r?\n/g)) {
          const tag = /'([^']*)',?\s*$/.exec(args)?.[1] ?? `${file}: тега нет`
          const report = buildClientReport({ kind: 'boundary', error: new Error('x'), island: tag, href: HREF })
          expect(report?.island, `${dir}/${file}`).toBe(tag)
          tags.push(tag)
        }
      }
    }
    // без этого сторож мог бы быть зелёным вхолостую
    expect(tags.length).toBeGreaterThanOrEqual(4)
    expect(new Set(tags).size, tags.join(', ')).toBe(tags.length)
  })

  test('приёмник живёт по тому адресу, куда шлёт браузер', () => {
    const route = read('app', ...CLIENT_ERROR_PATH.split('/').filter(Boolean), 'route.ts')
    expect(route).toMatch(/export async function POST/)
    expect(route).toContain('checkRate')
  })
})
