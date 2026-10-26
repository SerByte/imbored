import fs from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'
import { modifyRouteRegex } from 'next/dist/lib/redirect-status'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination'
import { getRedirectUrl, getRewrittenUrl, unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'
import { describe, expect, test } from 'vitest'
import nextConfig from '../next.config'
import { HUB_FACETS, HUB_GENRES, HUB_TAGS } from './gamehub'
import { LOCALIZED_SECTIONS } from './i18n'
import { garbageRewrites, localeRedirects, localeRewrites } from './i18nroutes'

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

type Rule = { source: string; destination: string }

/**
 * Куда правила lib/i18nroutes уведут адрес так, как их сопоставляет сам
 * сервер Next: getPathMatch без учёта регистра и prepareDestination с
 * appendParamsToQuery у rewrites — как buildCustomRoute и resolve-routes в
 * next/dist/server/lib/router-utils. Файлов и маршрутов не знает: после
 * beforeFiles считается, что файла нет, и решает первое совпавшее afterFiles.
 *
 * route() для адреса в чужом регистре не годится:
 * unstable_getResponseFromNextConfig проверяет регулярку правила с учётом
 * регистра, а параметры достаёт без него — и на /EN бросает «extracting
 * params from path failed». А сервер (и CDN) регистр не различает.
 */
function serverRoute(url: string): { redirect: string | null; rewrite: string | null } {
  const u = new URL(BASE + url)
  const query = Object.fromEntries(u.searchParams)
  const apply = (rule: Rule, pathname: string, redirect: boolean): string | null => {
    const params = getPathMatch(rule.source, {
      strict: true,
      removeUnnamedParams: true,
      regexModifier: (re) => modifyRouteRegex(re, redirect ? ['/_next'] : undefined),
    })(pathname)
    if (!params) return null
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: !redirect,
      destination: rule.destination,
      params,
      query,
    })
    const search = new URLSearchParams(parsedDestination.query as Record<string, string>).toString()
    return parsedDestination.pathname + (search ? `?${search}` : '')
  }
  for (const rule of localeRedirects()) {
    const to = apply(rule, u.pathname, true)
    if (to) return { redirect: to, rewrite: null }
  }
  // beforeFiles сервер проходит все по очереди, каждое — по уже переписанному адресу
  let target: string | null = null
  for (const rule of localeRewrites()) {
    target = apply(rule, new URL(BASE + (target ?? url)).pathname, false) ?? target
  }
  const afterFiles = new URL(BASE + (target ?? url)).pathname
  for (const rule of garbageRewrites()) {
    const to = apply(rule, afterFiles, false)
    if (to) return { redirect: null, rewrite: to }
  }
  return { redirect: null, rewrite: target }
}

/** Пример значения динамического сегмента: форма адреса, а не настоящая игра */
const SAMPLE: Record<string, string> = {
  '[appid]': '730',
  '[gid]': '5000000000000000000',
  '[id]': 'k7m2qp',
  '[steamid]': '76561198000000000',
  '[tag]': 'roguelike',
  '[token]': 'tok3n',
}

/**
 * Адреса всех маршрутов под app/[lang] без языка: страницы, route handlers и
 * файловые карточки, параметры — примерами из SAMPLE. Ловушка [...missing] —
 * не маршрут, а её отсутствие.
 */
function routeUrls(): string[] {
  const out = new Set<string>()
  const walk = (dir: string, segs: string[]) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === '[...missing]') continue
        const seg = e.name.startsWith('[') ? SAMPLE[e.name] : e.name
        if (!seg) throw new Error(`нет примера для сегмента ${e.name} — допиши SAMPLE`)
        walk(path.join(dir, e.name), [...segs, seg])
      } else if (/^(page|route)\.(tsx|ts)$/.test(e.name)) {
        out.add('/' + segs.join('/'))
      } else if (/^(opengraph-image|twitter-image)\.(tsx|ts)$/.test(e.name)) {
        out.add('/' + [...segs, e.name.replace(/\.[a-z]+$/, '')].join('/'))
      }
    }
  }
  walk(LANG_DIR, [])
  return [...out].sort()
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

  /**
   * Корневой layout отвечает на чужой язык notFound(), но route handler и
   * файловая карточка рендерятся мимо layout. А адрес под чужим «языком»
   * маршрут находит: /_x/portrait/<id>/card.png доходил до обработчика и
   * отдавал PNG без noindex, под сколько угодно ключами ISR. Поэтому каждый
   * обработчик под app/[lang] либо закрыт dynamicParams = false (тогда язык
   * решает сборка), либо сам проверяет isLocale.
   */
  test('каждый route handler и файловая карточка под [lang] отвечают на чужой язык 404', () => {
    const handlers: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/^(route|opengraph-image|twitter-image|icon|apple-icon)\.(tsx|ts|jsx|js)$/.test(e.name)) handlers.push(p)
      }
    }
    walk(LANG_DIR)
    expect(handlers.length, 'обработчики не найдены — сторож ослеп').toBeGreaterThan(10)
    const open = handlers
      .filter((p) => {
        const src = fs.readFileSync(p, 'utf8')
        return !/export const dynamicParams = false/.test(src) && !/if \(!isLocale\(lang\)\) return /.test(src)
      })
      .map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
    expect(open, 'добавь в начало обработчика: if (!isLocale(lang)) return 404').toEqual([])
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

  /**
   * Правило переписывает формы маршрутов, а не «раздел и всё под ним»
   * (почему — SECTION_SHAPES в lib/i18nroutes.ts). Сторож обходит
   * app/[lang] сам: страница, обработчик или карточка, которых формы не
   * знают, на русском адресе отдавали бы 404, — новый маршрут без строки в
   * SECTION_SHAPES валит этот тест, а не русский сайт.
   */
  test('переписывается адрес каждого маршрута под app/[lang]', async () => {
    const urls = routeUrls()
    expect(urls.length, 'маршруты не найдены — сторож ослеп').toBeGreaterThan(30)
    // каждый раздел из списка — хотя бы одним адресом
    for (const s of LOCALIZED_SECTIONS) {
      expect(urls.some((u) => u === `/${s}` || u.startsWith(`/${s}/`)), s).toBe(true)
    }
    for (const url of urls) {
      expect((await route(url)).rewrite, url).toBe(url === '/' ? '/ru' : `/ru${url}`)
    }
  })

  test('страница жанра — каждым адресом из generateStaticParams', async () => {
    // Список жанров в правиле — то же выражение, что у страницы: разойдутся —
    // жанр на русском адресе ушёл бы в 404
    const page = fs.readFileSync(path.join(LANG_DIR, 'games', '[tag]', 'page.tsx'), 'utf8')
    expect(page).toContain(
      'return [...HUB_TAGS.map((tag) => ({ tag: HUB_GENRES[tag].slug })), ...HUB_FACETS.map((f) => ({ tag: f.slug }))]',
    )
    const slugs = [...HUB_TAGS.map((tag) => HUB_GENRES[tag].slug), ...HUB_FACETS.map((f) => f.slug)]
    expect(slugs.length).toBeGreaterThan(30)
    for (const slug of slugs) {
      expect((await route(`/games/${slug}`)).rewrite, slug).toBe(`/ru/games/${slug}`)
      expect((await route(`/games/${slug}/opengraph-image`)).rewrite, slug).toBe(`/ru/games/${slug}/opengraph-image`)
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
   *
   * Эта одна 404 — /_not-found (app/global-not-found.tsx), а не страница с
   * notFound(): HTML такой страницы — пустая оболочка Next (сторож ниже).
   */
  test('уходит в статическую 404 — одну на все адреса', async () => {
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
      '/_next',
      '/_next/xyz',
      '/_next/staticx/a.js',
      '/_nextx/y',
      '/_vercel',
      '/_vercel/x',
      // на CDN Vercel его отдаёт сама аналитика; сюда он доходит на сервере
      // без неё — next start, где файла нет
      '/_vercel/insights/script.js',
    ]) {
      expect((await route(url)).rewrite, url).toBe('/_not-found')
    }
  })

  test('свои первые сегменты и пути Next не уводит в 404', async () => {
    for (const url of [
      '/api/nope',
      '/api/session/touch',
      '/api/auth/steam/return',
      '/api/portrait/76561198000000000/card.png',
      '/_next/static/chunks/a.js',
      '/_next/static/chunks/nope.js',
      '/_next/image',
      '/_next/data/build/en/play.json',
      '/ru/game/730/opengraph-image',
    ]) {
      expect((await route(url)).rewrite, url).toBe(null)
    }
    // /en — правилом регистра в него же, адрес и строка запроса как были
    for (const url of ['/en', '/en/xyz-nope', '/en/play', '/en/play?time=short&vibe=chill', '/en?join=KW4WXJ']) {
      expect((await route(url)).rewrite, url).toBe(url)
      expect(serverRoute(url), url).toEqual({ redirect: null, rewrite: url })
    }
  })

  /**
   * Сервер и CDN сравнивают адрес с правилами без учёта регистра, и
   * исключение «en» в ловушке пропускало /EN к корневому layout с языком
   * «EN»: пустая оболочка 404 с русской головой и своя запись ISR на каждый
   * вариант регистра, а на диске Windows — поверх записи /en (почему так и
   * почему не редирект — garbageRewrites в lib/i18nroutes.ts).
   */
  test('«en» в любом регистре — это /en: тот же адрес и та же запись ISR', () => {
    for (const [url, to] of [
      ['/EN', '/en'],
      ['/En', '/en'],
      ['/eN', '/en'],
      ['/EN?join=KW4WXJ', '/en?join=KW4WXJ'],
      ['/En/quiz', '/en/quiz'],
      ['/EN/play?time=short', '/en/play?time=short'],
      ['/EN/privacy', '/en/privacy'],
      ['/eN/game/730', '/en/game/730'],
      ['/EN/game/387290/news/5000000000000000000', '/en/game/387290/news/5000000000000000000'],
      ['/En/room/KW4WXJ', '/en/room/KW4WXJ'],
      ['/EN/zzz-nonexistent-c3', '/en/zzz-nonexistent-c3'],
    ]) {
      expect(serverRoute(url), url).toEqual({ redirect: null, rewrite: to })
    }
  })

  test('соседи «en» в чужом регистре — в статическую 404, /RU — редиректом без префикса', () => {
    for (const url of ['/ENX', '/EN-us/play', '/Enx/y', '/_NEXT/x', '/_Vercel/x', '/XX/quiz']) {
      expect(serverRoute(url).rewrite, url).toMatch(/^\/_not-found(\?|$)/)
    }
    expect(serverRoute('/RU/play')).toEqual({ redirect: '/play', rewrite: null })
    expect(serverRoute('/Ru')).toEqual({ redirect: '/', rewrite: null })
  })

  test('разделы по-прежнему уезжают в свои страницы, а не в 404', async () => {
    expect((await route('/quiz')).rewrite).toBe('/ru/quiz')
    expect((await route('/missing')).rewrite).toBe('/ru/missing')
    // Параметр решает страница: игры 999999999 нет, но адрес — её
    expect((await route('/game/999999999')).rewrite).toBe('/ru/game/999999999')
  })

  /**
   * /game/abc страница отдала бы notFound() из ISR, а ISR кэширует и 404 —
   * своей записью на каждый адрес, который перебирает сканер (~13 блоков
   * ISR Writes). Мимо формы (APPID и GID в lib/i18nroutes.ts) такой адрес
   * уходит в общую статическую /_not-found. Нули впереди, плюс, дробь и
   * экспонента — тоже: Number() их принимал, и каждый был отдельной записью
   * ISR той же карточки.
   */
  test('номер игры или поста не той формы — в статическую 404, а не в ISR-маршрут', async () => {
    for (const url of [
      '/game/abc',
      '/game/undefined',
      '/game/NaN',
      '/game/null',
      '/game/0',
      '/game/-0',
      '/game/0730',
      '/game/+730',
      '/game/730.0',
      '/game/7.3e2',
      '/game/0x2DA',
      '/game/--5',
      '/game/abc/opengraph-image',
      '/game/abc/news',
      '/game/abc/news/5000000000000000000',
      '/game/730/news/xyz',
      '/game/730/news/12a',
      '/game/730/news/-1',
      '/game/730/news/xyz/opengraph-image',
    ]) {
      expect((await route(url)).rewrite, url).toBe('/_not-found')
    }
  })

  test('настоящие номера уезжают в /ru/…: отрицательный appid — другие магазины', async () => {
    for (const url of [
      '/game/730',
      '/game/4704690',
      '/game/-5',
      '/game/-111/opengraph-image',
      '/game/730/opengraph-image',
      '/game/730/news',
      '/game/730/news/5000000000000000000',
      '/game/730/news/5000000000000000000/opengraph-image',
    ]) {
      expect((await route(url)).rewrite, url).toBe(`/ru${url}`)
    }
  })

  /**
   * Опечатка под русским разделом — в ту же статическую 404, что /xyz, а не
   * в /ru/…: там её ловила динамическая /[lang]/[...missing], и HTML был
   * пустой оболочкой Next без lang, стилей и текста, функцией на каждый
   * адрес. До [lang] такие адреса отдавала статическая 404 — сервером
   * целиком. Список — адреса из живой проверки, где это всплыло.
   */
  test('опечатка под русским разделом — в статическую 404, а не в /ru/…', async () => {
    for (const url of [
      '/games/no-such-genre',
      '/games/no-such-genre/opengraph-image',
      '/quiz/xyz',
      '/daily/x',
      '/privacy/x',
      '/support/x',
      '/whatsnew/x',
      '/whatsnew/feed',
      '/games/a/b',
      '/room/new/x',
      '/rooms/x',
      '/explore/x',
      '/play/x',
      '/game',
      '/game/730/xyz',
      '/game/730/news/1/x',
      '/library/x',
      '/compat/a/b',
      '/pick',
      '/pick/a/b',
      '/portrait/1/year/x',
      '/opengraph-image/x',
      '/missing/x',
    ]) {
      expect((await route(url)).rewrite, url).toBe('/_not-found')
    }
  })
})

/**
 * Двойник правила выше под /en. Переписывать /en/game/abc некуда, и маршрут
 * /[lang]/game/[appid] нашёл бы его сам — notFound() из ISR, запись 404 на
 * адрес. Правило ловит неверный номер и уводит его в пререндеренную
 * английскую 404, одну на все такие адреса.
 */
describe('номер не той формы под /en', () => {
  test('в /en/missing — в любом регистре и со всем, что под номером', async () => {
    for (const url of [
      '/en/game/abc',
      '/en/game/undefined',
      '/en/game/0',
      '/en/game/0730',
      '/en/game/730.0',
      '/en/game/7.3e2',
      '/en/game/abc/opengraph-image',
      '/en/game/abc/news',
      '/en/game/abc/news/5000000000000000000',
      '/en/game/730/news/xyz',
      '/en/game/730/news/12a',
      '/en/game/730/news/xyz/opengraph-image',
    ]) {
      expect((await route(url)).rewrite, url).toBe('/en/missing')
      expect(serverRoute(url), url).toEqual({ redirect: null, rewrite: '/en/missing' })
    }
    // регистр сервер не различает: правило ловит и /EN, до правил регистра
    for (const url of ['/EN/game/abc', '/En/game/730/news/xyz', '/en/GAME/abc']) {
      expect(serverRoute(url), url).toEqual({ redirect: null, rewrite: '/en/missing' })
    }
  })

  test('настоящий номер не задевает: страница, карточка, архив, патч', async () => {
    for (const url of [
      '/en/game/730',
      '/en/game/-5',
      '/en/game/730/opengraph-image',
      '/en/game/730/news',
      '/en/game/730/news/5000000000000000000',
      '/en/game/730/news/5000000000000000000/opengraph-image',
    ]) {
      expect((await route(url)).rewrite, url).toBe(url)
      expect(serverRoute(url), url).toEqual({ redirect: null, rewrite: url })
    }
  })

  /**
   * Запрос роутера CDN Vercel может довести до afterFiles уже с суффиксом
   * RSC. Правило, которое увело бы такой адрес в 404, сломало бы переход и
   * префетч живой карточки, — поэтому верный номер — тот, за которым конец,
   * «/» или точка с буквой (NUM_END в lib/i18nroutes.ts).
   */
  test('суффикс RSC за настоящим номером — не мусор', () => {
    for (const url of [
      '/en/game/730.rsc',
      '/en/game/730.segments/_tree.segment.rsc',
      '/en/game/730/news.rsc',
      '/en/game/730/news.segments/_tree.segment.rsc',
      '/en/game/730/news/5000000000000000000.rsc',
      '/en/game/730/news/5000000000000000000.segments/_tree.segment.rsc',
    ]) {
      expect(serverRoute(url).rewrite, url).not.toBe('/en/missing')
    }
  })

  test('ни один маршрут под app/[lang] на английском адресе не уходит в /en/missing', () => {
    const urls = routeUrls()
    expect(urls.length, 'маршруты не найдены — сторож ослеп').toBeGreaterThan(30)
    for (const url of urls) {
      const en = url === '/' ? '/en' : `/en${url}`
      expect(serverRoute(en).rewrite, en).toBe(en)
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
