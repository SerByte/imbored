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
 * Модуль без единого импорта: его читают и серверные страницы, и клиентский
 * лендинг, и роут возврата из Steam.
 */

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

/** Проверенный адрес назначения либо null. */
export function destinationPath(raw: string | null | undefined): string | null {
  return raw && Object.hasOwn(DESTINATIONS, raw) ? raw : null
}

/** Адрес лендинга, который помнит, куда человек шёл. */
export function bounceTo(path: keyof typeof DESTINATIONS | string): string {
  return destinationPath(path) ? `/?next=${encodeURIComponent(path)}` : '/'
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
  const next = destinationPath(search.get('next'))
  if (join && JOIN_RE.test(join)) out.set('join', join)
  else if (compat && COMPAT_RE.test(compat)) out.set('compat', compat)
  else if (next) out.set('next', next)
  return out
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
