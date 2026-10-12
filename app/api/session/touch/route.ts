import { after, NextResponse } from 'next/server'
import { getUserCard, latestEveningPlan, pendingOutcomeAsk, touchSession, type Db } from '@/lib/db'
import { dayKey } from '@/lib/daily'
import { dailyRecord } from '@/lib/dailyrecord'
import type { EveningPlan } from '@/lib/eveningplan'
import { logSwallowed } from '@/lib/errlog'
import type { OutcomeAsk } from '@/lib/outcome'
import type { MutePreset } from '@/lib/mutetags'
import { markReturn } from '@/lib/retention'
import {
  SESSION_COOKIE,
  currentMutes,
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
 * Четвёртый — отметка возврата (lib/retention): первый за сутки заход
 * считается здесь, потому что сюда приходят все страницы, включая главную,
 * где SessionKeeper молчит.
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
  const demo = isDemoId(steamid)

  // Отметка возврата — после ответа и лучшим усилием: приветствию незачем
  // ждать счётчик, а отказ базы — не повод отказать во входе. Стоит до
  // раннего выхода ниже: считается каждый заход, а не только продление. Цена
  // обычного захода — одно чтение по первичному ключу (markActiveDay).
  const marked = markReturn(db, steamid, demo, now).catch((err: unknown) => {
    logSwallowed('touch:return', err)
  })
  try {
    after(marked)
  } catch {
    // Вне запроса (тест, скрипт) after недоступен: работа идёт и так, а отказ
    // уже пойман выше.
  }

  // Ник и аватар читаются только когда их просят. Спрашивает одна главная —
  // ради приветствия; SessionKeeper на остальных страницах берёт из ответа
  // writer, а для сверки подсказки о входе — authed и steamid
  // (settleSessionHint в lib/sessionhint), и лишний запрос в базу на каждую
  // загрузку был бы даром. Поэтому steamid отвечается и без card=1: без него
  // сверка молча перестала бы работать.
  //
  // demo — туда же: демо-личность главная встречает не «С возвращением,
  // Демо-игрок», а полем для своей ссылки. Признак считается по самому
  // steamid, в базу за ним не ходят.
  //
  // live — живая строка карточки (liveLine в ConnectCard): вопрос «как тебе?»,
  // план на вечер или готовая игра дня. Только пишущей сессии не из демо: демо
  // и вход по ссылке заняты своими подписями, спрашивать «как тебе?» того,
  // чей ответ не сохранится, незачем (GET /api/outcome отвечает им так же), а
  // план — нажатие самого владельца, и сессия по ссылке его не ставила.
  const wantCard = new URL(req.url).searchParams.get('card') === '1'
  const withLive = wantCard && isWriter(session) && !demo
  // «Не предлагать» — кукой этого браузера: игра дня в живой строке та же,
  // что откроется ему на /daily (см. liveOf)
  const mutes = withLive ? await currentMutes() : []
  const [user, live] = wantCard
    ? await Promise.all([
        getUserCard(db, steamid).catch(() => ({ personaName: null, avatarUrl: null })),
        withLive ? liveOf(db, steamid, now, mutes) : null,
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
 * Живое для карточки главной — три точечные выборки: запись игры дня этого
 * дня, самый свежий несверенный совет (тот же pendingOutcomeAsk, что у
 * GET /api/outcome) и живой план на вечер (latestEveningPlan — свои оценки за
 * полтора дня по индексу). Разом, и каждая падает в null сама: приветствие
 * важнее живой строки.
 *
 * Игра дня — глазами этого браузера, с его «Не предлагать» (dailyRecord в
 * lib/dailyrecord.ts, тот же, что у /api/daily). Общую запись мог выбрать
 * телефон без фильтра, и строка «Игра дня уже выбрана — «X»» с хоррором у
 * того, кто хорроры запретил, нарушала бы «никогда» — а /daily этого браузера
 * X не покажет и, обещанное «без прогрева», начнёт с прогрева. Нет годной
 * записи — строки про игру дня нет, карточка говорит своё (LIVE_DEFAULT).
 * Цена — только у браузера с фильтром: вторая запись и мета героев, всё по
 * первичным ключам.
 *
 * Патчей здесь нет намеренно: счёт «обновлений в твоих играх» читает весь
 * снапшот библиотеки и ленту по трёмстам играм (lib/whatsnewfeed), а этот
 * роут зовут на каждый заход главной и без потолка частоты.
 */
async function liveOf(
  db: Db,
  steamid: string,
  now: number,
  mutes: readonly MutePreset[],
): Promise<{
  daily: { appid: number; name: string } | null
  plan: EveningPlan | null
  ask: OutcomeAsk | null
}> {
  const [daily, plan, ask] = await Promise.all([
    dailyRecord(db, steamid, dayKey(now), mutes)
      .then((r) => r.selection?.pick ?? null)
      .catch(() => null),
    latestEveningPlan(db, steamid, now).catch(() => null),
    pendingOutcomeAsk(db, steamid, now).catch(() => null),
  ])
  return { daily: daily ? { appid: daily.appid, name: daily.name } : null, plan, ask }
}
