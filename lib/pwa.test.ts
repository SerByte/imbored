import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import manifest from '../app/manifest'
import { GET as manifestEn } from '../app/manifest.en.webmanifest/route'
import { LOCALIZED_SECTIONS, type Locale } from './i18n'
import { manifestFor, manifestHref } from './manifest'
import { SITE_DESCRIPTION, SITE_TITLE, siteDescription, siteTitle } from './site'
import { THEME_COLOR } from './themecolor'

// Корневой layout — ради его generateMetadata: шрифты next/font без
// компилятора Next не грузятся, а классы шрифтов метаданным не нужны
vi.mock('next/font/google', () => ({
  Manrope: () => ({ variable: 'font-manrope' }),
  JetBrains_Mono: () => ({ variable: 'font-jbmono' }),
}))

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
    const layout = fs.readFileSync(path.join(ROOT, 'app', '[lang]', 'layout.tsx'), 'utf8')
    // Корень берёт их на языке страницы, и русские — те же константы
    expect(layout, 'корень должен брать описание из lib/site.ts').toMatch(/description:\s*siteDescription\(locale\)/)
    expect(layout, 'и имя тоже').toMatch(/default:\s*siteTitle\(locale\)/)
    expect(siteDescription('ru')).toBe(SITE_DESCRIPTION)
    expect(siteTitle('ru')).toBe(SITE_TITLE)
  })

  /**
   * Цвет обвязки не спрашивает тему ОС, пока её не спрашивает сам сайт.
   *
   * Стояли две строки по prefers-color-scheme, а тема сайта живёт в
   * localStorage: у светлой ОС молочная адресная строка висела над чёрной
   * страницей. Теперь в разметке одно значение, то же, что у манифеста, а
   * дальше его ведут ChromeZone и ThemeToggle (lib/themecolor).
   */
  test('theme-color — одно значение без media, как у манифеста', () => {
    expect(m.theme_color).toBe(THEME_COLOR)
    const layout = fs.readFileSync(path.join(ROOT, 'app', '[lang]', 'layout.tsx'), 'utf8')
    const at = layout.indexOf('export const viewport')
    expect(at, 'viewport в корне не найден').toBeGreaterThan(-1)
    const viewport = layout.slice(at, layout.indexOf('\n}\n', at))
    expect(viewport).toMatch(/themeColor:\s*THEME_COLOR\b/)
    expect(viewport, 'тема сайта не зависит от темы ОС').not.toContain('prefers-color-scheme')
  })

  test('у приложения есть id — смена start_url не создаст второе', () => {
    expect(m.id).toBe('/')
  })

  test('ярлыки ведут на существующие страницы', () => {
    expect(m.shortcuts?.map((s) => s.url)).toEqual(['/quiz', '/daily', '/rooms'])
    for (const s of m.shortcuts ?? []) {
      const page = path.join(ROOT, 'app', '[lang]', ...s.url.split('/').filter(Boolean), 'page.tsx')
      expect(fs.existsSync(page), `${s.url}: нет ${path.relative(ROOT, page)}`).toBe(true)
    }
  })
})

/**
 * Требования Chrome к снимкам для окна установки: стороны от 320 до 3840,
 * длинная не больше чем в 2,3 раза длиннее короткой, sizes совпадает с
 * файлом. Нарушение не роняет ничего — снимок просто молча не показывается.
 * У каждого языка снимки свои, и проходить обязан каждый набор.
 */
describe.each(['ru', 'en'] as const)('снимки манифеста (%s)', (locale: Locale) => {
  const m = manifestFor(locale)

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
 * Английский манифест. Один манифест на оба языка ставил с /en приложение с
 * русским именем и описанием, а долгое нажатие на иконку вело в русский сайт.
 */
describe('английский манифест', () => {
  const en = manifestFor('en')
  const CYR = /[А-Яа-яЁё]/

  test('ни буквы по-русски; имя и описание — те же, что у английского корня', () => {
    expect(JSON.stringify(en)).not.toMatch(CYR)
    expect(en.name).toBe(siteTitle('en'))
    expect(en.description).toBe(siteDescription('en'))
    expect(en.lang).toBe('en')
  })

  /*
   * Свой id: с общим браузер считал бы обе версии одним приложением и
   * переписывал бы его имя тем манифестом, который видел последним.
   */
  test('своё приложение: id и start_url — /en', () => {
    expect(en.id).toBe('/en')
    expect(en.start_url).toBe('/en')
    expect(en.id).not.toBe(manifest().id)
  })

  test('ярлыки — в английские страницы, имена — как в английской навигации', () => {
    expect(en.shortcuts?.map((s) => s.url)).toEqual(['/en/quiz', '/en/daily', '/en/rooms'])
    expect(en.shortcuts?.map((s) => s.name)).toEqual(['Find a game', 'Game of the day', 'Party'])
    const nav = fs.readFileSync(path.join(ROOT, 'components', 'HeaderNav.tsx'), 'utf8')
    for (const s of en.shortcuts ?? []) expect(nav, s.name).toContain(`en: '${s.name}'`)
    const bar = fs.readFileSync(path.join(ROOT, 'components', 'MobileNav.tsx'), 'utf8')
    for (const s of en.shortcuts ?? []) if (s.short_name) expect(bar, s.short_name).toContain(`en: '${s.short_name}'`)
  })

  test('снимки — свои, английской главной, а не русские', () => {
    const ru = new Set((manifest().screenshots ?? []).map((s) => s.src))
    for (const s of en.screenshots ?? []) expect(ru.has(s.src), s.src).toBe(false)
  })

  /*
   * Ответ — как у файлового app/manifest.ts: тот же JSON и тот же тип. Адрес
   * — в корне, вне разделов: правило beforeFiles его не трогает
   * (lib/i18nroutes.test.ts сам видит каталоги маршрутов корня).
   */
  test('/manifest.en.webmanifest отдаёт его как манифест', async () => {
    const res = manifestEn()
    expect(res.headers.get('content-type')).toBe('application/manifest+json')
    expect(await res.text()).toBe(JSON.stringify(en))
    expect(manifestHref('en')).toBe('/manifest.en.webmanifest')
    expect(fs.existsSync(path.join(ROOT, 'app', manifestHref('en').slice(1), 'route.ts'))).toBe(true)
    expect(LOCALIZED_SECTIONS as readonly string[]).not.toContain(manifestHref('en').slice(1))
  })
})

/**
 * Голова корневого layout на /en: манифест своего языка и подпись корневой
 * карточки превью (docs/i18n.md, п. 10). Русская голова — как была: ни
 * манифеста в метаданных (его ставит файловый app/manifest.ts), ни своих
 * images (карточку и её alt ставит файл).
 */
describe('корневые метаданные', () => {
  const meta = async (lang: Locale) => {
    const { generateMetadata } = await import('../app/[lang]/layout')
    return generateMetadata({ params: Promise.resolve({ lang }), children: null })
  }

  test('на /en — английский манифест и английская подпись карточки', async () => {
    const { size, contentType } = await import('../app/[lang]/opengraph-image')
    const m = await meta('en')
    expect(m.manifest).toBe('/manifest.en.webmanifest')
    expect(m.openGraph?.images).toEqual([
      { url: '/en/opengraph-image', width: size.width, height: size.height, type: contentType, alt: siteTitle('en') },
    ])
    // twitter:image Next дозаполняет из openGraph сам — своего тут не нужно
    expect(m.twitter).not.toHaveProperty('images')
  })

  test('на русском — ни манифеста, ни images: их ставят файлы', async () => {
    const { alt } = await import('../app/[lang]/opengraph-image')
    expect(alt).toBe(SITE_TITLE)
    const m = await meta('ru')
    expect(m).not.toHaveProperty('manifest')
    expect(m.openGraph).not.toHaveProperty('images')
    expect(m.twitter).not.toHaveProperty('images')
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
