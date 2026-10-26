import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import nextConfig from '../next.config'
import { cardUrl } from './cardhash'
import type { SimilarGame } from './db'
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

/*
 * Каталог, база и кэш Next — со счётчиками: граница not-found не должна
 * трогать ни одного (сторож ниже). Кэш Next прозрачный, но пишет в журнал
 * каждый свой вызов — так сторож видит и кэш данных из чужого модуля. По
 * умолчанию каталог пуст, и полки нет — как у 404 на молчащей базе (shelf()
 * в app/[lang]/not-found.tsx).
 */
const { cacheRuns, getDb, topCatalogGames } = vi.hoisted(() => ({
  cacheRuns: [] as string[],
  getDb: vi.fn(async () => ({})),
  topCatalogGames: vi.fn(async (): Promise<SimilarGame[]> => []),
}))
vi.mock('next/cache', () => ({
  unstable_cache:
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts?: string[]) =>
    async (...args: A) => {
      cacheRuns.push(String(keyParts))
      return fn(...args)
    },
}))
// appBaseUrl — настоящий: метадата корня (metadataBase) берёт его оттуда же
vi.mock('@/lib/server', async () => ({ getDb, appBaseUrl: (await import('@/lib/origin')).appBaseUrl }))
vi.mock('@/lib/db', () => ({ topCatalogGames }))
// ViewTransition в react вне Next нет (его даёт канарейка React из сборки
// Next): морф плитки полки здесь — просто её содержимое
vi.mock('@/components/Morph', () => ({ GameMorph: ({ children }: { children: ReactNode }) => children }))
// next/root-params вне сборки бросает при импорте (lib/i18n-server.ts)
vi.mock('@/lib/i18n-server', () => ({ getLocale: async () => 'ru' }))
// next/font/google — функция сборки, вне Next её нет; not-found и
// global-not-found тянут корневой layout, шрифтам нужна только переменная
vi.mock('next/font/google', () => ({
  Manrope: () => ({ variable: '--font-manrope' }),
  JetBrains_Mono: () => ({ variable: '--font-jbmono' }),
}))

const { NotFoundView } = await import('@/app/[lang]/not-found')
const { LocaleProvider } = await import('@/components/LocaleProvider')

const ROOT = path.join(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
const CYR = /[А-Яа-яЁё]/

type ViewProps = Parameters<typeof NotFoundView>[0]

/** Под провайдером языка — как под корневым layout: Link и поиск берут язык из него */
async function view(locale: 'ru' | 'en', props: Omit<ViewProps, 'locale'> = {}): Promise<string> {
  const el = (await NotFoundView({ ...props, locale })) as ReactElement
  return renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, el))
}

/** Каталог больше одного ряда: полку, если её нарисовать, видно по ссылкам */
const CATALOG: SimilarGame[] = Array.from({ length: 6 }, (_, i) => ({
  appid: 100 + i,
  name: `Game ${i}`,
  headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${100 + i}/header.jpg`,
  art: null,
}))
const gameLinks = (html: string) => html.match(/href="\/game\/\d+"/g) ?? []

describe('мусорный адрес — в /_not-found, который рисует сервер', () => {
  test('правило уводит в /_not-found, а не на страницу с notFound()', () => {
    // Первые два — не 404: «en» в чужом регистре — это /en (garbageRewrites в lib/i18nroutes.ts)
    expect(garbageRewrites().map((r) => r.destination)).toEqual(['/en', '/en/:path+', '/_not-found'])
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
    const el = (await NotFound()) as ReactElement<ViewProps>
    expect(el.type).toBe(NotFoundView)
    expect(el.props.locale).toBe('ru')
  })
})

/**
 * Граница not-found — без базы и без кэша данных.
 *
 * Next рисует границу not-found корневого layout вместе с КАЖДОЙ страницей
 * под app/[lang] (проп notFound у LayoutRouter), и кэш данных с числом в
 * revalidate, выполнившийся в ней, опускает срок всех страниц до своего.
 * Так и было: полка 404 читала каталог через unstable_cache на сутки, и
 * карточка игры с revalidate на неделю перегенерировалась раз в сутки, а
 * /privacy и /support без revalidate стали ISR на сутки. Поэтому граница
 * рисует экран без полки и не ходит ни в базу, ни в кэш — а сторож ловит и
 * кэш, вписанный в неё через чужой модуль: next/cache здесь ведёт журнал.
 *
 * Каталог в этих тестах не пуст: нарисуй граница полку, её было бы видно.
 */
describe('граница not-found — без базы и без кэша данных', () => {
  beforeEach(() => {
    topCatalogGames.mockImplementation(async () => CATALOG)
    topCatalogGames.mockClear()
    getDb.mockClear()
    cacheRuns.length = 0
  })
  afterEach(() => {
    topCatalogGames.mockImplementation(async () => [])
  })

  test('граница не зовёт ни каталог, ни базу, ни кэш данных — и полки в ней нет', async () => {
    const { default: NotFound } = await import('@/app/[lang]/not-found')
    const el = (await NotFound()) as ReactElement<ViewProps>
    expect(el.props.withShelf).toBe(false)
    // Экран — тоже серверный и асинхронный: рисуем его тем, что вернула граница
    const html = await view(el.props.locale as 'ru', el.props)
    expect(html).toContain('Такой страницы нет')
    expect(gameLinks(html)).toEqual([])
    expect(topCatalogGames).not.toHaveBeenCalled()
    expect(getDb).not.toHaveBeenCalled()
    expect(cacheRuns).toEqual([])
  })

  test('сторож не слепой: экран с полкой, как у /_not-found, читает каталог и рисует ряд', async () => {
    const html = await view('ru')
    expect(topCatalogGames).toHaveBeenCalledTimes(1)
    expect(html).toContain('Из каталога')
    expect(gameLinks(html)).toHaveLength(4)
  })

  /*
   * Кэш Next полке не нужен: /_not-found пререндерен раз на сборку, а
   * unstable_cache хранил бы верх каталога и между деплоями (докблок shelf()).
   */
  test('полка читает каталог напрямую, без кэша Next', async () => {
    await view('ru')
    expect(cacheRuns).toEqual([])
  })

  test('молчащая база — экран открывается, просто без полки', async () => {
    getDb.mockImplementationOnce(async () => {
      throw new Error('TURSO_DATABASE_URL не задан')
    })
    const html = await view('ru')
    expect(html).toContain('Такой страницы нет')
    expect(gameLinks(html)).toEqual([])
  })
})

/**
 * noindex у /_not-found — в его собственной голове, а не от Next.
 *
 * Свой noindex Next вставляет только при рендере с кодом выше 400 (NonIndex в
 * next/dist/server/app-render), а Vercel отдаёт пререндер /_not-found, куда
 * мусор уводит правило afterFiles, как обычную статическую страницу — кодом
 * 200. Замер на проде 19.10.2026: /games/nonexistent-genre, /quiz/xyz, /xyz,
 * /.env — «200 OK», X-Matched-Path: /_not-found и ни одного <meta
 * name="robots">: мягкий 404 с заголовком главной. noindex в метаданных лежит
 * в самом HTML и работает при любом коде ответа.
 */
describe('/_not-found: noindex в своём HTML', () => {
  test('robots — noindex, follow: полка ведёт на живые карточки', async () => {
    const { generateMetadata } = await import('@/app/global-not-found')
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true })
  })
})

/**
 * Карточка превью в голове 404 (docs/i18n.md, п. 10). Голову 404 читают
 * краулеры и превью мессенджеров — сырым HTML, без скрипта.
 */
describe('карточка превью 404', () => {
  /*
   * У /_not-found нет сегмента [lang], и файловая карточка корня
   * (app/[lang]/opengraph-image.tsx) сюда не доходит: без своих images
   * русская 404 вне разделов осталась без og:image и twitter:image вовсе. До
   * [lang] корневая карточка стояла и на ней. Размеры и тип в
   * global-not-found — копия, и если карточка сменит формат, тест поймает.
   */
  test('/_not-found — корневая карточка русских страниц, с их подписью', async () => {
    const { generateMetadata } = await import('@/app/global-not-found')
    const { generateMetadata: rootMetadata } = await import('@/app/[lang]/layout')
    const { alt, size, contentType } = await import('@/app/[lang]/opengraph-image')
    const meta = await generateMetadata()
    const root = await rootMetadata({ params: Promise.resolve({ lang: 'ru' }), children: null } as never)
    expect(alt).toBe('imbored — во что поиграть')
    expect(meta.openGraph?.images).toEqual([
      { url: '/ru/opengraph-image', width: size.width, height: size.height, type: contentType, alt },
    ])
    // Остальная голова — корневая русская, как была: openGraph — корневой и
    // карточка; сверху — только свой noindex (тест ниже)
    const { openGraph, robots, ...rest } = meta
    const { openGraph: rootOg, ...rootRest } = root
    expect(rest).toEqual(rootRest)
    expect(robots).toEqual({ index: false, follow: true })
    expect(openGraph).toEqual({ ...rootOg, images: openGraph?.images })
    expect(rootOg).toEqual({ type: 'website', siteName: 'imbored', locale: 'ru_RU' })
    // twitter:image Next достраивает из openGraph сам — своего тут не нужно
    expect(meta.twitter).toEqual({ card: 'summary_large_image' })
  })

  /*
   * На not-found Next ставит файлы корня ещё раз, последним уровнем, вместе с
   * метадатой not-found.tsx: без своих images русский alt файла побеждал
   * английскую карточку layout, и сырой HTML каждой /en/… 404 отдавал
   * «imbored — во что поиграть» рядом с og:locale en_US.
   */
  test('граница not-found на /en — корневой openGraph layout целиком, с английской подписью', async () => {
    const { generateMetadata } = await import('@/app/[lang]/not-found')
    const { generateMetadata: rootMetadata } = await import('@/app/[lang]/layout')
    const { size, contentType } = await import('@/app/[lang]/opengraph-image')
    const en = await generateMetadata({ params: Promise.resolve({ lang: 'en' }) })
    const root = await rootMetadata({ params: Promise.resolve({ lang: 'en' }), children: null } as never)
    // openGraph уровня заменяет накопленный целиком: тип, имя и язык — тоже здесь
    expect(en).toEqual({ openGraph: root.openGraph })
    expect(en.openGraph).toMatchObject({ type: 'website', siteName: 'imbored', locale: 'en_US' })
    expect(en.openGraph?.images).toEqual([
      { url: cardUrl('/en', 'app/[lang]/opengraph-image.tsx'), width: size.width, height: size.height, type: contentType, alt: 'imbored — what to play' },
    ])
    expect(JSON.stringify(en)).not.toMatch(CYR)
  })

  test('граница not-found на русском — своей метадаты нет: работает файл, голова прежняя', async () => {
    const { generateMetadata } = await import('@/app/[lang]/not-found')
    expect(await generateMetadata({ params: Promise.resolve({ lang: 'ru' }) })).toEqual({})
  })
})
