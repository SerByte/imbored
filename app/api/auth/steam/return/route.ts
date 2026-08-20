import { NextResponse } from 'next/server'
import { saveLibrarySnapshot, upsertUser } from '@/lib/db'
import { safeNext } from '@/lib/nav'
import { checkRate, clientIp } from '@/lib/ratelimit'
import {
  SESSION_COOKIE,
  appBaseUrl,
  getDb,
  issueSession,
  nowSec,
  sessionCookieOptions,
  steamApiKey,
} from '@/lib/server'
import { fetchOwnedGames, fetchPlayerSummary } from '@/lib/steam'
import { verifyAssertion } from '@/lib/steam-openid'

/**
 * Каждый вызов этой ручки — исходящий POST на steamcommunity.com
 * (check_authentication), то есть чужой ресурс, который мы тратим от своего
 * имени. Плюс за проверкой идут ещё два запроса в Steam Web API по нашему
 * ключу. Ключ по IP: steamid до проверки ассерта доверия не заслуживает, а
 * после проверки ограничивать уже поздно — деньги потрачены.
 */
const RETURN_LIMIT = 20
const RETURN_WINDOW_SEC = 600

export async function GET(req: Request) {
  const base = appBaseUrl()
  const params = new URL(req.url).searchParams

  // Отказ — редиректом, а не 429 JSON'ом: сюда человека приводит браузер после
  // Steam, и увидеть он должен страницу, а не тело ответа.
  const gate = await checkRate(await getDb(), {
    bucket: 'steam-return',
    id: clientIp(req.headers),
    limit: RETURN_LIMIT,
    windowSec: RETURN_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return NextResponse.redirect(`${base}/?error=busy`)

  const steamid = await verifyAssertion(params).catch(() => null)
  if (!steamid) return NextResponse.redirect(`${base}/?error=auth`)

  const key = steamApiKey()
  if (!key) return NextResponse.redirect(`${base}/?error=nokey`)

  try {
    const db = await getDb()
    const now = nowSec()
    const summary = await fetchPlayerSummary(steamid, { apiKey: key }).catch(() => null)
    const games = await fetchOwnedGames(steamid, { apiKey: key })
    if (games === 'private') return NextResponse.redirect(`${base}/?error=private`)
    if (!games.length) return NextResponse.redirect(`${base}/?error=empty`)

    await upsertUser(
      db,
      {
        steamid,
        ...(summary?.personaName ? { personaName: summary.personaName } : {}),
        ...(summary?.avatarUrl ? { avatarUrl: summary.avatarUrl } : {}),
      },
      now,
    )
    await saveLibrarySnapshot(db, steamid, games, now)

    /*
     * Куда вернуть.
     *
     * Раньше третьей веткой было безусловное /quiz, и это стоило дороже, чем
     * выглядит: человек, нажавший «войти» с игровой страницы, из библиотеки
     * или с демо-выдачи, получал анкету вместо того места, где стоял, — а на
     * демо-выдаче вместе с ней терял и уже отвеченные три вопроса.
     *
     * safeNext повторяется здесь, хотя тот же параметр уже проверен при входе:
     * это значение из URL, и единственная причина ему доверять — то, что мы
     * сами его проверили. Проверить дважды дешевле, чем однажды забыть.
     */
    const next = safeNext(params.get('next'))
    const join = params.get('join')
    const compat = params.get('compat')
    const target =
      join && /^[A-Z0-9]{6}$/.test(join)
        ? `${base}/room/${join}`
        : compat && /^\d{17}$/.test(compat)
          ? `${base}/compat/${compat}`
          : next
            ? `${base}${next}`
            : `${base}/quiz`
    const res = NextResponse.redirect(target)
    res.cookies.set(
      SESSION_COOKIE,
      // Единственное место, где владение профилем ДОКАЗАНО: выше отработал
      // verifyAssertion. Признак разрешает разрушительное — см. докблок
      // Resolved.verified в lib/sessions.
      await issueSession(steamid, req.headers.get('user-agent'), { verified: true }),
      sessionCookieOptions(),
    )
    return res
  } catch {
    return NextResponse.redirect(`${base}/?error=steam`)
  }
}
