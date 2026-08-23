import { NextResponse } from 'next/server'
import { filterActual } from '@/lib/actual'
import { refreshDealsWithin } from '@/lib/deals'
import {
  bannedAppids,
  getPoolSize,
  getGamesMeta,
  getLatestSnapshot,
  listFeedback,
  loadTagStats,
} from '@/lib/db'
import { discountView } from '@/lib/discount'
import { editionKey } from '@/lib/editions'
import { claudePicks, heuristicPicks, type Pick } from '@/lib/llm'
import { parseMood } from '@/lib/mood'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from '@/lib/pool'
import {
  applyFeedbackToProfile,
  applyFocus,
  buildTagProfile,
  explainMatch,
  mixHeroPool,
  parseFocus,
  parseScope,
  PICK_COUNT,
  scoreCandidates,
  splitBySource,
} from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { HERO_SLIDES } from '@/lib/shots'
import type { GameMeta } from '@/lib/types'

/** Сколько игр из каталога уходит в нижний блок «Нет в твоей библиотеке» */
const DISCOVERY_CARDS = 6

/** Кандидатов на ранжирование. Из них Claude выбирает пятёрку. */
const CANDIDATE_LIMIT = 30

/**
 * Пул каталога, добираемый вне тегов профиля. Тридцать штук на четыре сотни —
 * заметная, но не подавляющая доля: ровно чтобы у большой игры не из твоего
 * жанра появился шанс, а не чтобы выдача перестала быть твоей.
 */
const WILDCARD_POOL = 30

export async function POST(req: Request) {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    mood?: unknown
    focus?: unknown
    scope?: unknown
  }
  const mood = parseMood(body.mood)
  if (!mood) return NextResponse.json({ error: 'badmood' }, { status: 400 })
  const focus = parseFocus(body.focus)
  // «Разгрести своё» и «покажи что угодно» — противоположные запросы:
  // при явном фокусе каталог в главную выдачу не пускаем вовсе
  const scope = focus ? 'library' : parseScope(body.scope)

  const db = await getDb()
  const now = nowSec()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })

  const games = snapshot.games
  const owned = new Set(games.map((g) => g.appid))
  // Второй ключ владения — по названию: у Skyrim и Skyrim Special Edition
  // разные appid, и по одному только owned каталог предлагал бы купить то,
  // что уже стоит в библиотеке
  const ownedKeys = new Set(games.map((g) => editionKey(g.name)).filter(Boolean))

  const banned = await bannedAppids(db, steamid)
  const feedback = await listFeedback(db, steamid, 300)

  // Метаданные своей библиотеки И игр из истории оценок: раньше здесь читался
  // весь каталог, что на сотне тысяч игр сожгло бы лимит прочитанных строк
  // Turso. Игры из фидбека нужны здесь же — иначе оценка игры, которой нет
  // в библиотеке, перестанет влиять на профиль вкуса.
  const libMetas = await getGamesMeta(db, [
    ...new Set([...games.map((g) => g.appid), ...feedback.map((f) => f.appid)]),
  ])
  const poolByAppid = new Map<number, GameMeta>()
  const metaOf = (appid: number): GameMeta | undefined =>
    libMetas.get(appid) ?? poolByAppid.get(appid)

  // профиль вкуса с поправкой на историю «зашло»/«не то»
  const profile = applyFeedbackToProfile(
    buildTagProfile(games, (id) => libMetas.get(id)),
    feedback,
    metaOf,
  )

  // Кандидаты из большого каталога — одним запросом с LIMIT, а не полным сканом
  const [tagStats, poolSize] = await Promise.all([loadTagStats(db), getPoolSize(db)])
  const newPool = (
    await fetchDiscoveryPool(db, {
      tags: pickQueryTags(profile, tagStats, poolSize),
      bannedAppids: [...banned],
      requireMultiplayer: mood.social === 'friends',
      rotation: rotationSlot(steamid, now),
      limit: 400,
      wildcard: WILDCARD_POOL,
    })
  ).filter((m) => !owned.has(m.appid) && !ownedKeys.has(editionKey(m.name)))
  for (const m of newPool) poolByAppid.set(m.appid, m)
  const candidates = scoreCandidates({
    profile,
    library: games,
    metaOf,
    newPool,
    mood,
    nowSec: now,
    // Тридцать, а не прежние двадцать пять: доля каталога в бюджете выросла
    // (DISCOVERY_SHARE), и на прежнем лимите своих кандидатов стало бы меньше,
    // чем было до появления каталога в главной выдаче. Режим «только моё»
    // просел бы вместе со всеми, ничего для этого не сделав.
    limit: CANDIDATE_LIMIT,
  }).filter((c) => !banned.has(c.appid))

  if (!candidates.length) return NextResponse.json({ error: 'nocandidates' }, { status: 409 })

  // Игры из библиотеки не проходят офлайн-фильтры каталога — считаем здесь.
  // «С друзьями» судим строже: в компанию не годится то, во что вместе не сесть.
  //
  // Метаданные каталога идут в тот же расчёт, а не только библиотечные: серии
  // определяются по группе целиком, и без пула вопрос «у тебя старая часть, а
  // живёт новая» решался бы вслепую ровно в ту сторону, где появился каталог.
  //
  // Но только по КАНДИДАТАМ, а не по всем четырём сотням пула: лишние члены
  // группы ничего не судят, зато могут её возглавить — buildSeriesIndex
  // выбирает победителя по номеру версии, и случайная «Часть 3» из хвоста
  // каталога отменяла бы вытеснение, которое до неё работало.
  const judged = new Set(candidates.map((c) => c.appid))
  const allMetas = new Map(libMetas)
  for (const [appid, meta] of poolByAppid) {
    if (judged.has(appid) && !allMetas.has(appid)) allMetas.set(appid, meta)
  }
  const actual = filterActual(
    candidates,
    allMetas,
    mood.social === 'friends' ? 'party' : 'solo',
  )

  // Своё и «нет в библиотеке» — по-прежнему разные разговоры и разные блоки.
  // Разница в том, что при scope = 'all' каталог получает и несколько мест в
  // главной выдаче: «во что поиграть» — это вопрос про игры, а не про чеки.
  // Потолок держит mixHeroPool, чтобы ответ не превратился в витрину.
  const { own, discovery } = splitBySource(actual)
  const focused = applyFocus(own, focus)
  const heroPool = scope === 'all' ? mixHeroPool(focused, discovery) : focused

  // Цены обновляются ДО подбора, а не перед самой отдачей.
  //
  // Соблазн был обратный — спросить цены только для тех пяти игр, что реально
  // показываем. Но объяснение к карточке пишется в тот же момент, что и сама
  // карточка: и шаблон, и промпт Claude называют цену со скидкой. Спроси мы
  // цены после — в тексте стояла бы вчерашняя цена, а на плашке рядом
  // сегодняшняя. Кандидатов в разы больше пяти, но запрос всё равно один:
  // GetItems берёт до двухсот игр за раз.
  const pricedIds = [...new Set([...heroPool, ...discovery].map((c) => c.appid))]
  const refreshed = await refreshDealsWithin(db, pricedIds, now)
  const priced = refreshed ? await getGamesMeta(db, pricedIds) : new Map<number, GameMeta>()
  const metaNow = (appid: number): GameMeta | undefined => priced.get(appid) ?? metaOf(appid)

  const fromClaude = heroPool.length
    ? await claudePicks({ candidates: heroPool, metaOf: metaNow, library: games, mood, focus, nowSec: now })
    : null
  const picks =
    fromClaude ?? heuristicPicks(heroPool.length ? heroPool : actual, metaNow, PICK_COUNT, now, profile)

  // В режиме «разгрести своё» список покупок — прямое противоречие запросу.
  // Уехавшее наверх из нижнего блока убираем: одна и та же игра дважды на
  // экране выглядит сбоем, а не рекомендацией.
  const inPicks = new Set(picks.map((p) => p.appid))
  const discoveries = focus
    ? []
    : heuristicPicks(
        discovery.filter((c) => !inPicks.has(c.appid)),
        metaNow,
        DISCOVERY_CARDS,
        now,
        profile,
      )

  const libByAppid = new Map(games.map((g) => [g.appid, g]))
  const enrich = (p: Pick) => {
    const meta = metaNow(p.appid)
    const lib = libByAppid.get(p.appid)
    const topTags = Object.entries(meta?.tags ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([t]) => t)
    return {
      ...p,
      headerImage: meta?.headerImage ?? null,
      art: meta?.art ?? null,
      ccu: meta?.ccu ?? null,
      shortDescription: meta?.shortDescription ?? null,
      tags: topTags,
      hoursPlayed: lib ? Math.round(lib.playtimeForever / 60) : null,
      store: meta?.store ?? null,
      storeUrl: meta?.storeUrl ?? null,
      priceFinal: meta?.priceFinal ?? null,
      isFree: meta?.isFree ?? null,
      // Скидка — разговор про покупку, поэтому только у не купленного: на
      // своей игре «−40%» сообщает ровно ничего, кроме того, что ты купил
      // её дороже. Считается на сервере вместе с подписью срока: у клиента
      // свой часовой пояс, и «до 17 августа» разъехалось бы при гидратации.
      discount: meta && p.source === 'new' ? discountView(meta, now) : null,
      signals: meta ? explainMatch(profile, meta, mood) : null,
    }
  }

  /**
   * Кадры для морфа в герое — только у picks, и это не экономия ради экономии.
   * Карточка «Ещё варианты» по клику становится героем, а «нет в библиотеке»
   * ведёт в магазин и героем не станет никогда, так что её кадры точно никто
   * не покажет. Обрезка до HERO_SLIDES по той же причине: в одном ответе пять
   * игр, а у иных в базе по два десятка скриншотов.
   */
  const heroShots = (appid: number) => (metaNow(appid)?.screenshots ?? []).slice(0, HERO_SLIDES)

  return NextResponse.json({
    picks: picks.map((p) => ({ ...enrich(p), screenshots: heroShots(p.appid) })),
    discoveries: discoveries.map(enrich),
    engine: fromClaude ? 'claude' : 'heuristic',
    candidateCount: candidates.length,
    scope,
  })
}
