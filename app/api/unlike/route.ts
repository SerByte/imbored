import { NextResponse } from 'next/server'
import { unlikeGame } from '@/lib/db'
import { getDb, requireWriter } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'

/**
 * Снять «зашло» — кнопка на полке /library (components/LikedShelf) и второе
 * нажатие сердца у героя /play и /daily. Клиент у них один — lib/unlike: он
 * же ставит снятие в очередь за «Зашло» той же игры, ещё не доехавшим сюда.
 *
 * Снимают они разное (unlikeGame в lib/db). Полка — всё, что сервер помнит
 * «зашло» про игру: её она и показывает. Сердце героя — только строку,
 * которую легло его нажатие (row из ответа /api/feedback): о прежних «зашло»
 * оно не знает, и снятие всего стирало бы и их. Нет row в теле — полка;
 * есть, но не id строки, — 400, а не «снять всё»: битое снятие у героя не
 * должно молча становиться самым широким.
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

  const body = (await readJsonObject(req)) as { appid?: number; row?: unknown }
  const appid = Number(body.appid)
  // appid бывает отрицательным — под такими id лежат игры чужих магазинов
  if (!Number.isInteger(appid) || appid === 0) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }
  // id строки feedback — AUTOINCREMENT, с единицы. Строка в теле не
  // приводится к числу: клиент шлёт то, что получил числом
  const { row } = body
  if (row !== undefined && !(Number.isSafeInteger(row) && (row as number) > 0)) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  await unlikeGame(await getDb(), steamid, appid, row as number | undefined)
  return NextResponse.json({ ok: true })
}
