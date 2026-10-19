import { manifestFor } from '@/lib/manifest'

/**
 * Английский манифест — /manifest.en.webmanifest: имя, описание, ярлыки и
 * снимки английской версии, start_url и id — /en. На него ссылается
 * корневой layout на /en (metadata.manifest); что в манифесте и почему он не
 * под /en — в lib/manifest.ts.
 *
 * Обычный route handler, а не файловая метадата: app/manifest.ts у корня
 * один, и Next заводит из него ровно /manifest.webmanifest. Ответ — как у
 * того: тот же JSON.stringify (resolveManifest в Next), тот же тип
 * application/manifest+json и те же заголовки кэша. Статический: строк из
 * базы в нём нет, и пересобирать его не из чего.
 */
export const dynamic = 'force-static'

export function GET(): Response {
  return new Response(JSON.stringify(manifestFor('en')), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
