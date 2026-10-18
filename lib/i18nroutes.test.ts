import fs from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'
import { getRedirectUrl, getRewrittenUrl, unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'
import { describe, expect, test } from 'vitest'
import nextConfig from '../next.config'
import { LOCALIZED_SECTIONS } from './i18n'
import { garbageRewrites, localeRewrites } from './i18nroutes'

const ROOT = path.join(__dirname, '..')
const LANG_DIR = path.join(ROOT, 'app', '[lang]')
const BASE = 'https://imbored.cc'

/**
 * Как Next разберёт адрес правилами next.config: редирект, rewrite или как есть.
 *
 * Утилита Next не знает файловой системы: для неё afterFiles срабатывают и
 * на /favicon.ico, хотя на деле файл отдаётся раньше них. Поэтому про файлы
 * спрашиваем конфиг без afterFiles — ровно то, что идёт ДО файлов.
 */
async function route(url: string, headers: Record<string, string> = {}, config: NextConfig = nextConfig) {
  const res = await unstable_getResponseFromNextConfig({ url: BASE + url, nextConfig: config, headers })
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

/** Конфиг с одними beforeFiles — то, что Next проверяет до файлов public/ и корня app/ */
const beforeFiles: NextConfig = {
  ...nextConfig,
  rewrites: async () => ({ beforeFiles: localeRewrites(), afterFiles: [], fallback: [] }),
}

describe('rewrites в next.config', () => {
  test('до файлов — только корень и разделы, мусорное правило — после файлов', async () => {
    const rewrites = await nextConfig.rewrites!()
    if (Array.isArray(rewrites)) throw new Error('rewrites без деления на beforeFiles/afterFiles')
    expect(rewrites.beforeFiles).toEqual(localeRewrites())
    expect(rewrites.beforeFiles).toHaveLength(2)
    expect(rewrites.afterFiles).toEqual(garbageRewrites())
  })
})

/**
 * beforeFiles идут ДО файлов: правило, задевшее файл, отнимает у него адрес.
 * Так мусорное правило в beforeFiles отдавало 404 вместо скриншотов из
 * манифеста PWA (public/screenshots/*.jpg). Сторож обходит public/ и файлы
 * корня app/ целиком: новый файл проверяется сам, без строки в тесте.
 */
describe('файлы public/ и корня app/', () => {
  const PUBLIC = path.join(ROOT, 'public')
  const APP = path.join(ROOT, 'app')
  /** Файлы метаданных, у которых адрес не совпадает с именем */
  const METADATA: Record<string, string> = {
    'manifest.ts': '/manifest.webmanifest',
    'robots.ts': '/robots.txt',
    'sitemap.ts': '/sitemap.xml',
  }
  /** Не адреса: стили, границы ошибок, тесты */
  const NOT_ROUTES = /^(globals\.css|global-error\.tsx|global-not-found\.tsx|.*\.test\.tsx?)$/

  function publicFiles(dir = PUBLIC, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) publicFiles(p, out)
      else out.push('/' + path.relative(PUBLIC, p).split(path.sep).join('/'))
    }
    return out
  }

  function rootFiles(): string[] {
    const out: string[] = []
    for (const e of fs.readdirSync(APP, { withFileTypes: true })) {
      if (e.isDirectory()) {
        // Каталог маршрута в корне — это адрес-файл: /search-index.json, /indexnow-key.txt
        if (e.name !== 'api' && !e.name.startsWith('[')) out.push(`/${e.name}`)
      } else if (!NOT_ROUTES.test(e.name)) {
        out.push(METADATA[e.name] ?? `/${e.name.replace(/\.(tsx|ts)$/, '')}`)
      }
    }
    return out
  }

  test('сторож видит и public/, и файлы корня', () => {
    expect(publicFiles()).toEqual(expect.arrayContaining(['/screenshots/narrow.jpg', '/screenshots/wide.jpg']))
    expect(rootFiles()).toEqual(
      expect.arrayContaining(['/favicon.ico', '/manifest.webmanifest', '/sitemap.xml', '/search-index.json', '/apple-icon']),
    )
  })

  test('ни одно правило до файлов их не переписывает и не редиректит', async () => {
    for (const url of [...publicFiles(), ...rootFiles()]) {
      const r = await route(url, {}, beforeFiles)
      expect(r.rewrite, url).toBe(null)
      expect(r.redirect, url).toBe(null)
    }
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

  test('до файлов английский, /api, файлы корня и мусор — как есть', async () => {
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
      '/wp-admin/setup.php',
    ]) {
      const r = await route(url, {}, beforeFiles)
      expect(r.rewrite, url).toBe(null)
      expect(r.redirect, url).toBe(null)
    }
  })
})

describe('адрес вне разделов', () => {
  /**
   * Без правила /wp-admin/setup.php доходил до корневого layout с языком
   * «wp-admin», и 404 рисовать было не в чем — стоковая страница Next. Все
   * такие адреса — в ОДНУ статическую 404: сканер перебирает их тысячами, и
   * каждый должен отдаваться с CDN, а не рендером.
   */
  test('уходит в статическую 404 русской ветки — одну на все адреса', async () => {
    for (const url of [
      '/xyz-nope',
      '/playground',
      '/games2',
      '/wp-login.php',
      '/wp-admin/setup.php',
      '/xx/quiz',
      '/run/x',
      '/enx/y',
      '/rux',
      '/.env',
      '/.well-known/security.txt',
      '/_foo/bar',
      '/_x/portrait/76561198000000000/card.png',
    ]) {
      expect((await route(url)).rewrite, url).toBe('/ru/missing')
    }
  })

  test('свои первые сегменты и служебное не трогает', async () => {
    for (const url of [
      '/en',
      '/en/xyz-nope',
      '/en/play',
      '/api/nope',
      '/api/session/touch',
      '/api/auth/steam/return',
      '/api/portrait/76561198000000000/card.png',
      '/_next/static/chunks/a.js',
      '/_next/image',
      '/_vercel/insights/script.js',
      '/ru/game/730/opengraph-image',
    ]) {
      expect((await route(url)).rewrite, url).toBe(null)
    }
  })

  test('разделы по-прежнему уезжают в свои страницы, а не в 404', async () => {
    expect((await route('/quiz')).rewrite).toBe('/ru/quiz')
    // Опечатка под разделом — это /ru/quiz/xyz, её ловит /[lang]/[...missing]
    expect((await route('/quiz/xyz')).rewrite).toBe('/ru/quiz/xyz')
    expect((await route('/missing')).rewrite).toBe('/ru/missing')
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
