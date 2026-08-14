import type { MetadataRoute } from 'next'
import { appBaseUrl } from '@/lib/server'

/**
 * До этого файла домен отдавал заглушку Cloudflare про content-signals: ни
 * Sitemap, ни Disallow, то есть краулер ходил куда угодно.
 *
 * Закрываем три разных класса адресов, и по разным причинам:
 *
 *   • /api/ — работа, а не контент. /api/prepare и /api/recommend вдобавок
 *     дёргают Steam и платную модель.
 *   • /portrait/, /compat/, /room/ — чужие личные страницы. Портрет
 *     подставляет в заголовок настоящий ник Steam, а строится он по снапшоту
 *     без всякой авторизации: в индексе такому не место. На шеринг это не
 *     влияет — превью и og:image берутся по прямой ссылке, а не из индекса.
 *   • /play, /quiz, /library — состояние сессии, а не страница. Без куки они
 *     всё равно выбрасывают на лендинг, то есть краулер индексировал бы
 *     редирект.
 *
 * Открытыми остаются ровно те разделы, у которых есть собственное содержание:
 * лендинг, /game/*, /whatsnew, /daily и статические страницы.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/portrait/', '/compat/', '/room/', '/rooms', '/play', '/quiz', '/library'],
    },
    sitemap: new URL('/sitemap.xml', appBaseUrl()).toString(),
  }
}
