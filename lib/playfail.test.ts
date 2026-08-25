import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож причин отказа подбора.
 *
 * /api/recommend отвечает четырьмя разными кодами: `nosession`, `badmood`,
 * `nolibrary`, `nocandidates`. Экран /play до правки различал ровно ОДИН
 * случай — потолок частоты, — а всё остальное сводил к `!res.ok` и показывал
 * одну строку на всех:
 *
 *     «Возможно, каталог ещё прогревается — попробуй ещё раз через минуту».
 *
 * Замерено сквозным прогоном с принудительно включённой веткой: при
 * `nocandidates` человек получал именно её, и кнопка «Попробовать снова» под
 * ней возвращала тот же 409 сколько угодно раз. Каталог при этом был в полном
 * порядке, а починка — совсем другая: сменить настроение или вернуть игры из
 * бана.
 *
 * Сторож нужен потому, что пятый код добавить легко, а забыть про экран —
 * ещё легче: TypeScript тут не поможет, коды живут строками в ответе.
 *
 * `nosession` разбирается не текстом, а переходом на вход: объяснять человеку
 * нечего, ему нужна кнопка «войти». Поэтому он в списке разобранных отдельно.
 */

const ROOT = path.join(__dirname, '..')
const API = fs.readFileSync(path.join(ROOT, 'app', 'api', 'recommend', 'route.ts'), 'utf8')
const PLAY = fs.readFileSync(path.join(ROOT, 'app', 'play', 'page.tsx'), 'utf8')

/** Коды, у которых ответ — действие, а не текст на экране отказа. */
const HANDLED_ELSEWHERE = new Set(['nosession'])

describe('причины отказа подбора', () => {
  test('у каждого кода API есть свой разбор на экране', () => {
    const codes = new Set([...API.matchAll(/error: '([a-z]+)'/g)].map((m) => m[1]))
    expect(codes.size, 'коды отказа в /api/recommend не найдены — сторож ослеп').toBeGreaterThan(2)

    const missing = [...codes].filter(
      (c) => !HANDLED_ELSEWHERE.has(c) && !PLAY.includes(`  ${c}: {`),
    )
    expect(
      missing,
      'код есть в API, а разбора на экране нет: человек получит чужой совет — ' +
        'скорее всего «каталог прогревается», который ему ничем не поможет',
    ).toEqual([])
  })

  test('код отказа читается из тела ответа, а не выводится из статуса', () => {
    expect(
      PLAY,
      'под 409 живут два разных отказа — nolibrary и nocandidates; по статусу их не различить',
    ).toMatch(/typeof d\.error === 'string'/)
  })

  /**
   * Обратная половина сделки: кнопка повтора обязана оставаться там, где повтор
   * может помочь. Без этого сторож выше зелёный и на экране, где предлагают
   * бесконечно повторять запрос с гарантированно тем же ответом.
   */
  test('повтор не предлагается там, где он вернёт тот же ответ', () => {
    for (const code of ['nocandidates', 'nolibrary', 'badmood']) {
      const at = PLAY.indexOf(`  ${code}: {`)
      expect(at, `нет разбора для ${code}`).toBeGreaterThan(-1)
      const block = PLAY.slice(at, PLAY.indexOf('},', at))
      expect(block, `${code}: повтор вернёт тот же отказ, предлагать его нельзя`).toContain(
        'retry: false',
      )
    }
  })
})
