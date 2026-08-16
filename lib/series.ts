/**
 * Определение устаревшей версии внутри серии.
 *
 * Задача: не предлагать CS 1.6, когда актуальна CS2. Наивная формула
 * «рейтинг × популярность» здесь проваливается — у CS 1.6 доля положительных
 * отзывов ВЫШЕ (95% против 77%), и по качеству она выигрывает. Отличает их
 * только объём свежих отзывов: 781 против 73 725, то есть в 94 раза.
 * Логарифм эту разницу съедает, поэтому нужен отдельный фильтр, а не слагаемое.
 *
 * Конструкция намеренно консервативна: «почему мне никогда не показывают
 * Portal?» — репутационно хуже, чем «мне показали CS 1.6». Поэтому вытеснение
 * применяется только к мультиплееру, только при совпадении издателя и только
 * когда аудитория реально переехала.
 */

export type SeriesMember = {
  appid: number
  name: string
  isMultiplayer: boolean
  alive: boolean
  audience?: number
  /** есть одиночный режим — значит игра самоценна, а не «версия» */
  soloCapable?: boolean
  releaseYear?: number
  publisher?: string
  developer?: string
  /** явный номер версии, если он известен точнее, чем из названия */
  ordinalHint?: number
}

/** Ручные решения там, где алгоритм слеп: ребрендинг, преемник в другом лаунчере */
export type SeriesOverrides = Record<number, number | null>

/** Во сколько раз новая версия должна опережать старую, чтобы вытеснить её */
export const SUPERSEDE_RATIO = 10

/**
 * Для игр с одиночным режимом планка на два порядка выше.
 *
 * Одиночная часть самоценна, пока в неё есть кому играть, поэтому раньше здесь
 * стоял безусловный пропуск. Но «есть одиночный режим» и «одиночный режим —
 * это содержание» не одно и то же: у Condition Zero кампания состоит из матчей
 * с ботами, и против миллиона в CS2 там стоит три сотни человек.
 *
 * Порог отделяет её от тех, ради кого пропуск и появился: Dark Souls II идёт
 * к третьей части как 1:22, Borderlands: The Pre-Sequel к четвёртой — 1:16,
 * Left 4 Dead ко второй — 1:52. Все они остаются. По каталогу в 5723 игры
 * порог задевает одну — Hearts of Iron III при живой четвёртой (1:916).
 */
export const SUPERSEDE_RATIO_SOLO = 500

/**
 * Ручные решения там, где метрики правы, а по существу — нет.
 *
 * Battlefield: Bad Company 2 порог проходит с запасом: четырнадцать игроков
 * против пятидесяти тысяч у шестой части, разрыв в 3666 раз. Но серверы — не
 * всё, что в ней есть: кампания у неё отдельная, признанная и играется без
 * единого живого человека рядом. Метрика видит мёртвый мультиплеер, а
 * вытесняет при этом целую игру.
 *
 * Двоеточие тут не случайно: parseSeries срезает подзаголовок, и «Bad Company»
 * складывается с нумерованными частями в одну серию, хотя это своя линейка.
 * Чинить это в parseSeries нельзя — на подзаголовках держится вытеснение
 * Counter-Strike: Source ради CS2. Поэтому исключение, а не правило.
 */
export const SERIES_OVERRIDES: SeriesOverrides = {
  24960: null, // Battlefield: Bad Company 2 — своя кампания, сиквел её не отменяет
}

/** Слишком многолюдная основа — это просто частое слово, а не серия */
const MAX_GROUP = 15
const MIN_BASE_LENGTH = 4

/** Слова, которыми Valve и издатели помечают именно УСТАРЕВШУЮ версию */
const OLD_MARKERS = ['legacy', 'classic', 'original']
/** Пометки актуальной версии — их тоже срезаем при вычислении основы */
const NEW_MARKERS = ['enhanced', 'remastered', 'remake', 'definitive', 'reforged']

const EDITION_RE =
  /\s*[-–—:]?\s*\b(game of the year|goty|deluxe|complete|ultimate|anniversary|gold|premium|standard|enhanced|definitive|remastered)?\s*\b(edition|director'?s cut)\b.*$/i

/**
 * Название без знаков, регистра и мусорной пунктуации — но БЕЗ срезания изданий.
 *
 * Выделено из normalizeTitle, чтобы этим же приведением пользовался editionKey
 * (lib/editions.ts): ему нужна голая строка, потому что EDITION_RE срезает
 * только якорь и оставляет квалификатор («…Skyrim Special Edition» →
 * «…skyrim special»), а для ключа издания это ровно то, что мешает.
 */
export function cleanTitle(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}:.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:\s-]+$/, '')
    .trim()
}

export function normalizeTitle(name: string): string {
  return cleanTitle(name.replace(/[™®©]/g, '').replace(EDITION_RE, ''))
}

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15,
}

/**
 * Основа серии и номер версии. Подзаголовок после двоеточия номером не считается:
 * «Counter-Strike: Source» — это та же основа без номера, а не вторая часть.
 */
export function parseSeries(name: string): { base: string; ordinal: number | null } {
  const normalized = normalizeTitle(name)
  let head = normalized.split(':')[0].trim()

  // маркеры версий срезаем, иначе «GTA V Legacy» и «GTA V Enhanced»
  // окажутся разными сериями
  for (const marker of [...OLD_MARKERS, ...NEW_MARKERS]) {
    head = head.replace(new RegExp(`\\s+${marker}\\b`, 'g'), '')
  }
  head = head.trim()

  const m = head.match(/\s+([\d]+(?:\.\d+)?|[ivx]+)$/i)
  if (!m) return { base: head, ordinal: null }

  const token = m[1].toLowerCase()
  const ordinal = /^[\d.]+$/.test(token) ? Number(token) : (ROMAN[token] ?? null)
  if (ordinal === null) return { base: head, ordinal: null }
  return { base: head.slice(0, m.index).trim(), ordinal }
}

/**
 * Пометка устаревшей версии — только там, где это пометка, а не часть названия.
 *
 * Слово должно стоять в конце имени, перед двоеточием или в скобках: «GTA V
 * Legacy», «theHunter Classic», «Battlefleet Gothic: Armada (Classic)»,
 * «Serious Sam Classic: The Second Encounter». Поиск слова где угодно ловил
 * «Divinity: Original Sin 2», «LEGO Indiana Jones: The Original Adventures» и
 * «LEGO Batman: Legacy of the Dark Knight» — там это существительное из
 * названия, и вытеснение уносило целую игру ради постороннего однофамильца.
 *
 * Промах был не виден, пока проверка маркера стояла ПОСЛЕ отсечки по
 * одиночному режиму: до неё просто не доходили. Стоило переставить — вылезли
 * сразу три ложных срабатывания по каталогу.
 */
export function hasOldMarker(name: string): boolean {
  const lower = name.toLowerCase()
  return OLD_MARKERS.some((w) => new RegExp(`\\b${w}\\b\\s*(?:$|[:)\\]])`).test(lower))
}

function sameMaker(a: SeriesMember, b: SeriesMember): boolean {
  return (
    (Boolean(a.publisher) && a.publisher === b.publisher) ||
    (Boolean(a.developer) && a.developer === b.developer)
  )
}

/**
 * Переехала ли аудитория одиночной игры целиком, с запасом в два порядка.
 *
 * Неизвестную аудиторию считаем аргументом ПРОТИВ вытеснения: молчание — не
 * доказательство переезда. Без этой проверки условие «преемник ≥ ноль» было бы
 * истинным всегда, и в каталоге вытеснялись бы пары, где обе части одинаково
 * безлюдны — Beat Hazard ради Beat Hazard 2 и ещё три таких же случая.
 */
function soloMovedOn(m: { audience?: number }, winner: { audience?: number }): boolean {
  if (!m.audience) return false
  return (winner.audience ?? 0) >= m.audience * SUPERSEDE_RATIO_SOLO
}

/**
 * appid устаревшей версии -> appid актуальной. Игры, которых нет в карте,
 * считаются актуальными.
 */
export function buildSeriesIndex(
  all: SeriesMember[],
  overrides: SeriesOverrides = {},
): Map<number, number> {
  const out = new Map<number, number>()

  // Вытеснение — только для совместной игры. Одиночные сиквелы никогда
  // не отменяют предшественника: Portal, Witcher, Half-Life остаются.
  const groups = new Map<string, Array<SeriesMember & { rank: number; old: boolean }>>()
  for (const m of all) {
    if (!m.isMultiplayer) continue
    const { base, ordinal } = parseSeries(m.name)
    if (base.length < MIN_BASE_LENGTH) continue
    const rank = m.ordinalHint ?? ordinal ?? 1
    const list = groups.get(base) ?? []
    list.push({ ...m, rank, old: hasOldMarker(m.name) })
    groups.set(base, list)
  }

  for (const list of groups.values()) {
    if (list.length < 2 || list.length > MAX_GROUP) continue

    // Актуальная версия: без пометки «legacy», выше номером, живее по отзывам
    const sorted = [...list].sort(
      (a, b) =>
        Number(a.old) - Number(b.old) ||
        b.rank - a.rank ||
        (b.audience ?? 0) - (a.audience ?? 0),
    )

    for (const m of list) {
      if (m.appid in overrides) continue

      /*
       * Преемник ищется ДЛЯ КАЖДОЙ игры свой, а не один на группу.
       *
       * Разница видна, только когда в группе оказывается посторонний: раньше
       * победителем становился первый живой по сортировке, и если издатель у
       * него не совпадал, вытеснения не происходило вовсе — ни для кого. То
       * есть безымянная «Часть 3» в группе ОТМЕНЯЛА вытеснение CS 1.6 ради
       * CS2, хотя обе Valve и обе на месте. Пока каталог считался офлайн, а
       * библиотека отдельно, посторонним взяться было неоткуда; с общим
       * расчётом — стало.
       *
       * Условие «та же студия» осталось тем же и таким же консервативным:
       * просто теперь оно выбирает преемника, а не отбраковывает единственного.
       */
      const winner = sorted.find((w) => w.alive && w.appid !== m.appid && sameMaker(m, w))
      if (!winner) continue

      /*
       * Пометка в названии сильнее любых метрик — и сильнее предохранителя ниже.
       *
       * Порядок здесь и есть смысл: раньше проверка стояла ПОСЛЕ отсечки по
       * одиночному режиму и потому не срабатывала никогда для того самого
       * случая, ради которого писалась. У GTA V категория «одиночная» есть,
       * так что до маркера дело не доходило, и «Игра дня» предлагала Legacy
       * человеку, у которого рядом лежит Enhanced с наигранными часами.
       *
       * Метрики тут бессильны по существу: у Legacy онлайн того же порядка,
       * что у Enhanced (31 753 против 37 649), никакого «переезда аудитории»
       * не видно. Видно только слово, которое издатель написал сам.
       */
      if (m.old && !winner.old) {
        out.set(m.appid, winner.appid)
        continue
      }

      // Если в игру можно играть одному, она не «версия», а самостоятельная
      // игра со своим содержанием: сиквел её не отменяет. Без этого прогон по
      // каталогу вытеснял Dark Souls II ради III, GTA IV ради V и Borderlands:
      // The Pre-Sequel ради четвёртой части — у всех есть сетевые режимы,
      // и предохранителя «только мультиплеер» не хватало.
      // Устаревает то, что жило сообществом: CS 1.6 без одиночного режима
      // играбельна только на серверах, и аудитория переехала в CS2 целиком.
      //
      // Но пропуск больше не безусловный: одиночный режим защищает игру, пока
      // у неё есть своя аудитория, а не сам по себе (см. SUPERSEDE_RATIO_SOLO).
      if (m.soloCapable && !soloMovedOn(m, winner)) continue

      if (winner.rank <= m.rank) continue
      // Серия сменилась не когда вышел сиквел, а когда аудитория переехала.
      // Именно переезд, а не смерть предшественника: мёртвое убирает фильтр
      // живости, и дублировать его здесь — значит вытеснять по слабому поводу.
      if ((winner.audience ?? 0) >= (m.audience ?? 0) * SUPERSEDE_RATIO) {
        out.set(m.appid, winner.appid)
      }
    }
  }

  // ручные решения применяем последними, чтобы они перекрывали алгоритм
  for (const [appid, target] of Object.entries(overrides)) {
    const id = Number(appid)
    if (target === null) out.delete(id)
    else out.set(id, target)
  }

  return out
}
