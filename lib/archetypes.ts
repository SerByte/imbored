import { tr, type Locale } from './i18n'

/**
 * Архетипы портрета игрока: тег Steam → кто ты («стрелок», «стратег»).
 *
 * Отдельный модуль без зависимостей, кроме lib/i18n: подписи нужны и сборке
 * портрета (lib/portrait тянет движок подбора), и запасному тексту
 * (lib/portraitvoice), и промпту модели, — а тянуть движок ради словаря
 * незачем.
 *
 * КЛЮЧ АРХЕТИПА — КАНОНИЧЕСКИЙ ТЕГ, А НЕ ПОДПИСЬ.
 *
 * Синонимы (FPS и Shooter, семейство рогаликов, RPG и Action RPG, два
 * кооператива, карточные и колодостроение) схлопываются в один архетип, и
 * раньше схлопывались по русской подписи: одинаковая подпись — один архетип.
 * С двумя языками это сломалось бы на первом же расхождении словарей: где
 * по-русски два синонима дали одну подпись, а по-английски две, проценты,
 * четвёрка и заголовок-диагноз у одной библиотеки разошлись бы между /portrait
 * и /en/portrait. А подписи едут ещё и в промпт модели. Поэтому архетип
 * определяет ключ, а подпись — только вывод: один расчёт на оба языка.
 *
 * Ключ неизвестного тега — сам тег: подпись у него запасная («фанат Fantasy»
 * / «Fantasy fan»), и в заголовок её не выносят (known: false в lib/portrait).
 * Неизвестный тег с каноническим совпасть не может: всякий тег из словаря
 * известен.
 */

/**
 * Подписи по каноническому тегу. Порядок — как был у русского словаря.
 *
 * По-английски — голое существительное, без артикля: подпись встаёт в
 * «you're 37% strategist and 20% factory builder» (portraitFallbackText) и
 * в заголовок «Diagnosis» на портрете. Шутка русской подписи переносится
 * смыслом: «любитель боли» — «pain enjoyer», как говорят про соулслайки.
 */
const ARCHETYPES = {
  Automation: { ru: 'строитель фабрик', en: 'factory builder' },
  'Base Building': { ru: 'строитель баз', en: 'base builder' },
  Roguelike: { ru: 'рогалик-энтузиаст', en: 'roguelike junkie' },
  'Story Rich': { ru: 'охотник за историями', en: 'story hunter' },
  MOBA: { ru: 'ветеран MOBA', en: 'MOBA veteran' },
  FPS: { ru: 'стрелок', en: 'sharpshooter' },
  'Tactical FPS': { ru: 'тактический стрелок', en: 'tactical sharpshooter' },
  Competitive: { ru: 'соревновательный зверь', en: 'competitive beast' },
  'Open World': { ru: 'исследователь открытых миров', en: 'open-world explorer' },
  Survival: { ru: 'выживальщик', en: 'survivalist' },
  'Farming Sim': { ru: 'мирный фермер', en: 'peaceful farmer' },
  Strategy: { ru: 'стратег', en: 'strategist' },
  Tactical: { ru: 'тактик', en: 'tactician' },
  RPG: { ru: 'ролевик', en: 'role-player' },
  'Co-op': { ru: 'кооп-игрок', en: 'co-op player' },
  Puzzle: { ru: 'головоломщик', en: 'puzzle solver' },
  Sandbox: { ru: 'архитектор песочниц', en: 'sandbox architect' },
  Metroidvania: { ru: 'картограф метроидваний', en: 'metroidvania mapper' },
  'Souls-like': { ru: 'терпеливый соулслайкер', en: 'patient soulslike player' },
  'Card Game': { ru: 'мастер колоды', en: 'deck master' },
  Difficult: { ru: 'любитель боли', en: 'pain enjoyer' },
  Simulation: { ru: 'симуляторщик', en: 'sim enthusiast' },
  'Colony Sim': { ru: 'управляющий колонией', en: 'colony manager' },
  Horror: { ru: 'любитель ужасов', en: 'horror buff' },
  Platformer: { ru: 'платформер-про', en: 'platformer pro' },
  Crafting: { ru: 'крафтер', en: 'crafter' },
  Exploration: { ru: 'исследователь', en: 'explorer' },
  MMORPG: { ru: 'житель MMO', en: 'MMO resident' },
  'Battle Royale': { ru: 'боец королевских битв', en: 'battle royale fighter' },
  Mining: { ru: 'шахтёр', en: 'miner' },
  'Turn-Based': { ru: 'пошаговый мыслитель', en: 'turn-based thinker' },
} satisfies Record<string, Record<Locale, string>>

/**
 * Синоним → канонический тег. Синоним — тег, который по смыслу тот же
 * архетип: прежний словарь давал им одну и ту же подпись.
 */
const SYNONYMS: Readonly<Record<string, keyof typeof ARCHETYPES>> = {
  Roguelite: 'Roguelike',
  'Action Roguelike': 'Roguelike',
  Shooter: 'FPS',
  'Action RPG': 'RPG',
  'Online Co-Op': 'Co-op',
  'Deck Building': 'Card Game',
}

/** hasOwn, а не in: у объекта есть наследованные constructor и toString */
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** Ключ архетипа по тегу Steam: канонический тег для синонима, иначе сам тег */
export function archetypeKey(tag: string): string {
  return has(SYNONYMS, tag) ? SYNONYMS[tag] : tag
}

/** Есть ли у архетипа подпись в словаре; запасную («фанат X») в заголовок не выносят */
export function isKnownArchetype(key: string): boolean {
  return has(ARCHETYPES, archetypeKey(key))
}

/**
 * Подпись архетипа на языке страницы. Принимает и ключ, и любой тег Steam:
 * синоним сводится к своему ключу.
 *
 * Неизвестный тег — «фанат {тег}» / «{tag} fan»: тег английский и так
 * (docs/i18n.md, «ключи тегов»), переводится только слово вокруг.
 */
export function archetypeLabel(key: string, locale: Locale = 'ru'): string {
  const k = archetypeKey(key)
  if (has(ARCHETYPES, k)) return ARCHETYPES[k as keyof typeof ARCHETYPES][locale]
  return tr(locale, { ru: `фанат ${k}`, en: `${k} fan` })
}
