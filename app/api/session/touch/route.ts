import { NextResponse } from 'next/server'
import { getDailyPick, getUserCard, pendingOutcomeAsk, touchSession, type Db } from '@/lib/db'
import { dayKey, parseDailySelection } from '@/lib/daily'
import type { OutcomeAsk } from '@/lib/outcome'
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
  //
  // live — живая строка карточки (liveLine в ConnectCard): вопрос «как тебе?»
  // или готовая игра дня. Только пишущей сессии не из демо: демо и вход по
  // ссылке заняты своими подписями, а спрашивать «как тебе?» того, чей ответ
  // не сохранится, незачем (GET /api/outcome отвечает им так же).
  const wantCard = new URL(req.url).searchParams.get('card') === '1'
  const demo = isDemoId(steamid)
  const withLive = wantCard && isWriter(session) && !demo
  const [user, live] = wantCard
    ? await Promise.all([
        getUserCard(db, steamid).catch(() => ({ personaName: null, avatarUrl: null })),
        withLive ? liveOf(db, steamid, now) : null,
      ])
    : [null, null]
  const card = user ? { ...user, demo, ...(withLive ? { live } : {}) } : null
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

/**
 * Живое для карточки главной — две точечные выборки по первичным ключам:
 * строка daily_picks этого дня и самый свежий несверенный совет (тот же
 * pendingOutcomeAsk, что у GET /api/outcome). Каждая падает в null сама:
 * приветствие важнее живой строки.
 *
 * Патчей здесь нет намеренно: счёт «обновлений в твоих играх» читает весь
 * снапшот библиотеки и ленту по трёмстам играм (lib/whatsnewfeed), а этот
 * роут зовут на каждый заход главной и без потолка частоты.
 */
async function liveOf(
  db: Db,
  steamid: string,
  now: number,
): Promise<{ daily: { appid: number; name: string } | null; ask: OutcomeAsk | null }> {
  const [daily, ask] = await Promise.all([
    getDailyPick(db, steamid, dayKey(now))
      .then((raw) => parseDailySelection(raw)?.pick ?? null)
      .catch(() => null),
    pendingOutcomeAsk(db, steamid, now).catch(() => null),
  ])
  return { daily: daily ? { appid: daily.appid, name: daily.name } : null, ask }
}
