import { NextResponse } from 'next/server'
import { memberLabel } from '@/lib/room'
import { getLatestSnapshot, getRoom, roomMembers } from '@/lib/db'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { buildTrivia, loadTriviaCatalog } from '@/lib/trivia'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/
const MAX_ROUND = 9

/**
 * Потолок, которого тут не было вовсе — при том, что вызов не из дешёвых.
 *
 * Один заход это getLatestSnapshot НА КАЖДОГО участника (библиотека целиком,
 * не счётчик) плюс окно каталога на восемьдесят строк. Кэша нет и быть не
 * может: seed склеен из комнаты, человека и раунда, каждый ответ уникален.
 *
 * Дорога к перебору — не запрос руками, а кнопка «ещё» в самой панели: раунд
 * упирается в MAX_ROUND, но КАЖДОЕ нажатие после этого честно поднимает
 * снапшоты всех заново. Зажатая кнопка в комнате на восьмерых — это восемь
 * библиотек и восемьдесят строк каталога за клик, без края.
 *
 * Тридцать на пять минут против десяти раундов у играющего человека: тройной
 * запас на переоткрытие панели и на новый раунд колоды, и всё равно край.
 */
const TRIVIA_LIMIT = 30
const TRIVIA_WINDOW_SEC = 300

/**
 * Вопросы «пока ждём». Разовый запрос, вне цикла опроса.
 *
 * Ответы лежат в самих вопросах — намеренно, см. докблок lib/trivia.ts.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  if (!(await getRoom(db, id))) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  const members = await roomMembers(db, id)
  if (!members.some((m) => m.steamid === steamid)) {
    return NextResponse.json({ error: 'notmember' }, { status: 403 })
  }

  // После проверки членства — как у соседнего /deck: чужие попытки уже отсечены
  // 403 выше, тратить на них строки ограничителя незачем.
  const gate = await checkRate(db, {
    bucket: 'room-trivia',
    id: steamid,
    limit: TRIVIA_LIMIT,
    windowSec: TRIVIA_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const raw = Number(new URL(req.url).searchParams.get('round') ?? 0)
  const round = Math.min(MAX_ROUND, Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : 0))
  const seed = `${id}:${steamid}:${round}`

  const party = await Promise.all(
    members.map(async (m) => ({
      steamid: m.steamid,
      name: memberLabel(id, m.steamid, m.personaName),
      library: (await getLatestSnapshot(db, m.steamid))?.games ?? [],
    })),
  )

  const catalog = await loadTriviaCatalog(db, seed)
  const questions = buildTrivia({ seed, catalog, party })

  // Пустой список — легальный ответ: клиент просто не покажет блок
  return NextResponse.json({ round, questions })
}
