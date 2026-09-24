/**
 * Выдача /play между заходами.
 *
 * Страница забывала всё при уходе. «Подробнее» → карточка игры → «Назад» — и
 * человек снова смотрел на экран прогрева: цикл /api/prepare с начала, новый
 * запрос к /api/recommend, который стоит единицу из двадцати на десять минут
 * (потолок в app/api/recommend/route.ts) и может вернуть ДРУГУЮ пятёрку. Герой,
 * которого он только что читал, пропадал; «Ещё варианты», в которых он
 * присмотрел третью карточку, — тоже. То же самое на телефоне без всякого
 * «Назад»: Steam открылся, браузер выгрузил вкладку, вернулся — перезагрузка.
 *
 * Здесь три записи на устройстве.
 *
 *   Выдача (sessionStorage, 15 минут) — последняя пятёрка вместе с героем и
 *   «Зашло», под ключом запроса. Моложе пятнадцати минут — это та выдача,
 *   которую он только что видел; старше — уже вчерашняя по ценам и онлайну.
 *   Одна запись, а не по записи на настроение: вернуться хотят к последнему,
 *   и копить в хранилище каждую пятёрку вечера незачем.
 *
 *   Метка прогрева (sessionStorage, 10 минут) — «/api/prepare сказал, что
 *   разбирать нечего». Пока она свежая, новый запрос выдачи идёт без прогрева:
 *   за десять минут каталог не устаревает (метаданные живут две недели, онлайн
 *   — шесть часов), а цикл прогрева на экране ожидания — это секунды.
 *
 *   Недавние баны (localStorage, 15 минут) — единственное, что может сделать
 *   сохранённую выдачу неправдой. Бан в соседней вкладке ей не виден: у
 *   sessionStorage соседей нет. Восстановленная пятёрка фильтруется по этому
 *   списку, и игра, которую человек убрал навсегда, не вернётся через «Назад».
 *
 * Обе записи выдачи привязаны к тому, ЧЬЯ она (viewer, steamid из ответа
 * /api/recommend). Вкладка переживает смену входа: демо → свой профиль, выход
 * и вход другим аккаунтом — и без привязки человек получил бы подборку по
 * чужой библиотеке, а метка прогрева пропустила бы прогрев тому, у кого его
 * не было вовсе (снимок библиотеки заводит именно /api/prepare). Кто сейчас
 * вошёл, говорит /api/session/touch — его и спрашивает страница, но только
 * если есть что восстанавливать.
 */

import { createLocalStore } from './localstore'
import { parseLean, type Lean } from './mood'
import { parseNudge } from './nudge'
import { parseSeedRef, type Deal, type PlayPick } from './playflow'
import type { ContinueGame, Focus } from './recommend'
import type { Mood } from './types'

/** Сколько выдача считается «той же самой», мс */
export const PLAY_CACHE_TTL_MS = 15 * 60_000

/** Сколько метка «прогрев закончен» позволяет его пропускать, мс */
export const WARM_MARK_TTL_MS = 10 * 60_000

/**
 * Версия формы записи. Вкладка живёт через деплой, и запись прошлой версии
 * сайта с другой формой карточки уронила бы рендер — а так её просто не узнают.
 * Поднимать при любой несовместимой правке PlayPick или Deal.
 */
export const PLAY_CACHE_VERSION = 1

export type PlayCache = {
  v: typeof PLAY_CACHE_VERSION
  /** Какой запрос — playCacheKey */
  key: string
  /** Чья выдача */
  viewer: string
  /** Когда она пришла, мс часов клиента — от них считается срок */
  at: number
  deal: Deal
  /** Кто был героем. appid, а не индекс: бан из соседней вкладки сдвинул бы индекс */
  hero: number
  /** «Зашло», уже нажатое в этой выдаче: без него кнопка погасла бы и записала оценку дважды */
  liked: number[]
}

/**
 * Ключ запроса — всё, что задаёт выдачу из адреса: настроение, «нераспакованное»,
 * рулетка и ось. Источник («Только моё») и ось, переключённые уже на выдаче, в
 * ключ не входят: они живут в самой записи, и после «Назад» человек вернётся
 * к тому, на что переключил, а не к тому, с чего начал.
 */
export function playCacheKey(q: {
  mood: Mood
  focus: Focus | null
  roulette: boolean
  lean: Lean | null
}): string {
  return [
    `${q.mood.time}.${q.mood.vibe}.${q.mood.social}`,
    q.focus ?? '',
    q.roulette ? 'roulette' : '',
    q.lean ?? '',
  ].join('|')
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)
const isStr = (x: unknown): x is string => typeof x === 'string'

/**
 * Карточка из хранилища. Проверяется то, к чему страница обращается без
 * оглядки на null: название, причина (pick.reason.includes), теги
 * (pick.tags.some). Остальные поля страница и так читает как необязательные.
 */
function isPick(x: unknown): x is PlayPick {
  if (!x || typeof x !== 'object') return false
  const p = x as Record<string, unknown>
  return (
    isInt(p.appid) &&
    isStr(p.name) &&
    isStr(p.reason) &&
    isStr(p.source) &&
    Array.isArray(p.tags) &&
    p.tags.every(isStr)
  )
}

function parseContinue(x: unknown): ContinueGame | null | undefined {
  if (x === null) return null
  if (!x || typeof x !== 'object') return undefined
  const c = x as Record<string, unknown>
  if (!isInt(c.appid) || !isStr(c.name) || typeof c.recentHours !== 'number') return undefined
  return { appid: c.appid, name: c.name, recentHours: c.recentHours }
}

function parseDeal(x: unknown): Deal | null {
  if (!x || typeof x !== 'object') return null
  const d = x as Record<string, unknown>
  if (!Array.isArray(d.picks) || d.picks.length === 0 || !d.picks.every(isPick)) return null
  if (!Array.isArray(d.discoveries) || !d.discoveries.every(isPick)) return null
  const continueGame = parseContinue(d.continueGame)
  if (continueGame === undefined) return null
  if (d.scope !== 'all' && d.scope !== 'library') return null
  if (!isStr(d.engine) || typeof d.nowSec !== 'number' || !Number.isFinite(d.nowSec)) return null
  if (!isStr(d.viewer)) return null
  return {
    picks: d.picks,
    discoveries: d.discoveries,
    continueGame,
    engine: d.engine,
    lean: parseLean(d.lean),
    scope: d.scope,
    // Записи до «Как «X», но…» поля не несут — это обычная выдача
    seed: parseSeedRef(d.seed),
    // Записи до подталкиваний — тоже: выдача без него
    nudge: parseNudge(d.nudge),
    nowSec: d.nowSec,
    viewer: d.viewer,
  }
}

/**
 * Разбор записи. Пишет туда кто угодно — прошлая версия сайта, консоль,
 * расширение, — поэтому всё, что не узнано целиком, — null: выдача с одной
 * битой карточкой хуже, чем прогрев заново.
 */
export function parsePlayCache(raw: unknown): PlayCache | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.v !== PLAY_CACHE_VERSION) return null
  if (!isStr(r.key) || !isStr(r.viewer) || !r.viewer) return null
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  if (!isInt(r.hero)) return null
  if (!Array.isArray(r.liked) || !r.liked.every(isInt)) return null
  const deal = parseDeal(r.deal)
  if (!deal || deal.viewer !== r.viewer) return null
  return { v: PLAY_CACHE_VERSION, key: r.key, viewer: r.viewer, at: r.at, deal, hero: r.hero, liked: r.liked }
}

/**
 * Свежесть по часам клиента. Запись «из будущего» — тоже не свежая: часы
 * перевели назад, и сколько ей на самом деле, уже не узнать.
 */
function fresh(at: number, nowMs: number, ttlMs: number): boolean {
  const age = nowMs - at
  return age >= -60_000 && age <= ttlMs
}

/** Есть ли вообще что восстанавливать под этот запрос — без вопроса, кто вошёл. */
export function hasFreshDeal(entry: PlayCache | null, key: string, nowMs: number): boolean {
  return !!entry && entry.key === key && fresh(entry.at, nowMs, PLAY_CACHE_TTL_MS)
}

export type RestoredDeal = {
  deal: Deal
  /** Индекс героя в отфильтрованной выдаче */
  index: number
  liked: number[]
  at: number
}

/**
 * Запись → выдача на экран, или null, если восстанавливать нечего: другой
 * запрос, другой человек, срок вышел, или всё, что в ней было, уже в бане.
 */
export function restoreDeal(
  entry: PlayCache | null,
  q: { key: string; viewer: string | null; nowMs: number; banned: ReadonlySet<number> },
): RestoredDeal | null {
  if (!entry || !q.viewer || entry.viewer !== q.viewer) return null
  if (!hasFreshDeal(entry, q.key, q.nowMs)) return null
  const keep = (p: PlayPick) => !q.banned.has(p.appid)
  const picks = entry.deal.picks.filter(keep)
  if (!picks.length) return null
  const index = Math.max(0, picks.findIndex((p) => p.appid === entry.hero))
  return {
    deal: { ...entry.deal, picks, discoveries: entry.deal.discoveries.filter(keep) },
    index,
    liked: entry.liked,
    at: entry.at,
  }
}

export const playCacheStore = createLocalStore('imbored.play.deal', parsePlayCache, 'session')

export type WarmMark = { viewer: string; at: number }

export function parseWarmMark(raw: unknown): WarmMark | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isStr(r.viewer) || !r.viewer || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  return { viewer: r.viewer, at: r.at }
}

/** Можно ли пропустить прогрев: он закончился недавно, и у этого же человека. */
export function warmIsFresh(mark: WarmMark | null, viewer: string | null, nowMs: number): boolean {
  return !!mark && !!viewer && mark.viewer === viewer && fresh(mark.at, nowMs, WARM_MARK_TTL_MS)
}

/** Свежая метка без вопроса, кто вошёл, — повод этот вопрос задать. */
export function hasFreshWarm(mark: WarmMark | null, nowMs: number): boolean {
  return !!mark && fresh(mark.at, nowMs, WARM_MARK_TTL_MS)
}

export const warmMarkStore = createLocalStore('imbored.play.warm', parseWarmMark, 'session')

export type RecentBan = { appid: number; at: number }

/** Мусорные элементы выбрасываются поштучно: один битый бан не отменяет остальные. */
export function parseRecentBans(raw: unknown): RecentBan[] | null {
  if (!Array.isArray(raw)) return null
  return raw.flatMap((x) => {
    if (!x || typeof x !== 'object') return []
    const b = x as Record<string, unknown>
    return isInt(b.appid) && typeof b.at === 'number' && Number.isFinite(b.at)
      ? [{ appid: b.appid, at: b.at }]
      : []
  })
}

/**
 * Список после нового бана. Старше срока выдачи — выброшены: восстановить
 * выдачу старше пятнадцати минут всё равно нельзя, а сервер такие игры
 * в новую выдачу и сам не пустит.
 */
export function withBan(list: RecentBan[] | null, appid: number, nowMs: number): RecentBan[] {
  return [
    ...(list ?? []).filter((b) => b.appid !== appid && fresh(b.at, nowMs, PLAY_CACHE_TTL_MS)),
    { appid, at: nowMs },
  ]
}

export function recentlyBanned(list: RecentBan[] | null, nowMs: number): Set<number> {
  return new Set((list ?? []).filter((b) => fresh(b.at, nowMs, PLAY_CACHE_TTL_MS)).map((b) => b.appid))
}

/*
 * Список только ради соседних вкладок, поэтому наружу — не хранилище, а два
 * действия, и оба читают его мимо кэша. Подписки на него нет, а без неё кэш
 * снимка запоминает первое прочитанное навсегда: бан из соседней вкладки
 * «Назад» возвращал на экран, а следующий бан здесь, дописанный поверх
 * пустого кэша, стирал его и для всех остальных вкладок.
 */
const recentBansStore = createLocalStore('imbored.play.bans', parseRecentBans, 'local')

/** Что убрано за последние пятнадцать минут — в любой вкладке, по хранилищу */
export function readRecentBans(nowMs: number): Set<number> {
  return recentlyBanned(recentBansStore.fresh(), nowMs)
}

/** Дописать бан к тому, что лежит в хранилище сейчас, а не к кэшу вкладки */
export function rememberBan(appid: number, nowMs: number): void {
  recentBansStore.set(withBan(recentBansStore.fresh(), appid, nowMs))
}

/** Кто вошёл — из ответа /api/session/touch. Гость и мусор — null. */
export function viewerFrom(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { authed?: unknown; steamid?: unknown }
  return b.authed === true && isStr(b.steamid) && b.steamid ? b.steamid : null
}

/**
 * Спросить сервер, кто вошёл. Любой сбой — «не знаю», и страница пойдёт
 * обычным путём: прогрев и новая выдача. Лишний прогрев лучше чужой выдачи.
 */
export async function whoAmI(signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn('/api/session/touch', { method: 'POST', signal })
    if (!res.ok) return null
    return viewerFrom(await res.json())
  } catch {
    return null
  }
}

/**
 * Забыть всё про выдачу на этом устройстве — при выходе. Привязка к viewer и
 * так не даст показать её другому, но хранить подборку вышедшего человека
 * до закрытия вкладки незачем.
 */
export function forgetPlay(): void {
  playCacheStore.set(null)
  warmMarkStore.set(null)
  recentBansStore.set(null)
}
