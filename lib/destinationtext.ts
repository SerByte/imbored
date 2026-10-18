import type { DestinationPath } from './destination'
import { splitLocale, tr, type Locale } from './i18n'
import { parseMood } from './mood'
import { moodCaption } from './quiz'

/**
 * Что сказать на лендинге гостю, которого развернуло с места назначения.
 *
 * Адреса — закрытый список DESTINATION_PATHS в lib/destination.ts, тексты к
 * ним — здесь, и только здесь: второй копии этих фраз в проекте быть не
 * должно, они уже разъезжались с адресами один раз. Разъехаться со списком
 * им не даёт тип: satisfies ниже требует текст у каждого адреса и не
 * пропускает текст без адреса (и lib/destination.test.ts — то же в рантайме).
 *
 * ОТДЕЛЬНЫМ МОДУЛЕМ — ради веса. Проверку адреса (destinationUrl, steamLoginFor)
 * читает записка режима просмотра в корневом лэйауте, то есть первая загрузка
 * КАЖДОЙ страницы, а тексты нужны одному лендингу (components/landing).
 * Лежали они в одном объекте с адресами — и 1.8 КБ кириллицы ехали в
 * скрипты /privacy и /support, где их никто не покажет. Разбор настроения
 * (lib/mood) и подписи ответов (lib/quiz) лендинг и так везёт — первый
 * читает lib/destination, вторые память настроения в карточке входа.
 */

export type Destination = {
  /** Что сказать на лендинге вместо общего обещания продукта. */
  promise: string
  /** Что написать на кнопке: она обязана называть, куда ведёт. */
  action: string
}

export const DESTINATIONS: Readonly<Record<string, Destination>> = {
  '/library': {
    promise: 'Подключи Steam — и увидишь всю свою библиотеку одной стеной: что заброшено, что ни разу не запускалось и сколько это стоило.',
    action: 'Открыть библиотеку',
  },
  '/daily': {
    promise: 'Игра дня выбирается из твоей библиотеки — подключи Steam, и она появится.',
    action: 'Показать игру дня',
  },
  '/play': {
    promise: 'Одна игра под твоё состояние из твоей же библиотеки — подключи Steam, и выберем.',
    action: 'Подобрать игру',
  },
  '/explore': {
    promise: 'Колода из твоей библиотеки и магазина — листай без обязательств. Подключи Steam, и соберём её.',
    action: 'Полистать игры',
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
  // Отказ входа через Steam (?error=private) с /whatsnew везёт next на
  // лендинг — отсюда и обещание (почему /whatsnew в списке — в lib/destination)
  '/whatsnew': {
    promise: 'Подключи Steam — и «Что нового» покажет патчи твоих игр. Получать их в ридер по секретной ссылке можно после входа через Steam.',
    action: 'Открыть ленту',
  },
} satisfies Record<DestinationPath, Destination>

/**
 * Те же тексты английского лендинга — тем же satisfies: адрес без текста
 * или текст без адреса не соберутся и здесь. Кнопка так же называет
 * действие: по-английски это повелительное наклонение (Open, Show, Find…),
 * и слова — из глоссария (Find a game, Browse, Get the link, Create a room).
 */
const DESTINATIONS_EN = {
  '/library': {
    promise:
      'Connect Steam and see your whole library as one wall: what you abandoned, what you never launched, and what it all cost.',
    action: 'Open your library',
  },
  '/daily': {
    promise: "The game of the day comes from your own library — connect Steam and it'll show up.",
    action: 'Show the game of the day',
  },
  '/play': {
    promise: "One game for how you feel, from your own library — connect Steam and we'll pick it.",
    action: 'Find a game',
  },
  '/explore': {
    promise: "A deck from your library and the store — browse, no strings attached. Connect Steam and we'll deal it.",
    action: 'Browse games',
  },
  '/portrait': {
    promise: 'Your player portrait is built from your library and your playtime — connect Steam.',
    action: 'Build your portrait',
  },
  '/compat': {
    promise: 'Connect Steam and get a link to compare tastes with anyone.',
    action: 'Get the link',
  },
  '/room/new': {
    // «ваших» — всех в комнате, а не одного гостя: «all your libraries»
    // читалось как несколько библиотек у него самого, и «connect yours» спорило
    promise: "A room is built from everyone's libraries — connect yours and we'll create it.",
    action: 'Create a room',
  },
  '/whatsnew': {
    promise:
      "Connect Steam and “What's new” will show patches for your games. Once you sign in with Steam, you can get them in a feed reader via a private link.",
    action: 'Open the feed',
  },
} satisfies Record<DestinationPath, Destination>

/** Тексты лендинга на языке страницы; DESTINATIONS — русские, как были */
export function destinations(locale: Locale = 'ru'): Readonly<Record<string, Destination>> {
  return tr<Readonly<Record<string, Destination>>>(locale, { ru: DESTINATIONS, en: DESTINATIONS_EN })
}

/**
 * Тексты места назначения по адресу — с языком или без: '/en/play?…' и
 * '/play' — одна выдача. Ключ списка — путь без языка, а адрес из ?next=
 * бывает и английским (destinationUrl его сохраняет). null — не место.
 */
export function destinationFor(url: string | null, locale: Locale = 'ru'): Destination | null {
  if (!url) return null
  const { path } = splitLocale(url.split('?', 1)[0])
  // hasOwn, а не in: у объекта есть наследованные toString и __proto__
  return Object.hasOwn(DESTINATIONS, path) ? destinations(locale)[path] : null
}

/**
 * Что сказать над заголовком лендинга про место, куда человек шёл: url —
 * адрес из ?next=, уже проверенный destinationUrl (lib/destination). null —
 * говорить нечего.
 *
 * Выдаче с настроением — само настроение. Гость отвечал на три вопроса,
 * квиз разворачивал его на вход (knownGuest в lib/sessionhint, app/quiz), и
 * лендинг встречал общим «одна игра под твоё состояние», как будто ответов
 * не было: последний шаг квиза выглядел провалом, а не шагом. Теперь он
 * слышит своё — «Пара часов · Расслабиться · Один — запомнили» — и что
 * осталось ровно одно. Подписи — moodCaption из lib/quiz: те же слова, что
 * на плитках, которые он только что нажимал.
 *
 * Только сказанное самим человеком. «Мне повезёт» (roulette) и «Ни разу не
 * запускал» (from) настроение выбирают за него — кубиком и дефолтом, — и
 * «запомнили» про то, чего он не говорил, было бы неправдой. Им, как и
 * неполному настроению, — общее обещание выдачи.
 *
 * Адрес бывает и с языком ('/en/play?…', см. destinationUrl): место
 * узнаётся по пути без префикса. Текст — на языке страницы (locale), а
 * настроение — подписями английского квиза, теми же, что он нажимал.
 */
export function destinationPromise(url: string | null, locale: Locale = 'ru'): string | null {
  if (!url) return null
  const cut = url.indexOf('?')
  const { path } = splitLocale(cut < 0 ? url : url.slice(0, cut))
  // hasOwn, а не in: у объекта есть наследованные toString и __proto__
  if (!Object.hasOwn(DESTINATIONS, path)) return null
  const q = new URLSearchParams(cut < 0 ? '' : url.slice(cut + 1))
  const mood =
    path === '/play' && !q.has('roulette') && !q.has('from')
      ? parseMood({ time: q.get('time'), vibe: q.get('vibe'), social: q.get('social') })
      : null
  const said = mood ? moodCaption(mood, locale) : ''
  if (!said) return destinations(locale)[path].promise
  return tr(locale, {
    ru: `${said} — запомнили. Остался последний шаг: подключи Steam, и выберем одну игру из твоей библиотеки.`,
    en: `${said} — got it. One last step: connect Steam and we'll pick one game from your library.`,
  })
}
