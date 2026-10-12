import type { GameArtUrls } from './art'
import { hashString, mulberry32 } from './daily'
import { ALIVE_POOL, parseTagMap, type Db } from './db'
import { playedLine } from './outcome'
import { tagRu } from './tagsru'
import type { LibraryGame } from './types'

/**
 * Викторина на экране ожидания.
 *
 * Осознанное ограничение: это таймкиллер, а не система очков. Ответы едут
 * клиенту прямо в вопросе — выигрывать нечего, счёт нигде не хранится, и
 * лишний раунд-трип за проверкой ответа только добавил бы задержку там, где
 * вся ценность в мгновенности. Не «чинить» это, не заметив причины.
 *
 * Экран, с которого хочется уйти, — цель продукта, а не провал: викторина
 * подписана «на матч не влияет» и сворачивается сама, когда в комнате
 * происходит что-то настоящее.
 */

export const TRIVIA_KINDS = ['hours', 'toptrio', 'ccu', 'cover', 'nottag'] as const
export type TriviaKind = (typeof TRIVIA_KINDS)[number]

export type TriviaQuestion = {
  /** стабильный ключ: React, дедуп внутри батча, «этот вопрос уже был» */
  id: string
  kind: TriviaKind
  prompt: string
  /** обложка к вопросу — только у kind = 'cover' */
  image?: { appid: number; art: GameArtUrls | null; headerImage: string | null }
  options: Array<{ label: string }>
  /** индекс правильного варианта */
  answer: number
  /** подпись после ответа */
  reveal?: string
}

export type TriviaCatalogGame = {
  appid: number
  name: string
  ccu: number | null
  art: GameArtUrls | null
  headerImage: string | null
  tags: Record<string, number>
}

export type TriviaParty = { steamid: string; name: string; library: LibraryGame[] }

export const TRIVIA_COUNT = 10
const TRIVIA_MIN_CCU = 1000
const TRIVIA_SAMPLE = 40
const TRIVIA_SLOTS = 8
/** Онлайн сравниваем, только когда разрыв очевиден — иначе это монетка */
const CCU_RATIO = 2
/**
 * Часы сравниваем с тем же принципом: 30% разницы, а не «почти поровну».
 * Разница меряется минутами: округлённые до часа 150 и 135 минут — это
 * 3 и 2 часа, порог пройден, а на деле разрыв 11%.
 */
const HOURS_RATIO = 1.3
/**
 * Вопрос про часы — когда у лидера наиграно хотя бы час. Меньше часа у
 * лидера — горстка минут у обоих: до получаса оба округлялись в «0 ч»
 * (0 ≥ 0 × 1.3 — вопрос задавался, «правильным» был первый по порядку пати,
 * хоть бы и с меньшим временем, а разгадка гласила «Дима — 0 ч, Саша — 0 ч»),
 * до часа — «1 ч» против «0 ч» у 45 и 20 минут. Минуты вместо часов
 * разводят такую пару честно, но разница в двадцать минут — всё равно
 * монетка, а не вопрос о том, кто во что играет.
 */
const HOURS_MIN = 60

/**
 * Выборка каталога для викторины: один запрос по частичному индексу
 * idx_games_ccu. Предикат — ALIVE_POOL из lib/db, та же строка, что в индексе:
 * без этого SQLite не возьмёт индекс, и вопрос про обложку станет полным
 * сканом games на каждый показ (план сторожит lib/queryplan.test.ts).
 *
 * Ротация — тот же приём hashString + OFFSET, что в lib/pool.ts и lib/daily.ts.
 * ORDER BY RANDOM() запрещён: это сортировка всей таблицы.
 */
export async function loadTriviaCatalog(
  db: Db,
  seed: string,
  size = TRIVIA_SAMPLE,
): Promise<TriviaCatalogGame[]> {
  const read = async (offset: number) => {
    const res = await db.execute({
      sql: `SELECT appid, name, ccu, art_json, header_image, tags_json
            FROM games
            WHERE ${ALIVE_POOL} AND ccu > ?
            ORDER BY ccu DESC LIMIT ? OFFSET ?`,
      args: [TRIVIA_MIN_CCU, size, offset],
    })
    return res.rows as unknown as Array<{
      appid: number
      name: string
      ccu: number | null
      art_json: string | null
      header_image: string | null
      tags_json: string
    }>
  }

  const slot = hashString(seed) % TRIVIA_SLOTS
  let rows = await read(slot * size)
  // Окно уехало за край (маленькая база) — тот же запасной ход, что в pool.ts
  if (rows.length < 4 && slot > 0) rows = await read(0)

  return rows.map((r) => ({
    appid: r.appid,
    name: r.name,
    ccu: r.ccu,
    art: r.art_json ? (JSON.parse(r.art_json) as GameArtUrls) : null,
    headerImage: r.header_image,
    // Через ту же дверь, что и вся мета: дважды закодированные теги иначе
    // приезжали бы сюда строкой
    tags: parseTagMap(r.tags_json),
  }))
}

/** Перемешивание варианта ответа вместе с индексом правильного */
function shuffled<T>(items: T[], correct: number, rnd: () => number): { items: T[]; answer: number } {
  const idx = items.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return { items: idx.map((i) => items[i]), answer: idx.indexOf(correct) }
}

function pick<T>(arr: T[], rnd: () => number): T | undefined {
  return arr.length ? arr[Math.floor(rnd() * arr.length)] : undefined
}

export function buildTrivia(args: {
  seed: string
  catalog: TriviaCatalogGame[]
  party: TriviaParty[]
  count?: number
}): TriviaQuestion[] {
  const { seed, catalog, party } = args
  const count = args.count ?? TRIVIA_COUNT
  const rnd = mulberry32(hashString(seed))

  const out: TriviaQuestion[] = []
  const seen = new Set<string>()
  const add = (q: TriviaQuestion | null) => {
    if (!q || seen.has(q.id) || out.length >= count) return
    seen.add(q.id)
    out.push(q)
  }

  // ---- вопросы про своих: ноль строк каталога, поэтому идут первыми ----
  const partyMax = Math.ceil(count / 2)

  const makeHours = (): TriviaQuestion | null => {
    if (party.length < 2) return null
    // Минуты, а не часы: округление до часа решало вопрос раньше порога —
    // см. HOURS_RATIO и HOURS_MIN
    const owner = new Map<number, Array<{ name: string; min: number; game: string }>>()
    for (const p of party) {
      for (const g of p.library) {
        if (!g.playtimeForever) continue
        const list = owner.get(g.appid) ?? []
        list.push({ name: p.name, min: g.playtimeForever, game: g.name })
        owner.set(g.appid, list)
      }
    }
    const shared = [...owner.values()].filter((l) => l.length >= 2)
    const chosen = pick(shared, rnd)
    if (!chosen) return null
    const sorted = [...chosen].sort((a, b) => b.min - a.min)
    // Без заметного разрыва или без часа у лидера это угадайка, а не вопрос
    if (sorted[0].min < HOURS_MIN || !(sorted[0].min >= sorted[1].min * HOURS_RATIO)) return null
    const opts = sorted.slice(0, 2).map((x) => ({ label: x.name }))
    const s = shuffled(opts, 0, rnd)
    return {
      id: `hours:${sorted[0].game}`,
      kind: 'hours',
      prompt: `У кого больше часов в «${sorted[0].game}»?`,
      options: s.items,
      answer: s.answer,
      // playedLine, а не часы: до десяти часов он точен до минуты («1 ч 29 мин»
      // против «1 ч»), и округлённая разгадка не показывает ничью там, где
      // её нет. Выше десяти часов порог 1.3 сам разводит подписи
      reveal: sorted.map((x) => `${x.name} — ${playedLine(x.min)}`).join(', '),
    }
  }

  const makeTopTrio = (): TriviaQuestion | null => {
    if (party.length < 2) return null
    const withTop = party
      .map((p) => ({
        p,
        // Топ — только из наигранного, как и «у кого больше часов» выше. При
        // скрытом в Steam времени (lib/playtime.ts) нули у всех игр, и
        // «топом» были бы три первые игры списка — вопрос, на который не
        // знает ответа и сам владелец
        top: p.library
          .filter((g) => g.playtimeForever > 0)
          .sort((a, b) => b.playtimeForever - a.playtimeForever)
          .slice(0, 3),
      }))
      .filter((x) => x.top.length === 3)
    const chosen = pick(withTop, rnd)
    if (!chosen) return null
    const opts = party.map((p) => ({ label: p.name }))
    const correct = party.findIndex((p) => p.steamid === chosen.p.steamid)
    const s = shuffled(opts, correct, rnd)
    return {
      // Ключ — по самим играм, а не по человеку. Здесь стоял steamid, и
      // ответ /api/room/[id]/trivia отдавал SteamID64 участника рядом с его
      // ником каждому в комнате, включая незнакомцев с доски «Пати»; по нему
      // открываются профиль Steam и /portrait со всей библиотекой. Для
      // дедупа внутри батча топ-3 различает людей не хуже.
      id: `toptrio:${hashString(chosen.top.map((g) => g.appid).join(',')).toString(36)}`,
      kind: 'toptrio',
      prompt: `Чей это топ-3: ${chosen.top.map((g) => g.name).join(', ')}?`,
      options: s.items,
      answer: s.answer,
    }
  }

  for (let i = 0; i < count * 3 && out.length < partyMax; i++) {
    add(i % 2 === 0 ? makeHours() : makeTopTrio())
  }

  // ---- вопросы по каталогу ----
  const withCcu = catalog.filter((g) => g.ccu !== null && g.ccu > 0)
  const withArt = catalog.filter((g) => g.art ?? g.headerImage)

  const makeCcu = (): TriviaQuestion | null => {
    const a = pick(withCcu, rnd)
    const b = pick(
      withCcu.filter((g) => g.appid !== a?.appid && g.name !== a?.name),
      rnd,
    )
    if (!a || !b) return null
    const [hi, lo] = a.ccu! >= b.ccu! ? [a, b] : [b, a]
    if (hi.ccu! < lo.ccu! * CCU_RATIO) return null
    const opts = [{ label: hi.name }, { label: lo.name }]
    const s = shuffled(opts, 0, rnd)
    return {
      id: `ccu:${Math.min(a.appid, b.appid)}:${Math.max(a.appid, b.appid)}`,
      kind: 'ccu',
      prompt: 'Куда сейчас набилось больше народу?',
      options: s.items,
      answer: s.answer,
      reveal: `${hi.name} — ${hi.ccu!.toLocaleString('ru-RU')}, ${lo.name} — ${lo.ccu!.toLocaleString('ru-RU')}`,
    }
  }

  const makeCover = (): TriviaQuestion | null => {
    const target = pick(withArt, rnd)
    if (!target) return null
    const others: TriviaCatalogGame[] = []
    const pool = catalog.filter((g) => g.appid !== target.appid && g.name !== target.name)
    for (let i = 0; i < 30 && others.length < 3; i++) {
      const cand = pick(pool, rnd)
      if (cand && !others.some((o) => o.appid === cand.appid || o.name === cand.name)) {
        others.push(cand)
      }
    }
    if (others.length < 3) return null
    const opts = [{ label: target.name }, ...others.map((o) => ({ label: o.name }))]
    const s = shuffled(opts, 0, rnd)
    return {
      id: `cover:${target.appid}`,
      kind: 'cover',
      prompt: 'Что это за игра?',
      image: { appid: target.appid, art: target.art, headerImage: target.headerImage },
      options: s.items,
      answer: s.answer,
    }
  }

  /**
   * «Какого тега нет у игры». Теги выбираются и сравниваются английскими
   * ключами tags_json, а в варианты идут подписями tagRu — на месте вывода,
   * как везде (lib/tagsru): ключи здесь стояли как есть, и вопрос предлагал
   * «Action Roguelike» и «Hack and Slash», пока карточка колоды под ним
   * рисовала теги той же игры по-русски.
   *
   * Подпись у двух ключей бывает одна («Dystopian » с пробелом и «Dystopian»),
   * поэтому свои варианты сводятся по подписи, а «чужой» отсеивается по
   * подписям ВСЕХ своих тегов, не только трёх показанных: иначе он выглядел бы
   * ровно как тег, который у игры есть, — и PartyTrivia получила бы два
   * одинаковых key.
   */
  const makeNotTag = (): TriviaQuestion | null => {
    const target = pick(
      catalog.filter((g) => Object.keys(g.tags).length >= 3),
      rnd,
    )
    if (!target) return null
    // Set хранит порядок вставки: подписи идут по весу тега, как раньше ключи
    const ownLabels = new Set(
      Object.entries(target.tags)
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => tagRu(t)),
    )
    const shown = [...ownLabels].slice(0, 3)
    if (shown.length < 3) return null
    const foreign = [
      ...new Set(
        catalog
          .flatMap((g) => Object.keys(g.tags))
          .filter((t) => !(t in target.tags) && !ownLabels.has(tagRu(t))),
      ),
    ]
    const wrong = pick(foreign, rnd)
    if (!wrong) return null
    const opts = [{ label: tagRu(wrong) }, ...shown.map((label) => ({ label }))]
    const s = shuffled(opts, 0, rnd)
    return {
      id: `nottag:${target.appid}:${wrong}`,
      kind: 'nottag',
      prompt: `Какого тега нет у «${target.name}»?`,
      options: s.items,
      answer: s.answer,
    }
  }

  const makers = [makeCover, makeCcu, makeNotTag]
  for (let i = 0; i < count * 8 && out.length < count; i++) {
    add(makers[i % makers.length]())
  }

  return out
}
