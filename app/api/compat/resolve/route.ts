import { NextResponse } from 'next/server'
import { parseCompatInput } from '@/lib/compatlink'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { getDb, nowSec, steamApiKey } from '@/lib/server'
import { resolveVanity } from '@/lib/steam'

/**
 * Превращает вставленную строку в steamid64.
 *
 * Нужна ровно ради одного случая — ника: ссылка вида steamcommunity.com/id/name
 * не содержит числового идентификатора, и без обращения к Steam его не узнать.
 * Всё остальное (наша ссылка совместимости, /profiles/<id>, голый id) клиент
 * разбирает тем же parseCompatInput у себя и сюда не ходит вовсе.
 *
 * Своя ручка, а не /api/connect: тот ВЫДАЁТ СЕССИЮ. Смотреть чужую
 * совместимость, перелогинившись в чужую личность, — не то, чего человек
 * просил, нажимая «Открыть».
 *
 * Ключ лимита — IP: сессии здесь может не быть вовсе (хаб теперь открыт
 * гостю), а ручка тратит нашу квоту Steam.
 */
const RESOLVE_LIMIT = 20
const RESOLVE_WINDOW_SEC = 600

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { input?: string }
  const parsed = parseCompatInput(String(body.input ?? ''))
  if (!parsed) return NextResponse.json({ error: 'badinput' }, { status: 400 })

  // Числовой id резолвить нечего — отвечаем сразу, не трогая ни лимит, ни Steam.
  // Клиент до этой ветки обычно не доходит, но ручка не должна зависеть от того,
  // насколько сообразителен её вызывающий.
  if (parsed.kind === 'steamid64') return NextResponse.json({ steamid: parsed.value })

  const gate = await checkRate(await getDb(), {
    bucket: 'compat-resolve',
    id: clientIp(req.headers),
    limit: RESOLVE_LIMIT,
    windowSec: RESOLVE_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const key = steamApiKey()
  if (!key) return NextResponse.json({ error: 'nokey' }, { status: 503 })

  const steamid = await resolveVanity(parsed.value, { apiKey: key }).catch(() => null)
  if (!steamid) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  return NextResponse.json({ steamid })
}
