import { loadTagStats, type Db } from './db'
import { logSwallowed } from './errlog'
import { rarityScale } from './tagweight'

/**
 * Карта тегов каталога (сколько игр у каждого тега) — с памятью на процесс.
 *
 * loadTagStats читает всю таблицу tags, около 430 строк, а карта меняется
 * только с заливкой каталога (rebuildTagStats). Память жила у карточки игры —
 * самой массовой страницы, — а горячие пути читали таблицу заново на каждый
 * запрос: подбор и каждое «Что-то другое», «Игра дня», колода исследователя
 * (все три — через buildCandidates), сравнение и колода комнаты. Каждый такой
 * запрос — четыре сотни прочитанных строк Turso за одну и ту же карту.
 * Шесть часов — с запасом короче недели, на которую кэшируется карточка.
 *
 * Модулем отдельно от lib/gamepage, а не экспортом оттуда: та тянет lib/server
 * (сессии, заголовки запроса), а сравнению и колоде комнаты он ни к чему.
 *
 * Ключ — сам клиент базы: в проде он один на процесс (lib/server), а тесты с
 * базой в памяти не видят чужих карт.
 *
 * Что НЕ запоминается:
 *   - непрогретая карта (rarityScale её не принимает — самый частый тег реже
 *     MIN_TAG_STATS): потребители всё равно работают по ней «как без
 *     каталога», а запомни её — и каталог, залитый следом, дошёл бы до
 *     подбора только через шесть часов;
 *   - сбой чтения. Без запомненной карты он бросает, как бросал loadTagStats:
 *     пустая карта, отданная молча, перевела бы подбор на «как без каталога»,
 *     и никто бы этого не увидел. С запомненной, пусть и просроченной, —
 *     отдаётся она: шестичасовая карта ничем не хуже свежей.
 *
 * Размер пула (getPoolSize) не запоминается: это одна строка catalog_meta.
 * После заливки он на несколько часов окажется свежее карты — pickQueryTags
 * делит одно на другое, и порог стоп-слов сдвинется на доли процента. Мягко,
 * и сам пройдёт с TTL.
 */
export const TAG_STATS_TTL_SEC = 6 * 3600

const memo = new WeakMap<Db, { at: number; stats: Map<string, number> }>()

export async function tagStatsFor(db: Db, nowSec: number): Promise<Map<string, number>> {
  const hit = memo.get(db)
  if (hit && nowSec - hit.at < TAG_STATS_TTL_SEC) return hit.stats
  try {
    const stats = await loadTagStats(db)
    if (rarityScale(stats) > 0) memo.set(db, { at: nowSec, stats })
    return stats
  } catch (err) {
    if (!hit) throw err
    logSwallowed('tagstats:stale', err)
    return hit.stats
  }
}
