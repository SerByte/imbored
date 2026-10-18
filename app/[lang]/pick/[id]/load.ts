import { getGamesMetaLite, getSharedPick, type SharedPick } from '@/lib/db'
import { nearGames } from '@/lib/gamepage'
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

/**
 * Есть ли у игры соседи — то есть куда вести «Похожее на «X» — по моей
 * библиотеке» со страницы выбора.
 *
 * Ссылка ведёт в квиз с затравкой (quizHref), а выдача с затравкой берёт
 * кандидатов ровно отсюда — nearGames (lib/candidates): готовые соседи, а
 * пока их не залили — полка по тегу. Нет соседей — выдача ответит «похожих не
 * нашлось», и ссылка обещала бы то, чего нет; та же мерка у такой же ссылки на
 * странице игры. Карта тегов не нужна: без неё полка по тегу берёт самый
 * весомый тег игры, а вопрос здесь один — пусто или нет.
 *
 * Отдельно от loadSharedPick: карточке в чате (opengraph-image.tsx) соседи не
 * нужны, и платить за них чтением ей незачем. Сессия не читается и здесь.
 * База молчит — false: страница остаётся с главной кнопкой, без обещания.
 */
export async function pickHasNear(meta: GameMeta): Promise<boolean> {
  try {
    const { games } = await nearGames(await getDb(), meta, null)
    return games.some((g) => g.appid !== meta.appid)
  } catch {
    return false
  }
}
