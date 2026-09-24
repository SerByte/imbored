/**
 * Хаб игр: полки по характерным тегам на /games.
 *
 * Зачем он вообще. На пять тысяч карточек /game/<appid> не было ни одной
 * страницы, которая ссылалась бы на них пачкой: шапка, подвал и нижняя панель
 * ведут в разделы за входом, главная держит обложки в декоративном слое, а
 * полка «Похожие» даёт по шесть ссылок с карточки, до которой ещё надо дойти.
 * Поисковик узнавал о большинстве игр только из карты сайта, а человеку с
 * карточки некуда было пойти «посмотреть ещё», кроме квиза.
 *
 * Жанры — список руками, а не вывод из частотности, и это проверено замером.
 * Частотный отбор (всё, что не шире 15% каталога, минус GENERIC_TAGS из
 * lib/hook) на живом каталоге собрал в первую тридцатку «Смешную», «Милую»,
 * «Протагонистку», «Кастомизацию персонажа» и «Решения с последствиями» —
 * описания, а не то, что ищут. Метроидвании и соулслайки при этом не
 * попадали и в первую сотню. Каталог решает другое: какая игра стоит на
 * полке (см. HUB_MIN_WEIGHT) и хватает ли полке игр (HUB_MIN_SHELF).
 *
 * Модуль чистый: из других модулей — только типы.
 */
import type { SimilarGame } from './db'

/**
 * Полки хаба в порядке показа — английскими ключами тегов, как они лежат в
 * game_tags. Подпись переводит tagRu на месте вывода; у каждого ключа она
 * есть (сторож в lib/gamehub.test.ts), иначе заголовок полки стоял бы
 * по-английски.
 *
 * Порядок — группами: экшен, ролевые, истории и загадки, выживание,
 * стратегии и менеджмент, спокойное, остальное. Тридцать — верх того, что
 * читается одной страницей без оглавления.
 */
export const HUB_TAGS: readonly string[] = [
  'Open World',
  'Souls-like',
  'Metroidvania',
  'Roguelike',
  'Hack and Slash',
  'FPS',
  'Stealth',
  'Immersive Sim',
  'Action RPG',
  'JRPG',
  'CRPG',
  'Visual Novel',
  'Point & Click',
  'Detective',
  'Puzzle',
  'Horror',
  'Survival',
  'Sandbox',
  'City Builder',
  'Colony Sim',
  'Automation',
  'Grand Strategy',
  'RTS',
  'Turn-Based Tactics',
  'Tower Defense',
  'Deckbuilding',
  'Farming Sim',
  'Cozy',
  'Platformer',
  'Racing',
]

/** Игр на полке */
export const HUB_SHELF = 12

/** Полка короче этого не показывается: три игры под заголовком жанра — не полка */
export const HUB_MIN_SHELF = 6

/**
 * Порог веса тега в самой игре — половина её главного тега.
 *
 * У игры в game_tags лежат только двенадцать верхних тегов, и вес у них
 * высокий почти всегда: замер на каталоге — у трёх строк из четырёх он выше
 * 500. Без порога на полку «Тактика» встала бы CS2 (Tactical у неё 453 при
 * FPS 1000), на «Уютную» — всё, где уют упомянут девятым тегом. С порогом
 * полка собирается из игр, для которых жанр — один из главных, а не метка.
 */
export const HUB_MIN_WEIGHT = 500

/**
 * Кандидатов на тег из базы — втрое больше полки. Запас нужен ради правила
 * «одна игра — одна полка» (см. assembleHub): Stardew Valley стоит в верхушке
 * и «Симулятора фермы», и «Уютной», и вторая полка без запаса осталась бы
 * короче.
 *
 * Вдвое не хватило, замер на каталоге: «Открытый мир» заполняется последним
 * (он самый широкий), его верх разбирают «Выживание», «Соулслайк» и
 * «Ролевой экшен», и из двадцати четырёх кандидатов полке оставалось девять,
 * «Градостроению» — десять. Прочитанных строк запас не добавляет: окно в
 * topGamesByTags всё равно проходит все игры тега, растёт только ответ.
 */
export const HUB_FETCH = HUB_SHELF * 3

/** Строка выборки: игра-кандидат одного тега и сколько всего игр у тега прошло порог */
export type HubRow = SimilarGame & { tag: string; total: number }

export type HubShelf = { tag: string; games: SimilarGame[] }

/**
 * Полки из строк выборки: каждая игра — ровно на одной полке.
 *
 * Без этого правила хаб показывал бы одни и те же хиты по пять раз: верх по
 * отзывам у широких жанров один и тот же. А тридцать полок по двенадцать
 * разных игр — это до трёхсот шестидесяти разных карточек, и для человека
 * («каждая полка — свои открытия»), и для краулера.
 *
 * Кому игра достаётся, решает редкость тега: полки заполняются от самого
 * узкого жанра к самому широкому (total — сколько игр прошло порог у тега).
 * Иначе Stardew Valley ушла бы в «Песочницу», где она одна из сотен, а
 * «Симулятор фермы» без неё остался бы без лица. Внутри тега порядок тот,
 * что пришёл из базы (по числу отзывов). При равной редкости раньше заполняется
 * та полка, что раньше стоит в HUB_TAGS.
 *
 * Показываются полки в порядке `tags`; полки короче minShelf выпадают.
 * Строки тегов, которых нет в `tags`, не читаются вовсе.
 */
export function assembleHub(
  tags: readonly string[],
  rows: readonly HubRow[],
  opts: { shelf?: number; minShelf?: number } = {},
): HubShelf[] {
  const shelf = opts.shelf ?? HUB_SHELF
  const minShelf = opts.minShelf ?? HUB_MIN_SHELF

  const byTag = new Map<string, { total: number; games: SimilarGame[] }>()
  for (const t of tags) byTag.set(t, { total: 0, games: [] })
  for (const r of rows) {
    const bucket = byTag.get(r.tag)
    if (!bucket) continue
    bucket.total = Math.max(bucket.total, r.total)
    // tag и total — служебные поля выборки, на полку едет только игра
    bucket.games.push({
      appid: r.appid,
      name: r.name,
      headerImage: r.headerImage,
      art: r.art,
    })
  }

  const order = tags
    .map((tag, i) => ({ tag, i, total: byTag.get(tag)?.total ?? 0 }))
    .sort((a, b) => a.total - b.total || a.i - b.i)

  const taken = new Set<number>()
  const filled = new Map<string, SimilarGame[]>()
  for (const { tag } of order) {
    const picked: SimilarGame[] = []
    for (const g of byTag.get(tag)?.games ?? []) {
      if (picked.length >= shelf) break
      if (taken.has(g.appid)) continue
      picked.push(g)
      taken.add(g.appid)
    }
    // Игры короткой полки возвращаются в оборот: полка не покажется, и держать
    // их за ней значило бы отнять у соседей ни за что
    if (picked.length < minShelf) {
      for (const g of picked) taken.delete(g.appid)
      continue
    }
    filled.set(tag, picked)
  }

  return tags.flatMap((tag) => {
    const games = filled.get(tag)
    return games ? [{ tag, games }] : []
  })
}
