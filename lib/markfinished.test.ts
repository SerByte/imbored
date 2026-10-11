import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { MarkFinished } from '../components/MarkFinished'

/**
 * «Уже прошёл» вне /play — в «Твоих вечерах» и на странице игры
 * (components/MarkFinished).
 *
 * Островок клиентский, DOM в тестах нет, поэтому две половины: разметка до
 * нажатия — настоящим рендером, а что уходит по нажатию — по исходнику, как
 * у сторожей зоны попадания и живых областей. Отметка — тот же бан, что у
 * героя /play: перепутай действие или причину — и пройденное ляжет на полку
 * «Скрытые» как изгнанное (BannedShelf).
 */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'components', 'MarkFinished.tsx'), 'utf8')
/** Код без комментариев: объяснение правки не должно попадать под проверку */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const html = (from: 'library' | 'game') =>
  renderToStaticMarkup(
    createElement(MarkFinished, {
      appid: 367520,
      name: 'Hollow Knight',
      from,
      onDenied: () => {},
      className: 'btn-glass',
    }),
  )

describe('«Уже прошёл» вне выдачи', () => {
  test('до нажатия — кнопка, чьё имя начинается с видимых слов и называет игру', () => {
    const out = html('library')
    expect(out).toMatch(
      /<button type="button" aria-disabled="false" title="[^"]*полке «Пройдено»" class="btn-glass">Уже прошёл<span class="sr-only"> «Hollow Knight»<\/span><\/button>/,
    )
    // disabled уронил бы фокус в body на время запроса (lib/disabledfocus.test.ts)
    expect(out).not.toMatch(/<button[^>]*\sdisabled[=\s>]/)
    // строка отказа стоит заранее, пустой (components/StatusLine)
    expect(out).toContain('<p role="status" class="sr-only"></p>')
  })

  test('отметка — бан с причиной done и снимком «откуда», без слота выдачи', () => {
    expect(CODE).toContain("fetch('/api/feedback'")
    expect(CODE).toContain("JSON.stringify({ appid, action: 'banned', reason: 'done', ctx: { source: from } })")
  })

  test('после отметки устройство забывает игру для /play — модулем по нажатию', () => {
    // статический импорт притащил бы разбор выдачи в первую загрузку /library и /game
    expect(CODE).not.toMatch(/^import[^\n]*(?:playcache|finishlocal|launchmemo)/m)
    expect(CODE).toMatch(/import\('@\/lib\/finishlocal'\)\.then\(\(m\) => m\.rememberFinished\(appid, Date\.now\(\)\)\)/)
  })

  test('needsteam — не «нажми ещё раз»: кнопку прячет тот, кто её поставил', () => {
    const denied = CODE.slice(CODE.indexOf('if (await isNeedSteam(res))'))
    expect(denied).toMatch(/^if \(await isNeedSteam\(res\)\) \{\s*next = 'idle'\s*onDenied\(\)/)
  })

  test('дальше — в духе этой игры: квиз с затравкой', () => {
    expect(CODE).toContain('href={quizHref(null, appid)}')
  })

  /*
   * /library упирается в бюджет веса первой загрузки (bundle-budget.json):
   * кнопка, нужная лишь у сыгранных всерьёз вечеров, едет туда отдельным
   * чанком. Статический импорт вернул бы её в первую загрузку молча — сборка
   * прошла бы, а превышение всплыло бы только в CI.
   */
  test('в «Твоих вечерах» — отдельным чанком, а не в первой загрузке /library', () => {
    const evenings = fs.readFileSync(path.join(__dirname, '..', 'components', 'Evenings.tsx'), 'utf8')
    expect(evenings).not.toMatch(/^import[^\n]*MarkFinished/m)
    expect(evenings).toMatch(/dynamic\(\(\) => import\('@\/components\/MarkFinished'\)/)
  })
})
