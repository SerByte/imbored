import type { MetadataRoute } from 'next'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { sitemapGames, sitemapNews, sitemapPatchArchives } from '@/lib/db'
import { facetPath, HUB_FACETS, HUB_GENRES, HUB_TAGS, hubPath, type HubFacet } from '@/lib/gamehub'
import { LOCALES, lp, type Locale } from '@/lib/i18n'
import { newsPath, SITEMAP_NEWS_MAX, SITEMAP_NEWS_WINDOW_SEC } from '@/lib/newspage'
import { PATCH_ARCHIVE_MIN, patchArchivePath } from '@/lib/patcharchive'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'
import { loadGenre, thinList } from './[lang]/games/[tag]/load'

/**
 * Карта сайта. Раньше её не было вовсе, и единственное содержание проекта —
 * страницы игр с русскими «за что любят / за что ругают», отзывами и
 * патчноутами — для поиска просто не существовало.
 *
 * Публиковать её стало можно только после того, как loadGamePage перестал
 * ходить в сеть и звать модель: до этой правки карта сайта означала бы, что мы
 * сами приводим краулер в платный эндпоинт по пяти тысячам адресов.
 */

/*
 * Потолок одного файла по протоколу — 50 000 URL. Стояло 5000 с пометкой
 * «столько нам и не нужно», а каталог с тех пор вырос: замер 20 августа — 5919
 * живых игр, то есть 919 страниц (одна шестая всей поисковой поверхности) в
 * карту не попадали НИКОГДА. И это ровно длинный хвост, у которого меньше всего
 * конкуренции в выдаче и почти нет других входов: блок «Похожие» даёт по шесть
 * ссылок с карточки, и та же ALIVE_POOL фильтрует его тоже.
 *
 * Настоящий предел ставит сам запрос: он отдаёт только живых, с тегами. Здесь
 * остаётся страховка от протокола, а не бюджет.
 *
 * Адрес теперь стоит в карте на каждом языке (см. localized ниже), так что
 * игра — это LOCALES.length адресов, и патчи тоже. Потолок игр — то, что
 * остаётся от протокола после патчей, архивов обновлений (их столько же,
 * SITEMAP_NEWS_MAX, и тоже на каждом языке — см. у выборки ниже) и
 * статических адресов (запас 100 на них с лихвой: жанры и подборки на обоих
 * языках — восемь десятков).
 */
const PROTOCOL_MAX = 50_000
const MAX_GAMES = Math.floor((PROTOCOL_MAX - SITEMAP_NEWS_MAX * LOCALES.length * 2 - 100) / LOCALES.length)

/** Сутки: чаще каталог всё равно не меняется, а запрос стоит прочитанных строк. */
export const revalidate = 86_400

type Entry = MetadataRoute.Sitemap[number]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appBaseUrl()
  const url = (path: string) => new URL(path, base).toString()

  /*
   * Каждый адрес — на каждом языке, и у каждого — ссылки на все версии и
   * x-default на русскую (xhtml:link в файле). Без них Google видел бы в
   * /en/game/730 дубль /game/730 и выбирал бы один из двух сам, а
   * англоязычному из выдачи показывал бы русскую. Та же пара, что в
   * alternates страниц (localeAlternates в lib/site.ts): path — русский
   * адрес без префикса.
   */
  const languages = (path: string, has: readonly Locale[] = LOCALES) => ({
    languages: {
      ...(has.includes('ru') ? { ru: url(path) } : {}),
      ...(has.includes('en') ? { en: url(lp('en', path)) } : {}),
      // x-default — русская, пока она в карте; без неё — та версия, что есть
      'x-default': url(has.includes('ru') ? path : lp(has[0], path)),
    },
  })
  const localized = (path: string, rest: Omit<Entry, 'url' | 'alternates'>): Entry[] =>
    LOCALES.map((locale) => ({ url: url(lp(locale, path)), alternates: languages(path), ...rest }))

  /*
   * Ошибка базы глотается ТОЛЬКО НА СБОРКЕ, как у хаба игр (loadHub в
   * app/games/page.tsx) и RSS (app/whatsnew/feed.xml).
   *
   * На сборке файл пререндерится, а getDb() бросает сам, когда в
   * продакшен-окружении не задан TURSO_DATABASE_URL, — незакрытый вызов
   * уронил бы весь build, а не одну карту. Поэтому try накрывает и getDb().
   *
   * При перегенерации — наоборот, ошибка уходит наружу намеренно. Карта живёт
   * на ISR сутки, и упавшая перегенерация оставляет в кэше ПРОШЛУЮ карту, а
   * Next повторит её следующим запросом (docs: incremental-static-
   * regeneration, «Handling uncaught exceptions»). Пойманная же записывала в
   * кэш то, что успело собраться: одна осечка Turso в момент суточной
   * перегенерации — и Googlebot, Bing и Яндекс сутки забирали карту из
   * тридцати статических адресов вместо шести тысяч. Довод «пятисотка на
   * /sitemap.xml подорвёт доверие» к ISR не относится: пятисотки нет,
   * отдаётся прошлая версия. Сторож — app/sitemap.test.ts.
   */
  let games: Awaited<ReturnType<typeof sitemapGames>> = []
  try {
    games = await sitemapGames(await getDb(), MAX_GAMES)
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('sitemap: каталог недоступен на сборке, отдаём только статические адреса —', String(err))
  }

  /*
   * Страницы пересказов патчей — отдельной выборкой и отдельным try: на
   * сборке упавшая выборка патчей не должна уносить с собой пять тысяч
   * карточек игр. Только крупные, с пересказом, у живых игр и за девяносто
   * дней — что и почему, в lib/newspage и у sitemapNews.
   *
   * Пересказ у каждого языка свой, и выборок по одной на язык. /en-двойник
   * патча своё имеет только с английским пересказом (tldr_en), без него он
   * стоит с noindex (docs/i18n.md) — в карту идут только такие, и hreflang
   * русской версии на него не ведёт: ссылка на неиндексируемую версию для
   * поиска пустой сигнал. Время изменения — своё у каждого языка: пересказы
   * пишутся в разные дни.
   */
  const news = new Map<string, { appid: number; gid: string; changedAt: Partial<Record<Locale, number>> }>()
  try {
    const db = await getDb()
    const since = nowSec() - SITEMAP_NEWS_WINDOW_SEC
    const rows = await Promise.all(LOCALES.map((locale) => sitemapNews(db, since, SITEMAP_NEWS_MAX, locale)))
    // Порядок — русской выборки (свежие сверху), английские без русского — следом
    LOCALES.forEach((locale, i) => {
      for (const n of rows[i]) {
        const key = `${n.appid}:${n.gid}`
        const entry = news.get(key) ?? { appid: n.appid, gid: n.gid, changedAt: {} }
        entry.changedAt[locale] = n.changedAt
        news.set(key, entry)
      }
    })
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('sitemap: патчи недоступны на сборке, отдаём без них —', String(err))
  }

  /*
   * Архивы обновлений игр (/game/<appid>/news) — своим try, как патчи: у них
   * своя выборка, и её сбой на сборке не должен уносить остальное. Только
   * архивы, в которых есть своё — пересказы (PATCH_ARCHIVE_MIN, lib/patcharchive);
   * остальные открыты по ссылке с карточки, но звать туда краулер незачем.
   *
   * Выборок по одной на язык, как у патчей. Своё у архива — пересказы, а их
   * у каждого языка свои: /en-архив считает английские (tldr_en, patchOn в
   * его загрузчике), и если их меньше PATCH_ARCHIVE_MIN, /en-двойник стоит с
   * noindex — в карте он был бы «Submitted URL marked noindex». Поэтому в
   * карте архив — на тех языках, где он проходит порог, и hreflang ведёт
   * только на них. Время изменения — своё у каждого языка.
   */
  const archives = new Map<number, Partial<Record<Locale, number>>>()
  try {
    const db = await getDb()
    const rows = await Promise.all(
      LOCALES.map((locale) => sitemapPatchArchives(db, PATCH_ARCHIVE_MIN, SITEMAP_NEWS_MAX, locale)),
    )
    // Порядок — русской выборки (по appid), английские без русского — следом
    LOCALES.forEach((locale, i) => {
      for (const a of rows[i]) {
        const entry = archives.get(a.appid) ?? {}
        entry[locale] = a.changedAt
        archives.set(a.appid, entry)
      }
    })
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('sitemap: архивы обновлений недоступны на сборке, отдаём без них —', String(err))
  }

  /*
   * Подборки по факту («с другом», «на 20 минут»…) — не все и не всегда:
   * подборка — отбор каталога, и у «на 20 минут» он узкий: только уверенная
   * семантика своей версии, и после выборки ещё уходят матчи. Короче полки
   * хаба страница закрыта от индекса (thinList), и отдай карта её адрес —
   * Search Console записал бы «Submitted URL marked noindex». Поэтому в карте
   * — ровно те подборки, что страница сама пускает в поиск: тот же loadGenre,
   * то же правило, без своей копии отбора.
   *
   * Своим try, как патчи и архивы. На сборке без базы loadGenre сам отдаёт
   * пустой список — подборок в карте тогда нет до первой перегенерации, как и
   * карточек игр. Так и надо: страница подборки на такой сборке тоже собрана
   * пустой, то есть закрытой от индекса.
   *
   * Одна проверка на оба языка: список игр подборки от языка не зависит
   * (loadGenre — та же выборка и тот же отсев), и тонкой страница бывает на
   * обоих сразу. Поэтому подборка — на каждом языке.
   *
   * Жанры — тем же правилом, но только английские двойники. Их подбирали
   * руками под полную полку, а полка — тоже выборка каталога, и страница
   * жанра короче полки хаба стоит с тем же noindex (thinList в
   * app/[lang]/games/[tag]): в локальном каталоге так стояли «Соулслайки» с
   * четырьмя играми и «Уютные» с одной. Русские адреса жанров в карте — все,
   * как до английской версии (известны без базы и переживают сборку без
   * неё): русская карта переводом не меняется, кроме добавленного. /en-
   * двойник — новый адрес, и звать на него краулер, пока страница закрыта от
   * индекса, незачем: в карте он только у полной полки, и hreflang русской
   * версии ведёт на него только тогда же — как у патчей. На сборке без базы
   * английских жанров в карте нет до первой перегенерации, как подборок.
   *
   * Тонкий русский жанр тем самым стоит в карте при noindex на странице —
   * «Submitted URL marked noindex» в Search Console, — и это решение, а не
   * недосмотр: так было и до перевода (карта перечисляла все HUB_TAGS), а
   * вычеркнуть его — правка русской карты, которой перевод не делает. Да и
   * сборка без базы унесла бы тогда из карты все русские жанры до первой
   * перегенерации. hreflang на /en-двойник в голове такой страницы
   * (localeAlternates) — для поиска пустой сигнал, но и не вред: noindex у
   * неё на обоих языках сразу, список игр от языка не зависит.
   */
  const genreListed = new Set<string>()
  let facets: HubFacet[] = []
  try {
    const listed = (page: Awaited<ReturnType<typeof loadGenre>>) => page != null && !thinList(page.games)
    const [genrePages, facetPages] = await Promise.all([
      Promise.all(HUB_TAGS.map((tag) => (hubPath(tag) ? loadGenre(HUB_GENRES[tag].slug) : null))),
      Promise.all(HUB_FACETS.map((f) => loadGenre(f.slug))),
    ])
    HUB_TAGS.forEach((tag, i) => {
      if (listed(genrePages[i])) genreListed.add(tag)
    })
    facets = HUB_FACETS.filter((_, i) => listed(facetPages[i]))
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('sitemap: жанры и подборки недоступны на сборке, отдаём без них —', String(err))
  }

  const stat: MetadataRoute.Sitemap = [
    ...localized('/', { changeFrequency: 'weekly', priority: 1 }),
    /*
     * /daily здесь НЕТ, и это исправление.
     *
     * Он стоял с приоритетом 0.9 — выше всех пяти тысяч страниц игр, — а
     * краулеру отдаёт заглушку: замер на деплое, запрос без куки, 249 символов
     * видимого текста, из них содержательного «Изучаю твою библиотеку…».
     * Выбор игры дня считается по ЛИЧНОЙ библиотеке, то есть страница
     * состояния сессии.
     *
     * Правило для этого класса записано в lib/robots.ts: /daily краулеру
     * открыт ровно затем, чтобы увидеть noindex (NOINDEX_PAGES), — в карту
     * ему тем более незачем. То же у /rooms.
     */
    ...localized('/whatsnew', { changeFrequency: 'daily', priority: 0.8 }),
    /*
     * /quiz — наоборот: гость видит первый вопрос целиком, и это главная
     * точка входа в продукт, на которую ведёт каждая карточка игры. Он
     * открыт краулеру и идёт в выдачу со своим canonical (lib/robots,
     * app/quiz/layout.tsx). Ниже хаба жанров: квиз один и не меняется.
     */
    ...localized('/quiz', { changeFrequency: 'monthly', priority: 0.6 }),
    // Хаб жанров: единственная страница, которая ссылается на карточки пачкой
    // (см. app/games/page.tsx). Полки меняются медленно — верх по отзывам
    // стоит неделями, — отсюда weekly, а не daily.
    ...localized('/games', { changeFrequency: 'weekly', priority: 0.8 }),
    // Страницы жанров — адреса известны без базы (HUB_GENRES), поэтому
    // переживают и сборку без каталога. Ниже хаба: хаб ссылается на них.
    // Английский двойник — только у полной полки (genreListed, выше)
    ...HUB_TAGS.flatMap((tag) => {
      const path = hubPath(tag)
      if (!path) return []
      const has: readonly Locale[] = genreListed.has(tag) ? LOCALES : ['ru']
      return has.map(
        (locale): Entry => ({
          url: url(lp(locale, path)),
          alternates: languages(path, has),
          changeFrequency: 'weekly',
          priority: 0.7,
        }),
      )
    }),
    ...localized('/support', { changeFrequency: 'yearly', priority: 0.3 }),
    ...localized('/privacy', { changeFrequency: 'yearly', priority: 0.2 }),
  ]

  return [
    ...stat,
    // Тот же сегмент и тот же ранг, что у жанров, — и так же на каждом языке
    ...facets.flatMap((f) => localized(facetPath(f), { changeFrequency: 'weekly', priority: 0.7 })),
    ...games.flatMap((g) =>
      localized(`/game/${g.appid}`, {
        lastModified: new Date(g.updatedAt * 1000),
        changeFrequency: 'weekly',
        priority: 0.7,
      }),
    ),
    // Между карточкой и патчем: ответ на «обновления X» — один адрес на игру,
    // а не десятки одинаковых заголовков Steam. lastmod — свежий патч или
    // пересказ своего языка (sitemapPatchArchives), а не перезаписанный вес.
    // Язык — только тот, где архив проходит порог, — почему, у выборки выше
    ...[...archives].flatMap(([appid, changedAt]) => {
      const path = patchArchivePath(appid)
      const has = LOCALES.filter((locale) => changedAt[locale] !== undefined)
      return has.map(
        (locale): Entry => ({
          url: url(lp(locale, path)),
          alternates: languages(path, has),
          lastModified: new Date(changedAt[locale]! * 1000),
          changeFrequency: 'weekly',
          priority: 0.6,
        }),
      )
    }),
    // Ниже карточек: патч — повод зайти, а не главное содержание сайта
    ...[...news.values()].flatMap((n) => {
      const path = newsPath(n.appid, n.gid)
      const has = LOCALES.filter((locale) => n.changedAt[locale] !== undefined)
      return has.map(
        (locale): Entry => ({
          url: url(lp(locale, path)),
          alternates: languages(path, has),
          lastModified: new Date(n.changedAt[locale]! * 1000),
          changeFrequency: 'monthly',
          priority: 0.5,
        }),
      )
    }),
  ]
}
