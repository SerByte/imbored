import { isDemoId } from './demoid'
import { tr, type Locale } from './i18n'

/**
 * Имя игрока для вывода — ник из Steam, демо-личность или запасное имя.
 *
 * Модуль чистый и годится клиенту: его берут и сервер (сравнение, портрет,
 * доска пати), и клиент комнаты. Импорты — только такие же чистые модули.
 *
 * Хранится имя по-русски и только по-русски: ник демо-личности пишется в
 * users.persona_name при входе в демо («Демо-игрок», «Демо-друг», см.
 * seedDemo и /api/connect), и язык страницы в ту минуту ничего не решал —
 * одна и та же демо-личность видна и на /room, и на /en/room. Поэтому имя
 * переводится при выводе, а не при записи: в базе одна строка на человека,
 * а подпись — на языке того, кто смотрит.
 */

/**
 * Запасное имя, когда ника нет: «Игрок 1234» / «Player 1234».
 *
 * Хвост выбирает вызывающий: у сравнения и портрета это четыре последние
 * цифры steamid, а у комнаты — хеш от комнаты и steamid (memberLabel в
 * lib/room), чтобы доска пати не раздавала хвост SteamID чужим. Склеивать
 * хвост здесь значило бы решить за них, что раскрывать.
 */
export function playerFallback(tail: string, locale: Locale = 'ru'): string {
  return tr(locale, { ru: `Игрок ${tail}`, en: `Player ${tail}` })
}

/** Ник демо-друга, как его пишет вход в демо (вариант 2, см. demoSteamId) */
const DEMO_FRIEND_RU = 'Демо-друг'

/**
 * Ник для вывода: у настоящего игрока — как записан, у демо-личности — на
 * языке страницы.
 *
 * Только демо-личность (isDemoId) и только по-английски: ник настоящего
 * человека — его собственный текст, его не переводят (docs/i18n.md, «Чего НЕ
 * переводить»). А по-русски ник возвращается как есть, вплоть до пустой
 * строки: русский вывод обязан остаться прежним байт в байт, и решение
 * «пустой ник — запасное имя» остаётся за вызывающим, как и было.
 *
 * Без ника — null: запасное имя у каждого вызывающего своё (playerFallback).
 */
export function personaLabel(steamid: string, stored: string, locale?: Locale): string
export function personaLabel(
  steamid: string,
  stored: string | null | undefined,
  locale?: Locale,
): string | null
export function personaLabel(
  steamid: string,
  stored: string | null | undefined,
  locale: Locale = 'ru',
): string | null {
  if (stored == null) return null
  if (locale !== 'en' || !isDemoId(steamid)) return stored
  // Сверка по записанному нику, а не по последней цифре steamid: подпись
  // обязана сказать то же, что русская на соседней вкладке, а русская
  // показывает именно записанное
  return stored === DEMO_FRIEND_RU ? 'Demo friend' : 'Demo player'
}
