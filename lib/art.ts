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
 *
 * Размеры отличаются на порядок, поэтому важно брать ассет под место:
 * header 460×215, header_2x 920×430, main_capsule 616×353,
 * library_hero 1920×620, library_hero_2x 3840×1240.
 */

/** Канонический хост. У shared.cloudflare тот же контент, но через лишний 301. */
export const ASSET_BASE = 'https://shared.steamstatic.com/store_item_assets/'

/** Резолвленные ссылки на арт одной игры. */
export type GameArtUrls = {
  /** 460×215 — плитка в сетке */
  header?: string
  /** 920×430 — она же на retina */
  header2x?: string
  /** 616×353 — запасной для плитки */
  capsule?: string
  /** 1920×620 — полноэкранный герой */
  hero?: string
  /** 3840×1240 — герой на широких экранах */
  hero2x?: string
}

/** Сырые ассеты из ответа GetItems: значения — `{hash}/{filename}`, без хоста. */
export type StoreAssets = Record<string, string | undefined> & { asset_url_format?: string }

/** Ключ в ответе Steam -> поле у нас */
const ASSET_KEYS: Array<[keyof GameArtUrls, string]> = [
  ['header', 'header'],
  ['header2x', 'header_2x'],
  ['capsule', 'main_capsule'],
  ['hero', 'library_hero'],
  ['hero2x', 'library_hero_2x'],
]

/** Ширина ассета в пикселях — для дескрипторов srcSet */
const WIDTH: Record<keyof GameArtUrls, number> = {
  header: 460,
  header2x: 920,
  capsule: 616,
  hero: 1920,
  hero2x: 3840,
}

export type ArtVariant = 'card' | 'hero'

/** Порядок деградации для каждого места. Герой начинается с широкого арта. */
const ORDER: Record<ArtVariant, Array<keyof GameArtUrls>> = {
  hero: ['hero', 'capsule', 'header'],
  card: ['header', 'capsule'],
}

export function buildAssetUrl(format: string, filename: string): string | null {
  if (!format || !filename) return null
  return ASSET_BASE + format.replace('${FILENAME}', filename)
}

export function parseStoreAssets(assets: StoreAssets | undefined | null): GameArtUrls {
  const out: GameArtUrls = {}
  if (!assets?.asset_url_format) return out
  for (const [field, key] of ASSET_KEYS) {
    const url = buildAssetUrl(assets.asset_url_format, assets[key] ?? '')
    if (url) out[field] = url
  }
  return out
}

/** Плоский путь без хэша: работает у игр, вышедших до перехода Valve. */
export function legacyArtUrl(appid: number, kind: 'header' | 'hero'): string {
  const file = kind === 'hero' ? 'library_hero.jpg' : 'header.jpg'
  return `${ASSET_BASE}steam/apps/${appid}/${file}`
}

type ArtSource = { appid: number; art?: GameArtUrls | null; headerImage?: string | null }

/**
 * Что показывать: сначала резолвленные ссылки нужного размера, затем сохранённый
 * header_image (строки, прогретые до появления art_json), затем запасные шаблоны
 * Steam. У игр вне Steam appid отрицательный, и шаблоны к ним неприменимы.
 */
export function artCandidates(game: ArtSource, variant: ArtVariant = 'card'): string[] {
  const out: string[] = []
  const push = (url: string | undefined | null) => {
    if (url && !out.includes(url)) out.push(url)
  }

  const art = game.art ?? {}
  // герой пробует шаблон широкого арта раньше, чем узкий header из базы
  if (variant === 'hero') {
    push(art.hero)
    if (game.appid > 0) push(legacyArtUrl(game.appid, 'hero'))
  }
  for (const key of ORDER[variant]) push(art[key])
  push(game.headerImage)
  if (game.appid > 0) push(legacyArtUrl(game.appid, 'header'))
  return out
}

/**
 * Дескрипторы ширины, а не `2x`: тогда браузер выбирает по ширине вьюпорта и не
 * тянет 1.7 МБ на обычный монитор. Без второго размера srcSet бессмысленен.
 */
export function artSrcSet(game: ArtSource, variant: ArtVariant = 'card'): string | undefined {
  const art = game.art ?? {}
  const pair: Array<keyof GameArtUrls> = variant === 'hero' ? ['hero', 'hero2x'] : ['header', 'header2x']
  const parts = pair.filter((k) => art[k]).map((k) => `${art[k]} ${WIDTH[k]}w`)
  return parts.length > 1 ? parts.join(', ') : undefined
}
