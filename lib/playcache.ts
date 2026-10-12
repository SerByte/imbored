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
 *   Выдача (sessionStorage, 15 минут) — последняя пятёрка вместе с героем,
 *   «Зашло» и отложенными на вечер, под ключом запроса. Моложе пятнадцати
 *   минут — это та выдача, которую он только что видел; старше — уже
 *   вчерашняя по ценам и онлайну. Одна запись, а не по записи на
 *   настроение: вернуться хотят к последнему, и копить в хранилище каждую
 *   пятёрку вечера незачем. Отложенные в ней стареют по-своему — от
 *   последнего показа, а не от прихода выдачи (heldPlanned): план не
 *   дешевеет за пятнадцать минут.
 *
 *   Метка прогрева (sessionStorage, 10 минут) — «/api/prepare сказал, что
 *   разбирать нечего». Пока она свежая, новый запрос выдачи идёт без прогрева:
 *   за десять минут каталог не устаревает (метаданные живут две недели, онлайн
 *   — шесть часов), а цикл прогрева на экране ожидания — это секунды. Сама
 *   метка — в lib/warmmark.ts (её читает и квиз), здесь — те же имена.
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

import { parseEveningPlan, PLAN_HOLD_MS } from './eveningplan'
import { createLocalStore } from './localstore'
import { parseLean, type Lean } from './mood'
import { parseNudge } from './nudge'
import { parseSeedRef, type Deal, type PlayPick } from './playflow'
import type { ContinueGame, Focus } from './recommend'
import type { Mood } from './types'
import { forgetsWith, PLAY_BANS_KEY, PLAY_DEAL_KEY } from './playforget'
import { fresh } from './warmmark'

/** Сколько выдача считается «той же самой», мс */
export const PLAY_CACHE_TTL_MS = 15 * 60_000

/**
 * Версия формы записи. Вкладка живёт через деплой, и запись прошлой версии
 * сайта с другой формой карточки уронила бы рендер — а так её просто не узнают.
 * Поднимать при любой несовместимой правке PlayPick или Deal.
 *
 * 2 — у цены появился регион (priceCc, unsold): карточка первой версии пришла
 * бы без валюты, и ценник у героя-покупки молча пропал бы на пятнадцать минут.
 */
export const PLAY_CACHE_VERSION = 2

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
  /**
   * Отложенные на вечер в этом заходе (writesPlan в lib/eveningplan.ts):
   * «Не то — дальше» у такого героя листает без пропуска, который закрыл бы
   * план. Без них «Подробнее» → «Назад» план забывал — и «Просто не сейчас»
   * через минуту после «Сыграю вечером на ПК» его закрывал (app/play).
   *
   * Заход — вкладка, а не настроение: новая выдача того же человека под
   * другим ключом список забирает (heldPlanned). План, закрытый не на /play —
   * запуском со страницы игры, из «Твоих вечеров», с «Игры дня», — отсюда
   * вычёркивает lib/planforget: после запуска «не то» — снова ответ.
   */
  planned: number[]
  /**
   * Когда выдачу последний раз видели на экране, мс часов клиента: запись
   * переписывается на каждом шаге, и время — этой записи. От него, а не от
   * at, считается срок отложенных без выдачи (heldPlanned). at — приход
   * выдачи, его запись хранит как был, и план, поставленный на
   * четырнадцатой минуте, умирал вместе с ней через минуту.
   */
  seenAt: number
}

/**
 * Ключ запроса — всё, что задаёт выдачу из адреса: настроение, «нераспакованное»,
 * рулетка, ось и затравка «Как «X», но…». Источник («Только моё»), ось и
 * затравка, переключённые уже на выдаче, в ключ не входят: они живут в самой
 * записи, и после «Назад» человек вернётся к тому, на что переключил, а не к
 * тому, с чего начал.
 *
 * Затравка с адреса (/play?…&seed=, см. parseSeedParam) — в ключе: без неё
 * обычная выдача, запомненная минуту назад, вставала бы на месте «похожих на
 * X», о которых человек только что попросил со страницы игры. Пятой частью и
 * только когда она есть: ключ без затравки — тот же, что до неё, и записи,
 * уже лежащие во вкладках, по-прежнему узнаются.
 */
export function playCacheKey(q: {
  mood: Mood
  focus: Focus | null
  roulette: boolean
  lean: Lean | null
  seed?: number | null
}): string {
  return [
    `${q.mood.time}.${q.mood.vibe}.${q.mood.social}`,
    q.focus ?? '',
    q.roulette ? 'roulette' : '',
    q.lean ?? '',
    ...(q.seed ? [String(q.seed)] : []),
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
  // Записи до «Уже прошёл» у строки «Продолжить» поля не несут — кнопки у них
  // нет: промолчать лучше, чем предложить «пройти» Dota 2
  return { appid: c.appid, name: c.name, recentHours: c.recentHours, finishable: c.finishable === true }
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
    // Записи до строки о скрытом времени — выдача без неё
    playtimeHidden: d.playtimeHidden === true,
    // Записи до плана на вечер — тоже: строка сбоку, и терять ради неё всю
    // выдачу (прогрев заново) было бы дороже, чем её саму
    plan: parseEveningPlan(d.plan),
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
  return {
    v: PLAY_CACHE_VERSION,
    key: r.key,
    viewer: r.viewer,
    at: r.at,
    deal,
    hero: r.hero,
    liked: r.liked,
    // Записи до этого поля — без отложенных, а не битые: версия та же, и
    // прогрев заново ради пустого списка дороже его самого. Мусор — поштучно
    planned: Array.isArray(r.planned) ? r.planned.filter(isInt) : [],
    // Записи до него — приход выдачи: отложенные живут не дольше, чем жили
    // до поля. Number.isFinite не приводит типы — строка и null не пройдут
    seenAt: Number.isFinite(r.seenAt) ? (r.seenAt as number) : r.at,
  }
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
  /** Отложенные на вечер в этом заходе, кроме забаненных — см. PlayCache.planned */
  planned: number[]
  at: number
}

/**
 * Запись → выдача на экран, или null, если восстанавливать нечего: другой
 * запрос, другой человек, срок вышел, или всё, что в ней было, уже в бане.
 *
 * Строка «Продолжить» фильтруется тем же списком: «Уже прошёл» ставят и у
 * неё, и на странице игры, куда уходят «Подробнее», — и после «Назад»
 * пройденная игра звала бы продолжить себя ещё пятнадцать минут.
 *
 * И строка плана на вечер (lib/eveningplan.ts): бан закрывает план и на
 * сервере (closesPlan), а план чаще всего и стоит героем, у которого жмут
 * «Подробнее». Пока игра была героем, строку прятал planBeside; после
 * «Назад» героя в выдаче нет — и без фильтра «Ставил «X» на загрузку ·
 * Запустить» звал бы в игру, только что названную пройденной.
 *
 * И отложенные на вечер (planned): бан их план уже закрыл, и «Не то —
 * дальше» у забаненной спрашивать некому.
 */
export function restoreDeal(
  entry: PlayCache | null,
  q: { key: string; viewer: string | null; nowMs: number; banned: ReadonlySet<number> },
): RestoredDeal | null {
  if (!entry || !q.viewer || entry.viewer !== q.viewer) return null
  if (!hasFreshDeal(entry, q.key, q.nowMs)) return null
  const keep = (p: { appid: number }) => !q.banned.has(p.appid)
  const picks = entry.deal.picks.filter(keep)
  if (!picks.length) return null
  const index = Math.max(0, picks.findIndex((p) => p.appid === entry.hero))
  const cont = entry.deal.continueGame
  const plan = entry.deal.plan
  return {
    deal: {
      ...entry.deal,
      picks,
      discoveries: entry.deal.discoveries.filter(keep),
      continueGame: cont && keep(cont) ? cont : null,
      plan: plan && keep(plan) ? plan : null,
    },
    index,
    liked: entry.liked,
    planned: entry.planned.filter((a) => !q.banned.has(a)),
    at: entry.at,
  }
}

/**
 * Отложенные на вечер из записи, которую restoreDeal не вернул, — для первой
 * новой выдачи; null — нести нечего.
 *
 * Запись одна на вкладку, и выдача узнаётся только под своим ключом.
 * «Изменить настроение» ведёт /play → /quiz → /play с другим настроением:
 * новое монтирование, другой ключ, восстанавливать нечего — и отложенные
 * начинались пустым списком, а первая же новая выдача ложилась поверх
 * единственной записи с пустым. Своя игра, отложенная минуту назад, приходит
 * героем и в новой пятёрке (знакомые свои повторяются), и «Не то — дальше» →
 * «Просто не сейчас» у неё снова закрывал план. Поэтому список живёт под
 * каким бы ключом ни лежала запись.
 *
 * И сколько бы ни было самой выдаче. Срок — заход: час с последнего показа
 * (seenAt, PLAN_HOLD_MS в lib/eveningplan), а не пятнадцать минут с прихода
 * выдачи (at). Мерили от at — и выдача, пришедшая в 19:00, в 19:15:40
 * уносила с собой план, поставленный в 19:14: «Подробнее» → «Назад» и
 * «Изменить настроение» после пятнадцатой минуты начинали с пустым списком,
 * и тот же пропуск снова закрывал план. Тот же ключ с устаревшей выдачей
 * сюда тоже доходит: restoreDeal её не вернёт, и список едет в новую.
 *
 * Чья запись — вместе со списком: сверить её не с кем, пока не пришла
 * выдача (deal.viewer), а спрашивать сервер ради одного списка незачем —
 * сверяет страница. Забаненные — нет, как и в restoreDeal: бан план закрыл.
 */
export function heldPlanned(
  entry: PlayCache | null,
  q: { nowMs: number; banned: ReadonlySet<number> },
): { viewer: string; appids: number[] } | null {
  if (!entry || !fresh(entry.seenAt, q.nowMs, PLAN_HOLD_MS)) return null
  const appids = entry.planned.filter((a) => !q.banned.has(a))
  return appids.length ? { viewer: entry.viewer, appids } : null
}

export const playCacheStore = createLocalStore(PLAY_DEAL_KEY, parsePlayCache, 'session')

/*
 * Метка прогрева живёт в lib/warmmark.ts: её читает и квиз, которому вся
 * остальная выдача не нужна. Отсюда — те же имена, что и раньше.
 */
export { hasFreshWarm, parseWarmMark, WARM_MARK_TTL_MS, warmIsFresh, warmMarkStore, type WarmMark } from './warmmark'

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
const recentBansStore = createLocalStore(PLAY_BANS_KEY, parseRecentBans, 'local')

// Выход (lib/playforget) стирает эти хранилища, а не только их ключи: так
// гаснет и то, что вкладка держит в памяти, и подписчики узнают
forgetsWith({ deal: playCacheStore, bans: recentBansStore })

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

/*
 * Забыть всё про выдачу при выходе — forgetPlay в lib/playforget.ts: кнопке
 * «Выйти» не нужен разбор выдачи, который лежит здесь. Отсюда — то же имя, а
 * хранилища этого модуля выход стирает через forgetsWith выше.
 */
export { forgetPlay } from './playforget'
