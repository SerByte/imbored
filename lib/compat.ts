import { buildTagProfile, cosine } from './recommend'
import type { GameMeta, LibraryGame } from './types'

export type Compatibility = {
  /** 0–100, близость вкусов; см. tasteCosine */
  percent: number
  commonGames: Array<{ appid: number; name: string; hoursA: number; hoursB: number }>
  sharedTags: string[]
}

/*
 * Почему здесь своя метрика, а не голый cosine.
 *
 * Сырой косинус тег-профилей показывал любым двум людям 85–95%. Замерено на
 * каталоге в 6000 игр, 400 пар непересекающихся библиотек по 60 игр:
 * min 74 / медиана 85 / max 91. Из 200 случайных пар 189 получали верхнюю
 * ступень «Вы буквально один человек», а ступени 40 и 20 не видел никто.
 *
 * Причина не в пороге, а в том, что у всех библиотек доминируют одни и те же
 * частотные теги — Singleplayer, Action, Adventure, — и вектора почти
 * сонаправлены ещё до всякого сходства вкусов. Хуже: процент оказывался
 * функцией РАЗМЕРА библиотеки, а не близости. Медиана на случайных парах:
 * 8 игр — 44, 25 игр — 69, 60 игр — 85, 150 игр — 93, 400 игр — 97.
 *
 * Лечится двумя приёмами, и оба нужны (числа — медиана на случайных парах):
 *   сырой косинус                          85
 *   только вес редкости                    66   размер всё ещё правит
 *   только вычитание фона                   7   но хвост уходит на 46
 *   вес редкости + вычитание фона           3   хвост 25
 *
 * После правки зависимость от размера почти уходит: 8 игр 44→0, 60 игр 85→3,
 * 400 игр 97→19.
 *
 * ВАЖНО: метрика живёт здесь, а не в lib/recommend.ts, намеренно. В подборе
 * косинус считается между профилем человека и ОДНОЙ игрой — вычитать фон там
 * бессмысленно, а перевес осей переупорядочил бы выдачу всем. Держим её
 * подальше от горячего пути, чтобы нельзя было вкрутить туда по невнимательности.
 */

/** Ниже этого карта тегов не считается пригодной — работаем как раньше. */
const MIN_TAG_STATS = 20

/**
 * Знаменатель редкости берём как максимум по самой карте, а не как настоящее
 * число игр с тегами.
 *
 * Истинное N потребовало бы либо COUNT(DISTINCT appid) по всей game_tags на
 * каждый запрос (а Turso берёт деньги за прочитанные строки), либо счётчика в
 * catalog_meta, который до ближайшего publish-catalog возвращал бы ноль — и
 * правка молча не работала бы. Разница между истинным N и максимумом — общий
 * сдвиг всех редкостей на константу; на медианах это меняет не больше трёх
 * пунктов (проверено: 0/3/27 против 0/3/25).
 *
 * Чего делать НЕЛЬЗЯ — брать сюда countIngest: это другая популяция (все игры
 * Steam, 138 тысяч), и доля любого тега выходит около двух процентов. Ровно на
 * этой ошибке уже мёртв STOP_TAG_SHARE в lib/pool.ts — не повторяем.
 */
function rarityScale(tagStats: Map<string, number>): number {
  let top = 0
  for (const count of tagStats.values()) if (count > top) top = count
  return top >= MIN_TAG_STATS ? top : 0
}

/** Тег у половины каталога не разделяет людей — его вес около нуля. */
function rarityOf(tag: string, tagStats: Map<string, number>, top: number): number {
  const df = tagStats.get(tag)
  return !df || df >= top ? 0 : Math.log(top / df)
}

function unit(v: Record<string, number>): { vec: Record<string, number>; norm: number } {
  let n = 0
  for (const x of Object.values(v)) n += x * x
  n = Math.sqrt(n)
  if (!n) return { vec: v, norm: 0 }
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(v)) out[k] = x / n
  return { vec: out, norm: n }
}

/**
 * Близость вкусов двух людей, 0…1.
 *
 * Без пригодной карты тегов честно возвращает прежний сырой косинус: лучше
 * старое поведение, чем деление на ноль или молчаливые нули.
 */
export function tasteCosine(
  a: Record<string, number>,
  b: Record<string, number>,
  tagStats: Map<string, number>,
): number {
  const top = rarityScale(tagStats)
  if (!top) return cosine(a, b)

  const weigh = (p: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const [tag, value] of Object.entries(p)) {
      const r = rarityOf(tag, tagStats, top)
      if (r > 0) out[tag] = value * r
    }
    return out
  }

  const wa = unit(weigh(a))
  const wb = unit(weigh(b))
  if (!wa.norm || !wb.norm) return cosine(a, b)

  // Направление «средний каталог». Приближение по game_count сверено с
  // настоящим средним профилем всех 6000 игр: косинус 0.9938. Точнее считать
  // (по сумме весов game_tags) — потребовало бы колонки и миграции ради
  // 0.9935, то есть ради ничего.
  const bgRaw: Record<string, number> = {}
  for (const [tag, df] of tagStats) {
    const r = rarityOf(tag, tagStats, top)
    if (r > 0) bgRaw[tag] = df * r
  }
  const bg = unit(bgRaw)
  if (!bg.norm) return cosine(wa.vec, wb.vec)

  /*
   * Вычитаем ПРОЕКЦИЮ на фон, а не сам фон.
   *
   * Вычесть фон «как есть» нельзя: профили разного масштаба — у одного
   * библиотека на 30 игр, у другого на 500, — и одна и та же вычтенная
   * константа выест первый и не заденет второй. Проекция забирает ровно
   * столько фона, сколько в этом профиле есть.
   */
  const deflate = (v: Record<string, number>) => {
    let along = 0
    for (const [tag, x] of Object.entries(bg.vec)) along += (v[tag] ?? 0) * x
    const out: Record<string, number> = { ...v }
    for (const [tag, x] of Object.entries(bg.vec)) out[tag] = (out[tag] ?? 0) - along * x
    return unit(out)
  }

  const ra = deflate(wa.vec)
  const rb = deflate(wb.vec)
  if (!ra.norm || !rb.norm) return cosine(wa.vec, wb.vec)

  // Остатки могут смотреть в разные стороны — отрицательная близость это всё
  // ещё «ничего общего», а не «меньше чем ничего».
  return Math.max(0, cosine(ra.vec, rb.vec))
}

/** Совместимость двух игроков по реальным библиотекам и наигранному времени */
export function compatibility(
  libA: LibraryGame[],
  libB: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
  // Обязательный, без значения по умолчанию: дефолт молча вернул бы старое
  // раздутое число, а продовый вызов ровно один.
  tagStats: Map<string, number>,
): Compatibility {
  const profileA = buildTagProfile(libA, metaOf)
  const profileB = buildTagProfile(libB, metaOf)
  const percent = Math.round(tasteCosine(profileA, profileB, tagStats) * 100)
  const top = rarityScale(tagStats)

  const byAppidB = new Map(libB.map((g) => [g.appid, g]))
  const commonGames = libA
    .filter((g) => byAppidB.has(g.appid))
    .map((g) => {
      const other = byAppidB.get(g.appid)!
      return {
        appid: g.appid,
        name: g.name,
        hoursA: Math.round(g.playtimeForever / 60),
        hoursB: Math.round(other.playtimeForever / 60),
      }
    })
    .sort((a, b) => b.hoursA + b.hoursB - (a.hoursA + a.hoursB))
    .slice(0, 10)

  /*
   * Общие теги тоже взвешены редкостью, и это меняет ответ по существу.
   *
   * «У вас общее: Singleplayer, Action» — не наблюдение, а описание каталога:
   * эти теги есть у половины игр. Взвешивание поднимает наверх то, что двоих
   * действительно роднит, даже если наиграно там меньше.
   */
  const weightOf = (tag: string) =>
    Math.min(profileA[tag], profileB[tag]) * (top ? rarityOf(tag, tagStats, top) : 1)

  const sharedTags = Object.keys(profileA)
    .filter((tag) => (profileB[tag] ?? 0) > 0 && profileA[tag] > 0)
    .sort((a, b) => weightOf(b) - weightOf(a))
    .slice(0, 6)

  return { percent, commonGames, sharedTags }
}
