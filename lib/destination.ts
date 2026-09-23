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
 * закрытый и известен целиком — значит и список закрытый. Заодно к каждому
 * адресу здесь же лежит его текст, и они не могут разъехаться.
 *
 * Хвост запроса едет тоже, но так же по списку — см. destinationUrl.
 *
 * Единственный импорт — разбор настроения из lib/mood, у которого самого
 * зависимостей нет: модуль читают и серверные страницы, и клиентский лендинг,
 * и роут возврата из Steam.
 */

import { parseLean, parseMood } from './mood'

export type Destination = {
  /** Что сказать на лендинге вместо общего обещания продукта. */
  promise: string
  /** Что написать на кнопке: она обязана называть, куда ведёт. */
  action: string
}

export const DESTINATIONS: Record<string, Destination> = {
  '/library': {
    promise: 'Подключи Steam — и увидишь всю свою библиотеку одной стеной: что заброшено, что ни разу не запускалось и сколько это стоило.',
    action: 'Открыть библиотеку',
  },
  '/daily': {
    promise: 'Игра дня выбирается из твоей библиотеки — подключи Steam, и она появится.',
    action: 'Показать игру дня',
  },
  '/play': {
    promise: 'Подборка собирается из твоей же библиотеки — подключи Steam, и соберём.',
    action: 'Подобрать игру',
  },
  '/portrait': {
    promise: 'Портрет игрока строится по твоей библиотеке и наигранным часам — подключи Steam.',
    action: 'Собрать портрет',
  },
  '/compat': {
    promise: 'Подключи Steam — и получишь ссылку, по которой сравнишь вкусы с кем угодно.',
    action: 'Получить ссылку',
  },
  '/room/new': {
    promise: 'Комната собирается из ваших библиотек — подключи свою, и создадим её.',
    action: 'Создать комнату',
  },
}

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
  return out
}

/**
 * Проверенный адрес назначения вместе с разрешённым хвостом запроса либо null.
 *
 * Путь — строго из DESTINATIONS, хвост — только у /play и только его
 * параметры (playQuery). У остальных мест хвоста нет, и мусор в нём
 * отбрасывается, а не губит весь адрес: человек всё равно шёл в библиотеку.
 * Результат собирается заново из проверенного, поэтому его можно класть и в
 * next, и в редирект.
 */
export function destinationUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cut = raw.indexOf('?')
  const path = cut < 0 ? raw : raw.slice(0, cut)
  if (!Object.hasOwn(DESTINATIONS, path)) return null
  const query = cut >= 0 && path === '/play' ? playQuery(new URLSearchParams(raw.slice(cut + 1))) : null
  return query?.size ? `${path}?${query}` : path
}

/** Место назначения — ключ DESTINATIONS — из адреса, в том числе с хвостом, либо null. */
export function destinationPath(raw: string | null | undefined): string | null {
  const url = destinationUrl(raw)
  return url === null ? null : url.split('?', 1)[0]
}

/**
 * Адрес лендинга, который помнит, куда человек шёл.
 *
 * search — текущая строка запроса страницы: с ней /play везёт через вход
 * настроение квиза, а не одно только «шёл в выдачу».
 */
export function bounceTo(
  path: keyof typeof DESTINATIONS | string,
  search?: { toString(): string } | null,
): string {
  const query = search?.toString() ?? ''
  const url = destinationUrl(query ? `${path}?${query}` : path)
  return url ? `/?next=${encodeURIComponent(url)}` : '/'
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
 */
export function loginCarry(search: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams()
  const join = search.get('join')
  const compat = search.get('compat')
  const next = destinationUrl(search.get('next'))
  if (join && JOIN_RE.test(join)) out.set('join', join)
  else if (compat && COMPAT_RE.test(compat)) out.set('compat', compat)
  else if (next) out.set('next', next)
  return out
}

/**
 * Ссылка «войди через Steam», которая вернёт человека туда, где он нажал.
 *
 * Нужна сессии, которой писать нельзя (вошла по вставленной ссылке, см.
 * isWriter в lib/server): подсказка «войди через Steam» обязана вести не на
 * квиз, а обратно — на ту же выдачу, в ту же библиотеку, в ту же комнату.
 * Путь комнаты едет как join, место из DESTINATIONS — как next (у выдачи —
 * вместе с настроением, см. destinationUrl); остальное пустым входом:
 * произвольный адрес в next не пропустит loginCarry, и обещать возврат туда
 * было бы враньём.
 */
export function steamLoginFor(path: string): string {
  const room = /^\/room\/([^/]+)$/.exec(path)?.[1]
  const carry = new URLSearchParams()
  const next = destinationUrl(path)
  if (room && JOIN_RE.test(room)) carry.set('join', room)
  else if (next) carry.set('next', next)
  const query = carry.toString()
  return query ? `/api/auth/steam?${query}` : '/api/auth/steam'
}

/** Куда вести после удачного входа: пати, совместимость, место назначения или квиз. */
export function loginTarget(search: URLSearchParams): string {
  const carry = loginCarry(search)
  const join = carry.get('join')
  if (join) return `/room/${join}`
  const compat = carry.get('compat')
  if (compat) return `/compat/${compat}`
  return carry.get('next') ?? '/quiz'
}
