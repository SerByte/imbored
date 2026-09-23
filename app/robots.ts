import type { MetadataRoute } from 'next'
import { ROBOTS_DISALLOW } from '@/lib/robots'
import { appBaseUrl } from '@/lib/server'

/**
 * До этого файла домен отдавал заглушку Cloudflare про content-signals: ни
 * Sitemap, ни Disallow, то есть краулер ходил куда угодно.
 *
 * Что закрыто и почему — в lib/robots.ts: тот же модуль задаёт noindex-
 * заголовки в next.config.ts, и два списка не могут разъехаться.
 *
 * ЛИЧНЫЕ СТРАНИЦЫ ЗДЕСЬ БОЛЬШЕ НЕ ЗАКРЫТЫ. /portrait/, /compat/ и /room/
 * стояли в Disallow с пометкой «на шеринг это не влияет — превью берутся по
 * прямой ссылке». Для краулера X это неверно: он соблюдает robots.txt, и
 * карточки этих страниц в X не разворачивались. А Google не видел их noindex
 * и мог проиндексировать голый адрес по внешней ссылке. Из поиска их теперь
 * убирает X-Robots-Tag (см. PERSONAL_PREFIXES).
 *
 * ХАБЫ /portrait И /compat ЗАКРЫТЫ ПО-ПРЕЖНЕМУ, после замера на деплое
 * запросом без куки: 232 и 230 символов видимого текста — шапка и подвал.
 * Теперь гостя с них разворачивает proxy.ts, и индексировать там нечего тем
 * более. Если хабы когда-нибудь начнут отдавать содержание серверу, их надо
 * будет открыть — ради этого замер и записан.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...ROBOTS_DISALLOW],
    },
    sitemap: new URL('/sitemap.xml', appBaseUrl()).toString(),
  }
}
