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
/** Слишком многолюдная основа — это просто частое слово, а не серия */
const MAX_GROUP = 15
const MIN_BASE_LENGTH = 4

/** Слова, которыми Valve и издатели помечают именно УСТАРЕВШУЮ версию */
const OLD_MARKERS = ['legacy', 'classic', 'original']
/** Пометки актуальной версии — их тоже срезаем при вычислении основы */
const NEW_MARKERS = ['enhanced', 'remastered', 'remake', 'definitive', 'reforged']

const EDITION_RE =
  /\s*[-–—:]?\s*\b(game of the year|goty|deluxe|complete|ultimate|anniversary|gold|premium|standard|enhanced|definitive|remastered)?\s*\b(edition|director'?s cut)\b.*$/i

export function normalizeTitle(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .replace(EDITION_RE, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}:.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:\s-]+$/, '')
    .trim()
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

function hasOldMarker(name: string): boolean {
  const lower = name.toLowerCase()
  return OLD_MARKERS.some((w) => new RegExp(`\\b${w}\\b`).test(lower))
}

function sameMaker(a: SeriesMember, b: SeriesMember): boolean {
  return (
    (Boolean(a.publisher) && a.publisher === b.publisher) ||
    (Boolean(a.developer) && a.developer === b.developer)
  )
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
    const winner = sorted.find((m) => m.alive)
    if (!winner) continue

    for (const m of list) {
      if (m.appid === winner.appid) continue
      if (m.appid in overrides) continue
      if (!sameMaker(m, winner)) continue

      // Если в игру можно играть одному, она не «версия», а самостоятельная
      // игра со своим содержанием: сиквел её не отменяет. Без этого прогон по
      // каталогу вытеснял Dark Souls II ради III, GTA IV ради V и Borderlands:
      // The Pre-Sequel ради четвёртой части — у всех есть сетевые режимы,
      // и предохранителя «только мультиплеер» не хватало.
      // Устаревает то, что жило сообществом: CS 1.6 без одиночного режима
      // играбельна только на серверах, и аудитория переехала в CS2 целиком.
      if (m.soloCapable) continue

      // Пометка в названии сильнее любых метрик: у «GTA V Legacy» онлайн
      // даже выше, чем у Enhanced, но актуальна всё равно вторая
      if (m.old && !winner.old) {
        out.set(m.appid, winner.appid)
        continue
      }

      if (winner.rank <= m.rank) continue
      // Серия сменилась не когда вышел сиквел, а когда аудитория переехала
      const moved = (winner.audience ?? 0) >= (m.audience ?? 0) * SUPERSEDE_RATIO
      if (!m.alive || moved) out.set(m.appid, winner.appid)
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
