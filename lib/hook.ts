/**
 * «Чем выделяется» без модели: два характерных тега игры.
 *
 * Правило владельца — никакого нового LLM, поэтому «фишка» здесь не
 * сочиняется, а отбирается из тегов Steam: вес тега в самой игре × его
 * редкость по каталогу (tagWeightFrom в lib/tagweight). Подпись в интерфейсе
 * честная — «Чем выделяется: …», это теги, которые проставили игроки, а не
 * пересказ.
 *
 * Отбор строгий, и null — нормальный ответ. Лучше промолчать, чем написать
 * «Чем выделяется: Indie, Singleplayer»: это описание половины каталога.
 * Поэтому:
 *   - общие теги, похвала, метки платформы и предупреждения о контенте не
 *     проходят никогда (GENERIC_TAGS) — как и жанры самой игры;
 *   - тег должен быть заметен в игре (MIN_SHARE от голосов её главного тега),
 *     а не висеть хвостом списка;
 *   - произведение веса и редкости должно дотянуть до MIN_SCORE;
 *   - без карты тегов (пустой или непрогретый каталог) редкость неизвестна, и
 *     ответ — null, а не «самые частые теги».
 * Два тега одного семейства (Roguelike и Roguelite, Turn-Based Strategy и
 * Turn-Based Tactics) не показываются вместе: второй ничего не добавляет.
 *
 * Модуль чистый: из других модулей — только типы.
 */
import type { TagWeight } from './tagweight'
import type { GameMeta } from './types'

/**
 * Жанры Steam по-английски. Жанры игры приезжают из appdetails на русском
 * (l=russian: «Экшены», «Инди»), и сверка с meta.genres их английские
 * тезки не поймает — поэтому они перечислены здесь явно.
 */
const STEAM_GENRES = [
  'Action',
  'Adventure',
  'Casual',
  'Indie',
  'Massively Multiplayer',
  'Racing',
  'RPG',
  'Simulation',
  'Sports',
  'Strategy',
  'Free to Play',
  'Early Access',
]

/** Теги, которые не бывают «фишкой», как бы редко они ни стояли */
export const GENERIC_TAGS: ReadonlySet<string> = new Set([
  ...STEAM_GENRES,
  // слишком общие: режим, камера, измерение
  'Singleplayer',
  'Single-player',
  'Multiplayer',
  'Multi-player',
  'Co-op',
  'Online Co-Op',
  'Local Co-Op',
  'Local Multiplayer',
  '4 Player Local',
  'Split Screen',
  'Co-op Campaign',
  'PvE',
  'First-Person',
  'Third Person',
  '2D',
  '3D',
  // похвала, а не суть
  'Great Soundtrack',
  'Soundtrack',
  'Masterpiece',
  'Classic',
  'Cult Classic',
  'Beautiful',
  'Addictive',
  'Replay Value',
  'Atmospheric',
  'Epic',
  'Memes',
  // графика «вообще»
  'Pixel Graphics',
  'Colorful',
  'Stylized',
  'Realistic',
  'Cartoony',
  'Cartoon',
  // платформа, управление, происхождение
  'Controller',
  'VR',
  'Moddable',
  'Mod',
  'Remake',
  'Sequel',
  'Reboot',
  'Software',
  'Utilities',
  'Tutorial',
  'Touch-Friendly',
  'Mouse Only',
  'TrackIR',
  // предупреждения о контенте — не повод выбрать игру
  'Nudity',
  'Sexual Content',
  'Hentai',
  'NSFW',
  'Mature',
  'Gore',
  'Violent',
])

/** Доля голосов главного тега игры, ниже которой тег считается хвостом */
const MIN_SHARE = 0.3

/**
 * Порог характерности: доля голосов × редкость (натуральный логарифм «во
 * сколько раз реже самого частого тега»). Тег с половиной голосов лидера у
 * каждой десятой игры каталога даёт 0.5 × ln 10 ≈ 1.15 — проходит; он же у
 * каждой третьей — 0.55, нет.
 */
const MIN_SCORE = 1

/** Слова, по которым семейство не определяется: они есть в чужих тегах */
const FAMILY_STOPWORDS = new Set(['game', 'games', 'based', 'like', 'style', 'simulator', 'player'])

/** Основы слов тега: «Action Roguelike» → action, rogue; «Turn-Based Tactics» → turn, tacti */
function stems(tag: string): string[] {
  return tag
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !FAMILY_STOPWORDS.has(w))
    .map((w) => w.slice(0, 5))
}

/**
 * До k характерных тегов игры, от самого характерного. null — нечего сказать
 * честно: нет карты тегов, нет тегов или ни один не прошёл порог.
 */
export function distinctiveTags(
  meta: Pick<GameMeta, 'tags' | 'genres'>,
  tagWeight: TagWeight | null,
  k = 2,
): string[] | null {
  if (!tagWeight || k <= 0) return null
  const votes = Object.entries(meta.tags ?? {}).filter(
    ([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  )
  const max = Math.max(...votes.map(([, v]) => v), 0)
  if (!max) return null
  const genres = new Set((meta.genres ?? []).map((g) => g.toLowerCase()))

  const ranked = votes
    .filter(([tag]) => !GENERIC_TAGS.has(tag) && !genres.has(tag.toLowerCase()))
    .map(([tag, v]) => {
      const share = v / max
      const rarity = tagWeight(tag)
      return { tag, share, score: share * (Number.isFinite(rarity) ? rarity : 0) }
    })
    .filter((c) => c.share >= MIN_SHARE && c.score >= MIN_SCORE)
    // при равенстве — по имени: порядок ключей tags_json не должен решать
    .sort((a, b) => b.score - a.score || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))

  const picked: string[] = []
  const seen = new Set<string>()
  for (const { tag } of ranked) {
    const own = stems(tag)
    if (own.some((s) => seen.has(s))) continue
    picked.push(tag)
    for (const s of own) seen.add(s)
    if (picked.length >= k) break
  }
  return picked.length ? picked : null
}
