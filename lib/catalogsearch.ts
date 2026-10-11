import { hasCyrillic } from './cyrillic'
import { foldTitle } from './foldtitle'
import { plural } from './plural'

/**
 * «НАЙТИ ИГРУ» — ПОИСК ПО КАТАЛОГУ В БРАУЗЕРЕ.
 *
 * До него к пяти с половиной тысячам карточек /game/<appid> можно было
 * прийти только из поисковика, по карте сайта, с полок хаба и из «Похожих».
 * Набрать название и попасть на игру было нельзя: единственное поле поиска в
 * продукте (components/LibrarySearch) ищет по своей библиотеке, и гостю без
 * Steam оно не открыто вовсе.
 *
 * Искать решено в браузере, по статическому индексу, а не запросом к базе на
 * каждую клавишу. Индекс — app/search-index.json/route.ts: одна выборка в
 * сутки на ISR и ни одного вызова функции на набор. Едет он только тогда,
 * когда человек открыл поиск (lib/catalogindex), а сам поиск — отдельным
 * чанком (components/SearchLauncher): страница, где поиск не открывали, не
 * платит ни байтом.
 *
 * Модуль клиентский и лёгкий: свёртка — lib/foldtitle, а не lib/forgotten
 * (тот тянет движок подбора). Сторож графа импортов — lib/searchlazy.test.ts.
 */

/** Адрес индекса. Маршрут — app/search-index.json/route.ts */
export const SEARCH_INDEX_PATH = '/search-index.json'

/**
 * Сколько игр показывает выпадающий список. Восемь строк по 44 px — список
 * целиком под полем и на телефоне с открытой клавиатурой, и стрелками его
 * проходят за пару нажатий. Больше — уже листание, а уточнить название
 * быстрее.
 */
export const SEARCH_SHOWN = 8

/** Потолок длины запроса — как у поиска по библиотеке (LIBRARY_QUERY_MAX) */
export const SEARCH_QUERY_MAX = 60

/**
 * Потолок строк индекса. Каталог сейчас ~5.8 тысячи живых игр, и индекс весит
 * около 66 КБ в brotli (76 КБ gzip, замер по локальной копии каталога, см.
 * докблок маршрута). Растёт он линейно, и потолок держит его в пределах
 * ~115 КБ br, если каталог вырастет; отрезается хвост по числу отзывов.
 */
export const SEARCH_INDEX_MAX = 10_000

/**
 * Индекс на проводе — колонками: номера отдельно, названия отдельно.
 *
 * Не пары [[appid, name], …]: те же данные пачкой «число-строка-число»
 * сжимаются хуже. Замер на 5816 играх: пары — 83.1 КБ gzip, колонки — 76.4.
 * Порядок строк — по числу отзывов, и он же порядок популярности при равном
 * совпадении: отдельного ранга на проводе нет.
 */
export type SearchIndexWire = { ids: number[]; names: string[] }

/** Строка индекса в браузере: свёрнутое название посчитано один раз при чтении */
export type SearchEntry = {
  appid: number
  name: string
  /** foldTitle(name) с пробелом спереди: «начало слова» — это ' ' + слово */
  hay: string
}

export type SearchHit = { appid: number; name: string }

export type SearchResult = {
  /** Первые SEARCH_SHOWN — по совпадению, при равном — по порядку индекса */
  games: SearchHit[]
  /** Сколько нашлось всего, а не сколько показано */
  total: number
  /**
   * Запрос в QWERTY, если хоть что-то из показанного нашлось только по нему
   * («цшесрук» → «witcher»). Иначе null: говорить о раскладке незачем.
   */
  layout: string | null
}

const clean = (name: string) => name.replace(/\s+/g, ' ').trim()

/** Строки базы → провод. Пустое после чистки название не едет: его не найти и не показать */
export function encodeSearchIndex(rows: Array<{ appid: number; name: string }>): SearchIndexWire {
  const ids: number[] = []
  const names: string[] = []
  for (const r of rows) {
    const name = clean(r.name)
    if (!name) continue
    ids.push(r.appid)
    names.push(name)
  }
  return { ids, names }
}

/**
 * Провод → строки для поиска. null — форма сломана целиком (не JSON индекса,
 * колонки разной длины): такой ответ — отказ, а не пустой каталог. Битая
 * строка внутри целой формы пропускается молча: из-за одной строки не
 * пропадать всему поиску.
 *
 * appid только положительный: у чужих магазинов id отрицательные, своей
 * карточки по такому адресу нет (выборка их и не отдаёт — это вторая линия).
 */
export function readSearchIndex(body: unknown): SearchEntry[] | null {
  if (!body || typeof body !== 'object') return null
  const { ids, names } = body as Partial<SearchIndexWire>
  if (!Array.isArray(ids) || !Array.isArray(names) || ids.length !== names.length) return null
  const out: SearchEntry[] = []
  for (let i = 0; i < ids.length; i++) {
    const appid = ids[i]
    const name = names[i]
    if (!Number.isInteger(appid) || appid <= 0 || typeof name !== 'string') continue
    const folded = foldTitle(name)
    if (!folded) continue
    out.push({ appid, name, hay: ` ${folded}` })
  }
  return out
}

/**
 * ЙЦУКЕН → QWERTY по клавишам: «цшесрук» — это «witcher», набранный в русской
 * раскладке. Самая частая ошибка русскоязычного набора латинского названия, а
 * каталог почти целиком латиницей (русских названий — два на 5816). null —
 * в запросе нет русских букв, переводить нечего.
 *
 * Знаки на месте букв (б → «,», ж → «;», э → «'») тоже переводятся: свёртка
 * затем сделает из них разделитель, как у настоящего названия.
 */
const RU_TO_QWERTY: Record<string, string> = {
  й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p', х: '[', ъ: ']',
  ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l', ж: ';', э: "'",
  я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm', б: ',', ю: '.', ё: '`',
}

export function fromRuLayout(q: string): string | null {
  if (!hasCyrillic(q)) return null
  return [...q].map((c) => RU_TO_QWERTY[c.toLowerCase()] ?? c.toLowerCase()).join('')
}

/**
 * Насколько хорошо название подходит запросу; меньше — лучше, null — не подходит.
 * phrase — свёрнутый запрос с пробелом спереди, как hay у строки индекса.
 *
 *   0 — название целиком и есть запрос: «doom» → «DOOM», а не «DOOM Eternal»,
 *       у которого отзывов больше;
 *   1 — название начинается с запроса: человек набирает с начала;
 *   2 — каждое слово запроса — начало слова в названии: «witcher 3» →
 *       «The Witcher 3: Wild Hunt»;
 *   3 — каждое слово запроса где-то в названии (matchesTitle, как на стене
 *       /library): «witch» → «Bewitched Forest».
 *
 * Внутри ступени — порядок индекса, то есть число отзывов.
 */
function tierOf(hay: string, phrase: string, words: string[]): number | null {
  if (!words.every((w) => hay.includes(w))) return null
  if (hay === phrase) return 0
  if (hay.startsWith(phrase)) return 1
  if (words.every((w) => hay.includes(` ${w}`))) return 2
  return 3
}

/** Ступеней прямого запроса; переведённый из раскладки встаёт следом за ними */
const TIERS = 4

/**
 * Поиск по индексу: первые limit по ступени совпадения, при равной — по
 * порядку индекса.
 *
 * Запрос в русской раскладке ищется дважды: как есть (русские названия в
 * каталоге есть) и переведённым в QWERTY. Переведённое встаёт ПОСЛЕ всего,
 * что нашлось как есть, и только по началам слов (ступени 0–2): раскладку
 * перепутали, но слово набирали с начала, а двухбуквенное «да» в QWERTY —
 * «lf», и оно сидит внутри «Half-Life».
 *
 * Один проход по индексу на клавишу: шесть тысяч строк и несколько
 * includes на каждую — доли миллисекунды, отдельный воркер или дебаунс
 * здесь не нужны.
 */
export function searchCatalog(index: SearchEntry[], query: string, limit = SEARCH_SHOWN): SearchResult {
  const phrase = foldTitle(query)
  if (!phrase) return { games: [], total: 0, layout: null }
  const words = phrase.split(' ')
  const ru = fromRuLayout(query)
  const alt = ru === null ? '' : foldTitle(ru)
  const altWords = alt && alt !== phrase ? alt.split(' ') : null

  const buckets: SearchEntry[][] = Array.from({ length: TIERS * 2 }, () => [])
  let total = 0
  for (const e of index) {
    let tier = tierOf(e.hay, ` ${phrase}`, words)
    if (tier === null && altWords) {
      const t = tierOf(e.hay, ` ${alt}`, altWords)
      if (t !== null && t < 3) tier = TIERS + t
    }
    if (tier === null) continue
    total++
    if (buckets[tier].length < limit) buckets[tier].push(e)
  }

  const picked: SearchEntry[] = []
  let viaLayout = false
  for (let t = 0; t < buckets.length && picked.length < limit; t++) {
    for (const e of buckets[t]) {
      if (picked.length >= limit) break
      picked.push(e)
      if (t >= TIERS) viaLayout = true
    }
  }
  return {
    games: picked.map((e) => ({ appid: e.appid, name: e.name })),
    total,
    layout: viaLayout ? alt : null,
  }
}

/**
 * Какая строка списка выбрана после стрелки. По кругу: с последней вниз —
 * на первую. Из «ничего не выбрано» (−1) вниз — первая, вверх — последняя:
 * так выбор по шаблону комбобокса ARIA, и стрелка вверх из поля сразу
 * достаёт хвост списка. Строк нет — выбирать нечего.
 */
export function stepActive(current: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return -1
  if (key === 'ArrowDown') return current < 0 || current >= count - 1 ? 0 : current + 1
  return current <= 0 || current >= count ? count - 1 : current - 1
}

/** Где индекс: не просили, едет, приехал, не доехал (lib/catalogindex) */
export type SearchPhase = 'idle' | 'loading' | 'ready' | 'failed'

/**
 * Строка статуса под полем — её же объявляет скринридер (StatusLine).
 *
 * Пустой запрос — пустая строка: говорить не о чем, и область молчит, пока
 * человек не начал набирать. Отказ — наоборот, звучит и без запроса: поиск
 * без каталога мёртв, и кнопка «Попробовать снова» стоит рядом.
 *
 * «Ничего не нашлось» на русский запрос — с подсказкой: каталог латиницей, и
 * «ведьмак» не найдёт ничего не потому, что игры нет.
 */
export function searchStatus(phase: SearchPhase, query: string, found: SearchResult): string {
  if (phase === 'failed') return 'Каталог не загрузился — проверь связь и попробуй ещё раз'
  if (!foldTitle(query)) return ''
  if (phase !== 'ready') return 'Загружаю каталог…'
  const { total } = found
  if (total === 0) {
    return hasCyrillic(query)
      ? 'Ничего не нашлось. Названия здесь — как в Steam, обычно латиницей'
      : 'Ничего не нашлось'
  }
  const verb = plural(total, 'Нашлась', 'Нашлись', 'Нашлось')
  const noun = plural(total, 'игра', 'игры', 'игр')
  const via = found.layout ? ` по «${found.layout}»` : ''
  const more = total > found.games.length ? `, вот первые ${found.games.length}` : ''
  return `${verb} ${total} ${noun}${via}${more}`
}
