import type { MetadataRoute } from 'next'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { sitemapGames, sitemapNews } from '@/lib/db'
import { HUB_TAGS, hubPath } from '@/lib/gamehub'
import { LOCALES, lp } from '@/lib/i18n'
import { newsPath, SITEMAP_NEWS_MAX, SITEMAP_NEWS_WINDOW_SEC } from '@/lib/newspage'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'

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
 * остаётся от протокола после патчей и статических адресов (запас 100 на
 * них с лихвой: их три десятка).
 */
const PROTOCOL_MAX = 50_000
const MAX_GAMES = Math.floor((PROTOCOL_MAX - SITEMAP_NEWS_MAX * LOCALES.length - 100) / LOCALES.length)

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
  const languages = (path: string) => ({
    languages: { ru: url(path), en: url(lp('en', path)), 'x-default': url(path) },
  })
  const localized = (path: string, rest: Omit<Entry, 'url' | 'alternates'>): Entry[] =>
    LOCALES.map((locale) => ({ url: url(lp(locale, path)), alternates: languages(path), ...rest }))

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
    // переживают и сборку без каталога. Ниже хаба: хаб ссылается на них
    ...HUB_TAGS.flatMap((tag) => {
      const path = hubPath(tag)
      return path ? localized(path, { changeFrequency: 'weekly', priority: 0.7 }) : []
    }),
    ...localized('/support', { changeFrequency: 'yearly', priority: 0.3 }),
    ...localized('/privacy', { changeFrequency: 'yearly', priority: 0.2 }),
  ]

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
   */
  let news: Awaited<ReturnType<typeof sitemapNews>> = []
  try {
    news = await sitemapNews(await getDb(), nowSec() - SITEMAP_NEWS_WINDOW_SEC, SITEMAP_NEWS_MAX)
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('sitemap: патчи недоступны на сборке, отдаём без них —', String(err))
  }

  return [
    ...stat,
    ...games.flatMap((g) =>
      localized(`/game/${g.appid}`, {
        lastModified: new Date(g.updatedAt * 1000),
        changeFrequency: 'weekly',
        priority: 0.7,
      }),
    ),
    // Ниже карточек: патч — повод зайти, а не главное содержание сайта
    ...news.flatMap((n) =>
      localized(newsPath(n.appid, n.gid), {
        lastModified: new Date(n.changedAt * 1000),
        changeFrequency: 'monthly',
        priority: 0.5,
      }),
    ),
  ]
}
