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
 *
 * И РОВНО ПОЭТОМУ «везде» требует подтверждённой сессии.
 *
 * /api/connect выдаёт подписанную куку по вставленной ссылке на профиль, без
 * доказательства владения, — это сам продукт, а не изъян: библиотека публична.
 * Но revokeAllSessions ставит users.sessions_from = now, после чего
 * resolveSession отвергает ВСЕ токены владельца, включая полученные через
 * Steam OpenID. Выходил перевёртыш прав: два запроса — POST /api/connect с
 * чужим steamid, затем этот с scope=all — и человек выброшен со всех своих
 * устройств без всякой возможности вернуть сессию, только войти заново.
 *
 * Неподтверждённой сессии остаётся обычный выход: гасится ЕЁ ЖЕ кука и её
 * строка. Это ровно то, на что она имеет право, — и ответ говорит правду,
 * а не делает вид, что погасил чужие устройства.
 */
export async function POST(req: Request) {
  const session = await currentSession()
  const хочетВезде = new URL(req.url).searchParams.get('scope') === 'all'
  const all = хочетВезде && Boolean(session?.verified)

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

  // Просили «везде», а права на это нет — говорим прямо, а не молча делаем
  // меньше обещанного. Статус успешный: своё устройство действительно вышло.
  if (хочетВезде && !all) {
    return NextResponse.json(
      {
        ok: true,
        scope: 'this-device',
        reason: 'Выход на всех устройствах доступен после входа через Steam.',
      },
      { headers: res.headers },
    )
  }

  return res
}
