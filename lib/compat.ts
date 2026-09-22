import { buildTagProfile } from './recommend'
import { cosine, rarityOf, rarityScale } from './tagweight'
import type { GameMeta, LibraryGame } from './types'

export type Compatibility = {
  /** 0–100, близость вкусов; см. tasteCosine */
  percent: number
  /** Самые наигранные из общих, не больше COMMON_SHOWN */
  commonGames: Array<{ appid: number; name: string; hoursA: number; hoursB: number }>
  /**
   * Размер ВСЕГО пересечения, а не показанного среза.
   *
   * Без него страница не может сказать правду: заголовок «Общие игры — N»
   * считал длину уже обрезанного списка, то есть у пары с тремя сотнями общих
   * игр честно писал «10». Число живёт здесь, а не в вёрстке, потому что срез
   * тоже делается здесь.
   */
  commonTotal: number
  /** Часы обоих по всему пересечению, а не по срезу */
  commonHours: number
  sharedTags: string[]
}

/** Сколько общих игр отдаём наружу: список, а не каталог */
export const COMMON_SHOWN = 10

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
 * ВАЖНО: метрика ЦЕЛИКОМ живёт здесь, а не в lib/recommend.ts, намеренно. В
 * подборе косинус считается между профилем человека и ОДНОЙ игрой — вычитать
 * фон там бессмысленно. Держим вычитание подальше от горячего пути, чтобы
 * нельзя было вкрутить его туда по невнимательности.
 *
 * Вес редкости — другое дело, и в подбор он переехал сознательно (коммит «Вкус
 * считается с весом редкости»). Раньше здесь стояло «перевес осей
 * переупорядочил бы выдачу всем» — да, и в этом был смысл правки: сырой
 * косинус профиля с игрой тоже решался частотным костяком, и совпадение по
 * Indie с Action поднимало игру наравне с совпадением по Automation. Цена
 * известна заранее: проценты совпадения на карточке упали (в замере выше один
 * только вес редкости снял медиану с 85 до 66), и это ожидаемо — число стало
 * честнее, а не хуже.
 * Без пригодной карты тегов подбор считает как раньше, сырым косинусом.
 */

/*
 * Порог пригодности карты тегов, её знаменатель и сам вес редкости живут в
 * lib/tagweight.ts: тот же вес нужен подбору и объяснениям, а две копии одной
 * формулы разошлись бы молча.
 */

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
  const allCommon = libA
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

  // Счётчик и сумма — по всему пересечению, до среза: см. Compatibility.commonTotal
  const commonTotal = allCommon.length
  const commonHours = allCommon.reduce((sum, g) => sum + g.hoursA + g.hoursB, 0)
  const commonGames = allCommon.slice(0, COMMON_SHOWN)

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

  return { percent, commonGames, commonTotal, commonHours, sharedTags }
}

/*
 * Вердикт — фраза, ради которой страницу и скриншотят. Жил приватной функцией
 * внутри JSX страницы и ровно поэтому пережил переписывание метрики
 * незамеченным: правили числа, а слова, которые эти числа объясняют, лежали в
 * другом файле и в тесты не попадали.
 *
 * Замеры после правки метрики (коммит «Совместимость перестала показывать
 * 85–95% любым двум людям», медиана на 200 парах непересекающихся библиотек):
 *
 *   случайные пары, библиотека 8 / 25 / 60 / 150 / 400 игр
 *     0 / 0 / 4 / 11 / 22
 *   две библиотеки из одной ниши (557 рогаликов)
 *     37 / 65 / 80
 *
 * Верхние три порога с этими замерами сходятся: потолок посторонних 22, пол
 * «одной ниши» 37, и 40 стоит ровно в разрыве между ними.
 *
 * ЧТО ЗДЕСЬ ЕЩЁ НЕ ЧИНЕНО. Нижний порог 20 делит людей по размеру библиотеки, а
 * не по вкусу: посторонний с четырьмя сотнями игр набирает 22 и получает
 * «Разные, но это даже интересно», а посторонний с двадцатью пятью получает 0 и
 * «Противоположности». Это тот же дефект, ради которого переписывали метрику,
 * вернувшийся уровнем ниже — в словах. Замеры намекают на 25, но тот же коммит
 * просил настраивать пороги по ЖИВЫМ процентам, а живого распределения в
 * репозитории до сих пор нет. Двигать вслепую — менять одну догадку на другую.
 */
export function verdict(percent: number): string {
  if (percent >= 80) return 'Вы буквально один человек'
  if (percent >= 60) return 'Отличная пара для коопа'
  if (percent >= 40) return 'Есть о чём поиграть вместе'
  if (percent >= 20) return 'Разные, но это даже интересно'
  return 'Противоположности. Притянетесь?'
}
