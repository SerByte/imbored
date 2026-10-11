import { NextResponse } from 'next/server'
import { getFeedHeadForApps, getLatestSnapshot, type FeedHeadItem } from '@/lib/db'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { cachedMajorFeed } from '@/lib/whatsnewcache'
import { resolveWhatsNew } from '@/lib/whatsnewfeed'

export const dynamic = 'force-dynamic'

/**
 * Голова ленты «Что нового» — чтобы вкладка могла спросить «появилось ли
 * новое», не перекачивая тела тридцати патчей.
 *
 * Отдаёт ровно те же ключи в том же порядке, что отрисует страница: ветка
 * выбора ленты общая (lib/whatsnewfeed), а getMajorFeed и getFeedForApps
 * собирают ленту из этих же голов, добирая к ним только тела. Иначе плашка
 * обещала бы обновления, которых после обновления страницы не появится.
 *
 * Совпадать обязан не только состав, но и МОМЕНТ. Общая часть читается не из
 * базы, а из той же записи кэша, что рисует страница (cachedMajorFeed, тот же
 * ключ limit+minRank через resolveWhatsNew). Голова, читавшая базу напрямую,
 * видела патч сразу после вставки кроном, а страница — только когда кэш
 * перегенерируется: revalidateTag(…, 'max') отдаёт первому запросу после
 * сброса устаревшее, а сбрасывает крон лишь в конце запуска. Плашка звала
 * router.refresh(), тот рисовал прежнюю запись — те же ключи, то же число на
 * плашке, клик впустую. Теперь первым устаревшее получает опрос: он же и
 * запускает перегенерацию, следующий опрос видит новое, и клик приходит в уже
 * свежую запись. Отдельный кэш под голову не годится: две записи
 * stale-while-revalidate обновляются независимо и снова разъезжаются.
 *
 * Цена — опрос читает из кэша тела тридцати патчей вместо ста двадцати узких
 * строк Turso; наружу по-прежнему уходят только ключи. Личная часть остаётся
 * живой — как и на странице.
 *
 * 401 здесь нет намеренно: гость — полноценный посетитель этой ленты, ему
 * отвечает общая вкладка. Ключ склеен как `appid:gid` — это дословно тот же
 * React-ключ, что у строк на странице, так что клиент сравнивает строки со
 * строками и ничего не выводит заново.
 */
export async function GET(req: Request) {
  const wantsPopular = new URL(req.url).searchParams.get('feed') === 'popular'
  const steamid = await currentSteamId()
  const db = await getDb()

  const now = nowSec()
  const { items, showPopular } = await resolveWhatsNew({
    steamid,
    wantsPopular,
    nowSec: now,
    snapshot: (id) => getLatestSnapshot(db, id),
    forApps: (appids, limit, since) => getFeedHeadForApps(db, appids, limit, undefined, since),
    // Явная проекция держит T головой (FeedHeadItem), как у forApps: тела
    // из кэша дальше этой строки не едут
    major: async (limit, minRank): Promise<FeedHeadItem[]> =>
      (await cachedMajorFeed(limit, minRank)).map(({ appid, gid, publishedAt }) => ({
        appid,
        gid,
        publishedAt,
      })),
  })

  return NextResponse.json(
    {
      showPopular,
      now,
      items: items.map((i) => ({ k: `${i.appid}:${i.gid}`, at: i.publishedAt })),
    },
    {
      headers: {
        // Ответ персональный: по нему читается состав библиотеки. cookies()
        // и так делает маршрут динамическим, но здесь цена ошибки — чужая
        // лента в общем кэше, а не лишний рендер.
        'Cache-Control': 'private, no-store, max-age=0',
        Vary: 'Cookie',
      },
    },
  )
}
