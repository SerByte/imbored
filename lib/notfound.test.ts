import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import nextConfig from '../next.config'
import { garbageRewrites } from './i18nroutes'

/**
 * Экран 404 и то, кто его рисует.
 *
 * Адрес вне разделов (/xyz, /wp-login.php) обязан прийти с сервера целиком:
 * <html lang="ru">, стили, шапка, текст и полка — как до [lang]. Страница с
 * notFound() этого в этой версии Next не умеет: её HTML — пустая оболочка
 * <html id="__next_error__">, экран дорисовывает клиент (докблок
 * app/global-not-found.tsx). Сервером целиком Next рисует только /_not-found,
 * и мусор уводится туда.
 */

// Полка 404 читает базу через кэш Next; здесь база пуста, и полки нет —
// как у 404 на молчащей базе (shelf() в app/[lang]/not-found.tsx)
vi.mock('next/cache', () => ({ unstable_cache: <T>(fn: T) => fn }))
vi.mock('@/lib/server', () => ({ getDb: async () => ({}) }))
vi.mock('@/lib/db', () => ({ topCatalogGames: async () => [] }))
// next/root-params вне сборки бросает при импорте (lib/i18n-server.ts)
vi.mock('@/lib/i18n-server', () => ({ getLocale: async () => 'ru' }))

const { NotFoundView } = await import('@/app/[lang]/not-found')
const { LocaleProvider } = await import('@/components/LocaleProvider')

const ROOT = path.join(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
const CYR = /[А-Яа-яЁё]/

/** Под провайдером языка — как под корневым layout: Link и поиск берут язык из него */
async function view(locale: 'ru' | 'en'): Promise<string> {
  const el = (await NotFoundView({ locale })) as ReactElement
  return renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, el))
}

describe('мусорный адрес — в /_not-found, который рисует сервер', () => {
  test('правило уводит в /_not-found, а не на страницу с notFound()', () => {
    expect(garbageRewrites().map((r) => r.destination)).toEqual(['/_not-found'])
  })

  /*
   * Без флага /_not-found собирается из встроенного layout Next (<html> без
   * lang и стилей) и app/not-found.tsx, которого нет: голая стоковая 404.
   */
  test('/_not-found — это app/global-not-found.tsx', () => {
    expect(nextConfig.experimental?.globalNotFound).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'app', 'global-not-found.tsx'))).toBe(true)
  })

  /*
   * Не копия layout, а он сам: шапка, подвал, шрифты, скрипт темы и замок
   * от тёмных читалок — те же, что у любой страницы, и не разъедутся.
   * Внутри — та же обёртка перехода и тот же экран, что у границы not-found.
   */
  test('global-not-found — корневой layout на русском, обёртка перехода и экран 404', () => {
    const src = read('app', 'global-not-found.tsx')
    expect(src).toMatch(/from '\.\/\[lang\]\/layout'/)
    expect(src).toMatch(/<RootLayout params=\{Promise\.resolve\(\{ lang: 'ru' \}\)\}>/)
    expect(src).toMatch(/<Template>\s*<NotFoundView locale="ru" \/>\s*<\/Template>/)
    // Метаданные — корневые русские: title «imbored — во что поиграть», og, twitter
    expect(src).toMatch(/rootMetadata\(\{ params: Promise\.resolve\(\{ lang: 'ru' \}\)/)
    expect(src).toMatch(/viewport: Viewport = rootViewport/)
  })
})

describe('экран 404', () => {
  test('русский — те же слова, что до [lang]', async () => {
    const html = await view('ru')
    for (const s of [
      'Ошибка 404',
      'Такой страницы нет',
      'Ссылка битая или игру убрали из каталога. Бывает — зато есть, во что поиграть.',
      'Подобрать игру',
      'На главную',
    ]) {
      expect(html, s).toContain(s)
    }
    expect(html).toContain('href="/quiz"')
  })

  test('английский — без кириллицы и словами глоссария', async () => {
    const html = await view('en')
    expect(html).not.toMatch(CYR)
    // Глоссарий: «Такой страницы нет» — This page doesn’t exist; «На главную» — Back to home
    expect(html).toContain('>This page doesn’t exist</h1>')
    expect(html).toContain('Back to home')
    expect(html).toContain('Find a game')
    expect(html).toContain('Search games')
    expect(html).toContain('href="/en/quiz"')
  })
})

describe('страница без экрана', () => {
  /*
   * Граница not-found и global-not-found рисуют один и тот же NotFoundView —
   * у границы язык из сегмента, у /_not-found русский явно.
   */
  test('граница not-found отдаёт тот же экран на языке сегмента', async () => {
    const { default: NotFound } = await import('@/app/[lang]/not-found')
    const el = (await NotFound()) as ReactElement<{ locale: string }>
    expect(el.type).toBe(NotFoundView)
    expect(el.props.locale).toBe('ru')
  })
})
