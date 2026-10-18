import fs from 'node:fs'
import path from 'node:path'
import { getRedirectUrl, getRewrittenUrl, unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'
import { describe, expect, test } from 'vitest'
import nextConfig from '../next.config'
import { LOCALIZED_SECTIONS } from './i18n'

const ROOT = path.join(__dirname, '..')
const LANG_DIR = path.join(ROOT, 'app', '[lang]')
const BASE = 'https://imbored.cc'

/** Как Next разберёт адрес правилами next.config: редирект, rewrite или как есть */
async function route(url: string, headers: Record<string, string> = {}) {
  const res = await unstable_getResponseFromNextConfig({ url: BASE + url, nextConfig, headers })
  const redirect = getRedirectUrl(res)
  const rewrite = getRewrittenUrl(res)
  const short = (u: string | null) => (u ? u.replace(BASE, '') : null)
  return { status: res.status, redirect: short(redirect), rewrite: short(rewrite) }
}

/**
 * Каталог app/[lang]/* без строки в LOCALIZED_SECTIONS не переписался бы с
 * русского адреса и отвечал бы там 404, а на английском работал бы — то
 * есть русская версия, у которой адреса без префикса, молча теряла бы
 * раздел. Обратное — строка без каталога — переписывала бы адрес в пустоту.
 */
describe('разделы под app/[lang]', () => {
  test('каждый каталог — в LOCALIZED_SECTIONS, и каждая строка — каталог или файловая карточка', () => {
    const dirs = fs
      .readdirSync(LANG_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('[') && !e.name.startsWith('(') && !e.name.startsWith('_'))
      .map((e) => e.name)
    // Файловые карточки корня: адрес /<имя> тоже первый сегмент под [lang]
    const files = fs
      .readdirSync(LANG_DIR)
      .filter((f) => /^(opengraph-image|twitter-image)\.(tsx|ts|jsx|js|png|jpg)$/.test(f))
      .map((f) => f.replace(/\.[a-z]+$/, ''))
    expect(dirs.length, 'каталоги не найдены — сторож ослеп').toBeGreaterThan(10)
    expect([...LOCALIZED_SECTIONS].sort()).toEqual([...new Set([...dirs, ...files])].sort())
  })

  test('под [lang] нет других динамических сегментов, кроме ловушки 404', () => {
    const dynamic = fs
      .readdirSync(LANG_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('['))
      .map((e) => e.name)
    expect(dynamic).toEqual(['[...missing]'])
  })

  test('в корне app/ не осталось страниц: их бы не нашёл ни один язык', () => {
    const pages: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (p !== LANG_DIR) walk(p)
        } else if (/^(page|layout|template|not-found|error|loading)\.(tsx|ts|jsx|js)$/.test(e.name)) {
          pages.push(path.relative(ROOT, p).split(path.sep).join('/'))
        }
      }
    }
    walk(path.join(ROOT, 'app'))
    expect(pages).toEqual([])
  })
})

describe('rewrites русской ветки', () => {
  test('корень и разделы уезжают под /ru, строка запроса — с ними', async () => {
    expect((await route('/')).rewrite).toBe('/ru')
    expect((await route('/play?time=short&vibe=chill')).rewrite).toBe('/ru/play?time=short&vibe=chill')
    expect((await route('/?next=%2Fplay')).rewrite).toBe('/ru?next=%2Fplay')
    expect((await route('/game/730')).rewrite).toBe('/ru/game/730')
    expect((await route('/game/730/news/123')).rewrite).toBe('/ru/game/730/news/123')
    expect((await route('/room/new')).rewrite).toBe('/ru/room/new')
    expect((await route('/opengraph-image')).rewrite).toBe('/ru/opengraph-image')
    expect((await route('/whatsnew/feed.xml')).rewrite).toBe('/ru/whatsnew/feed.xml')
    expect((await route('/portrait/76561198000000000/card.png')).rewrite).toBe(
      '/ru/portrait/76561198000000000/card.png',
    )
  })

  test('переписывается каждый раздел из списка', async () => {
    for (const s of LOCALIZED_SECTIONS) {
      expect((await route(`/${s}`)).rewrite, s).toBe(`/ru/${s}`)
      expect((await route(`/${s}/x`)).rewrite, s).toBe(`/ru/${s}/x`)
    }
  })

  test('английский, /api, файлы корня и мусор — как есть', async () => {
    for (const url of [
      '/en',
      '/en/play',
      '/api/session/touch',
      '/_next/static/chunks/a.js',
      '/favicon.ico',
      '/search-index.json',
      '/sitemap.xml',
      '/robots.txt',
      '/manifest.webmanifest',
      '/xyz-nope',
      '/playground',
      '/games2',
    ]) {
      const r = await route(url)
      expect(r.rewrite, url).toBe(null)
      expect(r.redirect, url).toBe(null)
    }
  })
})

describe('мусор глубже одного сегмента', () => {
  /**
   * Без правила /wp-admin/setup.php доходил до корневого layout с языком
   * «wp-admin», и 404 рисовать было не в чем — стоковая страница Next.
   */
  test('уходит в ловушку русской ветки — 404 со шапкой', async () => {
    expect((await route('/wp-admin/setup.php')).rewrite).toBe('/ru/wp-admin/setup.php')
    expect((await route('/xx/quiz')).rewrite).toBe('/ru/xx/quiz')
    expect((await route('/run/x')).rewrite).toBe('/ru/run/x')
    expect((await route('/enx/y')).rewrite).toBe('/ru/enx/y')
  })

  test('свои первые сегменты и служебное не трогает', async () => {
    for (const url of [
      '/en/xyz-nope',
      '/en/play',
      '/api/session/touch',
      '/api/auth/steam/return',
      '/_next/static/chunks/a.js',
      '/_next/image',
      '/_vercel/insights/script.js',
      '/.well-known/security.txt',
      '/ru/game/730/opengraph-image',
    ]) {
      expect((await route(url)).rewrite, url).toBe(null)
    }
  })
})

describe('редирект с /ru', () => {
  test('/ru и всё под ним — постоянно на адрес без префикса', async () => {
    expect(await route('/ru')).toMatchObject({ status: 308, redirect: '/' })
    expect(await route('/ru/quiz')).toMatchObject({ status: 308, redirect: '/quiz' })
    expect(await route('/ru/game/730/news/1?x=1')).toMatchObject({ status: 308, redirect: '/game/730/news/1?x=1' })
    expect(await route('/ru/portrait/1/card.png')).toMatchObject({ status: 308, redirect: '/portrait/1/card.png' })
  })

  /**
   * og:image русской страницы Next собирает из пути маршрута — /ru/…. Лишний
   * круг редиректа часть краулеров не проходит, и карточка в чате пустая.
   */
  test('файловые карточки под /ru отдаются как есть, без круга', async () => {
    for (const url of ['/ru/opengraph-image', '/ru/game/730/opengraph-image', '/ru/portrait/1/year/opengraph-image']) {
      const r = await route(url)
      expect(r.redirect, url).toBe(null)
      expect(r.rewrite, url).toBe(null)
    }
  })

  test('соседи /ru не задеты', async () => {
    for (const url of ['/rux', '/rules', '/rooms']) {
      expect((await route(url)).redirect, url).toBe(null)
    }
    // а /ru/… с opengraph-image в середине имени — обычная страница
    expect((await route('/ru/game/opengraph-imagery')).redirect).toBe('/game/opengraph-imagery')
  })
})
