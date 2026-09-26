import { getGamesMetaLite, getSharedPick, type SharedPick } from '@/lib/db'
import { getDb, nowSec } from '@/lib/server'
import { SHARED_PICK_ID_RE, SHARED_PICK_TTL_SEC } from '@/lib/sharedpick'
import type { GameMeta } from '@/lib/types'

/**
 * Выбор, которым поделились, — для страницы, заголовка и карточки в чате.
 *
 * Сессия здесь не читается ВООБЩЕ: и краулер, и адресат ссылки — не тот,
 * кто выбирал, и страница одна для всех. Автор (created_by) не выбирается
 * даже из базы (getSharedPick). База молчит — null, а не пятисотка у
 * краулера: карточка останется приглашением.
 */
export async function loadSharedPick(raw: string): Promise<{ pick: SharedPick; meta: GameMeta } | null> {
  const id = raw.toLowerCase()
  if (!SHARED_PICK_ID_RE.test(id)) return null
  try {
    const db = await getDb()
    const pick = await getSharedPick(db, id, nowSec() - SHARED_PICK_TTL_SEC)
    if (!pick) return null
    const meta = (await getGamesMetaLite(db, [pick.appid])).get(pick.appid)
    return meta ? { pick, meta } : null
  } catch {
    return null
  }
}
