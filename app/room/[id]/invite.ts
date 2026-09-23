import { getGamesMetaLite, getRoom, roomMembers } from '@/lib/db'
import type { RoomInvite } from '@/lib/roominvite'
import { getDb } from '@/lib/server'

/**
 * Что известно о комнате тому, кто ещё в неё не вошёл.
 *
 * Общее для заголовка страницы и для карточки в мессенджере — иначе превью и
 * то, что человек прочтёт в шапке чата, разъедутся уже на второй правке.
 * Тексты из этого собирает inviteCopy в lib/roominvite.ts.
 *
 * Сессия здесь не читается ВООБЩЕ, и это не оплошность: и краулер, и адресат
 * ссылки заведомо не участники комнаты. Всё, что показывается, — код, число
 * уже вошедших, имя хоста и игра, на которой сошлись, то есть ровно то, что
 * человек и так узнает, открыв ссылку.
 */
export const ROOM_ID_RE = /^[A-Z0-9]{6}$/

export type { RoomInvite }

export async function loadRoomInvite(id: string): Promise<RoomInvite | null> {
  if (!ROOM_ID_RE.test(id)) return null
  try {
    const db = await getDb()
    const room = await getRoom(db, id)
    if (!room) return null
    const matched = room.status === 'matched'
    // Название совпавшей игры — узкой строкой, без блобов: нужно одно имя
    const [members, games] = await Promise.all([
      roomMembers(db, id),
      matched && room.matchedAppid !== undefined
        ? getGamesMetaLite(db, [room.matchedAppid])
        : Promise.resolve(null),
    ])
    const host = members.find((m) => m.steamid === room.createdBy)?.personaName ?? null
    const matchedName =
      room.matchedAppid !== undefined ? (games?.get(room.matchedAppid)?.name ?? null) : null
    return { id: room.id, members: members.length, host, matched, matchedName }
  } catch {
    // База молчит — приглашение всё равно должно развернуться в чате чем-то
    // осмысленным, а не пятисоткой у краулера.
    return null
  }
}
