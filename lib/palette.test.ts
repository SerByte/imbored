import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { BG, DIM, EMBER, INK, LIGHT_BG, LIGHT_DIM, LIGHT_EMBER, LIGHT_INK, PLATE } from './palette'

/**
 * Сторож палитры, вынесенной из CSS.
 *
 * Два места в приложении не видят globals.css вообще: картинки next/og
 * (satori не исполняет CSS-переменные) и app/global-error.tsx (он заменяет
 * корневой layout и рендерится без глобальных стилей). Оба поэтому красятся
 * числами из lib/palette.ts.
 *
 * Числа-копии — это отложенное расхождение. Правка токена в globals.css молча
 * оставила бы карточку в мессенджере и экран аварии в ПРЕЖНЕМ цвете бренда, и
 * заметить это можно было бы только глазами и только случайно. Тест читает
 * настоящий CSS и сверяет.
 */

const CSS = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8')

/** Значение токена внутри конкретного селектора. */
function token(selector: string, name: string): string {
  const i = CSS.indexOf(selector)
  if (i < 0) throw new Error(`не найден блок ${selector}`)
  const body = CSS.slice(i, CSS.indexOf('\n}', i))
  const m = body.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'))
  if (!m) throw new Error(`нет токена ${name} в ${selector}`)
  return m[1].trim()
}

describe('палитра вне CSS', () => {
  test('тёмная тема совпадает с токенами globals.css', () => {
    expect(BG).toBe(token(':root {', '--bg'))
    expect(INK).toBe(token(':root {', '--ink'))
    expect(DIM).toBe(token(':root {', '--dim'))
    expect(EMBER).toBe(token(':root {', '--ember'))
  })

  test('светлая тема совпадает с токенами globals.css', () => {
    const light = ':root[data-theme="light"]'
    expect(LIGHT_BG).toBe(token(light, '--bg'))
    expect(LIGHT_INK).toBe(token(light, '--ink'))
    expect(LIGHT_DIM).toBe(token(light, '--dim'))
    expect(LIGHT_EMBER).toBe(token(light, '--ember'))
  })

  test('подложка знака совпадает с components/Logo.tsx', () => {
    const logo = fs.readFileSync(path.join(__dirname, '..', 'components', 'Logo.tsx'), 'utf8')
    expect(logo).toContain(PLATE)
  })

  /**
   * Отдельная проверка, что модуль остаётся импортируемым из браузера: стоит
   * кому-нибудь добавить сюда чтение файла или обращение к process, и сборка
   * клиентского бандла утащит за собой node:fs — ровно из-за этого числа и
   * уехали из lib/og.ts.
   */
  test('модуль палитры ничего не импортирует', () => {
    const src = fs.readFileSync(path.join(__dirname, 'palette.ts'), 'utf8')
    expect(src, 'палитру тянет клиентский global-error — импортов быть не должно').not.toMatch(
      /^\s*import\s/m,
    )
    expect(src).not.toMatch(/\bprocess\b|\brequire\(/)
  })

  test('аварийный экран существует и не тянет глобальные стили', () => {
    const p = path.join(__dirname, '..', 'app', 'global-error.tsx')
    expect(fs.existsSync(p), 'без него падение корневого layout показывает стоковый экран Next').toBe(
      true,
    )
    const src = fs.readFileSync(p, 'utf8')
    expect(src).toContain("'use client'")
    // свои <html> и <body> обязательны: файл заменяет корневой layout
    expect(src).toMatch(/<html/)
    expect(src).toMatch(/<body/)
    // Именно ИМПОРТ, а не упоминание: про то, что глобальные стили сюда
    // не доезжают, в самом файле написано словами, и запрещать строку целиком
    // значило бы запрещать объяснение вместе с ошибкой.
    expect(src, 'globals.css сюда не доезжает — импортировать его бессмысленно').not.toMatch(
      /import\s+['"][^'"]*globals\.css['"]/,
    )
    expect(src, 'retry перезапрашивает содержимое, reset — нет').toMatch(/retry/)
  })

  test('границы ошибок используют retry, а не reset', () => {
    for (const file of ['app/error.tsx', 'app/global-error.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      expect(code, `${file}: reset перерисовывает без повторного запроса`).not.toMatch(
        /\breset\b/,
      )
    }
  })
})
