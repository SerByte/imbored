import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож экранов отказа.
 *
 * Дважды в проекте повторилась одна и та же ошибка: API отвечает НЕСКОЛЬКИМИ
 * разными кодами, а страница сводит их все к одной строке.
 *
 * /play отвечал «Возможно, каталог ещё прогревается — попробуй ещё раз через
 * минуту» на четыре разных отказа. При `nocandidates` каталог был в полном
 * порядке, а кнопка «Попробовать снова» возвращала тот же 409 сколько угодно
 * раз — замерено сквозным прогоном.
 *
 * /daily отвечал «Не получилось выбрать игру дня» на три разных отказа и
 * предлагал «Обычный подбор». При `nolibrary` этот совет — тупик: обычный
 * подбор упрётся ровно в ту же причину. Тоже замерено.
 *
 * Общее у обоих случаев: под 409 живут ДВА разных отказа — «нет снимка
 * библиотеки» и «кандидатов не осталось». По статусу их не различить, только
 * по телу ответа. Поэтому третий тест проверяет именно чтение из тела.
 *
 * `nosession` разбирается не текстом, а переходом на вход: объяснять человеку
 * нечего, ему нужна кнопка «войти».
 */

const ROOT = path.join(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

/** Пары «маршрут API — экран, который показывает его отказы». */
const PAIRS = [
  { имя: '/play', api: ['app', 'api', 'recommend', 'route.ts'], page: ['app', 'play', 'page.tsx'] },
  { имя: '/daily', api: ['app', 'api', 'daily', 'route.ts'], page: ['app', 'daily', 'page.tsx'] },
  { имя: '/explore', api: ['app', 'api', 'explore', 'route.ts'], page: ['app', 'explore', 'page.tsx'] },
]

/** Коды, у которых ответ — действие, а не текст на экране отказа. */
const HANDLED_ELSEWHERE = new Set(['nosession'])

describe('экраны отказа', () => {
  for (const пара of PAIRS) {
    test(`${пара.имя}: у каждого кода API есть свой разбор`, () => {
      const api = read(...пара.api)
      const page = read(...пара.page)
      const codes = new Set([...api.matchAll(/error: '([a-z]+)'/g)].map((m) => m[1]))
      expect(codes.size, `коды отказа в ${пара.имя} не найдены — сторож ослеп`).toBeGreaterThan(1)

      const missing = [...codes].filter(
        (c) => !HANDLED_ELSEWHERE.has(c) && !page.includes(`  ${c}: {`),
      )
      expect(
        missing,
        'код есть в API, а разбора на экране нет: человек получит чужой совет, ' +
          'и почти наверняка совет в тупик',
      ).toEqual([])
    })

    test(`${пара.имя}: код читается из тела ответа, а не из статуса`, () => {
      expect(
        read(...пара.page),
        'под 409 живут два разных отказа — nolibrary и nocandidates; по статусу их не различить',
      ).toMatch(/typeof d\.error === 'string'/)
    })
  }

  /**
   * Обратная половина сделки, и только для /play: там есть кнопка повтора, и
   * она обязана отсутствовать там, где повтор гарантированно вернёт тот же
   * ответ. У /daily повтора нет вовсе — проверять нечего.
   */
  test('/play: повтор не предлагается там, где он вернёт тот же ответ', () => {
    const page = read('app', 'play', 'page.tsx')
    for (const code of ['nocandidates', 'nolibrary', 'badmood']) {
      const at = page.indexOf(`  ${code}: {`)
      expect(at, `нет разбора для ${code}`).toBeGreaterThan(-1)
      const block = page.slice(at, page.indexOf('},', at))
      expect(block, `${code}: повтор вернёт тот же отказ, предлагать его нельзя`).toContain(
        'retry: false',
      )
    }
  })
})

/**
 * needsteam — отказ не одного роута, а всех пишущих: сессия по вставленной
 * ссылке только читает (requireWriter в lib/server). Страница, которая зовёт
 * такой роут и сводит 403 к общему «не получилось — нажми ещё раз», совершает
 * ту же ошибку, что описана в шапке файла, только хуже: повтор здесь не
 * поможет никогда, а помочь может вход через Steam.
 *
 * Список пишущих роутов не выписан руками, а собран из кода: роут, который
 * зовёт requireWriter, — пишущий. Новый такой роут без разбора на странице
 * уронит этот тест сам.
 */
describe('needsteam', () => {
  const walk = (dir: string, keep: (f: string) => boolean): string[] =>
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) return walk(rel, keep)
      return keep(rel) ? [rel] : []
    })

  /** app/api/room/[id]/public/route.ts → регэксп вызова fetch(`/api/room/${…}/public`) */
  const callOf = (route: string) => {
    const url = route
      .replace(/^app/, '')
      .replace(/\/route\.ts$/, '')
      .split('/')
      // динамический сегмент в клиенте — подстановка в шаблонной строке
      .map((seg) => (/^\[.+\]$/.test(seg) ? '\\$\\{[^}]+\\}' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')
    return new RegExp(`fetch\\(\\s*['"\`]${url}['"\`?]`)
  }

  const writers = walk('app/api', (f) => f.endsWith('/route.ts')).filter((f) =>
    read(f).includes('requireWriter()'),
  )
  const pages = [
    ...walk('app', (f) => /\.tsx?$/.test(f) && !f.startsWith('app/api/') && !f.includes('.test.')),
    ...walk('components', (f) => /\.tsx?$/.test(f)),
  ]

  test('пишущие роуты найдены — иначе сторож ослеп', () => {
    expect(writers).toEqual(
      expect.arrayContaining([
        'app/api/feedback/route.ts',
        'app/api/room/[id]/public/route.ts',
        'app/api/room/create/route.ts',
        'app/api/unban/route.ts',
      ]),
    )
  })

  for (const route of writers) {
    test(`${route}: у каждого, кто его зовёт, есть разбор needsteam`, () => {
      const callers = pages.filter((f) => callOf(route).test(read(f)))
      expect(callers.length, `вызовов ${route} на страницах не найдено — сторож ослеп`).toBeGreaterThan(0)
      const blind = callers.filter((f) => !read(f).includes('isNeedSteam('))
      expect(
        blind,
        'страница зовёт пишущий роут и не отличает «только чтение» от сбоя: ' +
          'человек получит «нажми ещё раз» там, где поможет только вход через Steam (lib/writer)',
      ).toEqual([])
    })
  }
})

