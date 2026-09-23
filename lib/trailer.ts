import { ASSET_BASE, buildAssetUrl } from './art'

/**
 * Трейлер и кадры игры из ответа IStoreBrowseService/GetItems.
 *
 * Модуль чистый и без сервера: его разбор зовёт каталог, чтение из базы —
 * rowToMeta, а тип трейлера — клиентский TrailerPreview.
 *
 * ЧТО ТАКОЕ «ТРЕЙЛЕР» ЗДЕСЬ. Это микротрейлер Steam: короткая нарезка
 * геймплея без звука, та самая, что крутится в магазине при наведении на
 * капсулу. Полных трейлеров файлом Steam больше не отдаёт вовсе: ни GetItems,
 * ни appdetails (проверено в сентябре 2026) — только DASH и HLS, то есть
 * адаптивный поток, для которого браузеру нужен плеер. Микротрейлер же — обычный
 * mp4 и webm, его играет голый <video>, и для вопроса «как это выглядит в
 * движении» его и надо: секунды игры, а не пять минут логотипов.
 *
 * Видео лежит на своём хосте (VIDEO_BASE), постер — среди ассетов магазина
 * (ASSET_BASE). Оба — *.steamstatic.com, и это же проверяет readTrailer при
 * чтении из базы: ссылка уходит в <video src>, и чужой хост туда не попадёт,
 * даже если в строке окажется что-то не от Steam.
 */

/** Хост роликов магазина. Путь из ответа GetItems приклеивается как есть. */
export const VIDEO_BASE = 'https://video.akamai.steamstatic.com/store_trailers/'

/** Домен CDN Steam, с которого разрешены видео и постеры (см. lib/csp.ts). */
export const STEAM_MEDIA_DOMAIN = 'steamstatic.com'

export type Trailer = {
  /** Микротрейлер mp4 — есть у каждого записанного трейлера: без него не пишем */
  mp4: string
  /** Тот же ролик в webm; браузер берёт первый, который умеет */
  webm?: string
  /** Кадр 16:9 из самого ролика: movie_full, у старых трейлеров — 293×165 */
  poster?: string
  /**
   * Полный трейлер потоком HLS. Сейчас не показывается: без плеера его играет
   * только Safari. Лежит, чтобы режим «полный трейлер» не требовал нового
   * обхода каталога.
   */
  hls?: string
}

type VideoSource = { filename?: unknown; type?: unknown }

/** Один трейлер в ответе GetItems (StoreItem_Trailers.Trailer) */
type StoreTrailer = {
  trailer_url_format?: unknown
  microtrailer?: VideoSource[]
  adaptive_trailers?: Array<{ cdn_path?: unknown; encoding?: unknown }>
  screenshot_medium?: unknown
  screenshot_full?: unknown
  all_ages?: unknown
}

export type StoreTrailers = {
  highlights?: StoreTrailer[]
  other_trailers?: StoreTrailer[]
}

export type StoreScreenshots = {
  all_ages_screenshots?: Array<{ filename?: unknown; ordinal?: unknown }>
}

/**
 * Путь из ответа — буквы, цифры и /._- без «..», плюс отметка версии ?t=
 * у кадров. Он приклеивается к хосту Steam, и всё, что похоже на смену хоста
 * или выход из каталога, отбрасываем.
 */
const SAFE_PATH = /^[\w./-]+(\?t=\d+)?$/

function safePath(v: unknown): string | null {
  return typeof v === 'string' && SAFE_PATH.test(v) && !v.includes('..') && !v.startsWith('/')
    ? v
    : null
}

function sourceOf(list: VideoSource[] | undefined, mime: string): string | null {
  if (!Array.isArray(list)) return null
  for (const s of list) {
    if (typeof s?.type === 'string' && s.type.startsWith(mime)) {
      const file = safePath(s.filename)
      if (file) return VIDEO_BASE + file
    }
  }
  return null
}

/**
 * Постер: полный кадр, а без него средний. Путь в ответе относительный, и
 * склеивается он по trailer_url_format того же трейлера — ровно как арт по
 * asset_url_format (lib/art.ts).
 */
function posterOf(t: StoreTrailer): string | null {
  const format = typeof t.trailer_url_format === 'string' ? t.trailer_url_format : ''
  if (!format.includes('${FILENAME}')) return null
  const file = safePath(t.screenshot_full) ?? safePath(t.screenshot_medium)
  return file ? buildAssetUrl(format, file) : null
}

/**
 * Трейлер для показа: первый ролик с all_ages среди highlights, а если там
 * ни одного — среди остальных трейлеров.
 *
 * all_ages — не формальность. У HELLDIVERS 2 первые два трейлера за
 * возрастным порогом, и Steam сам показывает их только после вопроса о дате
 * рождения. Наша страница такого вопроса не задаёт и задавать не будет, так
 * что берём первый ролик, который Steam показывает всем.
 *
 * Запасной список нужен старым играм: у Left 4 Dead 2 и Civilization V
 * highlights пуст, а трейлеры лежат в other_trailers.
 *
 * Без mp4 микротрейлера ролик пропускается: webm Safari на iOS играет не
 * везде, а трейлер, который не откроется у половины телефонов, хуже его
 * отсутствия.
 */
export function parseStoreTrailer(trailers: StoreTrailers | null | undefined): Trailer | null {
  if (!trailers || typeof trailers !== 'object') return null
  const all = [
    ...(Array.isArray(trailers.highlights) ? trailers.highlights : []),
    ...(Array.isArray(trailers.other_trailers) ? trailers.other_trailers : []),
  ]
  for (const t of all) {
    if (!t || t.all_ages !== true) continue
    const mp4 = sourceOf(t.microtrailer, 'video/mp4')
    if (!mp4) continue
    const out: Trailer = { mp4 }
    const webm = sourceOf(t.microtrailer, 'video/webm')
    if (webm) out.webm = webm
    const poster = posterOf(t)
    if (poster) out.poster = poster
    const hls = (Array.isArray(t.adaptive_trailers) ? t.adaptive_trailers : []).find(
      (a) => a?.encoding === 'hls_h264',
    )
    const hlsPath = safePath(hls?.cdn_path)
    if (hlsPath) out.hls = VIDEO_BASE + hlsPath
    return out
  }
  return null
}

/** Сколько кадров храним — столько же, сколько отдаёт разбор appdetails */
export const STORE_SHOTS_MAX = 8

/** Размер уже есть в имени — `ss_….600x338.jpg`; второй не приписываем */
const HAS_SIZE = /\.\d+x\d+\.(jpe?g|png)(?=$|\?)/i
const EXT = /\.(jpe?g|png)(?=$|\?)/i

/**
 * Кадры из ответа GetItems — в том же виде, в каком их кладёт appdetails.
 *
 * GetItems отдаёт имя без размера: `…/ss_<hash>.jpg`. Файл по такому адресу
 * существует, но это исходник, и lib/shots не сможет выбрать для слайдера
 * лёгкий кадр: shotUrl меняет размер ТОЛЬКО в имени вида `.1920x1080.jpg`.
 * Поэтому размер вписываем сразу — ровно так выглядит path_full у appdetails,
 * и оба размера отвечают 200 и у контент-адресуемых путей, и у старых
 * числовых имён вроде `0000002574.jpg` у Team Fortress 2 (проверено).
 *
 * Только all_ages: кадры за возрастным порогом Steam сам прячет за вопросом о
 * дате рождения — так же, как трейлеры выше.
 */
export function parseStoreScreenshots(shots: StoreScreenshots | null | undefined): string[] {
  const list = Array.isArray(shots?.all_ages_screenshots) ? shots.all_ages_screenshots : []
  return list
    .map((s) => ({ file: safePath(s?.filename), ordinal: Number(s?.ordinal) || 0 }))
    .filter((s): s is { file: string; ordinal: number } => s.file !== null && EXT.test(s.file))
    .sort((a, b) => a.ordinal - b.ordinal)
    .slice(0, STORE_SHOTS_MAX)
    .map(({ file }) =>
      ASSET_BASE + (HAS_SIZE.test(file) ? file : file.replace(EXT, (_, ext: string) => `.1920x1080.${ext}`)),
    )
}

/** https и хост Steam — иначе ссылку в <video> и <img> не пускаем */
function isSteamMedia(v: unknown): v is string {
  if (typeof v !== 'string') return false
  try {
    const u = new URL(v)
    return (
      u.protocol === 'https:' &&
      (u.hostname === STEAM_MEDIA_DOMAIN || u.hostname.endsWith(`.${STEAM_MEDIA_DOMAIN}`))
    )
  } catch {
    return false
  }
}

/**
 * trailer_json → Trailer. Битая строка, чужой хост или трейлер без mp4 дают
 * undefined: у игры просто не будет трейлера, как у игры без него.
 */
export function readTrailer(json: string | null | undefined): Trailer | undefined {
  if (!json) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (!isSteamMedia(r.mp4)) return undefined
  const out: Trailer = { mp4: r.mp4 }
  if (isSteamMedia(r.webm)) out.webm = r.webm
  if (isSteamMedia(r.poster)) out.poster = r.poster
  if (isSteamMedia(r.hls)) out.hls = r.hls
  return out
}
