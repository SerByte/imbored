import { NextResponse } from 'next/server'
import { getUserCard, touchSession } from '@/lib/db'
import {
  SESSION_COOKIE,
  currentSession,
  getDb,
  isDemoId,
  isWriter,
  nowSec,
  sessionCookieOptions,
  sessionSecret,
} from '@/lib/server'
import { renewToken } from '@/lib/sessions'

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
 * Третий — writer: может ли сессия писать (isWriter в lib/server). Его читает
 * каждая страница через SessionKeeper и lib/writer, чтобы сессии по
 * вставленной ссылке не предлагать «Зашло», бан и новую комнату, которые
 * ответят ей 403 needsteam. Признак считается из уже разобранной сессии,
 * похода в базу он не добавляет.
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
  // ради приветствия; SessionKeeper на остальных страницах берёт из ответа
  // один writer, и лишний запрос в базу на каждую загрузку был бы даром.
  //
  // demo — туда же: демо-личность главная встречает не «С возвращением,
  // Демо-игрок», а полем для своей ссылки. Признак считается по самому
  // steamid, в базу за ним не ходят.
  const card =
    new URL(req.url).searchParams.get('card') === '1'
      ? {
          ...(await getUserCard(db, steamid).catch(() => ({ personaName: null, avatarUrl: null }))),
          demo: isDemoId(steamid),
        }
      : null
  const res = NextResponse.json({ authed: true, steamid, writer: isWriter(session), ...(card ?? {}) })

  if (!stale) return res

  // Легаси-кук без sid здесь больше не бывает: их не пускает resolveSession,
  // и обменивать на годовую сессию нечего (см. конец resolveSession).
  res.cookies.set(SESSION_COOKIE, renewToken(sid, steamid, sessionSecret(), now), sessionCookieOptions())
  // Отметка визита — справка для списка устройств, а не условие входа,
  // поэтому её падение не должно мешать продлению.
  await touchSession(db, sid, now).catch(() => {})
  return res
}
