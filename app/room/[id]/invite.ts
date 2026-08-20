import { getRoom, roomMembers } from '@/lib/db'
import { getDb } from '@/lib/server'

/**
 * Что известно о комнате тому, кто ещё в неё не вошёл.
 *
 * Общее для заголовка страницы и для карточки в мессенджере — иначе превью и
 * то, что человек прочтёт в шапке чата, разъедутся уже на второй правке.
 *
 * Сессия здесь не читается ВООБЩЕ, и это не оплошность: и краулер, и адресат
 * ссылки заведомо не участники комнаты. Всё, что показывается, — код, число
 * уже вошедших и имя хоста, то есть ровно то, что человек и так узнает,
 * открыв ссылку.
 */
export const ROOM_ID_RE = /^[A-Z0-9]{6}$/

export type RoomInvite = {
  id: string
  /** сколько человек уже в комнате */
  members: number
  /** ник создателя, если Steam его отдал */
  host: string | null
  /** матч уже случился — приглашать больше некуда */
  matched: boolean
}

export async function loadRoomInvite(id: string): Promise<RoomInvite | null> {
  if (!ROOM_ID_RE.test(id)) return null
  try {
    const db = await getDb()
    const room = await getRoom(db, id)
    if (!room) return null
    const members = await roomMembers(db, id)
    const host = members.find((m) => m.steamid === room.createdBy)?.personaName ?? null
    return { id: room.id, members: members.length, host, matched: room.status === 'matched' }
  } catch {
    // База молчит — приглашение всё равно должно развернуться в чате чем-то
    // осмысленным, а не пятисоткой у краулера.
    return null
  }
}
