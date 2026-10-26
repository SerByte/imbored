import { NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron'
import { routePaths, splitLocale } from '@/lib/i18n'
import { isRevalidatablePath, revalidateSitePath } from '@/lib/revalidate'

export const dynamic = 'force-dynamic'

/**
 * Сколько адресов за вызов. Каждый — две пометки (оба языка), и ответ
 * перечисляет все: полсотни — это ещё список, который читается глазами.
 * Больше — несколькими вызовами; молча обрезать хвост роут не будет.
 */
const MAX_PATHS = 50

/**
 * Ручной сброс кэша ISR по названным адресам — вместо Redeploy.
 *
 * После ручных проходов по данным (catalog:media, repair-names, описания,
 * pages:enrich) DEPLOY.md велел делать Redeploy: новый деплой — новый кэш
 * ISR. Так и есть, и это самый дорогой способ. Деплой выбрасывает кэш
 * целиком, и потом каждый адрес, который зашедший краулер найдёт холодным,
 * рендерится функцией и пишется заново: карточка игры — около 224 КБ, ~30
 * блоков ISR Writes по 8 КБ, а адресов у сайта на двух языках — десятки
 * тысяч. Лимит Hobby — 200 тысяч блоков на окно, и в октябре 2026 сайт
 * остановили именно за него. Этот роут помечает только то, что назвали:
 * пометка ничего не рендерит (revalidatePath из Route Handler, docs Next),
 * перегенерация — при следующем заходе, и запись — только если вывод и
 * правда поменялся.
 *
 *   GET /api/cron/revalidate?path=/game/730&path=/game/730/opengraph-image
 *   x-cron-secret: <CRON_SECRET>   (или Authorization: Bearer — cronAuthorized)
 *
 * path — адрес так, как его видит человек, с языком или без: '/game/730' и
 * '/en/game/730' значат одно и то же, сбрасываются обе копии
 * (revalidateSitePath). Повторы схлопываются. Принимается только то, у чего
 * есть что сбрасывать (isRevalidatablePath в lib/revalidate.ts): страница
 * сайта или файл корня с ISR (/sitemap.xml, /search-index.json). Хоть один
 * чужой адрес — 400 со списком и ни одной пометки: опечатку в адресе
 * revalidatePath не заметил бы, и сброс «прошёл» бы, ничего не сбросив.
 *
 * Карточка — отдельный адрес. revalidatePath сбрасывает только названный
 * путь, не вложенные (lib/gamecache.ts): новое имя игры после repair-names
 * доедет до /game/<appid>, а до /game/<appid>/opengraph-image — только если
 * назвать и её.
 *
 * Сброса «всего раздела» (revalidatePath('/[lang]/game/[appid]', 'page'))
 * здесь нет намеренно: это тот же Redeploy другими словами — каждая карточка
 * игры, на которую зайдёт краулер, рендерится и пишется заново.
 *
 * Закрыт тем же секретом и так же, как кроны: без секрета это была бы
 * кнопка «перерендерить сайт» для любого. GET — как у кронов: proxy.ts
 * сверяет Origin только у изменяющих методов, и запрос с секретом из curl
 * или воркфлоу проходит мимо этой проверки.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const asked = new URL(req.url).searchParams.getAll('path')
  if (!asked.length) return NextResponse.json({ error: 'no-path' }, { status: 400 })
  if (asked.length > MAX_PATHS) {
    return NextResponse.json({ error: 'too-many', max: MAX_PATHS, got: asked.length }, { status: 400 })
  }
  const rejected = asked.filter((p) => !isRevalidatablePath(p))
  if (rejected.length) return NextResponse.json({ error: 'not-site-path', rejected }, { status: 400 })

  // Без языка: '/en/game/730' и '/game/730' — один сброс обеих копий;
  // /sitemap.xml языка не имеет и остаётся как есть
  const bare = [...new Set(asked.map((p) => splitLocale(p).path))]
  for (const path of bare) revalidateSitePath(path)
  return NextResponse.json(
    { marked: bare.flatMap((path) => routePaths(path)) },
    { headers: { 'cache-control': 'no-store' } },
  )
}
