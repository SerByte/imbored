/**
 * Чистая часть генератора русских подписей тегов (scripts/gen-tagsru.ts).
 *
 * Отдельно от скрипта ради теста: склейка по tagid и вид файла проверяются
 * без сети и без базы, а скрипт только добывает словари и пишет результат.
 */

/** Пара «английский ключ → русская подпись» */
export type TagPair = readonly [en: string, ru: string]

/**
 * Меньше пар — это не словарь Steam, а сбой (пустой ответ, HTML вместо JSON,
 * не заполненный name_ru). Файл тогда не перезаписывается: иначе один
 * неудачный прогон молча вернул бы интерфейсу английские теги.
 */
export const MIN_PAIRS = 200

/** Пары из двух словарей Steam — английского и русского, склеенных по tagid */
export function joinTagDictionaries(
  en: ReadonlyMap<number, string>,
  ru: ReadonlyMap<number, string>,
): TagPair[] {
  const out: TagPair[] = []
  for (const [tagid, name] of en) {
    const label = ru.get(tagid)
    if (label !== undefined) out.push([name, label])
  }
  return out
}

/**
 * Пробелы по краям — у Steam они бывают и в ключе («Dystopian »), и в подписи
 * («Динозавры »). tagRu ищет по обрезанному ключу, так что и хранится он
 * обрезанным. Пустые выпадают, повтор ключа — первая пара. Порядок — по
 * кодам символов, а не localeCompare: файл не должен меняться от того, на
 * какой машине и с какой ICU его собрали.
 */
export function normalizePairs(pairs: Iterable<TagPair>): TagPair[] {
  const seen = new Map<string, string>()
  for (const [en, ru] of pairs) {
    const key = en.trim()
    const label = ru.trim()
    if (!key || !label || seen.has(key)) continue
    seen.set(key, label)
  }
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Строка в одинарных кавычках, как во всём проекте; с апострофом — в двойных */
function quote(s: string): string {
  return s.includes("'") ? JSON.stringify(s) : `'${s.replace(/\\/g, '\\\\')}'`
}

/** Текст lib/tagsru.steam.ts */
export function renderTagsRuModule(pairs: readonly TagPair[], source: string): string {
  const lines = pairs.map(([en, ru]) => `  ${quote(en)}: ${quote(ru)},`)
  return [
    '/**',
    ' * СГЕНЕРИРОВАНО scripts/gen-tagsru.ts — руками не править: следующий прогон',
    ' * перезапишет. Кривой перевод Steam чинится в lib/tagsru.overrides.ts, а',
    ' * читается всё через tagRu из lib/tagsru.ts.',
    ' *',
    ` * Источник: ${source}. Пар: ${pairs.length}.`,
    ' */',
    'export const TAGS_RU_STEAM: Readonly<Record<string, string>> = {',
    ...lines,
    '}',
    '',
  ].join('\n')
}
