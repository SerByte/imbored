import { NextResponse } from 'next/server'
import { getFeedHeadForApps, getLatestSnapshot, getMajorFeedHead } from '@/lib/db'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { resolveWhatsNew } from '@/lib/whatsnewfeed'

export const dynamic = 'force-dynamic'

/**
 * Голова ленты «Что нового» — чтобы вкладка могла спросить «появилось ли
 * новое», не перекачивая тела тридцати патчей.
 *
 * Отдаёт ровно те же ключи в том же порядке, что отрисует страница: ветка
 * выбора ленты общая (lib/whatsnewfeed), запросы — зеркала getMajorFeed и
 * getFeedForApps. Иначе плашка обещала бы обновления, которых после
 * обновления страницы не появится.
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

  const { items, showPopular } = await resolveWhatsNew({
    steamid,
    wantsPopular,
    snapshot: (id) => getLatestSnapshot(db, id),
    forApps: (appids, limit) => getFeedHeadForApps(db, appids, limit),
    major: (limit, minRank) => getMajorFeedHead(db, limit, { minRank }),
  })

  return NextResponse.json(
    {
      showPopular,
      now: nowSec(),
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
