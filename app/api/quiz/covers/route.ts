import { NextResponse } from 'next/server'
import { getGamesMeta, getLatestSnapshot } from '@/lib/db'
import { DEMO_METAS, demoLibrary } from '@/lib/demo'
import { pickQuizCovers, pickQuizShelf, type QuizCover, type QuizCovers } from '@/lib/quizart'
import { buildQuizCounts, type QuizCounts } from '@/lib/quizcount'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'

/**
 * Обложки под ответы квиза: стопки панелей и полка бэклога.
 *
 * Дешёвый маршрут по замыслу: снимок библиотеки и метаданные по её же appid —
 * два запроса, оба ограничены списком id. Полка считается из тех же данных,
 * без единого нового запроса. Ни каталожного пула, ни обновления цен, ни
 * Anthropic: экран не должен ждать, а квиз не должен стоить как выдача.
 * (Ограниченность по appid — не вкусовщина, за неё отвечает lib/noscan.test.ts.)
 *
 * 401 здесь нет намеренно, как и в /api/whatsnew/head. /quiz полностью доступен
 * без входа — стена стоит на /play, — и маршрут, отвечающий гостю ошибкой,
 * сыпал бы её на живом трафике.
 *
 * Кому какие обложки:
 *  - вошедший видит ТОЛЬКО свою библиотеку. Если она ещё не прогрета, ответ
 *    пустой и панели остаются стеклянными: это честная деградация. Подставить
 *    сюда демо-игры значило бы выдать чужие обложки за «из твоей библиотеки»;
 *  - гость видит демо-набор. Своей библиотеки у него нет вовсе, и выбор здесь
 *    не между правдой и неправдой, а между задуманным экраном и пустым.
 */
export async function GET(req: Request) {
  const untouchedOnly = new URL(req.url).searchParams.get('focus') === 'untouched'
  const now = nowSec()
  const steamid = await currentSteamId()

  if (steamid) {
    const db = await getDb()
    const snapshot = await getLatestSnapshot(db, steamid)
    const games = snapshot?.games ?? []
    if (!games.length) return json({}, null, [])

    const metas = await getGamesMeta(
      db,
      games.map((g) => g.appid),
    )
    const metaOf = (appid: number) => metas.get(appid)
    return json(
      pickQuizCovers({ library: games, metaOf, seed: steamid, nowSec: now, untouchedOnly }),
      buildQuizCounts({ library: games, metaOf, nowSec: now }),
      // Без exclude по стопкам: сервер не знает, какой шаг на экране, а вычет
      // всех 21 обложки морил полку голодом на небольших библиотеках. Совпадения
      // с ВИДИМЫМИ панелями прячет клиент по текущему шагу (app/quiz/page.tsx).
      pickQuizShelf({ library: games, metaOf, seed: steamid, nowSec: now, untouchedOnly }),
    )
  }

  /*
   * Гостю — обложки, но НЕ число.
   *
   * Обложка без названия и в размытии — фактура: она делает экран задуманным и
   * ничего не утверждает. Число же подписано «в бэклоге», и посчитанное по
   * демо-библиотеке оно было бы прямой неправдой человеку, у которого никакого
   * бэклога здесь ещё нет.
   */
  const demo = new Map(DEMO_METAS.map((m) => [m.appid, m]))
  const demoMetaOf = (appid: number) => demo.get(appid)
  return json(
    pickQuizCovers({
      library: demoLibrary(now),
      metaOf: demoMetaOf,
      seed: '',
      nowSec: now,
      untouchedOnly,
    }),
    null,
    pickQuizShelf({ library: demoLibrary(now), metaOf: demoMetaOf, seed: '', nowSec: now, untouchedOnly }),
  )
}

function json(covers: QuizCovers, counts: QuizCounts | null, shelf: QuizCover[]) {
  return NextResponse.json(
    // Поля отсутствуют, а не равны нулю/пустоте: клиент рисует блок только
    // тогда, когда данным можно верить — см. докблок MIN_COVERAGE в
    // lib/quizcount.ts; пустая полка не рисуется вовсе
    { covers, ...(counts ? { counts } : {}), ...(shelf.length ? { shelf } : {}) },
    {
      headers: {
        // Ответ персональный: по нему читается состав библиотеки.
        'Cache-Control': 'private, no-store, max-age=0',
        Vary: 'Cookie',
      },
    },
  )
}
