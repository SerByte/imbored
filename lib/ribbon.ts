import { legacyArtUrl } from './art'
import type { GameArtUrls } from './art'

/**
 * Обложки для ленты главной.
 *
 * Лента идёт за всеми сценами и потому обязана существовать всегда — в том
 * числе на пустой базе, где `topCatalogGames` вернёт ноль строк. Локально и в
 * превью TURSO_DATABASE_URL не задан, и это нормальное состояние, а не поломка
 * (образец обработки — `shelf()` в app/not-found.tsx). Пустая лента превратила
 * бы кино-главную в чёрный экран.
 *
 * Поэтому здесь две вещи: чистый отбор, который можно проверить без базы, и
 * зашитый запасной список на случай молчания каталога.
 */

/** Строка каталога в том виде, в каком её отдаёт topCatalogGames. */
export type RibbonSource = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
}

export type RibbonGame = {
  appid: number
  name: string
  /** Готовая ссылка на обложку 460×215 — лента другого размера не показывает. */
  src: string
}

/**
 * Сколько обложек нужно ленте.
 *
 * Нижняя граница не с потолка: колонок на широком экране до двенадцати, и
 * блок в колонке повторяется дважды. Меньше восемнадцати уникальных обложек —
 * и одна и та же игра встаёт рядом сама с собой в соседних колонках, что
 * читается как ошибка загрузки, а не как лента.
 */
export const RIBBON_MIN = 18
/** Верхняя — про трафик: каждая обложка это отдельный запрос к CDN Steam. */
export const RIBBON_MAX = 28

/**
 * Запасной список: давние игры, у которых ещё жив плоский путь к ассету.
 *
 * Тот же набор, что стоял в прежнем кино-фоне главной. Он намеренно из
 * узнаваемого: лента должна читаться как «полка игр», а не как случайный шум,
 * и в состоянии деградации это важнее свежести.
 */
export const FALLBACK_RIBBON: ReadonlyArray<{ appid: number; name: string }> = [
  { appid: 1245620, name: 'Elden Ring' },
  { appid: 1091500, name: 'Cyberpunk 2077' },
  { appid: 292030, name: 'The Witcher 3' },
  { appid: 1086940, name: "Baldur's Gate 3" },
  { appid: 632470, name: 'Disco Elysium' },
  { appid: 753640, name: 'Outer Wilds' },
  { appid: 1145360, name: 'Hades' },
  { appid: 548430, name: 'Deep Rock Galactic' },
  { appid: 367520, name: 'Hollow Knight' },
  { appid: 504230, name: 'Celeste' },
  { appid: 588650, name: 'Dead Cells' },
  { appid: 427520, name: 'Factorio' },
  { appid: 570, name: 'Dota 2' },
  { appid: 730, name: 'Counter-Strike 2' },
  { appid: 413150, name: 'Stardew Valley' },
  { appid: 105600, name: 'Terraria' },
  { appid: 892970, name: 'Valheim' },
  { appid: 646570, name: 'Slay the Spire' },
]

/** Ссылка на обложку: резолвленная, потом сохранённая, потом шаблон Steam. */
function coverUrl(g: RibbonSource): string | null {
  return g.art?.header ?? g.headerImage ?? (g.appid > 0 ? legacyArtUrl(g.appid, 'header') : null)
}

/**
 * Что показывает лента: каталог, добитый до минимума запасным списком.
 *
 * Чистая функция от строк каталога — базу в тесте поднимать не нужно, а
 * состояние деградации проверяется тем же прогоном, что и обычное.
 */
export function ribbonGames(catalog: readonly RibbonSource[]): RibbonGame[] {
  const seen = new Set<number>()
  const out: RibbonGame[] = []

  for (const g of catalog) {
    if (out.length >= RIBBON_MAX) break
    if (g.appid <= 0 || seen.has(g.appid)) continue
    const src = coverUrl(g)
    if (!src) continue
    seen.add(g.appid)
    out.push({ appid: g.appid, name: g.name, src })
  }

  // Добор, а не подмена: если каталог отдал десять живых строк, десять живых и
  // останутся, а недостающие восемь придут из запасного списка.
  for (const g of FALLBACK_RIBBON) {
    if (out.length >= RIBBON_MIN) break
    if (seen.has(g.appid)) continue
    seen.add(g.appid)
    out.push({ appid: g.appid, name: g.name, src: legacyArtUrl(g.appid, 'header') })
  }

  return out
}
