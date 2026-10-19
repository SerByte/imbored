import { hasCyrillic } from './cyrillic'
import { foldTitle } from './foldtitle'
import { fmtNumber, pl, tr, type Locale } from './i18n'
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
 *
 * alt — второе название: русское из магазина Steam (games.name_ru), когда
 * оно у игры своё и не сворачивается в то же, что английское. Ключ — номер
 * строки в ids и names, а не appid: ключ короче. Колонка редкая — у сотни
 * игр из шести тысяч, — поэтому не третий массив на все строки, где почти
 * всё было бы пустым, а словарь только с ними; нет ни одного — нет и поля.
 *
 * Весит оно мало. Замер по копии прода от 24 сентября — 5919 игр индекса,
 * у 34 из них второе название, а английские взяты из локального каталога:
 * с одними английскими индекс — 78.0 КБ gzip и 67.6 КБ br, со вторыми —
 * 79.3 и 68.5, то есть ~37 байт gzip (~28 br) на название. На сотню вторых
 * названий — ~4 КБ gzip, 5% индекса. Читатель старше поля его просто не
 * видит и ищет по одному названию, как прежде.
 */
export type SearchIndexWire = { ids: number[]; names: string[]; alt?: Record<number, string> }

/**
 * Свёрнутое название в том виде, в каком его сверяет tierOf: у строки
 * индекса таких одно или два (SearchEntry.alt) — и каждое считается раз при
 * чтении индекса.
 */
export type SearchKey = {
  /** foldTitle(name) с пробелом спереди: «начало слова» — это ' ' + слово */
  hay: string
  /**
   * Название слитно, без пробелов свёртки: «Half-Life 2» — «halflife2»,
   * «S.T.A.L.K.E.R. 2» — «stalker2». По нему находится набранное слитно
   * («halflife», «stalker», «spiderman») — с начал из words и spaced, см.
   * tierOf.
   *
   * И оно же сито: слово запроса, которого нет даже здесь, не подходит ни на
   * одной ступени, а это почти все строки индекса на каждую клавишу. Сверка
   * по короткому tight — самая дешёвая, и остальное считается только у
   * прошедших его.
   */
  tight: string
  /**
   * Где в tight начинаются слова свёртки — и через пробел, и через знак:
   * «Half-Life 2» — [0, 4, 8], «To the Moon» — [0, 2, 5]. Граница слов
   * запроса, набранного с начала названия, должна лечь на одно из них:
   * «half life» ложится на 4, а «to t» в «Total War» — на 2, посреди «total».
   */
  words: number[]
  /**
   * Где в tight начинаются слова названия через ПРОБЕЛ: «S.T.A.L.K.E.R. 2:
   * Heart of Chornobyl» — [0, 7, 8, 13, 15], «For The King» — [0, 3, 6].
   * Внутри такого слова знаки названия слитный запрос проходит свободно
   * («stalker», «halflife»), а через пробел — только ступенью 3 («dota2»), и
   * начинается слитное только здесь, а не с буквы посреди акронима: «ker» —
   * не «S.T.A.L.K.E.R.», «ear» — не «F.E.A.R.». Ступени — у tierOf.
   *
   * Оба массива считаются раз при чтении индекса (замер у readSearchIndex) и
   * живут только во вкладке, где поиск открывали (lib/catalogindex).
   */
  spaced: number[]
}

/** Строка индекса в браузере: свёрнутое название посчитано один раз при чтении */
export type SearchEntry = SearchKey & {
  appid: number
  /** Английское название магазина — им строка списка и называет игру */
  name: string
  /**
   * Русское название, если у игры оно другое (SearchIndexWire.alt). Ищется
   * наравне с name — берётся лучшая ступень из двух (collect), — а
   * показывается, только когда нашло лучше английского (SearchHit.alias).
   */
  alt?: SearchKey & { name: string }
}

/** Где начинается каждый кусок, если их склеить подряд: ['half', 'life', '2'] — [0, 4, 8] */
function startsOf(parts: string[]): number[] {
  const out: number[] = []
  let at = 0
  for (const part of parts) {
    if (!part) continue
    out.push(at)
    at += part.length
  }
  return out
}

/**
 * spaced для названия (см. SearchEntry): каждое слово через пробел
 * сворачивается отдельно, и его длина в tight — длина свёрнутого без
 * пробелов. Свёртка посимвольная, так что куски в сумме дают ровно tight
 * (сверено на всех 5816 названиях локальной копии каталога); слово, от
 * которого свёртка не оставила ничего («-», «&», «™»), места в tight не
 * занимает и начала не даёт.
 *
 * Слово из одних латинских букв и цифр — а таких 15 тысяч из 18 — свёртка
 * в длине не меняет, и его не сворачивают: со свёрткой каждого слова spaced
 * считался вдвое дольше (3 мс на 5816 названий против 1.5, Node, замер по
 * локальной копии каталога).
 */
function spacedOf(name: string): number[] {
  return startsOf(name.split(/\s+/).map((word) => (PLAIN.test(word) ? word : foldTitle(word).replace(/ /g, ''))))
}

const PLAIN = /^[a-z0-9]*$/i

export type SearchHit = {
  appid: number
  name: string
  /**
   * Русское название — только если игра нашлась по нему лучше, чем по
   * английскому: на «ведьмак» строка «The Witcher 3: Wild Hunt» без слова
   * «ведьмак» выглядела бы чужой находкой. Строка списка ставит его вторым
   * рядом (components/CatalogSearch). Поля нет — нашлось по английскому.
   */
  alias?: string
}

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

/**
 * Строки базы → провод. Пустое после чистки название не едет: его не найти и
 * не показать. Второе название (nameRu) едет, только если свёрнутым оно не
 * то же, что первое: «ЕСТЬ ДВА СТУЛА» при нём же или «BioShock» при «BioShock™»
 * ничего не добавят поиску, а вес — добавят.
 */
export function encodeSearchIndex(
  rows: Array<{ appid: number; name: string; nameRu?: string | null }>,
): SearchIndexWire {
  const ids: number[] = []
  const names: string[] = []
  const alt: Record<number, string> = {}
  let alts = 0
  for (const r of rows) {
    const name = clean(r.name)
    if (!name) continue
    const ru = r.nameRu ? clean(r.nameRu) : ''
    const ruFolded = ru && foldTitle(ru)
    if (ruFolded && ruFolded !== foldTitle(name)) {
      alt[ids.length] = ru
      alts++
    }
    ids.push(r.appid)
    names.push(name)
  }
  return alts ? { ids, names, alt } : { ids, names }
}

/** Свёртка и границы слов одного названия; null — свёртка не оставила ничего */
function keyOf(name: string): SearchKey | null {
  const folded = foldTitle(name)
  if (!folded) return null
  const words = folded.split(' ')
  return { hay: ` ${folded}`, tight: words.join(''), words: startsOf(words), spaced: spacedOf(name) }
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
 *
 * Свёртка и границы слов (SearchEntry) считаются здесь, раз на вкладку, а не
 * на клавишу: ~7 мс на 5816 играх (Node, замер по локальной копии каталога).
 *
 * Второе название (alt) — необязательное: не тот вид у словаря целиком или у
 * одного названия — строка читается с одним английским, как прежде. Из-за
 * второго названия не терять ни строки, ни поиска.
 */
export function readSearchIndex(body: unknown): SearchEntry[] | null {
  if (!body || typeof body !== 'object') return null
  const { ids, names, alt } = body as Partial<SearchIndexWire>
  if (!Array.isArray(ids) || !Array.isArray(names) || ids.length !== names.length) return null
  const alts: Record<number, unknown> = alt && typeof alt === 'object' && !Array.isArray(alt) ? alt : {}
  const out: SearchEntry[] = []
  for (let i = 0; i < ids.length; i++) {
    const appid = ids[i]
    const name = names[i]
    if (!Number.isInteger(appid) || appid <= 0 || typeof name !== 'string') continue
    const key = keyOf(name)
    if (!key) continue
    const ru = alts[i]
    const ruKey = typeof ru === 'string' ? keyOf(ru) : null
    const entry: SearchEntry = { appid, name, ...key }
    if (ruKey) entry.alt = { name: ru as string, ...ruKey }
    out.push(entry)
  }
  return out.length ? out : null
}

/**
 * ЙЦУКЕН → QWERTY по клавишам: «цшесрук» — это «witcher», набранный в русской
 * раскладке. Самая частая ошибка русскоязычного набора латинского названия, а
 * каталог почти целиком латиницей: названия — английские, как в магазине
 * Steam, а русское второе (SearchIndexWire.alt) есть лишь у сотни игр из
 * шести тысяч — у тех, кому его дал сам Steam. null — в запросе нет русских
 * букв, переводить нечего.
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
 * Остались ли от запроса в QWERTY одни обрывки. alt — запрос в QWERTY
 * свёрнутый: в нём нет ни одного слова от трёх букв, а в запросе есть буква
 * на клавише знака (б ю ж х ъ э ё) — знак, в который она перешла, режет
 * слово или стирается свёрткой вместе с буквой.
 *
 * Так выглядит не перепутанная раскладка, а русское слово: «баба» — «,f,f»,
 * то есть «f f», «ёжик» — «br», «эхо» — «j», «её» — «t». Обрывок в одну-две
 * буквы — начало слова в сотнях названий, и строка статуса говорила «Нашлось
 * 119 игр по «,f,f»».
 *
 * Обрывки рядом со словом от трёх букв — не помеха, и такой запрос ищется.
 * Знак в настоящих названиях стоит и после короткого слова — «Mr. Prepper»,
 * «Plants vs. Zombies», «Warhammer 40,000», «S.T.A.L.K.E.R. 2: Heart of…», —
 * а апостроф свёртка стирает вместе с буквой э, и короткое слово остаётся
 * целым: «Шэь щт Щиыукмфешщт Вген» — «im on observation duty». Прежде
 * хватало одного обрывка в любом слове, и все эти названия, набранные не в
 * той раскладке, отвечали «Ничего не нашлось». Длинное слово сужает выдачу
 * само: ступени раскладки (0–3) требуют, чтобы каждое слово запроса
 * начиналось там, где слово названия, и случайное «zuf» из «баба яга» не
 * начинает ни одного.
 *
 * Короткий запрос без знаковых букв — не обрывки: «ц» — первая клавиша
 * «цшесрук», а «Ф» в «Ф Цфн Щге» — слово «A» из «A Way Out», и оба ищутся.
 * Проигрыш — начало названия со знаком, пока длинного слова ещё нет: «Ькю»
 * («mr.») молчит до «Ькю Зку» («mr pre»); и акроним с точками, набранный в
 * русской раскладке («АюУюФюКю»), — без точек («ауфк») он находится.
 */
function brokenByLayout(query: string, alt: string): boolean {
  if (alt.split(' ').some((word) => word.length >= 3)) return false
  return [...query.toLowerCase()].some((c) => ON_SIGN_KEYS.has(c))
}

/**
 * Насколько хорошо название подходит запросу; меньше — лучше, null — не подходит.
 *
 *   0 — название целиком и есть запрос: «doom» → «DOOM», а не «DOOM Eternal»,
 *       у которого отзывов больше; «fear» → «F.E.A.R.»;
 *   1 — название начинается с запроса: человек набирает с начала (fromStart);
 *   2 — каждое слово запроса начинается там, где слово названия: «witcher 3»
 *       → «The Witcher 3: Wild Hunt», «spiderman» → «Marvel's Spider-Man»;
 *       или весь запрос слитно начинается там: «cyber punk» → «Cyberpunk
 *       2077», «s.t.a.l.k.e.r» → «Stalker Online»;
 *   3 — то же, но слитно через пробел названия: «dota2» → «Dota 2»,
 *       «witcher3» → «The Witcher 3», «pay day 2» → «PAYDAY 2»;
 *   4 — каждое слово запроса где-то в названии (matchesTitle, как на стене
 *       /library): «witch» → «Bewitched Forest».
 *
 * ЗНАКИ НАЗВАНИЯ внутри его слова (между пробелами) не считаются ни на одной
 * ступени: «stalker 2» → «S.T.A.L.K.E.R. 2» ступенью 1, «halflife» →
 * «Half-Life 2» — тоже, «fear» → «F.E.A.R.» — ступенью 0. Свёртка делает
 * точки и дефис разделителем, и без этого набранное слитно не находилось
 * вовсе: «s t a l k e r» не содержит «stalker».
 *
 * ПРОБЕЛ НАЗВАНИЯ — считается: слитно через него — ступень 3, ниже любого
 * настоящего начала слова. Иначе слово, набранное с начала, — самый частый
 * набор — находило бы чужие названия, склеенные через пробел, наравне со
 * своими и по отзывам выше них: «fort» — «For The King» над «Fort Solis»,
 * «theme» — «The Messenger» над «Theme Park Manager», «them» — «Halo: The
 * Master Chief Collection» над «…Save Them». Совсем без склейки через пробел
 * не нашлись бы «dota2» и «witcher3».
 *
 * Слитно — только с начала слова через пробел (SearchEntry.spaced), а не с
 * буквы посреди него: «ker» не находит «S.T.A.L.K.E.R.», «ear» — «F.E.A.R.»,
 * «fear» — «Cafe Arcade» (слитно — «cafearcade»). Буква акронима — слово
 * свёртки, но «ker» — хвост «stalker», а не начало чего-то в названии. Слово
 * запроса, которое умещается в слово свёртки, по-прежнему ищется с любого
 * его начала: «life» → «Half-Life», «man» → «Spider-Man», как по hay.
 *
 * Ступени 0–1 требуют ещё, чтобы граница слов запроса легла на границу слов
 * названия (SearchEntry.words): «to t» — это «To the Moon», а не «Total War»,
 * хотя слитно оба начинаются с «tot»; «a s» — «A Short Hike», а не
 * «Assassin's Creed». Пробел запроса при этом вправе лечь на знак названия:
 * «half life» — ступень 1 у «Half-Life 2».
 *
 * Знаки и пробелы ЗАПРОСА тоже не обязаны совпадать со знаками названия:
 * свёртка — с обеих сторон. Слитное название, набранное раздельно («cyber
 * punk», «pay day 2») или с точками («s.t.a.l.k.e.r»), находится запросом
 * слитно — но только ступенью 2–3 и только если по словам не нашлось. Иначе
 * «dark s» — человек, набирающий «dark souls», — ставил бы рядом с ним
 * «Darksiders» (слитно — тоже «darks…»), а по отзывам и выше.
 *
 * Внутри ступени — порядок индекса, то есть число отзывов.
 */
function tierOf(e: SearchKey, q: Wanted): number | null {
  // Сито (см. tight): каждое слово запроса — хотя бы где-то в названии слитно.
  // Это нужно любой ступени, а сверка по короткому tight — самая дешёвая
  if (!q.words.every((w) => e.tight.includes(w))) return null
  if (fromStart(e, q)) return e.tight === q.tight ? 0 : 1
  const each = q.words.map((w, i) => (e.hay.includes(q.heads[i]) ? 2 : gluedTier(e, w)))
  if (!each.includes(null)) return Math.max(...(each as number[]))
  // Запрос из одного слова слитно — он сам, и его уже сверили выше
  const glued = q.words.length > 1 ? gluedTier(e, q.tight) : null
  if (glued !== null) return glued
  return q.words.every((w) => e.hay.includes(w)) ? 4 : null
}

/**
 * Набран ли запрос с начала названия (ступени 0–1, см. tierOf): название
 * слитно начинается с запроса слитно, каждая граница слов запроса — на
 * границе слов названия, а пробел названия внутри набранного — только там,
 * где пробел запроса.
 */
function fromStart(e: SearchKey, q: Wanted): boolean {
  if (!e.tight.startsWith(q.tight)) return false
  if (!q.cuts.every((at) => e.words.includes(at))) return false
  return e.spaced.every((at) => at === 0 || at >= q.tight.length || q.cuts.includes(at))
}

/**
 * Идёт ли s слитно с начала слова названия через пробел (см. tierOf): 2 —
 * умещаясь в это слово, через его знаки («spiderman» в «Spider-Man»), 3 —
 * дальше, через пробел («dota2» в «Dota 2»), null — ни с какого.
 */
function gluedTier(e: SearchKey, s: string): 2 | 3 | null {
  let tier: 3 | null = null
  for (let i = 0; i < e.spaced.length; i++) {
    const at = e.spaced[i]
    if (!e.tight.startsWith(s, at)) continue
    if (at + s.length <= (e.spaced[i + 1] ?? e.tight.length)) return 2
    tier = 3
  }
  return tier
}

/**
 * Свёрнутый запрос в том виде, в каком его сверяет tierOf, — посчитан раз на
 * клавишу, а не на каждую из шести тысяч строк.
 */
type Wanted = {
  /** Слова запроса — для сита (по tight) и ступени 4 (по hay) */
  words: string[]
  /** ' ' + каждое слово: слово свёртки названия начинается с него (hay) */
  heads: string[]
  /** Запрос слитно */
  tight: string
  /** Где в tight запроса начинаются его слова, кроме первого: «to t» — [2] */
  cuts: number[]
}

function wanted(folded: string): Wanted {
  const words = folded.split(' ')
  return { words, heads: words.map((w) => ` ${w}`), tight: words.join(''), cuts: startsOf(words).slice(1) }
}

/**
 * Один проход по индексу: первые limit по ступени не хуже worst, при равной
 * ступени — по порядку индекса, и сколько нашлось всего.
 *
 * У строки с двумя названиями ступень — лучшая из двух: «ведьмак 3» с
 * начала русского названия — ступень 1, как «witcher 3» у английского. И
 * игра одна, сколько бы её названий ни подошло: строка в списке одна и в
 * total считается раз. Второе название сверяется всего у сотни строк, так
 * что проход на клавишу не дорожает.
 */
function collect(index: SearchEntry[], folded: string, limit: number, worst: number) {
  const q = wanted(folded)
  const buckets: SearchHit[][] = [[], [], [], [], []]
  let total = 0
  for (const e of index) {
    const main = tierOf(e, q)
    const ru = e.alt ? tierOf(e.alt, q) : null
    const viaRu = ru !== null && (main === null || ru < main)
    const tier = viaRu ? ru : main
    if (tier === null || tier > worst) continue
    total++
    if (buckets[tier].length >= limit) continue
    const hit: SearchHit = { appid: e.appid, name: e.name }
    if (viaRu && e.alt) hit.alias = e.alt.name
    buckets[tier].push(hit)
  }
  return { games: buckets.flat().slice(0, limit), total }
}

/**
 * Поиск по индексу: первые limit по ступени совпадения, при равной — по
 * порядку индекса.
 *
 * Запрос ищется как набран (русские названия в каталоге есть — вторые, см.
 * SearchIndexWire.alt), а в QWERTY — только если как набран не нашлось
 * НИЧЕГО. Прежде переведённый искали всегда и ставили следом за найденным,
 * но запрос, который что-то нашёл, — не перепутанная раскладка, и перевод
 * добавлял к нему один шум. Раскладка — спасение пустого ответа.
 *
 * И переведённый — только по началам слов (ступени 0–3): раскладку
 * перепутали, но слово набирали с начала, а двухбуквенное «да» в QWERTY —
 * «lf», и оно сидит внутри «Half-Life». Запрос, от которого в QWERTY
 * остались одни обрывки (brokenByLayout), не ищется вовсе: «баба» — это не
 * «f f».
 *
 * Проход по индексу на клавишу, второй — только при пустом первом: шесть
 * тысяч строк и includes по короткому tight на каждую, а границы слов — лишь
 * у прошедших его, — доли миллисекунды (0.17 мс в среднем на 5816 играх и
 * запросах-префиксах, Node, замер по локальной копии каталога; прежнее
 * сравнение по одному hay — 0.21). Отдельный воркер или дебаунс здесь не
 * нужны.
 */
export function searchCatalog(index: SearchEntry[], query: string, limit = SEARCH_SHOWN): SearchResult {
  const phrase = foldTitle(query)
  if (!phrase) return { games: [], total: 0, layout: null }
  const typed = collect(index, phrase, limit, 4)
  const ru = typed.total ? null : fromRuLayout(query)
  const alt = ru === null ? '' : foldTitle(ru)
  if (!alt || alt === phrase || brokenByLayout(query, alt)) return { ...typed, layout: null }
  const viaLayout = collect(index, alt, limit, 3)
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
 * «Ничего не нашлось» на русский запрос — с подсказкой. По-русски ищутся
 * только русские названия, которые игре дал сам Steam (SearchIndexWire.alt),
 * а их у сотни игр из шести тысяч: «Ведьмак 3» найдётся, а «гонки» или
 * «скайрим» — нет, и не потому, что игры нет. Прежняя подсказка —
 * «названия здесь… обычно латиницей» — говорила, что по-русски искать
 * незачем вовсе, а это уже не так. На /en подсказка та же: кириллицей там
 * набирают реже, но каталог и вторые названия для них те же.
 *
 * locale — язык окна. По-английски каждая строка — целой фразой, а не
 * склейкой русских кусков: у английского глагол от числа не зависит, зато
 * «1 game» и «3 games» — разные слова. Число — с разрядами по-английски
 * («Found 5,816 games»); по-русски оно, как и раньше, без разрядов.
 */
export function searchStatus(phase: SearchPhase, query: string, found: SearchResult, locale: Locale = 'ru'): string {
  if (phase === 'failed') {
    return tr(locale, {
      ru: 'Каталог не загрузился — проверь связь и попробуй ещё раз',
      en: "Couldn't load the catalog — check your connection and try again",
    })
  }
  if (!foldTitle(query)) return ''
  if (phase !== 'ready') return tr(locale, { ru: 'Загружаю каталог…', en: 'Loading the catalog…' })
  const { total } = found
  if (total === 0) {
    return hasCyrillic(query)
      ? tr(locale, {
          ru: 'Ничего не нашлось. Русское название есть не у каждой игры — попробуй как в Steam, латиницей',
          en: 'Nothing found. Not every game has a Russian title — try the Steam name in Latin letters',
        })
      : tr(locale, { ru: 'Ничего не нашлось', en: 'Nothing found' })
  }
  const shown = found.games.length
  const more = total > shown
  if (locale === 'en') {
    const games = `${fmtNumber('en', total)} ${pl('en', total, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })}`
    // Кавычки английские: «ёлочки» — только в русской строке (глоссарий docs/i18n.md)
    const via = found.layout ? ` for “${found.layout}”` : ''
    return `Found ${games}${via}${more ? `, showing the first ${shown}` : ''}`
  }
  const verb = plural(total, 'Нашлась', 'Нашлись', 'Нашлось')
  const noun = plural(total, 'игра', 'игры', 'игр')
  const via = found.layout ? ` по «${found.layout}»` : ''
  return `${verb} ${total} ${noun}${via}${more ? `, вот первые ${shown}` : ''}`
}
