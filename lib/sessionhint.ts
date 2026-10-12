/**
 * Подсказка «этот человек уже входил» — на устройстве, а не на сервере.
 *
 * Задача одна: убрать с парадного экрана мёртвое место. Главная статическая
 * (и должна такой остаться — её отдаёт CDN), поэтому узнать вошедшего в
 * разметке нельзя: кука читается только запросом. Пока ответ ехал, карточка
 * показывала «Секунду…» — то есть первое, что видел человек на сайте, было
 * место, где ничего нельзя сделать, и держалось оно целый круг до сервера.
 *
 * Теперь ответ на прошлый визит лежит рядом, и его видно сразу после
 * гидратации, без сети. Запрос всё равно уходит и всё равно главнее: подсказка
 * — это догадка, а не право входа. Ничего, что ею открывается, здесь нет;
 * ошибись она — человек увидит не тот заголовок на долю секунды, и запрос его
 * поправит. Пускать по ней внутрь нельзя, и никто не пускает.
 *
 * Хранится ник — свой собственный, на своём же устройстве. Гасится в выходе
 * (components/SignOut.tsx): без этого вышедший возвращался бы на главную и
 * читал «С возвращением».
 */

import { isDemoId } from './demoid'

/**
 * demo — вошёл демо-личностью. Поле есть только когда это правда: карточка
 * главной говорит демо «Ты в демо-режиме» и сразу даёт поле для своей
 * ссылки, а не «С возвращением, Демо-игрок». Без признака в подсказке
 * вернувшийся в демо видел бы приветствие, которое через круг до сервера
 * сменялось бы другой карточкой, — прыжок первого экрана под пальцем.
 * Тот же признак зажигает полосу «это чужая демо-библиотека» на /play и
 * /daily (components/DemoBar): им, клиентским, его больше взять неоткуда.
 *
 * readOnly — вошёл по ссылке на профиль: смотреть можно, сохранять нельзя
 * (isWriter в lib/server). По той же причине, что demo: карточка главной
 * говорит ему «только просмотр» и зовёт войти через Steam сразу, а не после
 * круга до сервера.
 */
export type SessionHint = { authed: boolean; personaName: string | null; demo?: true; readOnly?: true }

const KEY = 'imbored.session-hint'

/**
 * undefined — «ещё не читали», null — «читали, ничего нет». Разница нужна
 * useSyncExternalStore: getSnapshot обязан возвращать ОДНУ И ТУ ЖЕ ссылку,
 * пока значение не менялось, иначе React уходит в бесконечный рендер.
 */
let cache: SessionHint | null | undefined
const listeners = new Set<() => void>()

/**
 * ГОСТЬ — СО СЛОВ СЕРВЕРА, НА ВРЕМЯ ОДНОГО ДОКУМЕНТА (knownGuest ниже).
 *
 * Подсказка помнит только вошедших: гость и «не знаем» в ней одинаково
 * null. Квизу разница нужна (app/quiz, go): гостя последний ответ вёл на
 * /play, тот показывал экран прогрева и через круг до сервера (401 у
 * /api/prepare) разворачивал на лендинг. Зная, что перед ним гость, квиз
 * ведёт на лендинг сам — к честному «осталось подключить».
 *
 * Только память, как признак записи (lib/writer), и только «гость»
 * наверняка: ответ touch с authed: false, а не сбой сети. Сохранённый на
 * устройстве, флаг пережил бы вход — и вошедший вместо выдачи попадал бы на
 * лендинг; ошибиться в эту сторону дороже, чем пройти через /play по-старому.
 *
 * Гаснет с каждым входом, о котором этот документ знает:
 *  - подключение на главной пишет подсказку (rememberSession);
 *  - «Демо-друг (без Steam)» в комнате (app/room/[id], joinAsDemoFriend)
 *    подсказки не пишет и гасит флаг сам (forgetGuest). Без этого гость,
 *    пришедший по приглашению, после демо-друга шёл из шапки в квиз, и тот
 *    уводил вошедшего на лендинг «подключать Steam»;
 *  - ответ touch «вошёл» (settleSessionHint) — даже когда подсказки нет;
 *  - вход через Steam в этой вкладке — новый документ.
 *
 * А о входе мимо себя документ сам не узнает. Steam возвращает туда,
 * откуда шли (loginTarget в lib/destination), — чаще всего в квиз, а не на
 * главную, и подсказки там никто не пишет, так что событие storage из
 * соседней вкладки о таком входе не придёт. Поэтому флагу не верим, как
 * только документ спрятали (watchHiding): войти где-то ещё — в соседней
 * вкладке или уйдя в Steam и вернувшись «Назад» из bfcache, где память
 * модуля цела, — почти всегда значит спрятать этот. Спрятали — снова «не
 * знаем», путь через /play, как до флага. Не ловится одно: два окна рядом
 * на большом экране и вход через Steam во втором. Тогда квиз первого уведёт
 * на лендинг, где карточка по ответу touch узнает вошедшего и даст кнопку
 * дальше, — лишний шаг, а не тупик.
 */
let guest = false

/** Слежка за «документ спрятан» ставится один раз — с первым гостем */
let watching = false

/** Значение из чужих рук: пришло из localStorage, где его мог править кто угодно. */
function parse(raw: string): SessionHint | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const o = v as Record<string, unknown>
    if (o.authed !== true) return null
    return {
      authed: true,
      personaName: typeof o.personaName === 'string' ? o.personaName : null,
      ...(o.demo === true ? { demo: true as const } : {}),
      ...(o.readOnly === true ? { readOnly: true as const } : {}),
    }
  } catch {
    return null
  }
}

function read(): SessionHint | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parse(raw) : null
    // localStorage бросает в приватном режиме и при выключенных куках. Это не
    // повод ронять главную: нет подсказки — покажем вход, как и раньше.
  } catch {
    return null
  }
}

export function subscribeSessionHint(onChange: () => void): () => void {
  listeners.add(onChange)
  // Выход в соседней вкладке — тоже событие: там подсказка гаснет, здесь
  // заголовок обязан перестать здороваться.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== KEY) return
    cache = undefined
    onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function getSessionHint(): SessionHint | null {
  if (cache === undefined) cache = read()
  return cache
}

/**
 * На сервере подсказки нет и быть не может. Возвращаем null отдельной
 * функцией, а не тем же getSessionHint: React берёт этот снимок для
 * гидратации, и разметка сервера обязана совпасть с первым рендером клиента.
 */
export function getServerSessionHint(): SessionHint | null {
  return null
}

/** Записать ответ сервера. Гость и отсутствие ника — это стереть, а не хранить. */
export function rememberSession(hint: SessionHint | null): void {
  const next = hint && hint.authed ? hint : null
  cache = next
  // Вошёл — уже не гость (knownGuest): квиз поведёт в выдачу
  if (next) guest = false
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // Не записалось — значит в следующий раз снова будет «вход». Терпимо.
  }
  for (const cb of [...listeners]) cb()
}

/**
 * Для выхода: забыть, что здесь кто-то был. Гостем не делает: выход «везде»
 * бывает и недоделанным, а «не знаем» — это путь через /play, как раньше.
 */
export function forgetSessionHint(): void {
  rememberSession(null)
}

/**
 * Сервер ответил «гость» (touch: authed: false): подсказку стереть и
 * запомнить, что это известно наверняка. Сбой сети и пятисотка сюда не ведут
 * — о сессии они не говорят ничего.
 */
export function rememberGuest(): void {
  guest = true
  watchHiding()
  rememberSession(null)
}

/**
 * Вошёл мимо подсказки — гостем этот документ больше не считается. Для
 * входов, которые подсказку не пишут: демо-друг в комнате
 * (app/room/[id], joinAsDemoFriend), ответ touch «вошёл» без подсказки
 * (settleSessionHint), спрятанный документ (watchHiding). Подсказку не
 * трогает: ни завести, ни стереть её отсюда нечем.
 *
 * Слушатели узнают: квиз по флагу говорит гостю заранее, что будет после
 * ответов, и эта строка обязана погаснуть вместе с ним, а не врать до
 * следующего рендера.
 */
export function forgetGuest(): void {
  if (!guest) return
  guest = false
  for (const cb of [...listeners]) cb()
}

/**
 * См. «ГОСТЬ» выше: вход, которого этот документ не видел, случается только
 * пока он спрятан — в соседней вкладке или по дороге в Steam. visibilitychange
 * ловит и то и другое; pagehide — на случай браузеров, что уводят страницу в
 * bfcache, не сказав о скрытии. Один раз на документ и только у гостя:
 * остальным следить незачем.
 */
function watchHiding(): void {
  if (watching || typeof document === 'undefined') return
  watching = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') forgetGuest()
  })
  window.addEventListener('pagehide', forgetGuest)
}

/**
 * Гость наверняка: сервер так ответил в этом документе, документ с тех пор
 * не прятали, и подсказки о входе не появилось. Подсказка — и из соседней
 * вкладки (кука у вкладок общая), если там вошли через главную; вход через
 * Steam её не пишет, его ловит слежка за скрытием (watchHiding).
 */
export function knownGuest(): boolean {
  return guest && !getSessionHint()
}

/**
 * Подсказка из ответа touch или connect: демо помнится только настоящим
 * true, «только просмотр» — только настоящим writer: false у не-демо.
 *
 * Здесь, а не в карточке главной: по тому же правилу подсказку сверяет
 * settleSessionHint ниже, и два правила разъехались бы при первой правке.
 */
export function hintFrom(d: { personaName?: string | null; demo?: boolean; writer?: boolean }): SessionHint {
  return {
    authed: true,
    personaName: d.personaName ?? null,
    ...(d.demo === true ? { demo: true as const } : {}),
    ...(d.demo !== true && d.writer === false ? { readOnly: true as const } : {}),
  }
}

/**
 * СВЕРКА ПОДСКАЗКИ С ОТВЕТОМ TOUCH НА ОСТАЛЬНЫХ СТРАНИЦАХ (SessionKeeper).
 *
 * Пишет подсказку главная, а входят и мимо неё: возврат из Steam ведёт прямо
 * туда, откуда человек шёл, — в выдачу, библиотеку, комнату (loginTarget в
 * lib/destination). Демо, нажавший «Войти через Steam» в полосе демо
 * (components/DemoBar), возвращался на /play со старой подсказкой — и полоса
 * называла чужой его собственную библиотеку.
 *
 * Ника и признака демо в этом ответе нет: их touch считает только для
 * карточки главной. Зато есть steamid, а демо узнаётся по нему тем же
 * правилом, что на сервере (lib/demoid). Меняем только то, в чём подсказка
 * врёт о виде входа. Подсказку, которой нет, здесь не заводим, а гостя —
 * стираем, как это сделала бы главная.
 *
 * Ник гасим только вместе с признаком демо: у демо он чужой («Демо-игрок»),
 * а свой главная допишет на следующем заходе. Смена «только просмотр» ник не
 * трогает, и это не мелочь. У подсказок, записанных до признака readOnly,
 * его нет вовсе, и у каждой сессии по ссылке первая же сверка после выкладки
 * его добавит. Погаси она заодно ник — приветствие главной у всех таких
 * людей разом ждало бы имени круг до сервера, то есть прыгало бы ровно так,
 * как подсказка и заводилась, чтобы не прыгало. Вход через Steam после входа
 * по ссылке — почти всегда тот же профиль; если чужой, ник поправит главная,
 * как поправляет любую смену профиля мимо неё: steamid в подсказке нет.
 *
 * Гостя отмечаем и без подсказки (rememberGuest): раньше сверка на нём
 * молча выходила, а квизу, открытому гостем напрямую, только отсюда и
 * узнать, что перед ним гость (knownGuest). И снимаем отметку по «вошёл» —
 * тоже без подсказки: завести её отсюда нечем (ника в ответе нет), а
 * вошедший, которого документ всё ещё считает гостем, ушёл бы из квиза на
 * лендинг вместо выдачи.
 */
export function settleSessionHint(body: unknown): void {
  if (typeof body !== 'object' || body === null) return
  const b = body as { authed?: unknown; steamid?: unknown; writer?: unknown }
  if (b.authed === false) return rememberGuest()
  if (b.authed === true) forgetGuest()
  const hint = getSessionHint()
  if (!hint) return
  if (b.authed !== true || typeof b.steamid !== 'string' || typeof b.writer !== 'boolean') return
  const demo = isDemoId(b.steamid)
  const sameSide = demo === (hint.demo === true)
  const next = hintFrom({ personaName: sameSide ? hint.personaName : null, demo, writer: b.writer })
  if (next.demo === hint.demo && next.readOnly === hint.readOnly) return
  rememberSession(next)
}
