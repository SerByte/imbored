import { lp, type Locale } from './i18n'
import { withRef } from './track'

/**
 * Ссылка-приглашение в комнату — одна на кнопку «Поделиться» и на поле, что
 * показывается, когда скопировать не вышло. Раньше обе брали
 * window.location.href и уносили всё, что было в адресе у того, кто делится.
 * Метка ref=room — источник для воронки (lib/track.ts), кода человека в ней
 * нет, кроме кода самой комнаты, который и так в пути.
 *
 * Язык — того, кто зовёт: с английской комнаты друг получает /en/room/…, и
 * экран приглашения встречает его на том же языке, что и карточка в чате.
 */
export function roomShareUrl(origin: string, roomId: string, locale: Locale = 'ru'): string {
  return withRef(`${origin}${lp(locale, `/room/${encodeURIComponent(roomId)}`)}`, 'room')
}
