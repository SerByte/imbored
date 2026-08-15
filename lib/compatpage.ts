import { filterActual } from './actual'
import type { GameArtUrls } from './art'
import { COMMON_SHOWN, compatibility } from './compat'
import {
  countIngest,
  getGamesMeta,
  getLatestSnapshot,
  getPersonaName,
  loadTagStats,
  type Db,
} from './db'
import { type Discount, discountView } from './discount'
import { buildGroupDeck } from './group'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from './pool'
import { buildTagProfile } from './recommend'
import type { GameMeta } from './types'

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
 * и обязана быть свободна от запроса.
 */

export type ArtRef = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
}

export type CompatGame = ArtRef & { hoursA: number; hoursB: number }

export type CompatPick = ArtRef & {
  ownedByAll: boolean
  /** имена тех, у кого игры нет */
  missingFor: string[]
  priceFinal?: number
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
}

/** Что можно показать про владельца ссылки, ничего не зная о зрителе */
export type CompatInvite = {
  steamid: string
  name: string
  gamesCount: number
  totalHours: number
  topGames: ArtRef[]
}

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

function nameOf(steamid: string, stored: string | null): string {
  return stored ?? `Игрок ${steamid.slice(-4)}`
}

/**
 * Владелец ссылки — то, что видно и без входа.
 *
 * Отсюда живут три вещи, которые обязаны работать для незалогиненного:
 * generateMetadata, OG-картинка и сам экран приглашения. Все три описывают
 * ТОГО, КТО КИНУЛ ССЫЛКУ, а не того, кто её открыл: иначе одна ссылка
 * разворачивалась бы в каждом чате по-разному, а превью показывало бы того, чья
 * сессия случайно оказалась у краулера.
 */
export async function loadCompatInvite(db: Db, steamid: string): Promise<CompatInvite | null> {
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return null

  const top = [...snapshot.games]
    .filter((g) => g.appid > 0)
    .sort((a, b) => b.playtimeForever - a.playtimeForever)
    .slice(0, HERO_ART)
  const metas = await getGamesMeta(db, top.map((g) => g.appid))

  return {
    steamid,
    name: nameOf(steamid, await getPersonaName(db, steamid)),
    gamesCount: snapshot.games.length,
    totalHours: Math.round(snapshot.games.reduce((s, g) => s + g.playtimeForever, 0) / 60),
    topGames: top.map((g) => artRef(g.appid, g.name, metas.get(g.appid))),
  }
}

export async function loadCompat(
  db: Db,
  args: { other: string; me: string | null; now: number },
): Promise<CompatState> {
  const { other, me, now } = args

  // Своя же ссылка — отвечаем до единого запроса к базе
  if (me && me === other) return { kind: 'self' }

  const otherSnap = await getLatestSnapshot(db, other)
  if (!otherSnap) {
    return { kind: 'noprofile', otherName: await getPersonaName(db, other) }
  }

  // Приглашение нужно обоим экранам без результата, поэтому считается до
  // проверки сессии: и гостю, и тому, у кого нет своей библиотеки, показываем
  // одно и то же — кто зовёт и во что он играет
  const invite = await loadCompatInvite(db, other)
  if (!invite) return { kind: 'noprofile', otherName: null }
  if (!me) return { kind: 'noauth', invite }

  const mySnap = await getLatestSnapshot(db, me)
  if (!mySnap) return { kind: 'nolibrary', invite }

  const myName = nameOf(me, await getPersonaName(db, me))
  const otherName = invite.name

  // Совместимость считается по двум библиотекам — весь каталог для этого не нужен
  const metas = await getGamesMeta(db, [
    ...new Set([...mySnap.games, ...otherSnap.games].map((g) => g.appid)),
  ])
  // Каталог держим ОТДЕЛЬНО от библиотек. metaOf он нужен весь — для арта, цены
  // и второго прохода колоды, — а расчёту серий только в той части, что реально
  // попала в колоду. Причина ниже, у allMetas.
  const poolByAppid = new Map<number, GameMeta>()
  const metaOf = (appid: number): GameMeta | undefined => metas.get(appid) ?? poolByAppid.get(appid)

  const [tagStats, catalogSize] = await Promise.all([loadTagStats(db), countIngest(db)])
  const compat = compatibility(mySnap.games, otherSnap.games, metaOf, tagStats)

  const pairProfile = buildTagProfile([...mySnap.games, ...otherSnap.games], metaOf)
  const extraPool = await fetchDiscoveryPool(db, {
    tags: pickQueryTags(pairProfile, tagStats, catalogSize),
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
    return {
      ...artRef(c.appid, c.name, meta),
      ownedByAll: c.ownedByAll,
      missingFor: c.missingFor,
      ...(c.priceFinal !== undefined ? { priceFinal: c.priceFinal } : {}),
      // Скидка нужна только там, где кому-то придётся покупать: у общей игры
      // цена в разговоре не участвует
      discount: meta && !c.ownedByAll ? discountView(meta, now) : null,
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
      // Пустое пересечение — не повод показывать чёрный прямоугольник
      heroGames: commonGames.length ? commonGames.slice(0, HERO_ART) : invite.topGames,
      me,
      myName,
      other,
      otherName,
    },
  }
}

export { COMMON_SHOWN }
