import { NextResponse } from 'next/server'
import { getNewsBlocks } from '@/lib/db'
import { isEnglishText } from '@/lib/englishtext'
import { isNewsGid } from '@/lib/newspage'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { getDb, nowSec } from '@/lib/server'
import { blocksToText } from '@/lib/steamhtml'

/**
 * Тело одного патча по требованию.
 *
 * Зачем отдельный маршрут: строки ленты «Что нового» раскрываются на месте, и
 * тела всех тридцати ехали в разметке страницы заранее. На проде это 277 КБ из
 * 476 — 58 % веса страницы на текст, который читают у одной строки из тридцати.
 * Теперь тело приезжает по клику, а PatchRow берёт его на наведение курсора,
 * так что до самого клика оно обычно уже здесь.
 *
 * Ответ ОБЩИЙ и потому кэшируется на грани: пара appid+gid однозначно
 * определяет патч, и он один и тот же для всех. То есть «лишний запрос» после
 * первого читателя не доходит до функции вовсе — и до базы тем более.
 *
 * english — признак САМОГО ТЕЛА, а не читателя: годится ли оно для /en
 * (isEnglishText над первыми 600 знаками — то же правило, по которому
 * newsDescription берёт начало поста и ридер /en отдаёт тело, lib/newspage и
 * getRssFeedForApps). Русского тела на /en нет (docs/i18n.md, п. 8–9): строка
 * ленты там показывает вместо него ссылку на оригинал. Решает сервер, а не
 * островок: правило с его словарями служебных слов не едет в бандл ленты и
 * карточки игры. И языка в адресе поэтому нет: ответ один для обеих версий и
 * кэшируется на грани по-прежнему одной записью. Своё английское тело
 * (blocks_en_json) пока не пишется никем — когда появится, адрес получит
 * lang (withLang), а ответ — blocks_en ?? blocks.
 */

/** Тела патчей переписывает только крон, и то редко: сутки на грани безопасны */
const CDN_MAX_AGE = 86_400
const BROWSER_MAX_AGE = 3600

/**
 * Ограничитель — против перебора пар appid+gid мимо кэша, а не против чтения.
 * Живой человек за раскрытую минуту откроет строк пять, бот с перебором — все
 * тридцать за секунду и ещё тысячу несуществующих.
 */
const RATE_LIMIT = 60
const RATE_WINDOW_SEC = 60

export async function GET(req: Request) {
  const url = new URL(req.url)
  const appid = Number(url.searchParams.get('appid'))
  const gid = url.searchParams.get('gid')

  // Валидация до базы: gid приходит строкой из чужого ответа Steam и в SQL
  // едет параметром, но пускать в ограничитель мусор произвольной длины
  // незачем — ключ лимита строится из него же. Правило одно на этот роут и
  // страницу патча (lib/newspage).
  if (!Number.isInteger(appid) || appid <= 0 || !isNewsGid(gid)) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  const db = await getDb()
  const gate = await checkRate(db, {
    bucket: 'newsbody',
    id: clientIp(req.headers),
    limit: RATE_LIMIT,
    windowSec: RATE_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const blocks = await getNewsBlocks(db, appid, gid)
  if (!blocks) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  return NextResponse.json(
    { blocks, english: isEnglishText(blocksToText(blocks, 600)) },
    {
      headers: {
        'Cache-Control': `public, max-age=${BROWSER_MAX_AGE}, s-maxage=${CDN_MAX_AGE}, stale-while-revalidate=604800`,
      },
    },
  )
}
