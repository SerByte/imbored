/**
 * Ссылки на витринный арт Steam.
 *
 * Valve перевёл ассеты магазина на контент-адресуемые пути вида
 * `store_item_assets/steam/apps/{appid}/{hash}/{filename}`: хэш свой у каждого ассета,
 * а имя файла не угадывается (у части игр канонического header.jpg просто нет —
 * например у PEAK это header_alt_assets_3.jpg). Поэтому URL нельзя построить,
 * его нужно резолвить через IStoreBrowseService/GetItems и хранить в базе.
 *
 * Плоский путь без хэша остался живым только для приложений, существовавших
 * до перехода, и служит здесь запасным вариантом для ещё не резолвленных строк.
 */

/** Канонический хост. У shared.cloudflare тот же контент, но через лишний 301. */
export const ASSET_BASE = 'https://shared.steamstatic.com/store_item_assets/'

/** Ассеты из ответа GetItems: значения — это `{hash}/{filename}`, без хоста. */
export type StoreAssets = {
  asset_url_format?: string
  header?: string
  main_capsule?: string
  small_capsule?: string
  library_capsule?: string
}

/** Порядок деградации: от широкого баннера к вертикальной капсуле. */
const ASSET_ORDER = ['header', 'main_capsule', 'small_capsule', 'library_capsule'] as const

export function buildAssetUrl(format: string, filename: string): string | null {
  if (!format || !filename) return null
  return ASSET_BASE + format.replace('${FILENAME}', filename)
}

/** Готовые ссылки из ответа GetItems, в порядке предпочтения. */
export function parseStoreAssets(assets: StoreAssets | undefined | null): string[] {
  if (!assets?.asset_url_format) return []
  const out: string[] = []
  for (const key of ASSET_ORDER) {
    const url = buildAssetUrl(assets.asset_url_format, assets[key] ?? '')
    if (url) out.push(url)
  }
  return out
}

/** Плоский путь без хэша: работает у игр, вышедших до перехода Valve. */
export function legacyHeaderUrl(appid: number): string {
  return `${ASSET_BASE}steam/apps/${appid}/header.jpg`
}

/**
 * Что показывать для игры: сначала резолвленная ссылка из базы, затем — запасной
 * шаблон Steam. У игр вне Steam appid отрицательный, и шаблон к ним неприменим.
 */
export function artCandidates(game: { appid: number; headerImage?: string | null }): string[] {
  const out: string[] = []
  if (game.headerImage) out.push(game.headerImage)
  if (game.appid > 0) {
    const legacy = legacyHeaderUrl(game.appid)
    if (!out.includes(legacy)) out.push(legacy)
  }
  return out
}
