import { NextResponse, type NextRequest } from 'next/server'
import { saveLibrarySnapshot, upsertUser } from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
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
import { loginCarry, loginTarget } from '@/lib/destination'

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
   * Отказ везёт с собой join, compat или next — ровно то, с чем человек
   * пришёл. Иначе приглашённый в пати со скрытой библиотекой получал
   * ?error=private, открывал доступ по инструкции, входил снова — и попадал
   * на /quiz: код комнаты оставался только в чате. До проверки ассерта query
   * ещё ничем не подтверждён, но loginCarry пропускает лишь проверенные
   * форматы и закрытый список адресов, так что везти его безопасно.
   */
  const carry = loginCarry(params).toString()
  const fail = (code: string) => redirect(`${base}/?error=${code}${carry ? `&${carry}` : ''}`)

  /*
   * Сначала state — он проверяется локально и бесплатно, так что чужой или
   * подсунутый ссылкой ассерт не тратит ни строку лимита, ни запрос к Steam.
   */
  if (!stateMatches(req.cookies.get(OIDC_COOKIE)?.value, params.get('state'))) {
    return fail('auth')
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
  if (!gate.ok) return fail('ratelimited')

  /*
   * Бросок и отказ — разные вещи. null значит «Steam ассерт не подтвердил»,
   * а бросок — что до Steam не достучались (таймаут, сеть). Раньше оба
   * кончались ?error=auth: недоступный OpenID выглядел подделкой, и человеку
   * советовали попробовать ещё раз, когда стоило подождать.
   */
  const steamid = await verifyAssertion(params, `${base}${RETURN_PATH}`).catch((err: unknown) => {
    logSwallowed('auth/return:openid', err)
    return 'down' as const
  })
  if (steamid === 'down') return fail('steam')
  if (!steamid) return fail('auth')

  const key = steamApiKey()
  if (!key) return fail('nokey')

  /*
   * Какой шаг упал — Steam или своя база. Человеку по-прежнему ?error=steam,
   * а в лог — разные места: отозванный ключ Steam API и кончившаяся квота
   * Turso иначе выглядят одинаково.
   */
  let stage: 'steam' | 'db' = 'steam'
  try {
    const now = nowSec()
    // Параллельно: запросы друг от друга не зависят, а человек ждёт на белом
    // экране возврата — с повтором на сбой Steam каждая секунда на счету.
    const [summary, games] = await Promise.all([
      // Без имени и аватара вход всё равно состоится, но молча терять их не будем
      fetchPlayerSummary(steamid, { apiKey: key }).catch((err: unknown) => {
        logSwallowed('auth/return:summary', err)
        return null
      }),
      fetchOwnedGames(steamid, { apiKey: key }),
    ])
    if (games === 'private') return fail('private')
    if (!games.length) return fail('empty')

    stage = 'db'
    const db = await getDb()
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

    // Куда человек шёл до разворота на лендинг; список закрытый —
    // произвольный адрес сюда не попадёт (см. lib/destination.ts).
    const res = redirect(`${base}${loginTarget(params)}`)
    res.cookies.set(
      SESSION_COOKIE,
      // Единственное место, где владение профилем ДОКАЗАНО: выше отработал
      // verifyAssertion. Признак разрешает разрушительное — см. докблок
      // Resolved.verified в lib/sessions.
      await issueSession(steamid, req.headers.get('user-agent'), { verified: true }),
      sessionCookieOptions(),
    )
    return res
  } catch (err) {
    logSwallowed(`auth/return:${stage}`, err)
    return fail('steam')
  }
}
