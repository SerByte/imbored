import { NextResponse } from 'next/server'
import { assignEdges } from '@/lib/badges'
import { buildCandidates } from '@/lib/candidates'
import { buildPickContext, cardView, heroMediaView } from '@/lib/cards'
import { getHeroMedia } from '@/lib/db'
import { claudePicks, heuristicPicks, topUpPicks } from '@/lib/llm'
import { parseLean, parseMood } from '@/lib/mood'
import { parseExclude, parseNudge, planNudge } from '@/lib/nudge'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import {
  continueView,
  parseFocus,
  parseScope,
  parseSeed,
  PICK_COUNT,
  pickContinue,
} from '@/lib/recommend'
import { currentSteamId, getDb, isDemoId, nowSec } from '@/lib/server'
import { CANDIDATE_SOURCES, type ScoredCandidate } from '@/lib/types'

// Маршрут по дороге зовёт модель. Предел объявляем явно, как в кроновых
// маршрутах: иначе он неявный, а зависший вызов способен съесть его целиком
// вместо того, чтобы упасть на эвристику.
export const maxDuration = 60

/** Сколько игр из каталога уходит в нижний блок «Нет в твоей библиотеке» */
const DISCOVERY_CARDS = 6

/**
 * Сколько знакомого пускать в пятёрку. Одно — по умолчанию: иначе у человека
 * с сотней наигранных песочниц выдача стала бы «играй в то, что всегда». Три —
 * когда он сам попросил знакомого: это его запрос, но и тогда не вся пятёрка.
 */
const FAMILIAR_CAP = 1
const FAMILIAR_CAP_ASKED = 3

/*
 * Потолки на самую дорогую ручку продукта.
 *
 * Сессия здесь не барьер: её бесплатно выдаёт POST /api/connect {demo:true}
 * без всякой аутентификации, а каждый вызов этой ручки идёт в Claude. Без
 * ограничителя цикл «получить демо-сессию → запросить подборку» превращается
 * в чужой счёт за токены, и заметить это можно было бы только по биллингу.
 *
 * Считаем по обеим осям сразу. Один steamid — про человека, который завис на
 * кнопке «ещё»; один IP — про скрипт, который чеканит новые демо-личности
 * (они одноразовые, см. demoSteamId, и лимит по steamid ему не преграда).
 *
 * Отказ здесь именно 429, а не тихий откат на эвристику. Эвристика существует
 * для СБОЯ модели, и подменять ею отказ по лимиту значит скрыть от честного
 * человека, что он упёрся в потолок.
 */
const RECOMMEND_LIMIT = 20
const RECOMMEND_WINDOW_SEC = 600
const RECOMMEND_IP_LIMIT = 60

/*
 * Отдельный, куда более жёсткий потолок именно на вызовы модели у демо-личностей.
 *
 * Демо-выдача обязана быть настоящей: гость приходит с лендинга ровно за тем,
 * чтобы увидеть, как это работает, и шаблонное объяснение на первом же экране
 * обесценивает весь путь. Но и бесконечно крутить чужую библиотеку за наши
 * токены незачем — после пары подборок «вау» уже случилось.
 */
const DEMO_LLM_LIMIT = 2
const DEMO_LLM_WINDOW_SEC = 86_400

export async function POST(req: Request) {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    mood?: unknown
    focus?: unknown
    scope?: unknown
    lean?: unknown
    seed?: unknown
    nudge?: unknown
    exclude?: unknown
  }
  const asked = parseMood(body.mood)
  if (!asked) return NextResponse.json({ error: 'badmood' }, { status: 400 })
  const focus = parseFocus(body.focus)
  // Неверное значение не ошибка, а «ось не выбрана»: у каждого кода ошибки
  // здесь должен быть свой экран на /play, а опечатка в адресе его не стоит
  const lean = parseLean(body.lean)
  // «Как «X», но…» — по тому же правилу: мусор значит «без затравки»
  const seed = parseSeed(body.seed)
  // Подталкивание после выдачи (lib/nudge.ts) — и снова мусор значит «без
  // него». Настроение и источник оно меняет до подбора: «Покороче» — это то
  // же настроение, только на ступень короче, и объяснять карточку надо им
  const nudge = parseNudge(body.nudge)
  // «Разгрести своё» и «покажи что угодно» — противоположные запросы:
  // при явном фокусе каталог в главную выдачу не пускаем вовсе
  const plan = planNudge(nudge, asked, focus ? 'library' : parseScope(body.scope))
  const { mood, scope } = plan

  const db = await getDb()
  const now = nowSec()

  const ip = clientIp(req.headers)
  for (const gate of [
    { bucket: 'recommend', id: steamid, limit: RECOMMEND_LIMIT, windowSec: RECOMMEND_WINDOW_SEC },
    { bucket: 'recommend-ip', id: ip, limit: RECOMMEND_IP_LIMIT, windowSec: RECOMMEND_WINDOW_SEC },
  ]) {
    const verdict = await checkRate(db, { ...gate, nowSec: now })
    if (!verdict.ok) return rateLimitedResponse(verdict.retryAfterSec)
  }

  // Весь путь от снапшота до отранжированных кандидатов — lib/candidates.ts,
  // общий с «Игрой дня»: копии этого пути в двух маршрутах уже расходились
  const set = await buildCandidates(db, steamid, mood, scope, {
    nowSec: now,
    // Знакомое любимое — только здесь: «Игре дня» и демо главной оно не нужно
    allowFamiliar: true,
    familiarCap: lean === 'familiar' ? FAMILIAR_CAP_ASKED : FAMILIAR_CAP,
    lean,
    focus,
    seed,
    nudge: plan,
    exclude: parseExclude(body.exclude),
  })
  if (set === 'nolibrary') return NextResponse.json({ error: 'nolibrary' }, { status: 409 })
  if (set === 'nocandidates') return NextResponse.json({ error: 'nocandidates' }, { status: 409 })
  const { games, libMetas, profile, tagWeight, cooldown, banned, candidates, actual, discovery, heroPool } =
    set
  const seedRef = set.seed

  // Цены — до подбора, и по всем, кто может попасть на экран: см. buildPickContext
  const ctx = await buildPickContext(
    db,
    set,
    [...new Set([...heroPool, ...discovery].map((c) => c.appid))],
  )
  const { metaNow, anchorOf, hoursOf, hideUrgency } = ctx

  // Демо-личность получает настоящую подборку, но считанное число раз в сутки —
  // дальше та же выдача собирается эвристикой. Проверка идёт последней, уже
  // после того как пул собран: она должна тратить квоту только тогда, когда
  // вызов модели реально состоялся бы.
  //
  // Выдача из соседей («Как «X», но…») и по подталкиванию к модели не ходит
  // вовсе: правило владельца — никакого нового расхода на модель, а это новые
  // поводы её звать. Эвристика с якорем и причинами по тегам здесь и так
  // говорит по делу. Условия про затравку и подталкивание стоят в && первыми:
  // такой запрос не тратит и демо-квоту.
  const llmAllowed =
    seedRef === null &&
    nudge === null &&
    (!isDemoId(steamid) ||
      (
        await checkRate(db, {
          bucket: 'llm-demo',
          id: steamid,
          limit: DEMO_LLM_LIMIT,
          windowSec: DEMO_LLM_WINDOW_SEC,
          nowSec: now,
        })
      ).ok)

  const fromClaude =
    heroPool.length && llmAllowed
      ? await claudePicks({
          candidates: heroPool,
          metaOf: metaNow,
          library: games,
          mood,
          focus,
          nowSec: now,
          anchorOf,
          lean,
        })
      : null
  const byHeuristic = (pool: ScoredCandidate[], count: number) =>
    heuristicPicks(pool, metaNow, count, now, profile, {
      tagWeight,
      anchorOf,
      hoursOf,
      // «Расслабиться» и прямая просьба о знакомом — те случаи, когда оно
      // заслуживает места и без лучшего скора; в остальных — только по скору
      guaranteed: mood.vibe === 'chill' || lean === 'familiar' ? CANDIDATE_SOURCES : undefined,
      hideUrgency,
    })
  // Модель могла вернуть меньше пятёрки (отсеяла validatePicks) — недостающее
  // добирает та же эвристика из кандидатов, которых модель не взяла
  const picks = fromClaude
    ? topUpPicks(fromClaude, heroPool, PICK_COUNT, byHeuristic)
    : byHeuristic(heroPool.length ? heroPool : actual, PICK_COUNT)

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
        { tagWeight, anchorOf, hideUrgency },
      )

  // «Продолжить «X»» — то, во что он играет сейчас: строкой под героем, а не
  // шестой карточкой. Отложенное и надоевшее не предлагаем — пауза, взятая
  // минуту назад, тоже ответ, и «продолжи то, что надоело» его бы не услышало.
  const paused = [...cooldown].filter(([, c]) => c.mult < 1).map(([appid]) => appid)
  const cont = pickContinue(
    games,
    (id) => libMetas.get(id),
    new Set([...banned, ...paused]),
    inPicks,
  )

  // Чем каждая карточка лучше соседних. Части скора живут только здесь, на
  // сервере: Pick из llm.ts их теряет, поэтому ищем по appid среди кандидатов.
  // Только у picks: полка покупок — отдельный разговор, и второе «ближе всего
  // к вкусу» на ней спорило бы с первым в главной выдаче.
  const partsOf = new Map(candidates.map((c) => [c.appid, c.parts]))
  const edges = assignEdges(
    picks.map((p) => {
      const meta = metaNow(p.appid)
      return {
        appid: p.appid,
        parts: partsOf.get(p.appid),
        // Своя наигранная за вкус не соревнуется: вкус из неё и посчитан
        source: p.source,
        reviewsTotal: meta?.reviewsTotal,
        reviewsPercent: meta?.reviewsPercent,
      }
    }),
    // Пустой профиль — вкус посчитан популярностью, хвалить им нечестно
    { taste: Object.keys(profile).length > 0 },
  )

  // Кадры и трейлер — только у пятёрки (heroMediaView). Читаются отдельно, по
  // пятёрке: метаданные конвейера узкие, без блобов. Заодно кадры получает и
  // герой из каталога — строки пула скриншотов не несут.
  const media = await getHeroMedia(
    db,
    picks.map((p) => p.appid),
  )

  return NextResponse.json({
    // Серверные часы к ответу: по ним PlayersNow решает, имеет ли право
    // подписать онлайн словом «сейчас». Клиентский Date.now() в рендере и
    // нечист, и расходится с SSR — тот же довод, что в components/whatsnew/Now
    nowSec: nowSec(),
    picks: picks.map((p) => ({
      ...cardView(p, ctx, edges.get(p.appid) ?? null),
      ...heroMediaView(media.get(p.appid)),
    })),
    discoveries: discoveries.map((p) => cardView(p, ctx)),
    engine: fromClaude ? 'claude' : 'heuristic',
    candidateCount: candidates.length,
    scope,
    // Эхо оси: под какое состояние собрана выдача. null — без оси, в том
    // числе когда в адресе была опечатка: её мы молча не применили
    lean,
    // Эхо затравки «Как «X», но…»: чьи соседи на экране. null — обычная выдача
    seed: seedRef,
    // Эхо подталкивания: какой чипс под героем нажат. null — без него, в том
    // числе при мусоре в поле
    nudge,
    // Строка «Продолжить» или null — /play сам решает, где её не показывать
    continue: cont ? continueView(cont) : null,
    // Чья выдача. /play держит её на устройстве пятнадцать минут и обязан не
    // показать её другому входу в той же вкладке (lib/playcache.ts). Свой же
    // steamid своему же человеку — то, что и так отдаёт /api/session/touch.
    viewer: steamid,
  })
}
