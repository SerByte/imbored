/**
 * Куда человек шёл, когда его развернуло на лендинг.
 *
 * Половина продукта требует подключённой библиотеки, и пять экранов из шести
 * разворачивали гостя на главную МОЛЧА: нажал «Игра дня» — страница
 * подменилась лендингом, и ни слова о том, почему. Это тот же дефект, что
 * молчаливая кнопка «скопировать»: действие произошло, ответа нет. Только
 * здесь он встречает человека на первом же клике по навигации.
 *
 * Шестой экран, /room/new, разворачивал с `?error=nosession` и обещал «вернём
 * тебя в пати» — а возвращал на /quiz, потому что вернуть было нечем. Тут
 * появляется чем.
 *
 * СПИСОК, а не свободный путь. Соблазн принять произвольный ?next= велик, но
 * это открытый редирект: достаточно прислать /?next=//зло.example, и лендинг
 * своими руками уведёт человека наружу. Набор мест, откуда разворачивают,
 * закрытый и известен целиком — значит и список закрытый. Тексты к адресам
 * лежат рядом, в lib/destinationtext.ts, и разъехаться со списком им не даёт
 * тип (satisfies там).
 *
 * Хвост запроса едет тоже, но так же по списку — см. destinationUrl.
 *
 * ЯЗЫК. Адрес назначения бывает и английским: /en/play, /en/library. Раньше
 * список знал только русские пути, и ?next=/en/play отбрасывался целиком —
 * гость с английской выдачи после входа попадал на русский квиз. Теперь путь
 * сверяется со списком без префикса языка, а язык едет рядом: в самом адресе
 * (destinationUrl оставляет /en/…), в адресе лендинга (/en?next=/play) или
 * параметром lang у входа через Steam (loginCarry). next в лендинге и во
 * входе — всегда без языка: язык там — у лендинга и у lang.
 *
 * Импорты — разбор настроения из lib/mood, пресеты комнаты и разбор затравки
 * из lib/presets (у них самих — только такой же чистый lib/i18n) и lib/i18n:
 * модуль читают и серверные страницы, и клиентский лендинг, и роут возврата
 * из Steam, и proxy.ts.
 */

import { DEFAULT_LOCALE, LOCALES, lp, splitLocale, toLocale, type Locale } from './i18n'
import { parseLean, parseMood } from './mood'
import { parseGenreParam, parseSeedParam, roomPresetByKey, roomSeedOf } from './presets'

/**
 * Места назначения — закрытый список (см. выше). Тексты лендинга к ним — в
 * lib/destinationtext.ts, отдельно: здесь только адреса, потому что проверку
 * адреса читают страницы, которые разворачивают гостя или зовут войти, и
 * записка «Режим просмотра» (components/ReadOnlyNoteBox → steamLoginFor), а
 * тексты нужны одному лендингу. В корневом лэйауте модуля больше нет — тело
 * записки едет чанком (lib/sharedchunk.test.ts).
 *
 * /whatsnew гостя не разворачивает — общая лента открыта всем. Здесь он ради
 * возврата из входа через Steam: секретную ссылку на RSS выпускает только
 * вошедший через Steam, и подсказка «войди» у ссылки (steamLoginFor) обязана
 * вернуть туда, где человек её просил, а не на квиз.
 */
export const DESTINATION_PATHS = [
  '/library',
  '/daily',
  '/play',
  '/explore',
  '/portrait',
  '/compat',
  '/room/new',
  '/whatsnew',
] as const

export type DestinationPath = (typeof DESTINATION_PATHS)[number]

/** includes, а не ключ объекта: у списка нет наследованных toString и __proto__ */
const isDestination = (path: string): path is DestinationPath =>
  (DESTINATION_PATHS as readonly string[]).includes(path)

/**
 * Что из строки запроса выдачи едет через вход.
 *
 * Гость проходил квиз, /play разворачивал его на лендинг голым next=/play, и
 * после входа выдача собиралась по дефолтному настроению: три ответа,
 * которые человек только что дал, терялись на первом же шаге. Везём их — но
 * не строку как есть, а заново собранную из проверенных значений: next
 * приходит из адреса, и всё, что не прошло разбор, просто отбрасывается.
 *
 * Настроение — все три оси разом или ничего: /play подставляет дефолты по
 * одной, и половина настроения в адресе стала бы словами, которых человек
 * не говорил. Порядок параметров тот же, что у playHref (lib/presets), —
 * адрес, собранный квизом, проходит сюда без изменений.
 *
 * Затравка «Как «X», но…» (seed) — тоже: гость шёл со страницы игры за
 * похожими на неё, и после входа выдача обязана быть ими, а не обычной.
 * Разбор — parseSeedParam из того же lib/presets: lib/recommend сюда не
 * тянем, модуль читают лендинг и proxy.ts.
 *
 * Жанр (genre) — так же: гость шёл со страницы «Рогалики» за своими
 * рогаликами, и после входа выдача обязана быть ими. Здесь — только форма
 * адреса (parseGenreParam): словарь жанров лендингу и proxy.ts не нужен,
 * незнакомый жанр сервер подбора молча не применит.
 */
function playQuery(src: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams()
  const mood = parseMood({ time: src.get('time'), vibe: src.get('vibe'), social: src.get('social') })
  if (mood) {
    out.set('time', mood.time)
    out.set('vibe', mood.vibe)
    out.set('social', mood.social)
  }
  if (src.get('roulette') === '1') out.set('roulette', '1')
  // Единственный фокус выдачи (Focus в lib/recommend) — здесь строкой, чтобы
  // не тянуть движок рекомендаций в клиентский лендинг
  if (src.get('from') === 'untouched') out.set('from', 'untouched')
  const lean = parseLean(src.get('lean'))
  if (lean) out.set('lean', lean)
  const seed = parseSeedParam(src.get('seed'))
  if (seed !== null) out.set('seed', String(seed))
  const genre = parseGenreParam(src.get('genre'))
  if (genre) out.set('genre', genre)
  return out
}

/**
 * Что из строки запроса новой комнаты едет через вход: выбранное хостом
 * настроение, ключом пресета (ROOM_PRESETS). Хост выбирал его до того, как
 * его развернуло на вход, и после входа комната создаётся сразу с ним — а не
 * заново с вопросом, на который он уже ответил. Чужой ключ отбрасывается.
 *
 * hint — подсказка с /play (roomBridgeHref в lib/presets): точного пресета под
 * настроение выдачи нет, и экран выбора лишь отмечает похожий. Едет через
 * вход наравне с preset — иначе гость, развёрнутый на вход, вернулся бы к
 * выбору без отметки. Вместе с preset не едет: выбранное перекрывает
 * подсказку, комната всё равно создастся сразу.
 *
 * game — игра, в которую звали («Позвать в эту игру», roomSeedOf в
 * lib/presets): гость со страницы игры уходит на вход, и после входа комната
 * обязана создаться с ней первой картой. Едет рядом с любым из двух ключей —
 * это другой вопрос, не «какой вечер», а «с чего начать».
 */
function roomQuery(src: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams()
  const preset = roomPresetByKey(src.get('preset'))
  const hint = roomPresetByKey(src.get('hint'))
  const seed = roomSeedOf(src.get('game'))
  if (preset) out.set('preset', preset.key)
  else if (hint) out.set('hint', hint.key)
  if (seed !== null) out.set('game', String(seed))
  return out
}

/** У кого из мест назначения есть свой хвост запроса */
const QUERY_OF: Record<string, (src: URLSearchParams) => URLSearchParams> = {
  '/play': playQuery,
  '/room/new': roomQuery,
}

/**
 * Место назначения без языка и его язык: '/en/play?time=…' → { en,
 * '/play?time=…' }. null — не место назначения.
 *
 * Список сверяется с путём БЕЗ префикса: '/en/library' — та же библиотека,
 * что '/library'. '/ru/…' — тоже русский: снаружи такого адреса нет, но
 * usePathname на сервере пререндеренной страницы отдаёт именно его
 * (splitLocale в lib/i18n). Префикс — только целым сегментом: '/EN/library',
 * '/en//evil.example' и '/enx/play' мимо.
 *
 * Путь — строго из DESTINATION_PATHS, хвост — только у /play и /room/new и только
 * их параметры (playQuery, roomQuery). У остальных мест хвоста нет, и мусор в
 * нём отбрасывается, а не губит весь адрес: человек всё равно шёл в
 * библиотеку. Результат собирается заново из проверенного, поэтому его можно
 * класть и в next, и в редирект.
 */
function bareDestination(
  raw: string | null | undefined,
): { locale: Locale; path: DestinationPath; url: string } | null {
  if (!raw) return null
  const cut = raw.indexOf('?')
  const { locale, path } = splitLocale(cut < 0 ? raw : raw.slice(0, cut))
  if (!isDestination(path)) return null
  const tail = Object.hasOwn(QUERY_OF, path) ? QUERY_OF[path] : null
  const query = cut >= 0 && tail ? tail(new URLSearchParams(raw.slice(cut + 1))) : null
  return { locale, path, url: query?.size ? `${path}?${query}` : path }
}

/**
 * Проверенный адрес назначения вместе с разрешённым хвостом запроса либо null.
 *
 * Язык адреса сохраняется: '/en/play?…' → '/en/play?…', русский — без
 * префикса, как был ('/ru/play' → '/play'). Остальное — в bareDestination.
 */
export function destinationUrl(raw: string | null | undefined): string | null {
  const d = bareDestination(raw)
  return d ? lp(d.locale, d.url) : null
}

/**
 * Место назначения — из DESTINATION_PATHS — из адреса, в том числе с хвостом,
 * либо null. Адрес принимается и с языком, но место отдаётся БЕЗ него:
 * '/en/play?…' → '/play'.
 *
 * Без языка — потому что это ключ: место ищут в текстах лендинга
 * (DESTINATIONS в lib/destinationtext), а там ключи без префикса. Отдай мы
 * '/en/library', карточка входа не нашла бы текста, и на /?next=/en/library
 * обещание над заголовком (destinationPromise) говорило бы про библиотеку, а
 * кнопка — общее «Подобрать игру», хотя вела бы в библиотеку. Куда вести —
 * решает destinationUrl, он язык сохраняет; язык места — splitLocale от него.
 */
export function destinationPath(raw: string | null | undefined): DestinationPath | null {
  return bareDestination(raw)?.path ?? null
}

/**
 * Адрес лендинга, который помнит, куда человек шёл.
 *
 * search — текущая строка запроса страницы: с ней /play везёт через вход
 * настроение квиза, а не одно только «шёл в выдачу».
 *
 * Лендинг — на языке места: '/en/play' → '/en?next=%2Fplay'. next — без
 * языка, его язык уже у лендинга (так же разворачивает и guestBounce). Чужой
 * адрес — голая главная того же языка: гостя с /en/… не уводим на русскую.
 */
export function bounceTo(
  path: DestinationPath | string,
  search?: { toString(): string } | null,
): string {
  const query = search?.toString() ?? ''
  const d = bareDestination(query ? `${path}?${query}` : path)
  const locale = d?.locale ?? (typeof path === 'string' ? splitLocale(path.split('?', 1)[0]).locale : DEFAULT_LOCALE)
  return lp(locale, d ? `/?next=${encodeURIComponent(d.url)}` : '/')
}

/**
 * Серверные страницы, которые без сессии разворачивают гостя на лендинг.
 *
 * Сами страницы делают это redirect()'ом, но у /library свой loading.tsx: он
 * успевает отдать каркас раньше, чем страница прочла куку, и статус 200 уже
 * ушёл. Вместо 307 гость получал страницу с мета-обновлением, а краулер —
 * «страницу» из шапки и каркаса. Поэтому разворот стоит в proxy.ts, ДО
 * рендера, где статус ещё можно выбрать.
 *
 * Ровно адреса хабов: /compat/<steamid> и /portrait/<steamid> — публичные
 * страницы, по ним приходят из чужого чата без всякой сессии.
 *
 * /daily, /play и /room/new здесь нет: это клиентские страницы, они
 * разворачивают сами, после ответа сервера про библиотеку.
 *
 * GUEST_HUBS — сами хабы, адресом без языка (их и знает лендинг, см.
 * DESTINATION_PATHS); GUEST_BOUNCE — те же хабы на каждом языке, ровно то,
 * на чём стоит matcher в proxy.ts.
 */
export const GUEST_HUBS: readonly DestinationPath[] = ['/library', '/compat', '/portrait']

export const GUEST_BOUNCE: readonly string[] = LOCALES.flatMap((locale) => GUEST_HUBS.map((hub) => lp(locale, hub)))

/**
 * Куда развернуть гостя до рендера, либо null — пропустить к странице.
 *
 * Решает только НАЛИЧИЕ куки, подпись здесь не проверяется: прокси не тянет
 * базу и секрет (см. lib/origin.ts). Протухшую или поддельную куку ловит
 * сама страница тем же redirect(bounceTo(…)) — это редкий случай, и платит
 * за него только он.
 *
 * Лендинг — на языке хаба: гость с /en/library попадает на /en?next=…, а
 * не на русскую главную. next — адрес без языка, как у bounceTo; префикс к
 * нему ставит уже сам лендинг.
 */
export function guestBounce(pathname: string, hasSession: boolean): string | null {
  if (hasSession || !GUEST_BOUNCE.includes(pathname)) return null
  const { locale, path } = splitLocale(pathname)
  return lp(locale, bounceTo(path))
}

const JOIN_RE = /^[A-Z0-9]{6}$/
const COMPAT_RE = /^\d{17}$/

/**
 * Что везти через вход в Steam: код пати, чью совместимость смотреть или
 * куда человек шёл. Ровно одно — в этом порядке, — и только проверенное.
 *
 * Одна функция на старт входа, успешный возврат и КАЖДЫЙ отказ. Раньше
 * отказы разворачивали на голый /?error=…: друга со скрытой библиотекой звали
 * в пати, он получал ?error=private, открывал доступ по инструкции, жал
 * «Войти через Steam» ещё раз — и попадал на /quiz, потому что код комнаты
 * остался только в чате. Возвращается query без «?», пустой — если нечего.
 *
 * Язык места едет через Steam рядом с ним. next с префиксом ('/en/play')
 * становится next без языка и lang=en: язык входа старт читает из ?lang=
 * (app/api/auth/steam), возврат — из того же lang в return_to, и оба ведут
 * на страницу этого языка. Голый ?lang= сюда не копируется: его ставит и
 * читает сам роут, а отказ, собранный из этой функции, иначе нёс бы lang в
 * адресе лендинга, у которого язык и так в пути.
 */
export function loginCarry(search: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams()
  const join = search.get('join')
  const compat = search.get('compat')
  const next = bareDestination(search.get('next'))
  if (join && JOIN_RE.test(join)) out.set('join', join)
  else if (compat && COMPAT_RE.test(compat)) out.set('compat', compat)
  else if (next) {
    out.set('next', next.url)
    if (next.locale !== DEFAULT_LOCALE) out.set('lang', next.locale)
  }
  return out
}

/**
 * Ссылка «войди через Steam», которая вернёт человека туда, где он нажал.
 *
 * Нужна сессии, которой писать нельзя (вошла по вставленной ссылке, см.
 * isWriter в lib/server): подсказка «войди через Steam» обязана вести не на
 * квиз, а обратно — на ту же выдачу, в ту же библиотеку, в ту же комнату.
 * Путь комнаты едет как join, место из DESTINATION_PATHS — как next (у выдачи —
 * вместе с настроением, см. destinationUrl); остальное пустым входом:
 * произвольный адрес в next не пропустит loginCarry, и обещать возврат туда
 * было бы враньём.
 *
 * Путь страницы на английском ('/en/library', '/en/room/ABC234' — его отдаёт
 * usePathname) — тот же вход с lang=en: next и join без языка, язык —
 * параметром, и возврат ведёт на английскую страницу. Раньше английский путь
 * не узнавался вовсе, и вход терял, куда возвращать. Язык не угадывается по
 * Referer: ссылку могут открыть и без него.
 */
export function steamLoginFor(path: string): string {
  const { locale, path: bare } = splitLocale(path)
  const room = /^\/room\/([^/]+)$/.exec(bare)?.[1]
  const carry = new URLSearchParams()
  const next = bareDestination(path)
  if (room && JOIN_RE.test(room)) carry.set('join', room)
  else if (next) carry.set('next', next.url)
  if (locale !== DEFAULT_LOCALE) carry.set('lang', locale)
  const query = carry.toString()
  return query ? `/api/auth/steam?${query}` : '/api/auth/steam'
}

/**
 * Куда вести после удачного входа: пати, совместимость, место назначения или
 * квиз — на языке входа (lang в query возврата, см. loginCarry): с lang=en
 * это '/en/room/ABC123', '/en/library', '/en/quiz'.
 */
export function loginTarget(search: URLSearchParams): string {
  const carry = loginCarry(search)
  const locale: Locale = toLocale(carry.get('lang') ?? search.get('lang'))
  const join = carry.get('join')
  if (join) return lp(locale, `/room/${join}`)
  const compat = carry.get('compat')
  if (compat) return lp(locale, `/compat/${compat}`)
  return lp(locale, carry.get('next') ?? '/quiz')
}

/**
 * «Подключить заново» — главная с раскрытым полем для ссылки.
 *
 * Голый переход на / вёл по кругу: вошедшему главная говорила «С
 * возвращением» и давала кнопку в подбор — то есть ровно туда, откуда
 * человека только что развернуло без библиотеки. Поля для другой ссылки у
 * вошедшего не было вовсе. reconnect=1 раскрывает его сразу (ConnectCard).
 *
 * carry — то, что карточка и так читает из адреса (loginCarry): совместимость,
 * которую человек шёл смотреть, едет с ним, и после подключения карточка
 * уведёт туда же, а не в квиз.
 *
 * next — место, откуда пришли за своей библиотекой: демо с выдачи, игры дня
 * или библиотеки (components/DemoBar). Без него «вставить ссылку» из демо
 * возвращала бы не на ту же выдачу, а куда поведёт память настроения. Тот же
 * порядок и та же проверка, что у loginCarry: совместимость важнее, а next —
 * только из закрытого списка (destinationUrl), чужое просто не едет.
 *
 * Главная — на языке места: next '/en/play' → '/en?next=%2Fplay&reconnect=1',
 * как у bounceTo. Без next язык ставит тот, кто рисует ссылку: Link из
 * components/Link сам добавит префикс страницы.
 */
export function reconnectHref(carry?: { compat?: string; next?: string }): string {
  const q = new URLSearchParams()
  const next = bareDestination(carry?.next)
  if (carry?.compat && COMPAT_RE.test(carry.compat)) q.set('compat', carry.compat)
  else if (next) q.set('next', next.url)
  q.set('reconnect', '1')
  return lp(next?.locale ?? DEFAULT_LOCALE, `/?${q}`)
}
