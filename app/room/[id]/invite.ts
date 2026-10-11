import { getGamesMetaLite, getRoom, roomMembers } from '@/lib/db'
import { parseMood } from '@/lib/mood'
import { roomPresetOf } from '@/lib/presets'
import type { RoomInvite } from '@/lib/roominvite'
import { peekAllowed } from '@/lib/roompeek'
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
 * уже вошедших, имя хоста, настроение вечера, игра, в которую звали, и игра,
 * на которой сошлись, то есть ровно то, что человек и так узнает, открыв
 * ссылку: настроение стоит в шапке комнаты, предложенная игра — первой картой.
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
    // Игра, о которой говорит карточка: после матча — та, на которой сошлись,
    // до него — та, в которую звали (после матча предложенная молчит, см.
    // inviteCopy). Одна, узкой строкой, без блобов: нужны имя и арт
    const appid = matched ? room.matchedAppid : room.seedAppid
    const [members, games] = await Promise.all([
      roomMembers(db, id),
      appid !== undefined ? getGamesMetaLite(db, [appid]) : Promise.resolve(null),
    ])
    const host = members.find((m) => m.steamid === room.createdBy)?.personaName ?? null
    const game = appid !== undefined ? games?.get(appid) : undefined
    // Арт — из той же строки, без лишнего запроса: фон карточки
    const art = game
      ? { appid: game.appid, art: game.art ?? null, headerImage: game.headerImage ?? null }
      : null
    return {
      id: room.id,
      members: members.length,
      host,
      matched,
      matchedName: matched ? (game?.name ?? null) : null,
      matchedArt: matched ? art : null,
      // Названием пресета, а не осями: «пара быстрых каток», а не short/engaged.
      // Своё сочетание осей без пресета — null, чужим именем его не называем.
      // parseMood — тот же сторож, что у колоды: у битой строки настроения нет
      preset: roomPresetOf(parseMood(room.mood))?.label ?? null,
      seedName: matched ? null : (game?.name ?? null),
      seedArt: matched ? null : art,
    }
  } catch {
    // База молчит — приглашение всё равно должно развернуться в чате чем-то
    // осмысленным, а не пятисоткой у краулера.
    return null
  }
}

/**
 * То же — для заголовка страницы, с потолком room-peek по адресу.
 *
 * Заголовок отвечает по-разному на живую комнату и на несуществующую, то есть
 * это та же проверка существования кода, что у /api/room/[id], и платит она
 * тем же счётчиком (lib/roompeek). Списывается ДО чтения комнаты: промах
 * обязан стоить столько же, сколько попадание. Сверх потолка — null, то есть
 * нейтральное «Пати КОД», неотличимое от комнаты, которой нет; краулер
 * мессенджера, упёршийся в потолок, получит ту же нейтральную карточку, а не
 * ошибку.
 *
 * Сессия по-прежнему не читается, поэтому платят и участники, открывшие свою
 * комнату: одна единица за загрузку страницы против опроса раз в 2,5 секунды,
 * под который потолок и считался. Сбой счётчика не прячет приглашение:
 * checkRate при недоступной базе пропускает, а дальше молчащую базу ловит
 * loadRoomInvite.
 */
export async function loadRoomInviteForPage(id: string, headers: Headers): Promise<RoomInvite | null> {
  if (!ROOM_ID_RE.test(id)) return null
  try {
    if (!(await peekAllowed(await getDb(), headers)).ok) return null
  } catch {
    // getDb не поднялся — loadRoomInvite ниже ответит тем же null сам
  }
  return loadRoomInvite(id)
}
