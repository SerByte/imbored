import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { unbanGame } from '@/lib/db'
import { portraitTag } from '@/lib/portraitmodel'
import { getDb, requireWriter } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'

/**
 * Снятие бана. Отдельный роут, а не пятое значение action в /api/feedback:
 * тот пишет историю и обязан оставаться append-only, а этот удаляет
 * пользовательские строки (как и /api/unlike). Разные права — разные двери.
 */
export async function POST(req: Request) {
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  const { steamid } = writer

  const body = (await readJsonObject(req)) as { appid?: number }
  const appid = Number(body.appid)
  // appid бывает отрицательным — под такими id лежат игры чужих магазинов
  if (!Number.isInteger(appid) || appid === 0) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  // Вернувшаяся игра снова может стать стартовой на портрете (см. /api/feedback).
  // Только когда бан и правда снят: пустое снятие портрет не меняет, а сброс
  // на каждый повтор кнопки или круг скрипта — работа кэша впустую.
  //
  // Своего потолка у роута нет, и это не забыто: DELETE на повторе ничего не
  // пишет, а снимать есть что лишь после бана — записи через /api/feedback с
  // его потолками. Так что и сбросы кэша ограничены ими же
  if (await unbanGame(await getDb(), steamid, appid)) revalidateTag(portraitTag(steamid), 'max')
  return NextResponse.json({ ok: true })
}
