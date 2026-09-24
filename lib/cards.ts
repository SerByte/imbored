import type { PickEdge } from './badges'
import type { CandidateSet } from './candidates'
import { refreshDealsWithin } from './deals'
import { getGamesMetaLite, type Db, type HeroMedia } from './db'
import { discountView, trustedPrice } from './discount'
import { entryCost, showsEntry } from './entry'
import { sessionTrait } from './gametraits'
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
import type { CandidateSource, GameMeta, Mood } from './types'

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
 */
export async function buildPickContext(
  db: Db,
  set: CandidateSet,
  pricedIds: number[],
): Promise<PickContext> {
  const refreshed = await refreshDealsWithin(db, pricedIds, set.now)
  const priced = refreshed ? await getGamesMetaLite(db, pricedIds) : new Map<number, GameMeta>()
  return pickContext(set, (appid) => priced.get(appid) ?? set.metaOf(appid))
}

/** Картинка, магазин и цена — общее у всех карточек, от героя до плитки полки */
function shopView(meta: GameMeta | undefined, now: number) {
  return {
    // Ссылку не угадываем шаблоном — путь Steam контент-адресуемый. Клиент
    // соберёт нужный размер сам через GameArt.
    headerImage: meta?.headerImage ?? null,
    art: meta?.art ?? null,
    store: meta?.store ?? null,
    storeUrl: meta?.storeUrl ?? null,
    priceFinal: meta ? trustedPrice(meta, now) : null,
    isFree: meta?.isFree ?? null,
  }
}

/**
 * Скидка и «Steam вернёт деньги» — разговор про покупку, поэтому только у не
 * купленного: на своей игре «−40%» сообщает ровно ничего, кроме того, что ты
 * купил её дороже. Скидка считается на сервере вместе с подписью срока: у
 * клиента свой часовой пояс, и «до 17 августа» разъехалось бы при гидратации.
 */
function buyView(meta: GameMeta | undefined, source: CandidateSource, now: number, hideUrgency: boolean) {
  const buying = meta !== undefined && source === 'new'
  return {
    discount: buying ? discountView(meta, now, { urgency: !hideUrgency }) : null,
    refund: buying ? refundEligible(meta, now) : false,
  }
}

/**
 * Карточка выдачи /play — и героя, и «Ещё вариантов», и полки покупок.
 * edge — одно преимущество перед соседними (lib/badges.ts), только у пятёрки.
 */
export function cardView(p: LlmPick, ctx: PickContext, edge: PickEdge | null = null) {
  const meta = ctx.metaNow(p.appid)
  return {
    appid: p.appid,
    name: p.name,
    source: p.source,
    reason: p.reason,
    ...shopView(meta, ctx.now),
    ccu: meta?.ccu ?? null,
    // без отметки подпись не имеет права говорить «сейчас» — см. PlayersNow
    ccuAt: meta?.ccuAt ?? null,
    shortDescription: meta?.shortDescription ?? null,
    tags: topTags(meta),
    hoursPlayed: ctx.hoursOf(p.appid),
    // «Сессия ~20 мин» / «Матч ~15 мин» — из семантики, только уверенной
    // (sessionTrait): та же строка, что на карточке игры
    session: meta ? sessionTrait(meta) : null,
    // Цена входа (lib/entry) — только у того, что человек ещё не осваивал:
    // у своей наигранной про вход говорит причина, а не отдельная строка
    entry: meta && showsEntry(p.source) ? entryCost(meta) : null,
    // «92% из 48 тыс.» на плитке полки покупок: те же числа, по которым
    // confidenceMultiplier решил, насколько новинке верить
    reviewsPercent: meta?.reviewsPercent ?? null,
    reviewsTotal: meta?.reviewsTotal ?? null,
    ...buyView(meta, p.source, ctx.now, ctx.hideUrgency),
    signals: meta ? explainMatch(ctx.profile, meta, ctx.mood, ctx.tagWeight) : null,
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
 * Плитка магазина — полка находок «Игры дня». Полка всегда из каталога,
 * поэтому скидка у каждой, а строки про возврат у плитки нет: она про героя.
 */
export function storeCardView(
  c: { appid: number; name: string },
  meta: GameMeta | undefined,
  now: number,
  hideUrgency: boolean,
) {
  return {
    appid: c.appid,
    name: c.name,
    ...shopView(meta, now),
    discount: buyView(meta, 'new', now, hideUrgency).discount,
  }
}

export type StoreCard = ReturnType<typeof storeCardView>

/**
 * Герой «Игры дня». Причина, совпавшие теги и часы — из записи дня (отбор
 * был утром), цена и скидка — свежие, на каждом заходе.
 */
export function dailyCardView(
  pick: { appid: number; name: string; source: CandidateSource },
  meta: GameMeta | undefined,
  now: number,
  day: { reason: string; sharedTags: string[]; hoursPlayed: number | null; hideUrgency: boolean },
) {
  return {
    appid: pick.appid,
    name: pick.name,
    source: pick.source,
    reason: day.reason,
    ...shopView(meta, now),
    // Кадры целиком: сколько из них показать, решает сам герой — это упирается
    // в бюджет видеопамяти слайдера, а не в состав ответа
    screenshots: meta?.screenshots ?? [],
    ccu: meta?.ccu ?? null,
    ccuAt: meta?.ccuAt ?? null,
    tags: topTags(meta),
    // Чипсы совпавших тегов помечаются на экране, и метка обязана считаться
    // там же, где лежит профиль вкуса, — то есть в отборе; здесь она из
    // записи. Настроения у «Игры дня» нет — поэтому sharedTasteTags, а не
    // explainMatch: процент и вайб тут не о чем.
    sharedTags: day.sharedTags,
    hoursPlayed: day.hoursPlayed,
    ...buyView(meta, pick.source, now, day.hideUrgency),
  }
}

export type DailyPickCard = ReturnType<typeof dailyCardView>
