import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { unbanGame } from '@/lib/db'
import { portraitTag } from '@/lib/portraitmodel'
import { getDb, requireWriter } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'

/**
 * Снятие бана. Отдельный роут, а не пятое значение action в /api/feedback:
 * тот пишет историю и обязан оставаться append-only, а этот единственный в
 * проекте удаляет пользовательские строки. Разные права — разные двери.
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

  await unbanGame(await getDb(), steamid, appid)
  // Вернувшаяся игра снова может стать стартовой на портрете (см. /api/feedback)
  revalidateTag(portraitTag(steamid), 'max')
  return NextResponse.json({ ok: true })
}
