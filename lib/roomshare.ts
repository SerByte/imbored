import { withRef } from './track'

/**
 * Ссылка-приглашение в комнату — одна на кнопку «Поделиться» и на поле, что
 * показывается, когда скопировать не вышло. Раньше обе брали
 * window.location.href и уносили всё, что было в адресе у того, кто делится.
 * Метка ref=room — источник для воронки (lib/track.ts), кода человека в ней
 * нет, кроме кода самой комнаты, который и так в пути.
 */
export function roomShareUrl(origin: string, roomId: string): string {
  return withRef(`${origin}/room/${encodeURIComponent(roomId)}`, 'room')
}
