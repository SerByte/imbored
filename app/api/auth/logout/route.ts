import { NextResponse } from 'next/server'
import { revokeAllSessions, revokeSession } from '@/lib/db'
import { SESSION_COOKIE, currentSession, getDb, nowSec, sessionCookieOptions } from '@/lib/server'
import { forgetSessionCache } from '@/lib/sessions'

/**
 * Выход. POST, а не GET: браузеры и превьюшки ходят по ссылкам сами, и выход
 * по GET срабатывал бы от предзагрузки.
 *
 * `?scope=all` гасит все устройства. Разница существенная: обычный выход
 * трогает только эту куку, поэтому телефон не выкидывает вместе с ноутбуком.
 */
export async function POST(req: Request) {
  const session = await currentSession()
  const all = new URL(req.url).searchParams.get('scope') === 'all'

  const res = NextResponse.json({ ok: true })
  // Куку гасим ВСЕГДА и первым делом: даже если сессии уже нет и гасить в базе
  // нечего, человек нажал «выйти» и обязан выйти.
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })

  if (session) {
    const now = nowSec()
    try {
      const db = await getDb()
      if (all) {
        await revokeAllSessions(db, session.steamid, now)
      } else if (session.sid) {
        await revokeSession(db, session.sid, now)
      }
      // Иначе своё же устройство осталось бы внутри до конца минутного кэша.
      forgetSessionCache()
    } catch {
      // База недоступна — отзыв не записался, но кука уже погашена, и на этом
      // устройстве человек вышел. Врать про успех отзыва не нужно.
      return NextResponse.json({ ok: true, revoked: false }, { headers: res.headers })
    }
  }

  return res
}
