import { NextResponse } from 'next/server'
import { unbanGame } from '@/lib/db'
import { currentSteamId, getDb } from '@/lib/server'

/**
 * Снятие бана. Отдельный роут, а не пятое значение action в /api/feedback:
 * тот пишет историю и обязан оставаться append-only, а этот единственный в
 * проекте удаляет пользовательские строки. Разные права — разные двери.
 */
export async function POST(req: Request) {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { appid?: number }
  const appid = Number(body.appid)
  // appid бывает отрицательным — под такими id лежат игры чужих магазинов
  if (!Number.isInteger(appid) || appid === 0) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  await unbanGame(await getDb(), steamid, appid)
  return NextResponse.json({ ok: true })
}
