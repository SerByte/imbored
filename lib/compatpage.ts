import { cache } from 'react'
import { filterActual } from './actual'
import type { GameArtUrls } from './art'
import { COMMON_SHOWN, compatibility, pairTasteProfile } from './compat'
import {
  getPoolSize,
  getGamesMetaLite,
  getLatestSnapshot,
  getPersonaName,
  loadTagStats,
  type Db,
} from './db'
import { type Discount, discountView, trustedPrice } from './discount'
import { buildGroupDeck } from './group'
import { playtimeHidden } from './playtime'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from './pool'
import type { GameMeta, LibraryGame } from './types'

/**
 * Данные страницы совместимости. ТОЛЬКО ЧТЕНИЕ ИЗ БАЗЫ — как в lib/gamepage.ts.
 *
 * Жило внутри app/api/compat/[steamid]/route.ts, пока страница была клиентской
 * и ходила к себе же по fetch. После переезда страницы на сервер у роута не
 * осталось ни одного вызывающего, и он удалён: держать открытый JSON-эндпоинт,
 * отдающий чужой ник и пересечение библиотек, без единого потребителя — это
 * поверхность без назначения.
 *
 * Ни cookies, ни nowSec отсюда не читаются: и то и другое приходит аргументом.
 * Так модуль остаётся тестируемым и годится для OG-картинки, которая кэшируется
 * и обязана быть свободна от запроса. cache() из react этому не мешает: вне
 * рендера он просто зовёт функцию (см. snapshotOnce ниже).
 */

export type ArtRef = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
}

/** Часы null — время этой стороны скрыто настройками Steam (см. Compatibility) */
export type CompatGame = ArtRef & { hoursA: number | null; hoursB: number | null }

export type CompatPick = ArtRef & {
  ownedByAll: boolean
  /** имена тех, у кого игры нет */
  missingFor: string[]
  priceFinal?: number
  /** регион магазина цены (lib/steamregion) — её валюта */
  priceCc?: string
  /** «не продаётся в российском Steam» */
  unsold?: boolean
  /** бесплатная — цены у неё нет, см. GroupCard.isFree */
  isFree?: boolean
  discount: Discount | null
  tags: string[]
  store?: string
}

export type CompatResult = {
  percent: number
  commonGames: CompatGame[]
  /** всё пересечение, а не показанный срез */
  commonTotal: number
  commonHours: number
  sharedTags: string[]
  /** есть у обоих — во что сесть сегодня */
  playNow: CompatPick[]
  /** нет у кого-то из двоих — на будущее */
  playLater: CompatPick[]
  /** чем красить герой: общие игры, а если их нет — топ другого */
  heroGames: ArtRef[]
  me: string
  myName: string
  other: string
  otherName: string
  /** Время скрыто настройками Steam (lib/playtime.ts) — у каждого своё */
  myTimeHidden: boolean
  otherTimeHidden: boolean
}

/**
 * Владелец ссылки без обложек — всё, что про него говорят снапшот и ник.
 * Превью в чате ничего сверх этого не показывает (см. loadInviteHead)
 */
export type CompatInviteHead = {
  steamid: string
  name: string
  gamesCount: number
  totalHours: number
  /**
   * Время скрыто настройками Steam (lib/playtime.ts): вместо «0 часов» в
   * превью, герое и карточке — «время скрыто», как у портрета
   */
  playtimeHidden: boolean
}

/** Что можно показать про владельца ссылки, ничего не зная о зрителе */
export type CompatInvite = CompatInviteHead & { topGames: ArtRef[] }

export type CompatState =
  | { kind: 'ok'; data: CompatResult }
  | { kind: 'noauth'; invite: CompatInvite }
  | { kind: 'nolibrary'; invite: CompatInvite }
  | { kind: 'noprofile'; otherName: string | null }
  | { kind: 'self' }

/** Полка «во что зайти»: две по три — «сейчас» и «на будущее» */
const SHELF = 3

/**
 * Колода строится заметно больше полок, потому что актуальность считается
 * ПОСЛЕ сборки.
 *
 * buildGroupDeck ставит всё, что есть у обоих, впереди каталога безусловно, а у
 * пары с валвовским бандлом голова колоды мертва целиком: CS 1.6, Condition
 * Zero, Deleted Scenes, HL2:DM, HLDM Source, Deathmatch Classic, Ricochet, TF
 * Classic, Day of Defeat — около девяти игр, и все проваливают проверку живости
 * в режиме пати. На короткой колоде фильтру нечего оставить, он упирается в
 * собственную страховку «выкинул всё — значит не фильтр» и возвращает те же
 * трупы. Двадцать — столько же, сколько в комнате.
 */
const DECK_SIZE = 20

/** Обложек в приглашении и в герое — лента, а не сетка */
const HERO_ART = 5

function artRef(appid: number, name: string, meta: GameMeta | undefined): ArtRef {
  return { appid, name, headerImage: meta?.headerImage ?? null, art: meta?.art ?? null }
}

/*
 * Снапшот и ник — один раз на запрос.
 *
 * Их читают и generateMetadata (через loadInviteHead), и тело страницы, и
 * раньше тело читало их само — в обход памяти запроса. Страница объявлена
 * force-dynamic, и каждый заход по ссылке совместимости — а гость по
 * разосланной ссылке и есть её главный путь — тянул из Turso games_json
 * владельца дважды: у большой библиотеки это блоб на сотни килобайт. Вместе с
 * ним дважды читались ник и обложки приглашения.
 *
 * cache() живёт ровно один запрос — тот же приём, что на портрете
 * (app/portrait/[steamid]/page.tsx). Вне рендера — в тестах, в OG-картинке —
 * это сквозной вызов, и модуль остаётся свободным от запроса.
 *
 * Обёртки — здесь, а не в lib/db: чтение снапшота, закэшированное для всех,
 * отдало бы старое тому, кто в одном рендере пишет снапшот и тут же читает.
 */
const snapshotOnce = cache(getLatestSnapshot)
const personaOnce = cache(getPersonaName)

/**
 * Самые наигранные, по убыванию времени; appid 0 и ниже — не игры Steam.
 *
 * При скрытом времени сортировать не по чему, и стена — библиотека как есть,
 * как у карточки портрета: сортировка устойчивая, а подписи «самые
 * наигранные» у стены нет.
 */
function topPlayed(games: LibraryGame[], n: number): LibraryGame[] {
  return [...games]
    .filter((g) => g.appid > 0)
    .sort((a, b) => b.playtimeForever - a.playtimeForever)
    .slice(0, n)
}

/** Ник или «Игрок 1234» — одно на страницу сравнения, карточку и хаб */
export function nameOf(steamid: string, stored: string | null): string {
  return stored ?? `Игрок ${steamid.slice(-4)}`
}

/**
 * Снапшот и ник владельца ссылки — одним кругом и через память запроса.
 *
 * Ник — вместе со снапшотом, а не после: от снапшота он не зависит. Без
 * снапшота он прочитан зря, но странице он тогда как раз и нужен — «X ещё не
 * подключал библиотеку».
 */
function readOwner(db: Db, steamid: string) {
  return Promise.all([snapshotOnce(db, steamid), personaOnce(db, steamid)])
}

function inviteHead(steamid: string, games: LibraryGame[], stored: string | null): CompatInviteHead {
  return {
    steamid,
    name: nameOf(steamid, stored),
    gamesCount: games.length,
    totalHours: Math.round(games.reduce((s, g) => s + g.playtimeForever, 0) / 60),
    playtimeHidden: playtimeHidden(games),
  }
}

/**
 * Владелец ссылки — то, что видно и без входа.
 *
 * Отсюда живут три вещи, которые обязаны работать для незалогиненного:
 * generateMetadata (ему хватает головы, см. loadInviteHead), OG-картинка и сам
 * экран приглашения. Все три описывают ТОГО, КТО КИНУЛ ССЫЛКУ, а не того, кто
 * её открыл: иначе одна ссылка разворачивалась бы в каждом чате по-разному, а
 * превью показывало бы того, чья сессия случайно оказалась у краулера.
 *
 * Снапшот и ник — через память запроса (snapshotOnce), поэтому ни метаданные,
 * ни тело страницы второй раз за ними не ходят. Своё чтение здесь одно —
 * обложки, и платят за него только экраны и карточка, которые их показывают.
 */
export async function loadCompatInvite(
  db: Db,
  steamid: string,
  /** Сколько самых наигранных взять: странице — ленту, карточке — стену */
  opts: { top?: number } = {},
): Promise<CompatInvite | null> {
  const [snapshot, stored] = await readOwner(db, steamid)
  if (!snapshot) return null

  const top = topPlayed(snapshot.games, opts.top ?? HERO_ART)
  const metas = await getGamesMetaLite(db, top.map((g) => g.appid))

  return {
    ...inviteHead(steamid, snapshot.games, stored),
    topGames: top.map((g) => artRef(g.appid, g.name, metas.get(g.appid))),
  }
}

/**
 * Голова приглашения — для generateMetadata: превью в чате говорит имя, число
 * игр и часы, а обложек в нём нет (картинку рисует opengraph-image.tsx).
 *
 * Пока метаданные брали приглашение целиком, вошедший с библиотекой платил за
 * обложки пяти самых наигранных игр владельца, которых ему не показывает
 * никто: его экран — посчитанное сравнение, и герой там красится из
 * метаданных обеих библиотек. Выходило два чтения метаданных игр на заход
 * вместо одного. Теперь обложки читает только тело страницы — и только на
 * тех экранах, где лента есть.
 *
 * Снапшот и ник у головы и у тела страницы — общие промисы (snapshotOnce) на
 * любом пути: у гостя, у вошедшего, на своей ссылке.
 */
export async function loadInviteHead(db: Db, steamid: string): Promise<CompatInviteHead | null> {
  const [snapshot, stored] = await readOwner(db, steamid)
  return snapshot ? inviteHead(steamid, snapshot.games, stored) : null
}

export async function loadCompat(
  db: Db,
  args: { other: string; me: string | null; now: number },
): Promise<CompatState> {
  const { other, me, now } = args

  // Своя же ссылка — отвечаем до единого запроса к базе
  if (me && me === other) return { kind: 'self' }

  /*
   * Три круга к базе, а не лесенка из восьми.
   *
   * Раньше каждое чтение ждало предыдущего: снапшот другого, обложки
   * приглашения, его ник, свой снапшот, свой ник, метаданные библиотек,
   * статистика тегов, пул каталога — около трёхсот миллисекунд одной только
   * задержки Turso (~35 мс на круг, lib/candidates.ts) до первого расчёта, и
   * всё это время человек смотрел на loading.tsx. Зависят друг от друга
   * только три ступени: люди → метаданные их библиотек → каталожный пул по
   * профилю пары.
   *
   * Статистика тегов и размер пула не про людей вовсе, но идут вторым кругом,
   * рядом с метаданными, а не первым: гостю и человеку без библиотеки они не
   * нужны, а круг от этого не удлиняется.
   *
   * Цена размена записана: вошедший, открывший ссылку человека без профиля,
   * зря читает свои снапшот и ник. Случай редкий и молчаливый, задержку же
   * видит каждый — тот же размен, что в buildCandidates (lib/candidates.ts).
   */
  const [otherSnap, otherStored, mySnap, myStored] = await Promise.all([
    snapshotOnce(db, other),
    personaOnce(db, other),
    me ? snapshotOnce(db, me) : null,
    me ? personaOnce(db, me) : null,
  ])
  if (!otherSnap) return { kind: 'noprofile', otherName: otherStored }

  // Гость и человек без своей библиотеки видят одно и то же — кто зовёт и во
  // что он играет. Снапшот и ник владельца в запросе уже прочитаны
  // (snapshotOnce) — новое чтение здесь одно: обложки ленты
  if (!me || !mySnap) {
    const invite = await loadCompatInvite(db, other)
    if (!invite) return { kind: 'noprofile', otherName: otherStored }
    return me ? { kind: 'nolibrary', invite } : { kind: 'noauth', invite }
  }

  const myName = nameOf(me, myStored)
  const otherName = nameOf(other, otherStored)

  // Совместимость считается по двум библиотекам — весь каталог для этого не
  // нужен. Статистика тегов и размер пула — тем же кругом, см. выше
  const [metas, tagStats, poolSize] = await Promise.all([
    getGamesMetaLite(db, [...new Set([...mySnap.games, ...otherSnap.games].map((g) => g.appid))]),
    loadTagStats(db),
    getPoolSize(db),
  ])
  // Каталог держим ОТДЕЛЬНО от библиотек. metaOf он нужен весь — для арта, цены
  // и второго прохода колоды, — а расчёту серий только в той части, что реально
  // попала в колоду. Причина ниже, у allMetas.
  const poolByAppid = new Map<number, GameMeta>()
  const metaOf = (appid: number): GameMeta | undefined => metas.get(appid) ?? poolByAppid.get(appid)

  const compat = compatibility(mySnap.games, otherSnap.games, metaOf, tagStats)

  // Сумма двух профилей, а не профиль склейки: см. pairTasteProfile
  const pairProfile = pairTasteProfile(mySnap.games, otherSnap.games, metaOf)
  const extraPool = await fetchDiscoveryPool(db, {
    tags: pickQueryTags(pairProfile, tagStats, poolSize),
    requireMultiplayer: true,
    /*
     * Сид — ПАРА, отсортированная. У одних и тех же двоих два адреса: /compat/A,
     * открытый B, и /compat/B, открытый A. На сиде от «меня» они увидели бы
     * разные «во что зайти вместе», и фраза «давай возьмём вот эту» умирала бы
     * в момент, когда второй открывает свою ссылку. Оба id — 17 цифр, длина
     * одинаковая, порядок полный и стабильный.
     *
     * Без ротации каталожная половина полки заморожена для пары навсегда:
     * тег-ветка запроса детерминирована.
     */
    rotation: rotationSlot([me, other].sort().join(':'), now),
    limit: 150,
  })
  for (const m of extraPool) poolByAppid.set(m.appid, m)

  const deck = buildGroupDeck({
    members: [
      { steamid: me, name: myName, library: mySnap.games },
      { steamid: other, name: otherName, library: otherSnap.games },
    ],
    metaOf,
    extraPool,
    limit: DECK_SIZE,
  })

  /*
   * Колода собрана из библиотек, а библиотеки офлайн-курацию каталога не
   * проходят: без этого в «зайти вместе» уезжала Counter-Strike: Condition Zero
   * при живой CS2 — она есть у обоих, помечена сетевой, и сортировка ставит её
   * впереди всего каталога независимо от того, сколько человек в ней осталось.
   *
   * Серии судим по КАНДИДАТАМ, а не по всему пулу: лишний однофамилец ничего не
   * решает, зато может возглавить группу и отменить вытеснение, которое до него
   * работало (см. тест «однофамилец из каталога с тем же издателем»).
   *
   * Библиотечную половину карты, наоборот, берём целиком: Condition Zero
   * вытесняет именно CS2, а CS2 в паре сплошь и рядом есть только у одного из
   * двоих — то есть она лежит в metas, но в колоду попасть не может в принципе,
   * потому что туда пускают только то, что есть у обоих.
   */
  const judged = new Set(deck.map((c) => c.appid))
  const allMetas = new Map(metas)
  for (const [appid, meta] of poolByAppid) {
    if (judged.has(appid) && !allMetas.has(appid)) allMetas.set(appid, meta)
  }
  const actual = filterActual(deck, allMetas, 'party')

  const toPick = (c: (typeof actual)[number]): CompatPick => {
    const meta = metaOf(c.appid)
    // «Бесплатно» сильнее цены: у CS2 в строке каталога лежит цена Prime, и
    // полка «на будущее» показывала её как цену игры — $14.99 за бесплатную.
    const бесплатная = meta?.isFree ?? c.isFree ?? false
    const цена = бесплатная ? null : meta ? trustedPrice(meta, now) : (c.priceFinal ?? null)
    // Регион и «не продаётся» — той же меты, что и цена; без меты — с карты колоды
    const регион = meta ? meta.priceCc : c.priceCc
    // И у бесплатной: рядом с isFree ответ выбирает PriceTag, и «не продаётся»
    // у него первым — Warzone бесплатна в US, а магазин RU её не показывает
    const нетВРегионе = meta ? meta.storeHidden === true : c.unsold === true
    return {
      ...artRef(c.appid, c.name, meta),
      ownedByAll: c.ownedByAll,
      missingFor: c.missingFor,
      ...(бесплатная ? { isFree: true } : {}),
      // Цена — только та, которой верит витрина: при сгоревшей скидке
      // priceFinal это акционное число без акции (см. trustedPrice). Полка «на
      // будущее» показывала его как обычную цену, расходясь с карточкой той же
      // игры на /game и со строкой выдачи на /play.
      ...(цена !== null ? { priceFinal: цена } : {}),
      ...(регион ? { priceCc: регион } : {}),
      ...(нетВРегионе ? { unsold: true } : {}),
      // Скидка нужна только там, где кому-то придётся покупать: у общей игры
      // цена в разговоре не участвует, у бесплатной — тем более
      discount: meta && !c.ownedByAll && !бесплатная ? discountView(meta, now) : null,
      tags: c.tags,
      ...(c.store ? { store: c.store } : {}),
    }
  }

  const picks = actual.map(toPick)
  const commonGames = compat.commonGames.map((g) => ({
    ...artRef(g.appid, g.name, metas.get(g.appid)),
    hoursA: g.hoursA,
    hoursB: g.hoursB,
  }))

  return {
    kind: 'ok',
    data: {
      percent: compat.percent,
      commonGames,
      commonTotal: compat.commonTotal,
      commonHours: compat.commonHours,
      sharedTags: compat.sharedTags,
      playNow: picks.filter((p) => p.ownedByAll).slice(0, SHELF),
      playLater: picks.filter((p) => !p.ownedByAll).slice(0, SHELF),
      // Пустое пересечение — не повод показывать чёрный прямоугольник: топ
      // другого, как в приглашении. Его метаданные уже в metas — это
      // объединение обеих библиотек, — и отдельный запрос за пятью обложками
      // встал бы лишним кругом
      heroGames: commonGames.length
        ? commonGames.slice(0, HERO_ART)
        : topPlayed(otherSnap.games, HERO_ART).map((g) => artRef(g.appid, g.name, metas.get(g.appid))),
      me,
      myName,
      other,
      otherName,
      myTimeHidden: compat.timeHiddenA,
      otherTimeHidden: compat.timeHiddenB,
    },
  }
}

export { COMMON_SHOWN }
