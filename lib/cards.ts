import type { PickEdge } from './badges'
import type { CandidateSet } from './candidates'
import { refreshDealsWithin } from './deals'
import { comebackPatchPairs } from './comeback'
import { getGamesMetaLite, latestMajorPatchSince, type Db, type HeroMedia } from './db'
import { discountView, trustedPrice } from './discount'
import { entryCost, showsEntry } from './entry'
import { logSwallowed } from './errlog'
import { partsView } from './feedbackctx'
import { descriptionFor, storeUrlFor } from './gamedesc'
import { isRussianText } from './gamepage'
import { ruLangLine, sessionTrait } from './gametraits'
import type { Locale } from './i18n'
import type { Pick as LlmPick } from './llm'
import {
  buildAnchorFinder,
  deferredOf,
  explainMatch,
  hideUrgencyFor,
  topTags,
  type Cooldown,
  type OwnAnchor,
} from './recommend'
import { refundEligible } from './refund'
import { HERO_SLIDES } from './shots'
import type { TagWeight } from './tagweight'
import type { CandidateSource, GameMeta, Mood, ScoreParts } from './types'

/*
 * КАРТОЧКА ВЫДАЧИ — ОДИН КОНТРАКТ ОТ СЕРВЕРА ДО КЛИЕНТА.
 *
 * Поля карточки собирались в двух маршрутах (enrich в /api/recommend и тело
 * ответа /api/daily), а описывались на клиенте ещё двумя типами, написанными
 * руками. Каждое новое поле — трейлер, цена входа, длина сессии, отзывы —
 * требовало правки в четырёх местах, и опечатка в имени на клиенте давала
 * undefined без единой ошибки tsc: ответ приводится типом, а не проверяется.
 *
 * Теперь карточку строят функции отсюда, а клиенты берут их тип через
 * `import type` (lib/playflow.ts, app/daily/page.tsx): новое поле — строка
 * здесь, и страница его видит; переименованное — красный tsc там, где его
 * читают. Модуль серверный (цены, база), но тип из него стирается при сборке
 * и в бандл клиента не попадает.
 */

/**
 * Всё, что нужно карточке помимо самой игры: чьим вкусом её объяснять, на что
 * похожа, сколько часов в ней и стоит ли называть срок распродажи.
 */
export type PickContext = {
  now: number
  mood: Mood
  profile: Record<string, number>
  tagWeight: TagWeight | null
  cooldown: ReadonlyMap<number, Cooldown>
  /** Мета со свежими ценами, где их обновили; иначе — из конвейера */
  metaNow: (appid: number) => GameMeta | undefined
  /** Своя игра, на которую эта похожа («Ближе всего к X, где у тебя N ч») */
  anchorOf: (appid: number) => OwnAnchor | null
  /** Часы в своей игре; null — не своя */
  hoursOf: (appid: number) => number | null
  /**
   * Больше тридцати нераспакованных — срок распродажи не называем ни в
   * причине, ни под ценой: «успей купить» ему не помощь, а ещё одна покупка.
   */
  hideUrgency: boolean
  /**
   * Пересказ крупного патча, вышедшего после последнего запуска заброшенной
   * игры (lib/comeback.ts); null — факта нет, и причина говорит по-старому.
   * На языке locale: на /en — английский пересказ, а без него факта нет.
   */
  patchOf: (appid: number) => string | null
  /**
   * Язык карточек: на нём «О чём игра», страница магазина у игр не из Steam
   * и всё, что карточка говорит словами, — длина сессии (sessionTrait),
   * настроение словами (explainMatch → moodWords) и срок распродажи
   * (discountView → endsLabel). Русский по умолчанию — так контекст собирают
   * все прежние вызывающие.
   */
  locale: Locale
}

/**
 * Контекст по готовому набору кандидатов — без похода за ценами. «Игре дня»
 * он нужен в отборе, а цены она обновляет сама, на каждом заходе.
 *
 * Якорь — одна и та же своя игра для причины шаблона, строки промпта и поля
 * via, поэтому считается один раз и отсюда. Баны якорем не бывают: ссылаться
 * на игру, которую человек попросил не показывать, — издёвка.
 */
export function pickContext(
  set: CandidateSet,
  metaNow: (appid: number) => GameMeta | undefined = set.metaOf,
  patches: ReadonlyMap<number, string> = new Map(),
  locale: Locale = 'ru',
): PickContext {
  const { games, libMetas, tagWeight, banned } = set
  const findAnchor = buildAnchorFinder(games, (id) => libMetas.get(id), tagWeight, banned)
  const libByAppid = new Map(games.map((g) => [g.appid, g]))
  return {
    now: set.now,
    mood: set.mood,
    profile: set.profile,
    tagWeight,
    cooldown: set.cooldown,
    metaNow,
    anchorOf: (appid) => {
      const meta = metaNow(appid)
      return meta ? findAnchor(meta) : null
    },
    hoursOf: (appid) => {
      const lib = libByAppid.get(appid)
      return lib ? Math.round(lib.playtimeForever / 60) : null
    },
    hideUrgency: hideUrgencyFor(games, (id) => libMetas.get(id)),
    patchOf: (appid) => patches.get(appid) ?? null,
    locale,
  }
}

/**
 * Крупные патчи после последнего запуска — у заброшенных из cands, одним
 * обходом к базе (latestMajorPatchSince). Нет ни одной заброшенной с датой —
 * нет и запроса: у выдачи при скрытом времени он не стоит ничего.
 *
 * Вызывающий сам решает, вправе ли сессия этот факт видеть: он производный от
 * даты последнего запуска (см. lib/comeback.ts).
 *
 * Сбой базы здесь не бросает, а даёт пустую карту. Факт о патче — украшение
 * причины, а не её основа: без него шаблон говорит по-старому («вернись и
 * проверь»). Проброшенный обрыв Turso ронял бы 500-й всю выдачу /play и
 * «Игру дня» ради одной фразы, которую и так можно не сказать. Сбой не
 * молчит — строка в логе (logSwallowed), как у соседних фолбэков.
 *
 * locale — язык пересказа: на /en факт — английский пересказ, а патч без
 * него фактом не считается (latestMajorPatchSince): русская фраза посреди
 * английской причины хуже, чем причина без факта.
 */
export async function comebackPatches(
  db: Db,
  set: CandidateSet,
  cands: ReadonlyArray<{ appid: number; source: CandidateSource }>,
  locale: Locale = 'ru',
): Promise<Map<number, string>> {
  const pairs = comebackPatchPairs(cands, set.games, set.playtimeHidden)
  if (!pairs.length) return new Map()
  try {
    return await latestMajorPatchSince(db, pairs, locale)
  } catch (err) {
    logSwallowed('cards:comeback-patches', err, { pairs: pairs.length })
    return new Map()
  }
}

/**
 * Контекст со свежими ценами — ДО подбора, а не перед самой отдачей.
 *
 * Объяснение к карточке пишется в тот же момент, что и сама карточка: и
 * шаблон, и промпт модели называют цену со скидкой. Спроси мы цены после — в
 * тексте стояла бы вчерашняя цена, а на плашке рядом сегодняшняя. Кандидатов
 * в разы больше пяти, но запрос всё равно один: GetItems берёт до двухсот игр.
 *
 * Без свежих цен перечитывать незачем: мета пула — та же узкая выборка тем же
 * маппером (lib/pool), и отличаться от getGamesMetaLite ей больше нечем.
 *
 * opts.patches — грузить ли крупные патчи у заброшенных (comebackPatches).
 * По умолчанию нет: «Открытия» (/api/explore) тоже зовут этот контекст, и
 * заброшенные в их колоде бывают, но причину про патч они не пишут — запрос
 * там был бы чтением ради выброса на каждом свайпе. Включает его только
 * /api/recommend, и только writer-сессии.
 *
 * opts.locale — язык карточек (PickContext.locale) и пересказов патчей.
 */
export async function buildPickContext(
  db: Db,
  set: CandidateSet,
  pricedIds: number[],
  opts: { patches?: boolean; locale?: Locale } = {},
): Promise<PickContext> {
  const locale = opts.locale ?? 'ru'
  // Патчи — у тех же, кто может попасть на экран, и тем же заходом, что цены:
  // друг от друга они не зависят. Источник берётся из пула героя (он и
  // решает, заброшенная ли)
  const onScreen = () => {
    const byId = new Map([...set.candidates, ...set.heroPool].map((c) => [c.appid, c]))
    return pricedIds.flatMap((id) => byId.get(id) ?? [])
  }
  const [refreshed, patches] = await Promise.all([
    refreshDealsWithin(db, pricedIds, set.now),
    opts.patches ? comebackPatches(db, set, onScreen(), locale) : new Map<number, string>(),
  ])
  const priced = refreshed ? await getGamesMetaLite(db, pricedIds) : new Map<number, GameMeta>()
  return pickContext(set, (appid) => priced.get(appid) ?? set.metaOf(appid), patches, locale)
}

/**
 * Картинка, магазин и цена — общее у всех карточек, от героя до плитки полки.
 * locale — только ради страницы магазина у игр не из Steam: на /en она своя
 * (storeUrlFor в lib/gamedesc), у игр Steam ссылки в мете нет вовсе.
 */
function shopView(meta: GameMeta | undefined, now: number, locale: Locale) {
  return {
    // Ссылку не угадываем шаблоном — путь Steam контент-адресуемый. Клиент
    // соберёт нужный размер сам через GameArt.
    headerImage: meta?.headerImage ?? null,
    art: meta?.art ?? null,
    store: meta?.store ?? null,
    storeUrl: storeUrlFor(meta, locale),
    priceFinal: meta ? trustedPrice(meta, now) : null,
    // Регион цены едет рядом с ней: валюту знает только он (lib/steamregion),
    // а клиентскому ценнику до STEAM_STORE_CC не дотянуться
    priceCc: meta?.priceCc ?? null,
    // «Не продаётся в российском Steam» — вместо цены, а не вместе с ней
    unsold: meta?.storeHidden === true,
    isFree: meta?.isFree ?? null,
  }
}

/**
 * Скидка и «Steam вернёт деньги» — разговор про покупку, поэтому только у не
 * купленного: на своей игре «−40%» сообщает ровно ничего, кроме того, что ты
 * купил её дороже. Скидка считается на сервере вместе с подписью срока: у
 * клиента свой часовой пояс, и «до 17 августа» разъехалось бы при гидратации.
 *
 * locale — язык подписи срока (discount.endsLabel: «осталось 2 дня» / «2 days
 * left»). Его передают все пять карточек: подпись уезжает клиенту готовой
 * строкой, и язык решает тот, кто её считает, — язык запроса.
 */
function buyView(
  meta: GameMeta | undefined,
  source: CandidateSource,
  now: number,
  hideUrgency: boolean,
  locale: Locale,
) {
  const buying = meta !== undefined && source === 'new'
  return {
    discount: buying ? discountView(meta, now, { urgency: !hideUrgency, locale }) : null,
    refund: buying ? refundEligible(meta, now) : false,
  }
}

/**
 * Карточка выдачи /play — и героя, и «Ещё вариантов», и полки покупок.
 * edge — одно преимущество перед соседними (lib/badges.ts), только у пятёрки.
 */
/**
 * «О чём игра» — одной строкой описания магазина, только у новой для человека
 * игры из каталога (source 'new') и только на языке карточки.
 *
 * Своя игра в объяснении не нуждается: человек её купил. А про некупленную из
 * каталога он видел название, теги и причину — и ни слова о том, что это
 * вообще такое. Раньше shortDescription ехал в каждой карточке и нигде не
 * читался; английский хвост из магазина (у большинства карточек до прохода
 * крона страниц) посреди русского героя читался бы сбоем — см. isRussianText.
 *
 * На /en — английское описание (descriptionFor в lib/gamedesc): английский
 * слот, своё описание, если оно английское, или null. Русского абзаца
 * посреди английского героя нет по тому же доводу, что и наоборот.
 */
export function aboutLine(
  source: CandidateSource,
  meta: GameMeta | undefined,
  locale: Locale = 'ru',
): string | null {
  if (source !== 'new') return null
  if (locale === 'en') return descriptionFor(meta, 'en')?.trim() || null
  const text = meta?.shortDescription?.trim()
  return text && isRussianText(text) ? text : null
}

export function cardView(p: LlmPick, ctx: PickContext, edge: PickEdge | null = null) {
  const meta = ctx.metaNow(p.appid)
  return {
    appid: p.appid,
    name: p.name,
    source: p.source,
    reason: p.reason,
    ...shopView(meta, ctx.now, ctx.locale),
    ccu: meta?.ccu ?? null,
    // без отметки подпись не имеет права говорить «сейчас» — см. PlayersNow
    ccuAt: meta?.ccuAt ?? null,
    about: aboutLine(p.source, meta, ctx.locale),
    tags: topTags(meta),
    hoursPlayed: ctx.hoursOf(p.appid),
    // «Сессия ~20 мин» / «Матч ~15 мин» — из семантики, только уверенной
    // (sessionTrait): та же строка, что на карточке игры, на языке карточки
    session: meta ? sessionTrait(meta, ctx.locale) : null,
    // Цена входа (lib/entry) — только у того, что человек ещё не осваивал:
    // у своей наигранной про вход говорит причина, а не отдельная строка
    entry: meta && showsEntry(p.source) ? entryCost(meta) : null,
    // «Русские субтитры» / «Без русского» — по отметкам Steam (ruLangLine),
    // у своей и у покупки: сюжетная игра без русского — другой вечер, а на
    // полке покупок это довод «за» или «против». Готовой фразой, а не
    // ступенью: клиенту /play таблица подписей в бандле ни к чему. null —
    // не знаем, и строки нет. На /en строки нет вовсе (ruLangLine даёт null):
    // «есть ли русский» — вопрос русскоязычного вечера, английскому он
    // ничего не говорит
    russian: ruLangLine(meta?.ruLang, ctx.locale),
    // «92% из 48 тыс.» на плитке полки покупок: те же числа, по которым
    // confidenceMultiplier решил, насколько новинке верить
    reviewsPercent: meta?.reviewsPercent ?? null,
    reviewsTotal: meta?.reviewsTotal ?? null,
    ...buyView(meta, p.source, ctx.now, ctx.hideUrgency, ctx.locale),
    // Совпадение со вкусом: процент, теги (ключами — подписывает клиент) и
    // настроение словами из семантики — на языке карточки
    signals: meta ? explainMatch(ctx.profile, meta, ctx.mood, ctx.tagWeight, ctx.locale) : null,
    // Своя игра, на которую эта похожа. Причина от модели может её не
    // назвать — тогда /play добавляет строку сам, в «Почему она?»
    via: ctx.anchorOf(p.appid),
    // «Откладывал N дней назад» — только у вернувшегося «не сейчас»
    deferred: deferredOf(ctx.cooldown.get(p.appid), ctx.now),
    edge,
  }
}

export type PickCard = ReturnType<typeof cardView>

/**
 * Кадры для морфа в герое и трейлер — только у пятёрки: «нет в библиотеке»
 * героем не становится, и её кадры никто не покажет. Обрезка до HERO_SLIDES
 * по той же причине: в одном ответе пять игр, а у иных в базе по два десятка
 * скриншотов. Трейлер — пара ссылок, а не ролик: сам ролик качается только по
 * нажатию (components/TrailerPreview). null — у игры его нет.
 */
export function heroMediaView(media: HeroMedia | undefined) {
  return {
    screenshots: (media?.screenshots ?? []).slice(0, HERO_SLIDES),
    trailer: media?.trailer ?? null,
  }
}

export type HeroMediaView = ReturnType<typeof heroMediaView>

/**
 * Место карточки в своём списке ответа и части её скора — для снимка к оценке
 * (lib/feedbackctx), и только для него: на экран ни то, ни другое не выводится.
 *
 * Части скора раньше не покидали сервер вовсе. Решение владельца — хранить их
 * в фидбеке для отчёта, без показа (/privacy, раздел 01). Клиент — единственный,
 * кто знает, на какой карточке нажали, поэтому снимок едет к нему и
 * возвращается с оценкой; уходит он только самому человеку, по его сессии.
 */
export function scoreView(rank: number, parts: ScoreParts | undefined) {
  return { rank, parts: parts ? partsView(parts) : null }
}

export type ScoreView = ReturnType<typeof scoreView>

/**
 * Плитка магазина — полка находок «Игры дня». Полка всегда из каталога,
 * поэтому скидка у каждой, а строки про возврат у плитки нет: она про героя.
 *
 * Русский — та же фраза, что на плитке полки покупок /play (cardView): там и
 * здесь одно решение «присмотреться к покупке», и «без русского» перед ним
 * весит не меньше цены. Отзывов на этой плитке нет, а русский есть — он
 * короче и решает раньше. null — не знаем, и строки нет; на /en — всегда
 * null, как и у cardView.
 */
export function storeCardView(
  c: { appid: number; name: string },
  meta: GameMeta | undefined,
  now: number,
  hideUrgency: boolean,
  locale: Locale = 'ru',
) {
  return {
    appid: c.appid,
    name: c.name,
    ...shopView(meta, now, locale),
    discount: buyView(meta, 'new', now, hideUrgency, locale).discount,
    russian: ruLangLine(meta?.ruLang, locale),
  }
}

export type StoreCard = ReturnType<typeof storeCardView>

/**
 * Герой «Игры дня». Причина, совпавшие теги и часы — из записи дня (отбор
 * был утром), цена и скидка — свежие, на каждом заходе.
 *
 * locale — язык карточки: «О чём игра», магазин у игр не из Steam и строка о
 * русском (на /en её нет). Причину вызывающий передаёт уже на этом языке
 * (dailyReasonBase в lib/daily).
 */
export function dailyCardView(
  pick: { appid: number; name: string; source: CandidateSource },
  meta: GameMeta | undefined,
  now: number,
  day: {
    reason: string
    sharedTags: string[]
    hoursPlayed: number | null
    hideUrgency: boolean
    via?: OwnAnchor | null
  },
  locale: Locale = 'ru',
) {
  return {
    appid: pick.appid,
    name: pick.name,
    source: pick.source,
    reason: day.reason,
    ...shopView(meta, now, locale),
    // Кадры целиком: сколько из них показать, решает сам герой — это упирается
    // в бюджет видеопамяти слайдера, а не в состав ответа
    screenshots: meta?.screenshots ?? [],
    // «О чём игра» — только у игры из каталога и только на языке карточки (aboutLine)
    about: aboutLine(pick.source, meta, locale),
    // Микротрейлер — живой фон героя после паузы (components/HeroTrailer).
    // Лежит в той же записи, что кадры: лишнего чтения нет
    trailer: meta?.trailer ?? null,
    ccu: meta?.ccu ?? null,
    ccuAt: meta?.ccuAt ?? null,
    // Та же фраза о русском, что у героя /play (cardView); null — не знаем
    russian: ruLangLine(meta?.ruLang, locale),
    tags: topTags(meta),
    // Чипсы совпавших тегов помечаются на экране, и метка обязана считаться
    // там же, где лежит профиль вкуса, — то есть в отборе; здесь она из
    // записи. Настроения у «Игры дня» нет — поэтому sharedTasteTags, а не
    // explainMatch: процент и вайб тут не о чем.
    sharedTags: day.sharedTags,
    hoursPlayed: day.hoursPlayed,
    // Своя игра-ориентир: у игры не из Steam своего арта нет, и герой стоит
    // на размытом арте той, на которую она похожа (components/HeroArt)
    via: day.via ?? null,
    ...buyView(meta, pick.source, now, day.hideUrgency, locale),
  }
}

export type DailyPickCard = ReturnType<typeof dailyCardView>

/**
 * Карта колоды исследователя (/explore) — в форме колоды пати (DeckCard в
 * components/SwipeDeck), чтобы колода была одна. У одного человека
 * ownedByAll — «есть в библиотеке», а не хватает её никому. Причина — та же,
 * что у эвристики /play: колоде, как и выдаче, есть что сказать о своей игре.
 */
export function exploreCardView(p: LlmPick, ctx: PickContext) {
  const meta = ctx.metaNow(p.appid)
  const shop = shopView(meta, ctx.now, ctx.locale)
  return {
    appid: p.appid,
    name: p.name,
    ownedByAll: p.source !== 'new',
    missingFor: [] as string[],
    // У колоды «нет цены» — отсутствие поля, а не null, и «бесплатно» сильнее
    // цены: у бесплатной CS2 в каталоге лежит цена Prime (см. GroupCard)
    ...(shop.isFree
      ? { isFree: true }
      : shop.priceFinal !== null
        ? { priceFinal: shop.priceFinal }
        : {}),
    priceCc: shop.priceCc,
    unsold: shop.unsold,
    discount: buyView(meta, p.source, ctx.now, ctx.hideUrgency, ctx.locale).discount,
    headerImage: shop.headerImage,
    art: shop.art,
    ccu: meta?.ccu ?? null,
    ccuAt: meta?.ccuAt ?? null,
    session: meta ? sessionTrait(meta, ctx.locale) : null,
    tags: topTags(meta),
    ...(shop.store ? { store: shop.store } : {}),
    ...(shop.storeUrl ? { storeUrl: shop.storeUrl } : {}),
    reason: p.reason,
    // Ориентир — фон карты у игры не из Steam (components/TypeCover)
    via: ctx.anchorOf(p.appid),
  }
}

export type ExploreCard = ReturnType<typeof exploreCardView>

/**
 * «Отправить другу» у героя: текст и подпись сервера (lib/pickshare
 * shareView). lang — только у английского героя: подпись покрывает язык, и
 * клиент возвращает его в /api/pick.
 */
export type ShareView = { share: { text: string; sig: string; lang?: 'en' } }

/**
 * Плитка полки «Приглянулось»: картинка, дорога к карточке игры и цена.
 *
 * Цена — потому что полка и есть список «может, купить»: приглянувшееся из
 * магазина без ценника заставляло открывать каждую карточку. Правила те же,
 * что у колоды (exploreCardView): «бесплатно» сильнее цены, скидка — только у
 * не купленного (buyView), срок распродажи молчит при большом бэклоге.
 * Своя игра — без цены вовсе: её не покупают.
 *
 * opts.locale — язык плитки; по умолчанию русский. От него зависят страница
 * магазина у игр не из Steam (shopView) и подпись срока скидки (buyView).
 */
export function shelfCardView(
  meta: GameMeta,
  opts: { now: number; owned: boolean; hideUrgency: boolean; locale?: Locale },
) {
  const locale = opts.locale ?? 'ru'
  const shop = shopView(meta, opts.now, locale)
  const buying = !opts.owned
  return {
    appid: meta.appid,
    name: meta.name,
    headerImage: shop.headerImage,
    art: shop.art,
    owned: opts.owned,
    isFree: buying && shop.isFree === true,
    priceFinal: buying && !shop.isFree ? shop.priceFinal : null,
    priceCc: buying ? shop.priceCc : null,
    unsold: buying && shop.unsold,
    discount: buyView(meta, buying ? 'new' : 'familiar', opts.now, opts.hideUrgency, locale).discount,
  }
}

export type ShelfCard = ReturnType<typeof shelfCardView>
