import { indexNowKey } from '@/lib/indexnow'

/**
 * Файл ключа IndexNow — доказательство, что пинг о страницах imbored.cc шлёт
 * хозяин сайта (lib/indexnow). Лежит в корне: ключ из корня покрывает весь
 * хост, а из подпапки — только её адреса. Имя фиксированное, путь к нему
 * уходит в пинге как keyLocation.
 *
 * Ключ публичен по устройству протокола, секрета здесь нет. Не задан — 404:
 * без ключа пинга не бывает, и отдавать нечего.
 */
export const dynamic = 'force-dynamic'

export function GET(): Response {
  const key = indexNowKey()
  if (!key) return new Response('Not found', { status: 404 })
  return new Response(key, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
