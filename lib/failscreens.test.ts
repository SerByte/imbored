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
