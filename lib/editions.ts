import { cleanTitle } from './series'

/**
 * «Та же игра, другая коробка».
 *
 * Задача не та, что у series.ts. Там решается, куда переехала аудитория —
 * вопрос про мир, с ccu, издателем и порогами. Здесь чистая работа со строкой:
 * «Hellblade: Senua's Sacrifice» и «Hellblade: Senua's Sacrifice VR Edition» —
 * это два appid, две записи в библиотеке и одна игра. Ни одна защита «не
 * показывай дважды» в проекте такую пару не ловила: все они по appid, а appid
 * у изданий разные. На полке «Ты забыл, что они у тебя есть» они стояли рядом,
 * с одинаковой обложкой.
 *
 * buildSeriesIndex для этого не годится дважды: он пропускает всё
 * немультиплеерное, а parseSeries режет название по первому двоеточию —
 * основой обеих Hellblade стало бы просто «hellblade».
 */

/**
 * Слова, которых достаточно самих по себе, чтобы объявить хвост изданием:
 * «Skyrim VR», «Batman: Arkham City GOTY», «Metro 2033 Redux».
 */
const EDITION_ANCHORS = new Set(['edition', 'goty', 'vr', 'remaster', 'remastered', 'redux'])

/**
 * Слова, которые уезжают ВМЕСТЕ с якорем, но сами по себе не значат ничего.
 *
 * Разделение на два класса — единственное, что отличает «Skyrim Special
 * Edition» (издание) от «Tomb Raider: Anniversary» (отдельная игра 2007 года),
 * «Hogwarts Legacy» и «Halo: The Master Chief Collection». Сделай их якорями —
 * и все три схлопнутся с чужими играми.
 */
const EDITION_QUALIFIERS = new Set([
  // game of the year
  'game', 'of', 'the', 'year',
  'deluxe', 'complete', 'ultimate', 'anniversary', 'gold', 'premium', 'standard',
  'special', 'legacy', 'classic', 'original', 'enhanced', 'definitive',
  'reforged', 'remake', 'hd', 'collection', 'digital', 'upgrade',
])

/** Отдельно стоящий разделитель: «Wild Hunt - Game of the Year Edition» */
const SEPARATOR_TOKEN = /^[-–—:]+$/

/**
 * «Director's Cut» ловим ДО cleanTitle: апостроф там станет пробелом, и от
 * фразы останется бессвязное «director s cut».
 */
const DIRECTORS_CUT_RE = /\bdirector'?s\s+cut\b/gi

/** Ключ короче двух знаков — это не игра, а огрызок; лучше вернуть как было */
const MIN_KEY_LENGTH = 2

/**
 * Ключ, одинаковый у всех изданий одной игры.
 *
 * Срезает с конца непрерывную цепочку служебных слов — но только если в ней
 * есть хотя бы один якорь. Скан по токенам, а не одна регулярка: только так
 * выражается «срезай маркеры, но не трогай маркер, стоящий в одиночку».
 *
 * Числа не трогаются НИКОГДА — ни арабские, ни римские, ни годы. Portal и
 * Portal 2 разные игры, Civilization V и VI тоже, FIFA 22 и FIFA 23 тем более,
 * а «Dead Space (2008)» — отдельная запись, а не издание ремейка.
 *
 * Осознанные промахи: «DOOM 3: BFG Edition» даёт «doom 3: bfg» и с «DOOM 3» не
 * сходится, как и «DARK SOULS: Prepare to Die Edition», «Mass Effect Legendary
 * Edition». Любое правило «дотягивать срез до предыдущего разделителя» их
 * чинит — и одновременно сливает «Batman: Arkham Asylum» с «Batman: Arkham
 * City» в общий «batman». Промах дешевле такого схлопывания.
 */
export function editionKey(name: string): string {
  const base = cleanTitle(name.replace(DIRECTORS_CUT_RE, ' edition '))
  const tokens = base.split(' ').filter(Boolean)

  let cut = tokens.length
  let anchored = false
  while (cut > 0) {
    const token = tokens[cut - 1]
    if (EDITION_ANCHORS.has(token)) {
      anchored = true
      cut--
      continue
    }
    if (EDITION_QUALIFIERS.has(token) || SEPARATOR_TOKEN.test(token)) {
      cut--
      continue
    }
    break
  }
  // cut === 0 — название целиком из маркеров: игра, названная «VR», остаётся собой
  if (!anchored || cut === 0) return base

  // Хвостовой разделитель снимаем, точку — нет: «F.E.A.R. Gold Edition»
  // обязана совпасть с «F.E.A.R.», а не превратиться в «f.e.a.r»
  const stripped = tokens.slice(0, cut).join(' ').replace(/[:\s-]+$/, '')
  return stripped.length >= MIN_KEY_LENGTH ? stripped : base
}

/** Несёт ли название пометку издания: «…VR Edition» — да, «Hellblade» — нет */
export function isVariantName(name: string): boolean {
  return editionKey(name) !== cleanTitle(name)
}

/**
 * Оставляет по одной записи на ключ издания.
 *
 * Позиция группы — по ПЕРВОМУ вхождению ключа: там, где вход уже отранжирован,
 * схлопывание не имеет права двигать порядок. Победителя внутри группы выбирает
 * переданный компаратор (отрицательное — «претендент лучше»), потому что политик
 * две: на полке побеждает канон, в подборе — первый, ведь входной порядок и есть
 * ранжирование, а оно знает больше, чем строка названия.
 *
 * Записи с пустым ключом не схлопываются ни с кем — иначе все стабы без имени
 * слиплись бы в один.
 */
export function collapseEditions<T>(
  items: T[],
  nameOf: (item: T) => string,
  better: (challenger: T, current: T) => number,
): T[] {
  const winners = new Map<string, T>()
  const slots: Array<{ key: string; kept: T }> = []

  for (const item of items) {
    const key = editionKey(nameOf(item))
    if (!key) {
      slots.push({ key: '', kept: item })
      continue
    }
    const current = winners.get(key)
    if (current === undefined) {
      winners.set(key, item)
      slots.push({ key, kept: item })
      continue
    }
    if (better(item, current) < 0) winners.set(key, item)
  }

  return slots.map((slot) => (slot.key ? winners.get(slot.key)! : slot.kept))
}
