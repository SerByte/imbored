import { NextResponse } from 'next/server'
import { assignEdges } from '@/lib/badges'
import { buildCandidates } from '@/lib/candidates'
import { buildPickContext, cardView, heroMediaView, scoreView } from '@/lib/cards'
import { getGamesMetaLite, getHeroMedia, latestEveningPlan } from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { HUB_GENRES, hubTagOf } from '@/lib/gamehub'
import { claudePicks, heuristicPicks, llmAvailable, reasonPrice, topUpPicks } from '@/lib/llm'
import { llmDailyCap, takeLlmBudgetForIp } from '@/lib/llmcap'
import { parseLean, parseMood } from '@/lib/mood'
import { parseExclude, parseNudge, planNudge } from '@/lib/nudge'
import {
  checkRate,
  checkRatesInOrder,
  clientIp,
  personalRateId,
  rateLimitedResponse,
} from '@/lib/ratelimit'
import {
  continueView,
  hasTaste,
  mutedHit,
  ownFirst,
  parseFocus,
  parseScope,
  parseSeed,
  PICK_COUNT,
  pickContinue,
} from '@/lib/recommend'
import { shareView } from '@/lib/pickshare'
import { parseGenreParam } from '@/lib/presets'
import { shareText } from '@/lib/sharedpick'
import { currentMutes, currentSession, getDb, isDemoId, isWriter, nowSec, sessionSecret } from '@/lib/server'
import { recordTelemetryLater } from '@/lib/telemetry'
import { CANDIDATE_SOURCES, type ScoredCandidate } from '@/lib/types'
import { readJsonObject } from '@/lib/reqbody'

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
 * Считаем по обеим осям сразу. Личный потолок — про человека, который завис
 * на кнопке «ещё»; один IP — про скрипт, который чеканит новые демо-личности
 * и сессии по ссылке (они одноразовые, см. demoSteamId, и личный потолок ему
 * не преграда).
 *
 * Личный — не «на steamid». Один steamid давно не значит одного человека:
 * сессию по ссылке /api/connect выдаёт на любой публичный профиль, и общий
 * счётчик позволял чужому двадцатью запросами запирать владельцу /play окно
 * за окном. Writer считается по steamid (один человек на всех своих
 * устройствах), сессия по ссылке — сама по себе: personalRateId в
 * lib/ratelimit.
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
 *
 * Квота на личность, а демо-личность новая на каждый демо-вход без куки, —
 * скрипт её обходит. От скрипта бюджет модели стережёт доля адреса
 * (llmIpDailyLimit в lib/llmcap), общая для демо и сессий по ссылке.
 */
const DEMO_LLM_LIMIT = 2
const DEMO_LLM_WINDOW_SEC = 86_400

export async function POST(req: Request) {
  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'nosession' }, { status: 401 })
  const { steamid } = session

  const body = (await readJsonObject(req)) as {
    mood?: unknown
    focus?: unknown
    scope?: unknown
    lean?: unknown
    seed?: unknown
    genre?: unknown
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
  // Жанр со страницы /games/<slug> — адресом страницы (parseGenreParam), и
  // страница должна быть: незнакомый адрес — «без жанра», как опечатка в lean
  const genreSlug = typeof body.genre === 'string' ? parseGenreParam(body.genre) : null
  const genre = genreSlug ? hubTagOf(genreSlug) : null
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
  const mutes = await currentMutes()

  // Личный гейт первым: отказанный по нему запрос не съедает потолок адреса
  const ip = clientIp(req.headers)
  const gate = await checkRatesInOrder(
    db,
    [
      {
        bucket: 'recommend',
        id: personalRateId(session, isWriter(session)),
        limit: RECOMMEND_LIMIT,
        windowSec: RECOMMEND_WINDOW_SEC,
      },
      { bucket: 'recommend-ip', id: ip, limit: RECOMMEND_IP_LIMIT, windowSec: RECOMMEND_WINDOW_SEC },
    ],
    now,
  )
  if (!gate.ok) {
    // Сколько раз упёрлись в потолок — числом за час (telemetry_hourly), раз
    // на человека или адрес за окно: 'ratelimited:recommend' или
    // 'ratelimited:recommend-ip'. Подталкивания и «Как «X», но…» к модели не
    // ходят, а квоту тратят ту же — делить потолок на дорогой и дешёвый стоит,
    // только если это число окажется заметным рядом с pick_shown
    if (gate.first) recordTelemetryLater('event', `ratelimited:${gate.bucket}`)
    return rateLimitedResponse(gate.retryAfterSec)
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
    genre,
    nudge: plan,
    // Что уже на экране — только «Что-то другое»: остальным подталкиваниям
    // показанная игра, подошедшая под поправку, не помеха
    exclude: nudge === 'different' ? parseExclude(body.exclude) : [],
    // «Не предлагать» — кукой этого браузера (lib/mutetags.ts): /play стоит
    // у потолка бюджета и ради фильтра не везёт ни байта
    muted: mutes,
  })
  if (set === 'nolibrary') return NextResponse.json({ error: 'nolibrary' }, { status: 409 })
  // Кандидаты были, но все — под «Не предлагать»: совет — ослабить фильтр, а
  // не «верни что-нибудь из бана» (FAIL.muted на /play). Затравку тут не
  // называем: пусто не потому, что у X нет соседей
  if (set === 'allmuted') return NextResponse.json({ error: 'muted' }, { status: 409 })
  if (set === 'nocandidates') {
    /*
     * «Как «X», но…» приходит и адресом — со страницы игры, из «Уже прошёл» и
     * из библиотеки, — и экран отказа обязан сказать, ЧЬИХ соседей не нашлось:
     * «подбирать не из чего» у выдачи, которую просили «в духе Hades», звучит
     * как поломка. Имя — одним чтением и только на этом отказе. Незнакомой
     * затравке назвать нечего — тогда поля нет, и экран скажет общими словами.
     *
     * То же у жанра со страницы /games: «верни что-нибудь из бана» у выдачи
     * визуальных новелл «с друзьями» — чужой совет, пусто там от жанра
     * (свои — только сетевые, пул магазина — только мультиплеер). Название —
     * из словаря, без чтения базы, и только если жанр применился: при
     * затравке его нет (buildCandidates), и экран тогда про затравку.
     */
    const seedName = seed === null ? undefined : (await getGamesMetaLite(db, [seed])).get(seed)?.name
    const genreTitle = seed === null && genre !== null ? HUB_GENRES[genre].title : null
    return NextResponse.json(
      {
        error: 'nocandidates',
        ...(seedName ? { seed: { appid: seed, name: seedName } } : {}),
        ...(genreTitle ? { genre: { title: genreTitle } } : {}),
      },
      { status: 409 },
    )
  }
  const { games, libMetas, profile, tagWeight, cooldown, banned, candidates, actual, discovery, heroPool } =
    set
  const seedRef = set.seed

  // Цены — до подбора, и по всем, кто может попасть на экран: см. buildPickContext.
  // Крупный патч после последнего запуска — только writer-сессии: факт
  // производный от даты запуска, а сессию по вставленной ссылке выдают на
  // любой публичный профиль (lib/comeback.ts). Остальным и запроса нет
  const ctx = await buildPickContext(
    db,
    set,
    [...new Set([...heroPool, ...discovery].map((c) => c.appid))],
    { patches: isWriter(session) },
  )
  const { metaNow, anchorOf, hoursOf, hideUrgency, patchOf } = ctx

  // Демо-личность получает настоящую подборку, но считанное число раз в сутки —
  // дальше та же выдача собирается эвристикой. Проверка идёт уже после того,
  // как пул собран: она должна тратить квоту только тогда, когда вызов модели
  // реально состоялся бы. Поэтому сперва всё, что решается без записи, —
  // есть из чего выбирать, есть ключ и модель не выключена нулём
  // (LLM_DAILY_CAP=0): раньше демо-квота списывалась и без них, и гость мог
  // потерять свою пару настоящих подборок на шаблонах — а включи владелец
  // модель обратно в тот же день, гости, заходившие при выключенной, сутки
  // получали бы эвристику.
  //
  // Выдача из соседей («Как «X», но…»), по жанру со страницы /games и по
  // подталкиванию к модели не ходит вовсе: правило владельца — никакого
  // нового расхода на модель, а это новые поводы её звать. Эвристика с якорем
  // и причинами по тегам здесь и так говорит по делу. Такой запрос не тратит
  // ни одной квоты ниже.
  const wantsModel =
    seedRef === null &&
    set.genre === null &&
    nudge === null &&
    heroPool.length > 0 &&
    llmAvailable() &&
    llmDailyCap() > 0

  // Дальше — по очереди, как в checkRatesInOrder: личная квота демо, доля
  // адреса в суточном бюджете, сам бюджет (lib/llmcap, takeLlmBudgetForIp).
  // Доля адреса — потому что потолки подбора выше стерегут Turso, а не
  // модель: шестьдесят подборов на адрес за десять минут выбрали бы общий
  // бюджет суток за часы, и до полуночи модель молчала бы для всех. Отказ на
  // любом шаге — та же выдача эвристикой, без 429: это не личный потолок
  // человека на подборы, и отказывать ему не за что.
  const llmAllowed =
    wantsModel &&
    (!isDemoId(steamid) ||
      (
        await checkRate(db, {
          bucket: 'llm-demo',
          id: steamid,
          limit: DEMO_LLM_LIMIT,
          windowSec: DEMO_LLM_WINDOW_SEC,
          nowSec: now,
        })
      ).ok) &&
    (await takeLlmBudgetForIp(db, ip, now))

  const fromClaude =
    llmAllowed
      ? await claudePicks({
          candidates: heroPool,
          metaOf: metaNow,
          library: games,
          mood,
          focus,
          nowSec: now,
          anchorOf,
          lean,
          profile,
          tagWeight,
          // «С твоего последнего захода вышло крупное обновление» — у
          // заброшенных, где патч подтверждён моделью (lib/comeback.ts)
          patchOf,
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
      playtimeHidden: set.playtimeHidden,
      patchOf,
    })
  // Модель могла вернуть меньше пятёрки (отсеяла validatePicks) — недостающее
  // добирает та же эвристика из кандидатов, которых модель не взяла.
  //
  // «Своё идёт первым» — одним местом для всех трёх путей (модель, её добор,
  // эвристика): и модель, и скор ставили первой покупку со скидкой, хотя
  // главная обещает обратное (ownFirst в lib/recommend). Где покупок в
  // пятёрке нет (scope 'library', фокус), ничего не меняет
  const picks = ownFirst(
    fromClaude
      ? topUpPicks(fromClaude, heroPool, PICK_COUNT, byHeuristic)
      : byHeuristic(heroPool.length ? heroPool : actual, PICK_COUNT),
  )

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
        { tagWeight, anchorOf, hideUrgency, playtimeHidden: set.playtimeHidden },
      )

  // «Продолжить «X»» — то, во что он играет сейчас: строкой под героем, а не
  // шестой карточкой. Отложенное и надоевшее не предлагаем — пауза, взятая
  // минуту назад, тоже ответ, и «продолжи то, что надоело» его бы не услышало.
  // И то, что под «Не предлагать»: «Продолжить» — тоже совет, а фильтр
  // обещает «никогда». Судим только сыгранное за две недели — других
  // pickContinue не берёт, и сортировать теги всей библиотеки незачем
  const paused = [...cooldown].filter(([, c]) => c.mult < 1).map(([appid]) => appid)
  const mutedNow = mutes.length
    ? games.filter((g) => g.playtime2Weeks > 0 && mutedHit(libMetas.get(g.appid), mutes)).map((g) => g.appid)
    : []
  const cont = pickContinue(
    games,
    (id) => libMetas.get(id),
    new Set([...banned, ...paused, ...mutedNow]),
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
    // Пустой профиль — вкус посчитан популярностью, хвалить им нечестно.
    // Пустой — по hasTaste, тем же правилом, что выбрало популярность в
    // скоринге: профиль из нулей после скипа «не тот жанр» иначе получил бы
    // «Ближе всего к вкусу» за число, которое вкусом не было
    { taste: hasTaste(profile) },
  )

  // Кадры и трейлер — только у пятёрки (heroMediaView). Читаются отдельно, по
  // пятёрке: метаданные конвейера узкие, без блобов. Заодно кадры получает и
  // герой из каталога — строки пула скриншотов не несут.
  //
  // Рядом, тем же заходом, — план на вечер (lib/eveningplan.ts): поставленное
  // на загрузку /play показывает строкой с запуском над «Продолжить». Только
  // пишущей сессии не из демо — план её же нажатие. Отказ чтения выдачу не
  // срывает: план — строка сбоку
  const [media, eveningPlan] = await Promise.all([
    getHeroMedia(
      db,
      picks.map((p) => p.appid),
    ),
    isWriter(session) && !isDemoId(steamid)
      ? latestEveningPlan(db, steamid, now).catch((err: unknown) => {
          logSwallowed('recommend:plan', err)
          return null
        })
      : null,
  ])

  return NextResponse.json({
    // Серверные часы к ответу: по ним PlayersNow решает, имеет ли право
    // подписать онлайн словом «сейчас». Клиентский Date.now() в рендере и
    // нечист, и расходится с SSR — тот же довод, что в components/whatsnew/Now
    nowSec: nowSec(),
    // scoreView — место и части скора для снимка к оценке (lib/feedbackctx):
    // /play возвращает их с «Зашло» и «Не то», на экран они не выводятся
    picks: picks.map((p, i) => ({
      ...cardView(p, ctx, edges.get(p.appid) ?? null),
      ...heroMediaView(media.get(p.appid)),
      ...scoreView(i, partsOf.get(p.appid)),
      // «Отправить другу» (/pick): текст без денег — ни хвоста шаблона, ни
      // цены словами модели, — подписанный для этой сессии (lib/pickshare).
      // И без факта о патче: «С твоего последнего захода…» на публичной
      // странице получатель прочтёт про себя, а дату запуска она выдаст
      // любому (shareText, lib/comeback.ts)
      ...shareView(sessionSecret(), {
        steamid,
        appid: p.appid,
        source: p.source,
        text: shareText(
          p.reason,
          reasonPrice(p.source, metaNow(p.appid), ctx.now, hideUrgency),
          patchOf(p.appid),
        ),
      }),
    })),
    discoveries: discoveries.map((p, i) => ({
      ...cardView(p, ctx),
      ...scoreView(i, partsOf.get(p.appid)),
    })),
    engine: fromClaude ? 'claude' : 'heuristic',
    candidateCount: candidates.length,
    scope,
    // Эхо оси: под какое состояние собрана выдача. null — без оси, в том
    // числе когда в адресе была опечатка: её мы молча не применили
    lean,
    // Эхо затравки «Как «X», но…»: чьи соседи на экране. null — обычная выдача
    seed: seedRef,
    // Эхо жанра со страницы /games: название — для подписи «Только рогалики»,
    // own — есть ли в пятёрке свои. Нет своих — подпись скажет, что эти из
    // магазина: «рогалики из твоей библиотеки» без единой своей были бы
    // неправдой. null — без жанра, в том числе при затравке и мусоре в поле
    genre: set.genre ? { title: HUB_GENRES[set.genre].title, own: picks.some((p) => p.source !== 'new') } : null,
    // Эхо подталкивания: какой чипс под героем нажат. null — без него, в том
    // числе при мусоре в поле
    nudge,
    // Строка «Продолжить» или null — /play сам решает, где её не показывать.
    // Мета у неё есть всегда (pickContinue без неё не выбирает): по ней
    // finishable — ставить ли рядом «Уже прошёл»
    continue: cont ? continueView(cont, libMetas.get(cont.appid)) : null,
    // План на вечер или null — строка с запуском над «Продолжить»
    plan: eveningPlan,
    // Время скрыто настройками Steam (lib/playtime.ts): /play говорит об этом
    // строкой и подсказывает, как открыть, — иначе свои карточки «Из твоей
    // библиотеки» без единого часа выглядели бы сбоем
    playtimeHidden: set.playtimeHidden,
    // Чья выдача. /play держит её на устройстве пятнадцать минут и обязан не
    // показать её другому входу в той же вкладке (lib/playcache.ts). Свой же
    // steamid своему же человеку — то, что и так отдаёт /api/session/touch.
    viewer: steamid,
  })
}
