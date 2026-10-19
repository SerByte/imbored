import { editionKey } from './editions'
import { tr, type Locale } from './i18n'
import {
  buildTagProfile,
  isMultiplayerMeta,
  moodMultiplier,
  normalizedTags,
  semanticsMultiplier,
  topTags,
} from './recommend'
import { weightedCosineTo, type TagWeight } from './tagweight'
import type { GameMeta, LibraryGame, Mood } from './types'

export type GroupMember = {
  steamid: string
  name: string
  library: LibraryGame[]
}

export type GroupCard = {
  appid: number
  name: string
  ownedByAll: boolean
  /** имена участников, у которых игры нет */
  missingFor: string[]
  score: number
  priceFinal?: number
  /** Регион магазина цены (lib/steamregion) — без него у числа нет валюты */
  priceCc?: string
  /** «Нет в российском Steam»: магазин региона игру не показывает */
  unsold?: boolean
  /**
   * Бесплатная игра. Цены у такой карточки нет вовсе, даже если в строке
   * каталога она лежит: у Counter-Strike 2 is_free = 1 и price_final = 1499 —
   * это Prime, а не игра (см. offersOf в lib/jsonld.ts).
   */
  isFree?: boolean
  headerImage?: string
  tags: string[]
  store?: string
  storeUrl?: string
  /** Подпись под названием — только у закреплённой первой карты (pinnedReason) */
  reason?: string
}

/**
 * Подпись первой карты, в которую звали («Позвать в эту игру»).
 *
 * Без имени: рука хоста в комнате переходит (ROOM_HEIR_ORDER), и «предложил
 * Серёга» соврало бы, когда Серёга уже ушёл. Вторая фраза — чтобы карта не
 * читалась решением, принятым за всех: это предложение, и «не хочу» по нему
 * ведёт в обычную колоду, а не в тупик.
 *
 * По-английски «не хочу» — это кнопка «Pass» (глоссарий колоды пати), и
 * подпись говорит её словом. Строка стоит в две строки карточки
 * (line-clamp-2 в SwipeDeck), и английская в них укладывается.
 *
 * И без «you»: карту видит и хост, который комнату из этой игры и собрал, —
 * «the one you were invited to» ему соврало бы, его никто не звал. Русское
 * «звали» безлично и годится обоим; английская говорит о самой пати
 * («Party ABC123» в шапке комнаты), а не о том, кто кого позвал.
 */
export function pinnedReason(locale: Locale = 'ru'): string {
  return tr(locale, {
    ru: 'В неё и звали. Не хочется — дальше обычная колода',
    en: 'The game this party is for. Pass, and the usual deck is next',
  })
}

/** Русская подпись — для тех, кто сверял её константой до перевода */
export const PINNED_REASON = pinnedReason('ru')

/**
 * Колода для свайп-матча пати: сначала общие мультиплеерные игры,
 * затем кандидаты «не у всех» с пометкой, кому не хватает, и ценой.
 * Скоринг — близость к суммарному вкусу всех участников.
 *
 * banned — «Больше не показывать» хоть кого-то из участников (bannedAppidsOf).
 * Отсев до выбора изданий, а не после: иначе забаненное издание занимало бы
 * ключ, и живое второе издание той же игры в колоду уже не попадало бы.
 *
 * tagWeight — вес редкости, та же мера вкуса, что у /play (weightedCosineTo):
 * на сыром косинусе колода пати ранжировала по Multiplayer и Action, которые
 * есть у половины каталога. null — сырой косинус, до бита прежний.
 *
 * mood — настроение комнаты, которое хост выбрал при создании (ROOM_PRESETS в
 * lib/presets). Раньше оно хранилось в rooms.mood_json и не доезжало до
 * колоды вовсе: «пара быстрых каток» и «весь вечер» раздавали одно и то же.
 * Вкус пати остаётся главным, настроение его взвешивает — той же мерой, что у
 * /play: теговая часть (moodMultiplier) с поправкой по осям семантики
 * (semanticsMultiplier). Общие игры по-прежнему идут раньше недостающих:
 * настроение переставляет карты внутри этих групп, а не между ними. null и
 * отсутствие — скор до бита прежний.
 *
 * pinned — игра, в которую звали (rooms.seed_appid, «Позвать в эту игру»).
 * Она первая у всех, мимо «общие раньше» и мимо скора: ради неё комнату и
 * создавали. Но правила колоды для неё те же, что для любой карты:
 *   • бан хоть кого-то из участников сильнее закрепления — карты нет вовсе;
 *   • в колоду идёт только то, во что играют вместе (isMultiplayerMeta);
 *   • издание: закреплённая разбирается ПЕРВОЙ и держит свой ключ, поэтому
 *     другое издание той же игры — даже общее — в колоду не попадает. Звали
 *     в это издание, и матч обязан случиться на нём.
 * Мету закреплённой роут кладёт в metaOf сам: её может не быть ни в одной
 * библиотеке, ни в пуле. Нет меты — нет и карты, колода прежняя. limit
 * считает и её, и колода на больший limit по-прежнему продолжает меньшую:
 * первая карта первая в каждом раунде.
 *
 * locale — язык подписи закреплённой карты (pinnedReason), и только её:
 * состав и порядок колоды от языка не зависят — участники одной комнаты
 * голосуют за одни и те же карты, на каком бы языке ни смотрели.
 */
export function buildGroupDeck(args: {
  members: GroupMember[]
  metaOf: (appid: number) => GameMeta | undefined
  extraPool: GameMeta[]
  limit: number
  banned?: ReadonlySet<number>
  tagWeight?: TagWeight | null
  mood?: Mood | null
  pinned?: number | null
  locale?: Locale
}): GroupCard[] {
  const {
    members,
    metaOf,
    extraPool,
    limit,
    banned,
    tagWeight = null,
    mood = null,
    pinned = null,
    locale = 'ru',
  } = args
  if (!members.length) return []

  // суммарный вкус пати
  const combined: Record<string, number> = {}
  for (const m of members) {
    for (const [tag, w] of Object.entries(buildTagProfile(m.library, metaOf))) {
      combined[tag] = (combined[tag] ?? 0) + w
    }
  }
  // Сторона общего вкуса готовится один раз, а не на каждую карту
  const tasteOf = weightedCosineTo(combined, tagWeight)
  // Без настроения — ровно 1, а умножение на единицу скор не трогает вовсе
  const moodOf = (meta: GameMeta): number => {
    if (!mood) return 1
    const tagMood = moodMultiplier(meta, mood)
    return tagMood * semanticsMultiplier(meta, mood, tagMood)
  }

  const owners = new Map<number, Set<string>>()
  for (const m of members) {
    for (const g of m.library) {
      let set = owners.get(g.appid)
      if (!set) {
        set = new Set()
        owners.set(g.appid, set)
      }
      set.add(m.steamid)
    }
  }

  const toCard = (meta: GameMeta): GroupCard => {
    const owning = owners.get(meta.appid) ?? new Set()
    const missingFor = members.filter((m) => !owning.has(m.steamid)).map((m) => m.name)
    return {
      appid: meta.appid,
      name: meta.name,
      ownedByAll: missingFor.length === 0,
      missingFor,
      score: tasteOf(normalizedTags(meta)) * moodOf(meta),
      // «Бесплатно» сильнее цены — тот же порядок, что у PriceTag и разметки.
      // Колода пати писала «Нет у: Дима · $15» у бесплатной CS2: у колоды своя
      // строка цены, и isFree до неё просто не доезжал.
      ...(meta.isFree
        ? { isFree: true }
        : meta.priceFinal !== undefined
          ? { priceFinal: meta.priceFinal }
          : {}),
      ...(meta.priceCc ? { priceCc: meta.priceCc } : {}),
      // Пати такую игру не прячет: общая библиотека — не покупка, а тем, у кого
      // её нет, честнее прочитать «нет в российском Steam», чем не узнать. И
      // у бесплатной тоже: Warzone бесплатна в US, а магазин RU её не
      // показывает. Рядом с isFree ответ выбирает строка колоды (SwipeDeck) —
      // «нет в российском Steam» первым, как в PriceTag
      ...(meta.storeHidden ? { unsold: true } : {}),
      ...(meta.headerImage ? { headerImage: meta.headerImage } : {}),
      tags: topTags(meta),
      ...(meta.store ? { store: meta.store } : {}),
      ...(meta.storeUrl ? { storeUrl: meta.storeUrl } : {}),
    }
  }

  const seen = new Set<number>()
  // Тот же запрет «не дважды», но на уровень выше appid: два издания одной игры
  // — это два appid, и колода из двадцати карт голосовала бы за одну игру
  // дважды, а матч срабатывал бы не на том издании. Порядок циклов ниже сам
  // решает, кто победит: общие игры разбираются раньше пула, поэтому карточка
  // из каталога не может вытеснить издание, которым партия владеет.
  const seenKeys = new Set<string>()
  const cards: GroupCard[] = []

  // Отбор одной карты: бан, издание, «не дважды». Карту не кладёт — это
  // решает зовущий: закреплённая встаёт вне сортировки
  const claim = (meta: GameMeta): GroupCard | null => {
    if (banned?.has(meta.appid)) return null
    const key = editionKey(meta.name)
    if (key && seenKeys.has(key)) return null
    seen.add(meta.appid)
    if (key) seenKeys.add(key)
    return toCard(meta)
  }
  const take = (meta: GameMeta): void => {
    const card = claim(meta)
    if (card) cards.push(card)
  }

  // Закреплённая — раньше всех циклов: так её издание занимает ключ первым
  const pinnedMeta = pinned !== null ? metaOf(pinned) : undefined
  const lead = pinnedMeta && isMultiplayerMeta(pinnedMeta) ? claim(pinnedMeta) : null

  // общие игры всех участников
  for (const [appid, owning] of owners) {
    // seen — ради закреплённой: у названия без ключа издания (editionKey
    // пустой) только он не даст общей игре встать второй раз
    if (owning.size !== members.length || seen.has(appid)) continue
    const meta = metaOf(appid)
    if (!meta || !isMultiplayerMeta(meta)) continue
    take(meta)
  }

  // пул «не у всех»/«ни у кого»
  for (const meta of extraPool) {
    if (seen.has(meta.appid) || !isMultiplayerMeta(meta)) continue
    const owning = owners.get(meta.appid) ?? new Set()
    if (owning.size === members.length) continue // уже покрыто выше
    take(meta)
  }

  cards.sort((a, b) => Number(b.ownedByAll) - Number(a.ownedByAll) || b.score - a.score)
  return (lead ? [{ ...lead, reason: pinnedReason(locale) }, ...cards] : cards).slice(0, limit)
}
