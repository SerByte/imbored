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
 * целиком под полем на экране без клавиатуры, и стрелками его проходят за
 * пару нажатий. Больше — уже листание, а уточнить название быстрее.
 *
 * С открытой клавиатурой телефона восемь строк не влезают: окно с ними —
 * ~470 px, а над клавиатурой у iPhone видно ~400–450, у SE — ~290. Тогда
 * список листается внутри окна, над клавиатурой: окно меряет себя по
 * visualViewport (components/CatalogSearch), а не по 100dvh, которого
 * клавиатура не уменьшает.
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
  /**
   * Название слитно от начала каждого своего слова, через «|»: «Half-Life 2» —
   * «|halflife2|life2|2|», «S.T.A.L.K.E.R. 2» — «|stalker2|talker2|…|2|».
   * «|» + слово запроса здесь — слово, которое начинается там же, где слово
   * названия, но идёт дальше через его знаки и пробелы: «halflife»,
   * «stalker», «spiderman». Ступени — у tierOf.
   *
   * Считается один раз при чтении индекса: ~256 тысяч знаков на 5816 игр и
   * ещё ~94 тысячи у tight (замер по локальной копии каталога) — меньше
   * мегабайта памяти вкладки, и только у той, где поиск открывали
   * (lib/catalogindex).
   */
  runs: string
  /**
   * Название слитно целиком — первый отрезок runs: «Half-Life 2» —
   * «halflife2». Сито tierOf: слово запроса, которого нет даже здесь, не
   * подходит ни на одной ступени, а это почти все строки индекса на каждую
   * клавишу. Без сита каждая из них сверялась с runs — вдвое длиннее hay — и
   * поиск шёл втрое дольше прежнего (замер у searchCatalog).
   */
  tight: string
}

/** runs для свёрнутого названия (см. SearchEntry) */
function runsOf(folded: string): string {
  const words = folded.split(' ')
  let runs = '|'
  for (let i = 0; i < words.length; i++) runs += `${words.slice(i).join('')}|`
  return runs
}

export type SearchHit = { appid: number; name: string }

export type SearchResult = {
  /** Первые SEARCH_SHOWN — по совпадению, при равном — по порядку индекса */
  games: SearchHit[]
  /** Сколько нашлось всего, а не сколько показано */
  total: number
  /**
   * Запрос в QWERTY, если найденное нашлось по нему («цшесрук» → «witcher»):
   * как набран, запрос не нашёл ничего (searchCatalog). Иначе null: говорить
   * о раскладке незачем.
   *
   * Как набран, а не свёрнутый: его видят и слышат в строке статуса, и
   * «ифдвгкэы пфеу» там — «baldur's gate», а не «baldurs gate» свёртки,
   * похожее на опечатку ровно там, где говорят, что искали.
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
 * Пустой индекс — тоже null. Живого каталога без единой игры не бывает, а
 * пустой индекс бывает: его собирает сборка без базы (app/search-index.json,
 * readIndex), и ISR держит его до суток. Прочитанный как «каталог пуст», он
 * сутки отвечал бы «Ничего не нашлось» даже на «Dota 2» — а как отказ это
 * «Каталог не загрузился» с кнопкой повтора: поломка видна поломкой.
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
    out.push({ appid, name, hay: ` ${folded}`, runs: runsOf(folded), tight: folded.replace(/ /g, '') })
  }
  return out.length ? out : null
}

/**
 * ЙЦУКЕН → QWERTY по клавишам: «цшесрук» — это «witcher», набранный в русской
 * раскладке. Самая частая ошибка русскоязычного набора латинского названия, а
 * каталог почти целиком латиницей (русских названий — два на 5816). null —
 * в запросе нет русских букв, переводить нечего.
 *
 * Знаки на месте букв (б → «,», ж → «;», э → «'») тоже переводятся: свёртка
 * затем сделает из них то же, что из знака настоящего названия, — апостроф
 * сотрёт, остальное станет разделителем.
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

/** Русские буквы на клавишах знаков: б ю ж х ъ э ё */
const ON_SIGN_KEYS = new Set(Object.keys(RU_TO_QWERTY).filter((c) => !/[a-z]/.test(RU_TO_QWERTY[c])))

/**
 * Распалось ли слово запроса в QWERTY на обрывки: знак, в который перешла
 * буква на его клавише, отрезал кусок короче трёх букв.
 *
 * Так выглядит не перепутанная раскладка, а русское слово: «баба» — «,f,f»,
 * то есть «f f», «ёжик» — «br», «эхо» — «j». Обрывок в одну-две буквы — начало
 * слова в сотнях названий, и строка статуса говорила «Нашлось 119 игр по
 * «,f,f»». Настоящее название, набранное не в той раскладке, на обрывки не
 * распадается: апостроф свёртка стирает («ифдвгкэы» — «baldurs»), а точка или
 * двоеточие стоят в конце длинного слова.
 *
 * Обрывок — только то, что отрезал знак. Короткое слово целиком — не обрывок:
 * «ц» — первая клавиша «цшесрук», а «Ф» в «Ф Цфн Щге» — слово «A» из «A Way
 * Out», и оба ищутся. Проигрыш один и редкий: акроним с точками, набранный в
 * русской раскладке («АюУюФюКю»), — без точек («ауфк») он находится.
 */
function brokenByLayout(query: string): boolean {
  return query.split(/[^\p{L}\p{N}]+/u).some((word) => {
    const lower = word.toLowerCase()
    if (![...lower].some((c) => ON_SIGN_KEYS.has(c))) return false
    return foldTitle(fromRuLayout(lower) ?? lower)
      .split(' ')
      .some((piece) => piece.length < 3)
  })
}

/**
 * Насколько хорошо название подходит запросу; меньше — лучше, null — не подходит.
 *
 *   0 — название целиком и есть запрос: «doom» → «DOOM», а не «DOOM Eternal»,
 *       у которого отзывов больше; «fear» → «F.E.A.R.»;
 *   1 — название начинается с запроса: человек набирает с начала;
 *   2 — каждое слово запроса начинается там, где слово названия: «witcher 3»
 *       → «The Witcher 3: Wild Hunt», «spiderman» → «Marvel's Spider-Man»;
 *       или весь запрос слитно начинается там: «cyber punk» → «Cyberpunk
 *       2077», «s.t.a.l.k.e.r» → «Stalker Online»;
 *   3 — каждое слово запроса где-то в названии (matchesTitle, как на стене
 *       /library): «witch» → «Bewitched Forest».
 *
 * Ступени 0–2 — по runs, то есть знаки и пробелы НАЗВАНИЯ не считаются:
 * «stalker 2» → «S.T.A.L.K.E.R. 2», «halflife» → «Half-Life 2», «dota2» →
 * «Dota 2». Свёртка делает точки и дефис разделителем, и без этого набранное
 * слитно не находилось вовсе: «s t a l k e r» не содержит «stalker». Начало
 * слова запроса при этом — всегда начало слова названия: слитно — через знаки
 * СВОЕГО слова, а не с середины чужого, иначе «fear» нашёл бы «Cafe Arcade»
 * (слитно — «cafearcade»). Где слова названия и запроса совпадают, ступени
 * те же, что были у сравнения по hay с пробелами.
 *
 * Знаки и пробелы ЗАПРОСА тоже не обязаны совпадать со знаками названия:
 * свёртка — с обеих сторон. Слитное название, набранное раздельно («cyber
 * punk», «pay day 2») или с точками («s.t.a.l.k.e.r»), находится запросом
 * слитно — но только ступенью 2 и только если по словам не нашлось. Иначе
 * «dark s» — человек, набирающий «dark souls», — ставил бы рядом с ним
 * «Darksiders» (слитно — тоже «darks…»), а по отзывам и выше.
 *
 * Внутри ступени — порядок индекса, то есть число отзывов.
 */
function tierOf(e: SearchEntry, q: Wanted): number | null {
  // Сито (см. tight): каждое слово запроса — хотя бы где-то в названии слитно.
  // Это нужно любой ступени, а сверка по короткому tight — самая дешёвая
  if (!q.words.every((w) => e.tight.includes(w))) return null
  if (q.starts.every((s) => e.runs.includes(s))) {
    if (e.runs.startsWith(q.whole)) return 0
    if (e.runs.startsWith(q.glued)) return 1
    return 2
  }
  // Запрос из одного слова слитно — он сам, и его уже сверили выше
  if (q.words.length > 1 && e.runs.includes(q.glued)) return 2
  return q.words.every((w) => e.hay.includes(w)) ? 3 : null
}

/**
 * Свёрнутый запрос в том виде, в каком его сверяет tierOf, — посчитан раз на
 * клавишу, а не на каждую из шести тысяч строк.
 */
type Wanted = {
  /** Слова запроса — для ступени 3, по hay */
  words: string[]
  /** «|» + каждое слово: слово названия начинается с него (runs) */
  starts: string[]
  /** «|» + запрос слитно: с него начинается слово названия */
  glued: string
  /** glued + «|»: название слитно целиком и есть запрос */
  whole: string
}

function wanted(folded: string): Wanted {
  const words = folded.split(' ')
  const glued = `|${words.join('')}`
  return { words, starts: words.map((w) => `|${w}`), glued, whole: `${glued}|` }
}

/**
 * Один проход по индексу: первые limit по ступени не хуже worst, при равной
 * ступени — по порядку индекса, и сколько нашлось всего.
 */
function collect(index: SearchEntry[], folded: string, limit: number, worst: number) {
  const q = wanted(folded)
  const buckets: SearchEntry[][] = [[], [], [], []]
  let total = 0
  for (const e of index) {
    const tier = tierOf(e, q)
    if (tier === null || tier > worst) continue
    total++
    if (buckets[tier].length < limit) buckets[tier].push(e)
  }
  const games = buckets
    .flat()
    .slice(0, limit)
    .map((e) => ({ appid: e.appid, name: e.name }))
  return { games, total }
}

/**
 * Поиск по индексу: первые limit по ступени совпадения, при равной — по
 * порядку индекса.
 *
 * Запрос ищется как набран (русские названия в каталоге есть), а в QWERTY —
 * только если как набран не нашлось НИЧЕГО. Прежде переведённый искали
 * всегда и ставили следом за найденным, но запрос, который что-то нашёл, —
 * не перепутанная раскладка, и перевод добавлял к нему один шум. Раскладка —
 * спасение пустого ответа.
 *
 * И переведённый — только по началам слов (ступени 0–2): раскладку
 * перепутали, но слово набирали с начала, а двухбуквенное «да» в QWERTY —
 * «lf», и оно сидит внутри «Half-Life». Запрос, распавшийся в QWERTY на
 * обрывки (brokenByLayout), не ищется вовсе: «баба» — это не «f f».
 *
 * Проход по индексу на клавишу, второй — только при пустом первом: шесть
 * тысяч строк и несколько includes на каждую — доли миллисекунды (0.18 мс в
 * среднем на 5816 играх и запросах-префиксах, Node, замер по локальной копии
 * каталога; до runs было 0.21, с runs без сита tight — 0.6), отдельный
 * воркер или дебаунс здесь не нужны.
 */
export function searchCatalog(index: SearchEntry[], query: string, limit = SEARCH_SHOWN): SearchResult {
  const phrase = foldTitle(query)
  if (!phrase) return { games: [], total: 0, layout: null }
  const typed = collect(index, phrase, limit, 3)
  const ru = typed.total ? null : fromRuLayout(query)
  const alt = ru === null || brokenByLayout(query) ? '' : foldTitle(ru)
  if (!alt || alt === phrase) return { ...typed, layout: null }
  const viaLayout = collect(index, alt, limit, 2)
  return {
    ...viaLayout,
    // Искали свёрнутым (alt), а называем — как набрано, с апострофами и дефисами
    layout: viaLayout.total && ru ? clean(ru) : null,
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
