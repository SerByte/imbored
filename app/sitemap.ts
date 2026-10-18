import type { MetadataRoute } from 'next'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { sitemapGames, sitemapNews, sitemapPatchArchives } from '@/lib/db'
import { facetPath, HUB_FACETS, HUB_TAGS, hubPath, type HubFacet } from '@/lib/gamehub'
import { newsPath, SITEMAP_NEWS_MAX, SITEMAP_NEWS_WINDOW_SEC } from '@/lib/newspage'
import { PATCH_ARCHIVE_MIN, patchArchivePath } from '@/lib/patcharchive'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'
import { loadGenre, thinList } from './games/[tag]/load'

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
 */
const MAX_GAMES = 50_000

/** Сутки: чаще каталог всё равно не меняется, а запрос стоит прочитанных строк. */
export const revalidate = 86_400

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appBaseUrl()
  const url = (path: string) => new URL(path, base).toString()

  const stat: MetadataRoute.Sitemap = [
    { url: url('/'), changeFrequency: 'weekly', priority: 1 },
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
    { url: url('/whatsnew'), changeFrequency: 'daily', priority: 0.8 },
    /*
     * /quiz — наоборот: гость видит первый вопрос целиком, и это главная
     * точка входа в продукт, на которую ведёт каждая карточка игры. Он
     * открыт краулеру и идёт в выдачу со своим canonical (lib/robots,
     * app/quiz/layout.tsx). Ниже хаба жанров: квиз один и не меняется.
     */
    { url: url('/quiz'), changeFrequency: 'monthly', priority: 0.6 },
    // Хаб жанров: единственная страница, которая ссылается на карточки пачкой
    // (см. app/games/page.tsx). Полки меняются медленно — верх по отзывам
    // стоит неделями, — отсюда weekly, а не daily.
    { url: url('/games'), changeFrequency: 'weekly', priority: 0.8 },
    // Страницы жанров — адреса известны без базы (HUB_GENRES), поэтому
    // переживают и сборку без каталога. Ниже хаба: хаб ссылается на них
    ...HUB_TAGS.flatMap((tag) => {
      const path = hubPath(tag)
      return path ? [{ url: url(path), changeFrequency: 'weekly' as const, priority: 0.7 }] : []
    }),
    { url: url('/support'), changeFrequency: 'yearly', priority: 0.3 },
    { url: url('/privacy'), changeFrequency: 'yearly', priority: 0.2 },
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

  /*
   * Архивы обновлений игр (/game/<appid>/news) — своим try, как патчи: у них
   * своя выборка, и её сбой на сборке не должен уносить остальное. Только
   * архивы, в которых есть своё — пересказы (PATCH_ARCHIVE_MIN, lib/patcharchive);
   * остальные открыты по ссылке с карточки, но звать туда краулер незачем.
   */
  let archives: Awaited<ReturnType<typeof sitemapPatchArchives>> = []
  try {
    archives = await sitemapPatchArchives(await getDb(), PATCH_ARCHIVE_MIN, SITEMAP_NEWS_MAX)
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('sitemap: архивы обновлений недоступны на сборке, отдаём без них —', String(err))
  }

  /*
   * Подборки по факту («с другом», «на 20 минут»…) — не все и не всегда, в
   * отличие от жанров. Жанры подобраны руками так, чтобы полка была полной, а
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
   */
  let facets: HubFacet[] = []
  try {
    const pages = await Promise.all(HUB_FACETS.map((f) => loadGenre(f.slug)))
    facets = HUB_FACETS.filter((_, i) => {
      const page = pages[i]
      return page != null && !thinList(page.games)
    })
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('sitemap: подборки недоступны на сборке, отдаём без них —', String(err))
  }

  return [
    ...stat,
    // Тот же сегмент и тот же ранг, что у жанров
    ...facets.map((f) => ({ url: url(facetPath(f)), changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...games.map((g) => ({
      url: url(`/game/${g.appid}`),
      lastModified: new Date(g.updatedAt * 1000),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    // Между карточкой и патчем: ответ на «обновления X» — один адрес на игру,
    // а не десятки одинаковых заголовков Steam. lastmod — свежий патч или
    // пересказ (sitemapPatchArchives), а не перезаписанный вес
    ...archives.map((a) => ({
      url: url(patchArchivePath(a.appid)),
      lastModified: new Date(a.changedAt * 1000),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    // Ниже карточек: патч — повод зайти, а не главное содержание сайта
    ...news.map((n) => ({
      url: url(newsPath(n.appid, n.gid)),
      lastModified: new Date(n.changedAt * 1000),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ]
}
