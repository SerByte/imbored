import { reconnectHref, steamLoginFor } from './destination'
import { track } from './track'

/**
 * ДВЕРЬ ИЗ ДЕМО К СВОЕЙ БИБЛИОТЕКЕ — адреса и счёт показов полосы демо
 * (components/DemoBar).
 *
 * Демо — единственный путь без обязательств, и его работа — довести человека
 * до своей библиотеки. Но демо называло себя только на карточке главной, а на
 * /play, /daily и /library не было ни слова: в самый момент ценности («вот
 * игра, и вот почему») сделать то же по своей было негде.
 *
 * Обе двери возвращают туда же, где нажали, — вход через Steam нужен ради
 * этой выдачи, а не ради квиза. Steam — через steamLoginFor: выдача едет со
 * своим настроением. Ссылка — через главную с раскрытым полем (reconnectHref)
 * и тем же next: у демо поле и так раскрыто (ConnectCard), а next уводит после
 * подключения обратно сюда.
 *
 * Модуль без React: адреса проверяются тестом целиком, по кругу через
 * loginTarget и destinationUrl.
 */
export function demoDoors(from: string): { steam: string; link: string } {
  return { steam: steamLoginFor(from), link: reconnectHref({ next: from }) }
}

/** Страницы, чей показ полосы уже посчитан в этом документе */
const counted = new Set<string>()

/**
 * Отметить показ полосы — раз на страницу за документ, а не на монтирование.
 *
 * На /play и /daily полоса стоит в герое, а герой пересоздаётся с каждой
 * новой игрой («Не то — дальше», «Не сегодня»): считай мы монтирования,
 * листание демо выглядело бы в воронке десятками показов одной и той же
 * полосы. Страница — путь без строки запроса: смена настроения на выдаче —
 * та же полоса на той же странице.
 */
export function noteDemoDoorShown(from: string): void {
  const page = from.split('?', 1)[0]
  if (counted.has(page)) return
  counted.add(page)
  track('demo_door_shown')
}
