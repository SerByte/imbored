import fs from 'node:fs'
import path from 'node:path'
import { cookies } from 'next/headers'
import { createDb, createSession, getSessionState, revokeSession, type Db } from './db'
import {
  SESSION_TTL_SEC,
  deviceLabel,
  forgetSessionCache,
  mintSession,
  resolveSession,
  type Resolved,
} from './sessions'

const globalStore = globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }

/**
 * Снимает промис с кэша, если он отклонился.
 *
 * Кэшируется именно ПРОМИС, а не соединение, — иначе миграции пошли бы на
 * каждый запрос. Плата за это была несоразмерной: одна неудача createDb на
 * холодном старте (а внутри неё migrateDb с двумя десятками ALTER) оставляла
 * в globalThis навсегда отклонённый промис, и инстанс до самой переработки
 * Vercel'ом отвечал ошибкой на КАЖДЫЙ запрос, хотя Turso уже поднялась.
 *
 * Сверка по идентичности обязательна: пока первый промис отклонялся, вызов
 * рядом мог положить в слот новый, и безусловный сброс затёр бы живой.
 *
 * catch навешивается на копию и намеренно ничего не возвращает: исходный
 * промис остаётся отклонённым для тех, кто его уже ждёт, а этот обработчик
 * нужен лишь для того, чтобы Node не считал отказ необработанным.
 */
function forgetOnFailure(p: Promise<Db>): Promise<Db> {
  p.catch(() => {
    if (globalStore.__imboredDb === p) globalStore.__imboredDb = undefined
  })
  return p
}

/**
 * Соединение с БД. В проде — Turso (TURSO_DATABASE_URL), локально — файл.
 * Промис кэшируется на процесс: миграции выполняются один раз за холодный старт.
 */
export function getDb(): Promise<Db> {
  if (!globalStore.__imboredDb) {
    const remote = process.env.TURSO_DATABASE_URL
    if (remote) {
      globalStore.__imboredDb = forgetOnFailure(createDb(remote, process.env.TURSO_AUTH_TOKEN))
    } else {
      // На serverless файловая база эфемерна: данные исчезали бы между запросами.
      // Падаем с внятной ошибкой вместо тихой потери данных.
      if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        throw new Error(
          'TURSO_DATABASE_URL не задан. В продакшене файловая база не работает — ' +
            'укажи переменные TURSO_DATABASE_URL и TURSO_AUTH_TOKEN в настройках проекта.',
        )
      }
      const dir = path.join(process.cwd(), 'data')
      fs.mkdirSync(dir, { recursive: true })
      globalStore.__imboredDb = forgetOnFailure(createDb(`file:${path.join(dir, 'imbored.db')}`))
    }
  }
  return globalStore.__imboredDb
}

export const SESSION_COOKIE = 'imbored_session'

/*
 * Демо-режим: свой steamid каждому посетителю.
 *
 * Раньше демо-игрок был одной константой на всех. А по steamid в продукте
 * ключуется всё: баны, фидбек «зашло/не то», снапшот библиотеки, портрет,
 * членство в комнате. Последствия были такие:
 *
 *   • любой, кто нажал «🚫», убирал игру из демо-выдачи НАВСЕГДА и для всех —
 *     снятия бана в продукте нет;
 *   • скипы и лайки всех посетителей складывались в один профиль вкуса и
 *     портили демо тем сильнее, чем больше людей его посмотрело;
 *   • два человека, зашедшие в демо одновременно и попавшие в одну комнату,
 *     оказывались ОДНИМ участником (room_members PRIMARY KEY по room_id+steamid).
 *
 * Формат: '000' + 13 знаков случайности + цифра варианта. Семнадцать цифр,
 * потому что ровно это проверяет /^\d{17}$/ во всех маршрутах и в подписи
 * сессии. Префикс '000' безопасен: настоящие SteamID64 начинаются с 7656119,
 * пересечься невозможно. Он же делает демо-строки узнаваемыми для будущей
 * уборки старых данных.
 *
 * Вариант 2 — «демо-друг» для пати: он делит со своим игроком всё, кроме
 * последней цифры, поэтому пара всегда состоит из двух разных участников
 * одного посетителя.
 */
const DEMO_PREFIX = '000'
const DEMO_ID_RE = /^000\d{14}$/

export function isDemoId(steamid: string): boolean {
  return DEMO_ID_RE.test(steamid)
}

/** Основа демо-личности посетителя: 16 знаков, к которым добавляется вариант. */
function newDemoBase(): string {
  let out = DEMO_PREFIX
  while (out.length < 16) out += Math.floor(Math.random() * 10)
  return out
}

/**
 * Демо-личность для этого посетителя. Если он уже в демо — переиспользуем его
 * основу, чтобы «демо-друг» оказался в паре с ним, а не со случайным чужим.
 */
export function demoSteamId(variant: 1 | 2, current?: string | null): string {
  const base = current && isDemoId(current) ? current.slice(0, 16) : newDemoBase()
  return `${base}${variant}`
}

/**
 * Ключ подписи сессий.
 *
 * В проде отсутствие переменной — отказ, а не подстановка заглушки, ровно по
 * той же логике, что двадцатью строками выше у TURSO_DATABASE_URL. Разница
 * была неоправданной и опасной: со строкой по умолчанию любой, кто читал
 * исходники, мог подписать себе куку с чужим steamid, и никакого признака
 * проблемы в логах при этом не возникало.
 *
 * Локально заглушка остаётся: иначе разработку нельзя начать без секрета.
 */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (secret) return secret
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET не задан. В продакшене подписывать сессии ключом по умолчанию нельзя — ' +
        'укажи SESSION_SECRET в настройках проекта.',
    )
  }
  return 'imbored-dev-secret-change-in-prod'
}

/**
 * Общие флаги куки сессии. Живут в одном месте, потому что ставится она из
 * двух разных роутов (/api/connect и возврат Steam OpenID), и раньше набор
 * флагов приходилось держать в голове дважды.
 *
 * secure только вне разработки: на http://localhost браузер такую куку не
 * примет, и локально сломался бы вход.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isDeployed(),
    path: '/',
    maxAge: SESSION_TTL_SEC,
  } as const
}

/**
 * «Мы не на машине разработчика».
 *
 * Отдельная функция, потому что раньше secure смотрел только на NODE_ENV, а
 * getDb и sessionSecret — на VERCEL тоже. Из-за расхождения превью-деплой,
 * который собирается не с NODE_ENV=production, ставил куку без Secure.
 */
function isDeployed(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production'
}

export function steamApiKey(): string | null {
  return process.env.STEAM_API_KEY || null
}

/**
 * Базовый адрес приложения.
 *
 * От него зависит куда больше, чем кажется: return_to у Steam OpenID, ссылки
 * self-chaining'а кронов, watchdog дайджеста и metadataBase для всех
 * og-картинок. Незаданная переменная роняла всё это разом на localhost:3000 —
 * без исключения, без записи в лог, с виду работающим сайтом и битыми
 * каноническими ссылками.
 *
 * Поэтому здесь лестница, а не одна заглушка: сначала APP_BASE_URL, потом то,
 * что Vercel проставляет сам (домен продакшена, затем адрес конкретного
 * деплоя — он же покрывает превью), и только потом localhost.
 *
 * Отказ — по VERCEL, а НЕ по isDeployed(). Разница принципиальная: isDeployed
 * включает NODE_ENV === 'production', а его выставляет обычный next build, и
 * бросок здесь ломал бы локальную сборку — appBaseUrl зовётся на уровне модуля
 * в app/layout.tsx, то есть прямо на сборе данных страниц. На самом Vercel обе
 * VERCEL_*_URL стоят всегда, так что ветка отказа — это страховка от чужого
 * рантайма, а не ожидаемый путь.
 */
export function appBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`
  if (process.env.VERCEL) {
    throw new Error(
      'APP_BASE_URL не задан, и Vercel не сообщил адрес деплоя. ' +
        'Укажи APP_BASE_URL в настройках проекта.',
    )
  }
  return 'http://localhost:3000'
}

/**
 * Текущая сессия целиком, либо null.
 *
 * НИЧЕГО НЕ ПИШЕТ — ни в базу, ни в куки, и это не случайность. Функцию зовут
 * серверные компоненты (app/library/page.tsx и другие), а они куку переставить
 * не могут в принципе: HTTP не разрешает Set-Cookie после начала стрима.
 * Поэтому продление живёт в единственном роуте /api/session/touch, а здесь
 * только читается флаг stale.
 */
export async function currentSession(): Promise<Resolved | null> {
  const jar = await cookies()
  return resolveSession({
    token: jar.get(SESSION_COOKIE)?.value,
    secret: sessionSecret(),
    nowSec: nowSec(),
    lookup: async (sid, steamid) => getSessionState(await getDb(), sid, steamid),
  })
}

/** SteamID64 текущего пользователя из подписанной куки, либо null */
export async function currentSteamId(): Promise<string | null> {
  return (await currentSession())?.steamid ?? null
}

/**
 * Выдать новую сессию и вернуть значение для куки.
 *
 * Прежняя сессия ЭТОГО устройства гасится — иначе выданный до входа
 * идентификатор оставался бы действительным и после него (фиксация сессии), а
 * заодно демо-вход не отпускал бы свою строку при переходе на реальный профиль.
 * Чужие устройства не трогаются: телефон переживает вход с ноутбука.
 *
 * Записи в базу — по возможности: строки нет — сессия всё равно жива, так
 * устроен resolveSession. Падение Turso не должно ломать вход.
 */
export async function issueSession(
  steamid: string,
  userAgent: string | null,
  opts: { verified?: boolean } = {},
): Promise<string> {
  const now = nowSec()
  const prev = await currentSession().catch(() => null)
  const { sid, token } = mintSession(steamid, sessionSecret(), now)
  try {
    const db = await getDb()
    if (prev?.sid) await revokeSession(db, prev.sid, now)
    // verified ставит ТОЛЬКО путь Steam OpenID — см. докблок Resolved.verified
    await createSession(
      db,
      { sid, steamid, device: deviceLabel(userAgent), verified: opts.verified },
      now,
    )
  } catch {
    // молча: кука уже подписана и будет выдана
  }
  forgetSessionCache()
  return token
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}
