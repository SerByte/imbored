import { NextResponse } from 'next/server'
import { createSession, getUserCard, touchSession } from '@/lib/db'
import {
  SESSION_COOKIE,
  currentSession,
  getDb,
  nowSec,
  sessionCookieOptions,
  sessionSecret,
} from '@/lib/server'
import { deviceLabel, mintSession, renewToken } from '@/lib/sessions'

/**
 * ЕДИНСТВЕННОЕ место, где вход продлевается.
 *
 * Так вышло не из вкуса, а из HTTP: Set-Cookie нельзя отправить после начала
 * стрима, поэтому серверные страницы куку переставить не могут (документация
 * Next 16, cookies.md). Значит продление обязано жить в роуте — и пусть оно
 * будет ровно одно, а не размазано по десятку обработчиков.
 *
 * Второй смысл роута — ответ. Главная не умеет узнавать гостя от вошедшего
 * (она клиентская), и именно отсюда берёт «Продолжить как ...».
 *
 * Куку ставят всего четыре роута на весь сайт: два входа, этот и выход. Ни
 * одна страница не трогается, поэтому ISR у /game/[appid] и og-картинок цел.
 */
export async function POST(req: Request) {
  const session = await currentSession()
  if (!session) return NextResponse.json({ authed: false })

  const { steamid, sid, stale } = session
  const db = await getDb()
  const now = nowSec()

  // Ник и аватар читаются только когда их просят. Спрашивает одна главная —
  // ради приветствия; SessionKeeper на остальных страницах ответ не читает
  // вовсе, и лишний запрос в базу на каждую загрузку был бы даром.
  const card =
    new URL(req.url).searchParams.get('card') === '1'
      ? await getUserCard(db, steamid).catch(() => ({ personaName: null, avatarUrl: null }))
      : null
  const res = NextResponse.json({ authed: true, steamid, ...(card ?? {}) })

  if (!stale) return res

  if (sid) {
    res.cookies.set(SESSION_COOKIE, renewToken(sid, steamid, sessionSecret(), now), sessionCookieOptions())
    // Отметка визита — справка для списка устройств, а не условие входа,
    // поэтому её падение не должно мешать продлению.
    await touchSession(db, sid, now).catch(() => {})
    return res
  }

  // Легаси-кука без sid: заводим настоящую сессию. Если запись не удалась,
  // куку всё равно выдаём — отсутствие строки у нас означает «жива»,
  // а не «отказать» (см. lib/sessions.ts).
  const minted = mintSession(steamid, sessionSecret(), now)
  res.cookies.set(SESSION_COOKIE, minted.token, sessionCookieOptions())
  const device = deviceLabel(req.headers.get('user-agent'))
  await createSession(db, { sid: minted.sid, steamid, device }, now).catch(() => {})
  return res
}
