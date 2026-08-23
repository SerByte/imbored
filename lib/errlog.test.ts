import { describe, expect, test } from 'vitest'
import { formatServerError, serverErrorLine } from './errlog'

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
  test('строка запроса в лог не попадает', () => {
    const log = formatServerError(new Error('boom'), {
      ...REQ,
      path: '/compat/76561198000000000?next=%2Fplay&join=ABC123',
    })
    expect(log.path).toBe('/compat/76561198000000000')
    expect(JSON.stringify(log)).not.toContain('ABC123')
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
