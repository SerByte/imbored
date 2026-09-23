import { NextResponse, type NextRequest } from 'next/server'
import { saveLibrarySnapshot, upsertUser } from '@/lib/db'
import { checkRate, clientIp } from '@/lib/ratelimit'
import {
  OIDC_COOKIE,
  SESSION_COOKIE,
  appBaseUrl,
  getDb,
  issueSession,
  nowSec,
  oidcCookieOptions,
  sessionCookieOptions,
  steamApiKey,
} from '@/lib/server'
import { fetchOwnedGames, fetchPlayerSummary } from '@/lib/steam'
import { RETURN_PATH, stateMatches, verifyAssertion } from '@/lib/steam-openid'
import { destinationPath } from '@/lib/destination'

/**
 * Каждый вызов этой ручки — исходящий POST на steamcommunity.com
 * (check_authentication), то есть чужой ресурс, который мы тратим от своего
 * имени. Плюс за проверкой идут ещё два запроса в Steam Web API по нашему
 * ключу. Ключ по IP: steamid до проверки ассерта доверия не заслуживает, а
 * после проверки ограничивать уже поздно — деньги потрачены.
 */
const RETURN_LIMIT = 20
const RETURN_WINDOW_SEC = 600

export async function GET(req: NextRequest) {
  const base = appBaseUrl()
  const params = new URL(req.url).searchParams

  /*
   * Кука state гасится на ЛЮБОМ исходе: ассерт одноразовый, и после этого
   * запроса ей сверять больше нечего. Удачный вход оставил бы её висеть до
   * истечения, неудачный — тоже, а следующая попытка всё равно начнётся
   * заново на /api/auth/steam и получит свою.
   */
  const redirect = (url: string) => {
    const res = NextResponse.redirect(url)
    res.cookies.set(OIDC_COOKIE, '', { ...oidcCookieOptions(), maxAge: 0 })
    return res
  }

  /*
   * Сначала state — он проверяется локально и бесплатно, так что чужой или
   * подсунутый ссылкой ассерт не тратит ни строку лимита, ни запрос к Steam.
   */
  if (!stateMatches(req.cookies.get(OIDC_COOKIE)?.value, params.get('state'))) {
    return redirect(`${base}/?error=auth`)
  }

  // Отказ — редиректом, а не 429 JSON'ом: сюда человека приводит браузер после
  // Steam, и увидеть он должен страницу, а не тело ответа. Код тот же, что у
  // потолка на /api/connect, — у карточки входа для него уже есть своя строка.
  const gate = await checkRate(await getDb(), {
    bucket: 'steam-return',
    id: clientIp(req.headers),
    limit: RETURN_LIMIT,
    windowSec: RETURN_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return redirect(`${base}/?error=ratelimited`)

  const steamid = await verifyAssertion(params, `${base}${RETURN_PATH}`).catch(() => null)
  if (!steamid) return redirect(`${base}/?error=auth`)

  const key = steamApiKey()
  if (!key) return redirect(`${base}/?error=nokey`)

  try {
    const db = await getDb()
    const now = nowSec()
    const summary = await fetchPlayerSummary(steamid, { apiKey: key }).catch(() => null)
    const games = await fetchOwnedGames(steamid, { apiKey: key })
    if (games === 'private') return redirect(`${base}/?error=private`)
    if (!games.length) return redirect(`${base}/?error=empty`)

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

    const join = params.get('join')
    const compat = params.get('compat')
    // Куда человек шёл до разворота на лендинг; список закрытый —
    // произвольный адрес сюда не попадёт (см. lib/destination.ts).
    const next = destinationPath(params.get('next'))
    const target =
      join && /^[A-Z0-9]{6}$/.test(join)
        ? `${base}/room/${join}`
        : compat && /^\d{17}$/.test(compat)
          ? `${base}/compat/${compat}`
          : `${base}${next ?? '/quiz'}`
    const res = redirect(target)
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
    return redirect(`${base}/?error=steam`)
  }
}
