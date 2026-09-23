import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import manifest from '../app/manifest'
import { SITE_DESCRIPTION, SITE_TITLE } from './site'

/**
 * Сторож установки на домашний экран.
 *
 * Манифест читает не человек, а браузер, и ошибки в нём молчат: снимок с
 * неверными размерами Chrome просто выбрасывает из окна установки, ярлык на
 * несуществующий адрес открывает 404, а устаревшее описание висит в «О
 * приложении» годами — ровно так и было со старым слоганом.
 */

const ROOT = path.join(__dirname, '..')

/** Размеры JPEG из маркера SOFn — без библиотек, заголовок файла простой. */
function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error(`не JPEG-маркер на ${i}`)
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (sof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error('SOF не найден')
}

describe('манифест', () => {
  const m = manifest()

  test('имя и описание — те же, что у корня', () => {
    expect(m.description).toBe(SITE_DESCRIPTION)
    expect(m.name).toBe(SITE_TITLE)
    const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.tsx'), 'utf8')
    expect(layout, 'корень должен брать описание из lib/site.ts').toMatch(/description:\s*SITE_DESCRIPTION\b/)
    expect(layout, 'и имя тоже').toMatch(/default:\s*SITE_TITLE\b/)
  })

  test('у приложения есть id — смена start_url не создаст второе', () => {
    expect(m.id).toBe('/')
  })

  test('ярлыки ведут на существующие страницы', () => {
    expect(m.shortcuts?.map((s) => s.url)).toEqual(['/quiz', '/daily', '/rooms'])
    for (const s of m.shortcuts ?? []) {
      const page = path.join(ROOT, 'app', ...s.url.split('/').filter(Boolean), 'page.tsx')
      expect(fs.existsSync(page), `${s.url}: нет ${path.relative(ROOT, page)}`).toBe(true)
    }
  })

  /**
   * Требования Chrome к снимкам для окна установки: стороны от 320 до 3840,
   * длинная не больше чем в 2,3 раза длиннее короткой, sizes совпадает с
   * файлом. Нарушение не роняет ничего — снимок просто молча не показывается.
   */
  test('снимки есть в обеих раскладках и проходят требования Chrome', () => {
    const shots = m.screenshots ?? []
    expect(shots.map((s) => s.form_factor).sort()).toEqual(['narrow', 'wide'])
    for (const s of shots) {
      const file = path.join(ROOT, 'public', ...s.src.split('/').filter(Boolean))
      expect(fs.existsSync(file), `${s.src}: файла нет в public/`).toBe(true)
      const { width, height } = jpegSize(fs.readFileSync(file))
      expect(s.sizes, s.src).toBe(`${width}x${height}`)
      expect(s.type).toBe('image/jpeg')
      expect(Math.min(width, height), s.src).toBeGreaterThanOrEqual(320)
      expect(Math.max(width, height), s.src).toBeLessThanOrEqual(3840)
      expect(Math.max(width, height) / Math.min(width, height), s.src).toBeLessThanOrEqual(2.3)
      expect(s.form_factor === 'narrow' ? height > width : width > height, `${s.src}: раскладка`).toBe(true)
      expect(s.label, `${s.src}: подпись читает скринридер в окне установки`).toBeTruthy()
    }
  })
})

/**
 * /favicon.ico браузеры, читалки и боты запрашивают сами, без <link rel=icon>.
 * Без файла этот адрес отдавал 404 — страницу not-found с полкой игр, 46 КБ
 * HTML на каждый такой запрос.
 */
describe('favicon.ico', () => {
  const ico = fs.readFileSync(path.join(ROOT, 'app', 'favicon.ico'))

  test('настоящий ICO с кадрами 32 и 48 — пересобрать: npx tsx scripts/favicon.ts', () => {
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2), 'тип 1 — иконка').toBe(1)
    const count = ico.readUInt16LE(4)
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256)
    expect(sizes).toEqual([32, 48])
    for (let i = 0; i < count; i++) {
      const len = ico.readUInt32LE(6 + i * 16 + 8)
      const at = ico.readUInt32LE(6 + i * 16 + 12)
      expect(at + len, 'кадр выходит за файл').toBeLessThanOrEqual(ico.length)
      expect(ico.subarray(at, at + 4).toString('latin1'), 'кадр — PNG').toBe('\x89PNG')
    }
  })
})
