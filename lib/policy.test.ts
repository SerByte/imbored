import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож даты политики.
 *
 * На странице конфиденциальности стоит строка «Обновлено …». Она полезна ровно
 * до первой правки текста без правки числа: после этого дата не сообщает
 * ничего, а врёт — причём в документе, весь смысл которого в том, что ему
 * можно верить.
 *
 * Забыть тут легко и естественно: правят один абзац, дата стоит на семьдесят
 * строк выше и в поле зрения не попадает.
 *
 * Поэтому тест снимает отпечаток с ПРОЗЫ страницы — с того, что человек
 * читает глазами, — и сравнивает с записанным ниже. Классы оформления,
 * перестановка разметки и комментарии в отпечаток не входят: переверстать
 * страницу можно свободно, а переписать текст — только вместе с датой.
 *
 * Когда прогон упал: правка текста была намеренной — обнови UPDATED в
 * app/privacy/page.tsx и подставь сюда новый отпечаток из сообщения об ошибке.
 */

const PAGE = path.join(__dirname, '..', 'app', 'privacy', 'page.tsx')

/** Отпечаток прозы, действительный для даты ниже. */
const DIGEST = 'e572ec9690593227'

/** Та же дата, что и в UPDATED на странице. Дублируется, чтобы тест видел смену. */
const UPDATED = '12 августа 2026'

/**
 * Видимый текст страницы: строки-ответы, заголовки разделов и текстовые узлы
 * JSX. Комментарии вырезаются первыми — иначе отпечаток ловил бы объяснение
 * правки вместо самой правки.
 */
function prose(src: string): string {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*\/\/[^\n]*$/gm, '')
  const chunks: string[] = []
  for (const m of code.matchAll(/\b(?:title|answer)=["']([^"']+)["']/g)) chunks.push(m[1])
  for (const m of code.matchAll(/>([^<>{}]*[А-Яа-яЁё][^<>{}]*)[<{]/g)) chunks.push(m[1])
  for (const m of code.matchAll(/^\s*'([^']*[А-Яа-яЁё][^']*)',?\s*$/gm)) chunks.push(m[1])
  return chunks
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

describe('политика конфиденциальности', () => {
  const src = fs.readFileSync(PAGE, 'utf8')

  test('на странице стоит дата обновления', () => {
    expect(src).toContain(`const UPDATED = '${UPDATED}'`)
    expect(src).toContain('Обновлено {UPDATED}')
  })

  test('текст политики не менялся в обход даты', () => {
    const text = prose(src)
    expect(text.length, 'проза не извлеклась — проверь prose()').toBeGreaterThan(1500)
    const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
    expect(
      digest,
      `текст политики изменился. Если правка намеренная — обнови UPDATED в app/privacy/page.tsx и подставь сюда ${digest}`,
    ).toBe(DIGEST)
  })
})
