import { NextResponse } from 'next/server'
import { buildCandidates } from '@/lib/candidates'
import { buildPickContext, exploreCardView, shelfCardView } from '@/lib/cards'
import { getGamesMetaLite, listExplore } from '@/lib/db'
import { EXPLORE_SHELF, exploreDeck, exploredAppids } from '@/lib/explore'
import { heuristicPicks } from '@/lib/llm'
import { NEUTRAL_MOOD } from '@/lib/mood'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

/*
 * Колода исследователя (/explore, lib/explore.ts): пятнадцать карт своего и
 * каталога без вопроса о настроении и полка «Приглянулось».
 *
 * Только чтение: свайпы пишет /api/feedback с причиной 'explore', и сессии,
 * которой писать нельзя, он ответит needsteam — колода у неё листается на
 * устройстве. Модели здесь нет вовсе: причины — шаблоны эвристики, как у
 * выдачи по подталкиванию (правило владельца «никакого нового расхода на
 * модель»).
 *
 * Потолки — те же, что у /api/recommend, и по той же причине: отбор стоит
 * столько же прочитанных строк Turso, а сессию бесплатно выдаёт демо-вход.
 * Считаем по обеим осям: steamid — про человека, который завис на «ещё
 * колоду», IP — про скрипт, который чеканит демо-личности.
 */
const EXPLORE_LIMIT = 20
const EXPLORE_WINDOW_SEC = 600
const EXPLORE_IP_LIMIT = 60

export async function GET(req: Request) {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const now = nowSec()

  /*
   * Оба гейта и прочитанное — одним заходом, а не лесенкой.
   *
   * Обращение к Turso стоит около 35 мс (замер в lib/candidates.ts), и три
   * независимых чтения по очереди складывались в сотню миллисекунд до
   * первого полезного шага. Цена — лишнее чтение listExplore на отказанном
   * запросе, и отказ по первому гейту теперь всё равно отмечается во втором.
   */
  const ip = clientIp(req.headers)
  const [verdicts, explored] = await Promise.all([
    Promise.all(
      [
        { bucket: 'explore', id: steamid, limit: EXPLORE_LIMIT, windowSec: EXPLORE_WINDOW_SEC },
        { bucket: 'explore-ip', id: ip, limit: EXPLORE_IP_LIMIT, windowSec: EXPLORE_WINDOW_SEC },
      ].map((gate) => checkRate(db, { ...gate, nowSec: now })),
    ),
    // Что уже листал: приглянувшееся лежит на полке, «Мимо» неделю не
    // возвращается — колода каждый заход о новом (exploredAppids)
    listExplore(db, steamid),
  ])
  const refused = verdicts.find((v) => !v.ok)
  if (refused) return rateLimitedResponse(refused.retryAfterSec)

  // Тот же конвейер, что у /play и «Игры дня», но без настроения: его здесь
  // не спрашивали, и судить им нечего (moodless). Нейтральное настроение —
  // ради одиночного social: компании колода не собирается
  // Полка «Приглянулось» от колоды не зависит — её мета едет параллельно
  const likedIds = explored.filter((r) => r.liked).map((r) => r.appid).slice(0, EXPLORE_SHELF)
  const [set, likedMetas] = await Promise.all([
    buildCandidates(db, steamid, NEUTRAL_MOOD, 'all', {
      nowSec: now,
      moodless: true,
      exclude: exploredAppids(explored, now),
    }),
    getGamesMetaLite(db, likedIds),
  ])
  if (set === 'nolibrary') return NextResponse.json({ error: 'nolibrary' }, { status: 409 })
  if (set === 'nocandidates') return NextResponse.json({ error: 'nocandidates' }, { status: 409 })

  const deck = exploreDeck(set.own, set.discovery)
  // Цены — до причин: шаблон называет скидку, а карта — ценник (buildPickContext)
  const ctx = await buildPickContext(
    db,
    set,
    deck.map((c) => c.appid),
  )
  const reasons = new Map(
    heuristicPicks(deck, ctx.metaNow, deck.length, now, set.profile, {
      tagWeight: set.tagWeight,
      anchorOf: ctx.anchorOf,
      hoursOf: ctx.hoursOf,
      hideUrgency: ctx.hideUrgency,
    }).map((p) => [p.appid, p]),
  )

  return NextResponse.json({
    // см. докблок в PlayersNow: подпись «сейчас» требует серверных часов
    nowSec: now,
    // Порядок колоды — свой (чередование), а не порядок эвристики по скору
    cards: deck.flatMap((c) => {
      const p = reasons.get(c.appid)
      return p ? [exploreCardView(p, ctx)] : []
    }),
    // Полка «Приглянулось», свежие первыми; игра, выпавшая из каталога, — мимо
    liked: likedIds.flatMap((id) => {
      const meta = likedMetas.get(id)
      return meta ? [shelfCardView(meta)] : []
    }),
  })
}
