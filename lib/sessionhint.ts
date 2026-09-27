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
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // Не записалось — значит в следующий раз снова будет «вход». Терпимо.
  }
  for (const cb of [...listeners]) cb()
}

/** Для выхода: забыть, что здесь кто-то был. */
export function forgetSessionHint(): void {
  rememberSession(null)
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
 */
export function settleSessionHint(body: unknown): void {
  const hint = getSessionHint()
  if (!hint || typeof body !== 'object' || body === null) return
  const b = body as { authed?: unknown; steamid?: unknown; writer?: unknown }
  if (b.authed === false) return forgetSessionHint()
  if (b.authed !== true || typeof b.steamid !== 'string' || typeof b.writer !== 'boolean') return
  const demo = isDemoId(b.steamid)
  const sameSide = demo === (hint.demo === true)
  const next = hintFrom({ personaName: sameSide ? hint.personaName : null, demo, writer: b.writer })
  if (next.demo === hint.demo && next.readOnly === hint.readOnly) return
  rememberSession(next)
}
