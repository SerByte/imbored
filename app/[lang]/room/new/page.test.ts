import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * /room/new: место под строку «Первой картой — …» — с кадра, где игра
 * известна, а не с ответа сервера.
 *
 * Колонка выбора настроения стоит по центру экрана, и всё, что рождается в
 * ней позже, двигает плитки. Имя игры приходит ответом /api/room/seed — через
 * сетевой круг, когда человек уже целится в настроение: абзац, родившийся
 * вместе с ответом, поднимал заголовок и опускал плитки на пол-строки, и тап
 * приходился на соседнюю. Теперь абзац стоит от ?game= высотой в две строки,
 * а ответ только наполняет его текстом.
 *
 * Страница клиентская, и экран с игрой без браузера не отрисовать: на
 * сервере useSearch видит пустой адрес (components/useSearch), то есть игры
 * нет вовсе. Поэтому разметка читается как текст — как в
 * lib/focushandoff.test.ts, который сторожит этот же файл.
 */

/** Комментарии гасятся пробелами: докблок страницы цитирует саму строку */
const strip = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre: string, c: string) => pre + ' '.repeat(c.length))

const page = strip(fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8'))

describe('/room/new: строка про игру не двигает плитки', () => {
  const line = page.indexOf('Первой картой')
  const open = page.lastIndexOf('<p ', line)
  const p = page.slice(open, page.indexOf('>', open) + 1)

  test('абзац стоит от игры из адреса, а имя наполняет его изнутри', () => {
    expect(line, 'строка не найдена — сторож ослеп').toBeGreaterThan(-1)
    // Условие над абзацем — игра из адреса, а не ответ сервера: родись он от
    // seedName, вместе с ответом приехал бы и сдвиг
    expect(page.slice(0, open)).toMatch(/\{game !== null && \(\s*$/)
    expect(page.slice(open, line)).toMatch(/\{seedName && \(/)
  })

  test('высота — две строки своего кегля, пока имени ещё нет', () => {
    // 3.25em = 2 × 1.625 (leading-relaxed): em считается от text-sm самого
    // абзаца, и смени кто-нибудь интерлиньяж — запас разойдётся со строкой
    expect(p).toMatch(/\bmin-h-\[3\.25em\]/)
    expect(p).toMatch(/\btext-sm\b/)
    expect(p).toMatch(/\bleading-relaxed\b/)
  })
})
