import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import {
  SWALLOW_WINDOW_MS,
  formatServerError,
  formatSwallowed,
  logSwallowed,
  resetSwallowed,
  scrubText,
  serverErrorLine,
} from './errlog'

const REQ = {
  path: '/game/730?from=quiz',
  method: 'GET',
  headers: {
    cookie: 'imbored_session=SECRET-TOKEN-VALUE; theme=dark',
    authorization: 'Bearer SECRET',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    referer: 'https://imbored.cc/quiz',
    'x-forwarded-for': '203.0.113.7',
  },
}
const CTX = { routePath: '/app/game/[appid]', routeType: 'render' }

describe('formatServerError', () => {
  test('несёт то, по чему падение можно найти и воспроизвести', () => {
    const log = formatServerError(new Error('boom'), REQ, CTX)
    expect(log.event).toBe('server-error')
    expect(log.message).toBe('boom')
    expect(log.path).toBe('/game/730')
    expect(log.method).toBe('GET')
    // Файл маршрута, а не адрес: по нему видно, ГДЕ упало, а не у кого.
    expect(log.route).toBe('/app/game/[appid]')
    expect(log.routeType).toBe('render')
  })

  /*
   * Строка запроса срезается, и это не косметика: по адресам продукта ездят
   * чужие steamid (?compat=765611…) и коды пати. Страница приватности обещает,
   * что мы такого не храним, — лог не исключение.
   */
  test('строка запроса в лог не попадает, а steamid из пути — под маской', () => {
    const log = formatServerError(new Error('boom'), {
      ...REQ,
      path: '/compat/76561198000000000?next=%2Fplay&join=ABC123',
    })
    expect(log.path).toBe('/compat/:steamid')
    expect(JSON.stringify(log)).not.toContain('ABC123')
    expect(JSON.stringify(log)).not.toContain('76561198000000000')
  })

  test('код пати в пути — тоже доступ, и тоже под маской', () => {
    // По коду входят в комнату: в логе он был бы ключом от чужой пати.
    expect(formatServerError(new Error('b'), { path: '/room/K7Q2PX' }).path).toBe('/room/:id')
    expect(formatServerError(new Error('b'), { path: '/api/room/K7Q2PX/vote' }).path).toBe(
      '/api/room/:id/vote',
    )
    // набранный руками строчными ведёт туда же
    expect(formatServerError(new Error('b'), { path: '/room/k7q2px' }).path).toBe('/room/:id')
    // а настоящие адреса без кода остаются как есть
    expect(formatServerError(new Error('b'), { path: '/room/new' }).path).toBe('/room/new')
    expect(formatServerError(new Error('b'), { path: '/api/room/create' }).path).toBe('/api/room/create')
    expect(formatServerError(new Error('b'), { path: '/rooms' }).path).toBe('/rooms')
    expect(formatServerError(new Error('b'), { path: '/portrait/76561198000000000/opengraph-image' }).path).toBe(
      '/portrait/:steamid/opengraph-image',
    )
  })

  test('digest доезжает — это тот же код, что человек видит на экране', () => {
    /*
     * Весь смысл файла. Обе границы ошибок печатают digest человеку; без него
     * в логе жалоба «показало код a1b2c3» не связывается ни с чем.
     */
    const err = Object.assign(new Error('boom'), { digest: 'a1b2c3' })
    expect(formatServerError(err, REQ, CTX).digest).toBe('a1b2c3')
  })

  test('СЕКРЕТЫ В ЛОГ НЕ ПОПАДАЮТ', () => {
    /*
     * Сессионная кука — это возможность войти под человеком. Лог, в который
     * она утекла, превращается из отладочного инструмента в связку ключей, а
     * логи живут дольше и видны большему числу людей, чем принято думать.
     */
    const line = serverErrorLine(formatServerError(new Error('boom'), REQ, CTX))
    expect(line).not.toContain('SECRET-TOKEN-VALUE')
    expect(line).not.toContain('Bearer')
    expect(line.toLowerCase()).not.toContain('cookie')
    expect(line.toLowerCase()).not.toContain('authorization')
  })

  test('адрес не логируется — он не нужен, а это персональные данные', () => {
    // Воспроизвести падение он не помогает, зато обещание страницы
    // приватности нарушает.
    const line = serverErrorLine(formatServerError(new Error('boom'), REQ, CTX))
    expect(line).not.toContain('203.0.113.7')
  })

  test('список заголовков БЕЛЫЙ: незнакомое не попадает по умолчанию', () => {
    /*
     * Чёрный список удобен ровно до первого нового заголовка авторизации,
     * который никто не догадался в него внести.
     */
    const log = formatServerError(new Error('b'), {
      ...REQ,
      headers: { ...REQ.headers, 'x-secret-future-token': 'LEAK' },
    })
    expect(JSON.stringify(log)).not.toContain('LEAK')
    expect(Object.keys(log.headers ?? {}).sort()).toEqual(['referer', 'user-agent'])
  })

  /*
   * referer — тот же адрес, только чужой страницы: человек пришёл из пати на
   * /game/730, и её код оказывался в логе падения игры.
   */
  test('referer со своего сайта — origin и путь под масками, без строки запроса', () => {
    const log = formatServerError(new Error('b'), {
      headers: {
        host: 'imbored.cc',
        referer: 'https://imbored.cc/room/K7Q2PX?compat=76561198000000001#x',
      },
    })
    expect(log.headers?.referer).toBe('https://imbored.cc/room/:id')
    const withSteamid = formatServerError(new Error('b'), {
      headers: { host: 'imbored.cc', referer: 'https://imbored.cc/portrait/76561198000000000?join=ABC123' },
    })
    expect(withSteamid.headers?.referer).toBe('https://imbored.cc/portrait/:steamid')
  })

  test('referer с чужого сайта — только origin: его путь маскам не обучен', () => {
    // Профиль Steam в пути — это ник человека, а ник маска на steamid не ловит.
    const log = formatServerError(new Error('b'), {
      headers: { host: 'imbored.cc', referer: 'https://steamcommunity.com/id/some-nick/?x=1' },
    })
    expect(log.headers?.referer).toBe('https://steamcommunity.com')
    // host неизвестен — свой сайт не отличить от чужого, значит только origin
    const noHost = formatServerError(new Error('b'), {
      headers: { referer: 'https://imbored.cc/compat/76561198000000000' },
    })
    expect(noHost.headers?.referer).toBe('https://imbored.cc')
    // за прокси Vercel свой хост — в x-forwarded-host
    const forwarded = formatServerError(new Error('b'), {
      headers: { 'x-forwarded-host': 'imbored.cc', host: 'internal', referer: 'https://imbored.cc/play?x=1' },
    })
    expect(forwarded.headers?.referer).toBe('https://imbored.cc/play')
  })

  test('referer, который не адрес, в лог не попадает вовсе', () => {
    const log = formatServerError(new Error('b'), {
      headers: { 'user-agent': 'ua', referer: 'android-app://com.example/76561198000000000' },
    })
    expect(log.headers).toEqual({ 'user-agent': 'ua' })
    expect(formatServerError(new Error('b'), { headers: { referer: 'не адрес' } }).headers).toBeUndefined()
  })

  test('заголовок-массив не превращается в «a,b»', () => {
    const log = formatServerError(new Error('b'), {
      headers: { 'user-agent': ['first', 'second'] },
    })
    expect(log.headers?.['user-agent']).toBe('first')
  })

  test('длинный user-agent обрезается', () => {
    const log = formatServerError(new Error('b'), { headers: { 'user-agent': 'x'.repeat(500) } })
    expect(log.headers?.['user-agent'].length).toBeLessThanOrEqual(160)
  })

  test('стек обрезается, но остаётся', () => {
    const err = new Error('boom')
    err.stack = ['Error: boom', ...Array.from({ length: 40 }, (_, i) => `  at frame${i}`)].join('\n')
    const log = formatServerError(err, REQ, CTX)
    expect(log.stack?.split('\n').length).toBe(8)
    expect(log.stack).toContain('at frame0')
  })

  test('бросить можно что угодно, и логгер обязан это пережить', () => {
    /*
     * unknown в сигнатуре onRequestError — не формальность: бросают строки,
     * объекты ответа и undefined. Плюс докблок конвенции отдельно
     * предупреждает, что до нас доезжает не обязательно исходный объект.
     */
    expect(formatServerError('просто строка').message).toBe('просто строка')
    expect(formatServerError(undefined).message).toBe('undefined')
    expect(formatServerError({ message: 'как ошибка', digest: 'd1' }).digest).toBe('d1')
    expect(formatServerError({ weird: true }).message).toContain('weird')
  })

  test('без запроса и контекста лог всё равно осмысленный', () => {
    // onRequestError вызывается и там, где запроса нет.
    const log = formatServerError(new Error('boom'))
    expect(log.message).toBe('boom')
    expect(log.path).toBeUndefined()
    expect(log.headers).toBeUndefined()
  })
})

describe('serverErrorLine', () => {
  test('ровно одна строка — многострочный JSON в сборщике разъезжается', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom\n  at a\n  at b'
    const line = serverErrorLine(formatServerError(err, REQ, CTX))
    expect(line.includes('\n')).toBe(false)
    expect(JSON.parse(line).message).toBe('boom')
  })

  test('цикл в объекте не роняет логгер поверх упавшего приложения', () => {
    /*
     * Худший исход из возможных: приложение упало, а логгер упал следом и
     * унёс с собой единственный след того, что произошло.
     */
    const cyclic: Record<string, unknown> = { message: 'boom' }
    cyclic.self = cyclic
    const log = formatServerError(new Error('boom'))
    ;(log as unknown as Record<string, unknown>).extra = cyclic
    const line = serverErrorLine(log)
    expect(() => JSON.parse(line)).not.toThrow()
    expect(JSON.parse(line).message).toBe('boom')
  })
})

describe('scrubText', () => {
  test('у адреса в тексте срезается строка запроса: там ключ Steam API и ?compat=', () => {
    const s = scrubText(
      'request to https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=SECRETKEY&steamid=76561198000000000 failed',
    )
    expect(s).toBe('request to https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/ failed')
    expect(scrubText('see https://imbored.cc/play?join=ABC123#top')).toBe('see https://imbored.cc/play')
    // у относительного адреса схемы нет — значения опасных параметров всё равно уходят
    expect(scrubText('шли с /play?join=ABC123&mood=chill&key=K')).toBe('шли с /play?join=…&mood=chill&key=…')
  })

  test('steamid и коды пати — под масками и в свободном тексте', () => {
    expect(scrubText('нет снимка для 76561198000000000')).toBe('нет снимка для :steamid')
    expect(scrubText('id76561198000000000,76561198000000001')).toBe('id:steamid,:steamid')
    expect(scrubText('GET /api/room/K7Q2PX/vote')).toBe('GET /api/room/:id/vote')
    // 18 цифр — не steamid, и число покороче тоже не трогаем
    expect(scrubText('123456789012345678 и 730')).toBe('123456789012345678 и 730')
  })
})

describe('logSwallowed', () => {
  let warn: MockInstance<typeof console.warn>
  beforeEach(() => {
    resetSwallowed()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())
  const lines = () => warn.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)

  /*
   * Ради этого всё и затевалось: отозванный ключ Steam и кончившаяся квота
   * Turso заканчивались одним и тем же ?error=steam, а в Runtime Logs было
   * пусто — onRequestError проглоченного не видит.
   */
  test('одна строка JSON с местом, причиной и статусом', () => {
    expect(logSwallowed('auth/return:steam', new Error('Steam API /IPlayerService/GetOwnedGames/v1/: HTTP 403'))).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0][0])
    expect(line.includes('\n')).toBe(false)
    expect(JSON.parse(line)).toEqual({
      event: 'swallowed',
      where: 'auth/return:steam',
      name: 'Error',
      message: 'Steam API /IPlayerService/GetOwnedGames/v1/: HTTP 403',
      status: 403,
    })
  })

  test('код базы и причина под обёрткой fetch доезжают — по ним сеть отличают от базы', () => {
    const db = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })
    logSwallowed('ratelimit:check', db, { bucket: 'connect' })
    const net = new TypeError('fetch failed', {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.steampowered.com'), { code: 'ENOTFOUND' }),
    })
    logSwallowed('connect:steam', net)
    const [a, b] = lines()
    expect(a).toMatchObject({ where: 'ratelimit:check', code: 'SQLITE_BUSY', bucket: 'connect' })
    expect(b).toMatchObject({
      where: 'connect:steam',
      message: 'fetch failed',
      code: 'ENOTFOUND',
      cause: 'Error: getaddrinfo ENOTFOUND api.steampowered.com',
    })
  })

  test('статус берётся и из поля ошибки', () => {
    logSwallowed('pagejob:pros-cons', Object.assign(new Error('нет денег'), { status: 402 }))
    expect(lines()[0].status).toBe(402)
  })

  test('без стека, без steamid, без строки запроса, сообщение не длиннее 200', () => {
    const err = new Error(
      `upsert 76561198000000000 failed at https://x.turso.io/v2/pipeline?authToken=SECRET ${'x'.repeat(400)}`,
    )
    logSwallowed('auth/return:db', err, { note: 'шли с /compat/76561198000000001?join=ABC123' })
    const line = String(warn.mock.calls[0][0])
    expect(line).not.toContain('76561198000000000')
    expect(line).not.toContain('76561198000000001')
    expect(line).not.toContain('SECRET')
    expect(line).not.toContain('ABC123')
    expect(line).not.toContain('"stack"')
    expect((lines()[0].message as string).length).toBeLessThanOrEqual(200)
  })

  test('доп. поля не перетирают событие и место', () => {
    logSwallowed('news:feed', new Error('b'), { event: 'подделка', where: 'чужое', appid: 730 })
    expect(lines()[0]).toMatchObject({ event: 'swallowed', where: 'news:feed', appid: 730 })
  })

  /*
   * Лежащий Steam — это один и тот же сбой от каждого посетителя. Лог на
   * Hobby не резиновый, а тысяча одинаковых строк не читается.
   */
  test('одно место — не чаще раза в минуту, а промолчавшие считаются', () => {
    const t0 = 1_000_000
    expect(logSwallowed('sessions:lookup', new Error('a'), undefined, t0)).toBe(true)
    expect(logSwallowed('sessions:lookup', new Error('b'), undefined, t0 + 1000)).toBe(false)
    expect(logSwallowed('sessions:lookup', new Error('c'), undefined, t0 + 59_000)).toBe(false)
    // другое место прореживается отдельно
    expect(logSwallowed('deals:refresh', new Error('d'), undefined, t0 + 2000)).toBe(true)
    expect(logSwallowed('sessions:lookup', new Error('e'), undefined, t0 + SWALLOW_WINDOW_MS)).toBe(true)
    expect(lines().map((l) => [l.where, l.message, l.repeats])).toEqual([
      ['sessions:lookup', 'a', undefined],
      ['deals:refresh', 'd', undefined],
      ['sessions:lookup', 'e', 2],
    ])
  })

  test('логгер внутри catch не бросает никогда', () => {
    /*
     * Исключение отсюда превратило бы аккуратный фолбэк в 500 — ровно то,
     * от чего catch и спасал.
     */
    warn.mockImplementation(() => {
      throw new Error('stderr закрыт')
    })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => logSwallowed('catalog:ensure-meta', cyclic)).not.toThrow()
    expect(() => logSwallowed('catalog:most-played', undefined)).not.toThrow()
    expect(formatSwallowed('x', cyclic).message).toBe('[object Object]')
  })
})

/**
 * Сторож мест.
 *
 * where — ключ прореживания. Два разных catch с одним и тем же where делили
 * бы одну минуту на двоих, и второй сбой молчал бы за первым; по строке лога
 * их было бы и не различить. Плюс места, где сбой раньше глотался молча:
 * если catch там снова станет немым, сторож это заметит.
 */
describe('места logSwallowed', () => {
  const ROOT = path.join(__dirname, '..')
  const calls: Array<{ file: string; where: string }> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && rel !== 'lib/errlog.ts') {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        for (const m of src.matchAll(/logSwallowed\(\s*['`]([^'`]+)['`]/g)) {
          calls.push({ file: rel, where: m[1] })
        }
      }
    }
  }
  for (const dir of ['app', 'lib', 'components']) walk(dir)

  test('у каждого места своё имя', () => {
    expect(calls.length, 'вызовы logSwallowed не найдены — сторож ослеп').toBeGreaterThan(10)
    const seen = new Map<string, string>()
    const dup: string[] = []
    for (const c of calls) {
      const prev = seen.get(c.where)
      if (prev) dup.push(`${c.where}: ${prev} и ${c.file}`)
      seen.set(c.where, c.file)
    }
    expect(dup, 'одно where на два места — они делят прореживание и неразличимы в логе').toEqual([])
    for (const c of calls) expect(c.where, c.file).toMatch(/^[a-z/-]+:[a-z${}-]+$/)
  })

  test('сбои Steam и базы, которые раньше глотались молча, оставляют строку', () => {
    const files = new Set(calls.map((c) => c.file))
    for (const f of [
      'app/api/auth/steam/return/route.ts',
      'app/api/connect/route.ts',
      'app/api/prepare/route.ts',
      'lib/catalog.ts',
      'lib/deals.ts',
      'lib/news.ts',
      'lib/pagejob.ts',
      'lib/ratelimit.ts',
      'lib/sessions.ts',
    ]) {
      expect(files.has(f), f).toBe(true)
    }
  })
})
