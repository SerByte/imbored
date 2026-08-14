import type { MetadataRoute } from 'next'
import { sitemapGames } from '@/lib/db'
import { appBaseUrl, getDb } from '@/lib/server'

/**
 * Карта сайта. Раньше её не было вовсе, и единственное содержание проекта —
 * страницы игр с русскими «за что любят / за что ругают», отзывами и
 * патчноутами — для поиска просто не существовало.
 *
 * Публиковать её стало можно только после того, как loadGamePage перестал
 * ходить в сеть и звать модель: до этой правки карта сайта означала бы, что мы
 * сами приводим краулер в платный эндпоинт по пяти тысячам адресов.
 */

/** Потолок одного файла по протоколу — 50 000 URL; столько нам и не нужно. */
const MAX_GAMES = 5000

/** Сутки: чаще каталог всё равно не меняется, а запрос стоит прочитанных строк. */
export const revalidate = 86_400

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appBaseUrl()
  const url = (path: string) => new URL(path, base).toString()

  const stat: MetadataRoute.Sitemap = [
    { url: url('/'), changeFrequency: 'weekly', priority: 1 },
    { url: url('/daily'), changeFrequency: 'daily', priority: 0.9 },
    { url: url('/whatsnew'), changeFrequency: 'daily', priority: 0.8 },
    { url: url('/support'), changeFrequency: 'yearly', priority: 0.3 },
    { url: url('/privacy'), changeFrequency: 'yearly', priority: 0.2 },
  ]

  // Падать из-за базы здесь нельзя, и try/catch обязан накрывать getDb() тоже:
  // он бросает сам, когда в продакшен-окружении не задан TURSO_DATABASE_URL, —
  // а этот файл пререндерится на сборке, то есть незакрытый вызов роняет весь
  // build, а не одну карту сайта. Без карты проект живёт; с пятисотой на
  // /sitemap.xml поисковик перестаёт доверять и уже известным адресам.
  let games: Awaited<ReturnType<typeof sitemapGames>> = []
  try {
    games = await sitemapGames(await getDb(), MAX_GAMES)
  } catch (err) {
    console.error('sitemap: каталог недоступен, отдаём только статические адреса', err)
  }

  return [
    ...stat,
    ...games.map((g) => ({
      url: url(`/game/${g.appid}`),
      lastModified: new Date(g.updatedAt * 1000),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ]
}
