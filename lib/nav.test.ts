import { describe, expect, test } from 'vitest'
import { NO_ARRIVAL, parseArrival, safeNext } from './nav'

test('пропускает внутренние пути из белого списка', () => {
  expect(safeNext('/play')).toBe('/play')
  expect(safeNext('/daily')).toBe('/daily')
  expect(safeNext('/game/570')).toBe('/game/570')
  expect(safeNext('/room/ABC123')).toBe('/room/ABC123')
})

test('сохраняет строку запроса — в ней и лежит настроение', () => {
  const next = '/play?time=medium&vibe=chill&social=solo'
  expect(safeNext(next)).toBe(next)
})

test('режет протокол-относительные адреса', () => {
  expect(safeNext('//evil.com')).toBeNull()
  expect(safeNext('//evil.com/play')).toBeNull()
})

test('режет вариант с бэкслэшем, который браузер нормализует в слэш', () => {
  expect(safeNext('/\evil.com')).toBeNull()
  expect(safeNext('/play\@evil.com')).toBeNull()
})

test('режет абсолютные адреса', () => {
  expect(safeNext('https://evil.com')).toBeNull()
  expect(safeNext('http://imbored.cc/play')).toBeNull()
  expect(safeNext('javascript:alert(1)')).toBeNull()
})

test('режет управляющие символы — это расщепление заголовка, а не мусор', () => {
  expect(safeNext('/play\r\nLocation: https://evil.com')).toBeNull()
  expect(safeNext('/play\n')).toBeNull()
  expect(safeNext('/play ')).toBeNull()
})

test('не пускает в /api ни при каких условиях', () => {
  expect(safeNext('/api/auth/logout')).toBeNull()
  expect(safeNext('/api/cron/news')).toBeNull()
})

test('префикс не открывает всё, что с него начинается', () => {
  expect(safeNext('/playground')).toBeNull()
  expect(safeNext('/library-of-congress')).toBeNull()
})

test('путь из белого списка со своим сегментом проходит', () => {
  expect(safeNext('/portrait/76561198000000000')).toBe('/portrait/76561198000000000')
  expect(safeNext('/compat/76561198000000000')).toBe('/compat/76561198000000000')
})

test('пустое, слишком длинное и не-строка отбрасываются', () => {
  expect(safeNext('')).toBeNull()
  expect(safeNext(null)).toBeNull()
  expect(safeNext(undefined)).toBeNull()
  expect(safeNext(`/play?x=${'a'.repeat(600)}`)).toBeNull()
})

test('корень не проходит: возвращать на лендинг — это и есть поведение по умолчанию', () => {
  expect(safeNext('/')).toBeNull()
})

describe('parseArrival', () => {
  test('пустая строка — человек пришёл сам', () => {
    expect(parseArrival('')).toEqual(NO_ARRIVAL)
  })

  test('код пати приводится к верхнему регистру', () => {
    expect(parseArrival('?join=ab12cd').join).toBe('AB12CD')
  })

  test('код пати не той формы отбрасывается целиком', () => {
    // Значение уходит в путь /room/<code>, и «почти код» тут хуже, чем ничего.
    for (const bad of ['abc', 'abcdefg', '../../etc', 'ab-12c']) {
      expect(parseArrival(`?join=${bad}`).join).toBeNull()
    }
  })

  test('steamid — ровно семнадцать цифр', () => {
    expect(parseArrival('?compat=76561198000000000').compat).toBe('76561198000000000')
    expect(parseArrival('?compat=7656119800000000').compat).toBeNull()
    expect(parseArrival('?compat=765611980000000000').compat).toBeNull()
    expect(parseArrival('?compat=7656119800000000a').compat).toBeNull()
  })

  test('next проходит через тот же белый список, что и редирект', () => {
    expect(parseArrival('?next=/play%3Ftime%3Dshort').next).toBe('/play?time=short')
    expect(parseArrival('?next=//evil.com').next).toBeNull()
    expect(parseArrival('?next=/api/connect').next).toBeNull()
  })

  test('код ошибки едет как есть — словарь живёт на странице', () => {
    expect(parseArrival('?error=nolibrary').error).toBe('nolibrary')
    expect(parseArrival('?error=' + 'x'.repeat(50)).error).toHaveLength(50)
  })

  test('принимает и готовый URLSearchParams', () => {
    expect(parseArrival(new URLSearchParams({ join: 'AB12CD' })).join).toBe('AB12CD')
  })

  test('всё сразу разбирается независимо друг от друга', () => {
    expect(parseArrival('?join=AB12CD&compat=76561198000000000&next=/daily&error=busy')).toEqual({
      join: 'AB12CD',
      compat: '76561198000000000',
      next: '/daily',
      error: 'busy',
    })
  })
})
