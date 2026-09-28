import { NextResponse } from 'next/server'
import { unlikeGame } from '@/lib/db'
import { getDb, requireWriter } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'

/**
 * Снять «зашло» — кнопка на полке /library (components/LikedShelf).
 *
 * Отдельный роут по той же причине, что /api/unban: /api/feedback пишет
 * историю и остаётся append-only, а здесь строки удаляются. Права — те же,
 * что у записи фидбека: по вставленной ссылке на чужой профиль это было бы
 * «переписать человеку вкус».
 *
 * Кэш портрета не сбрасывается: портрет читает баны, а не оценки
 * (lib/portraitmodel).
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

  await unlikeGame(await getDb(), steamid, appid)
  return NextResponse.json({ ok: true })
}
