import { legacyArtUrl } from './art'
import { getGamesMeta, saveLibrarySnapshot, upsertGamesMeta, upsertUser, type Db } from './db'
import { seedOtherStores } from './otherstores'
import type { GameMeta, LibraryGame } from './types'

/**
 * Демо-режим: правдоподобная библиотека + метаданные, чтобы всё приложение
 * работало без STEAM_API_KEY и сети. Теги приближены к реальным тегам Steam.
 */

const H = 60 // минуты в часе
const DAY = 86_400

function meta(
  appid: number,
  name: string,
  tags: Record<string, number>,
  categories: number[],
  shortDescription: string,
  priceFinal?: number,
): GameMeta {
  return {
    appid,
    name,
    tags,
    genres: [],
    categories,
    shortDescription,
    headerImage: legacyArtUrl(appid, 'header'),
    // демо-игры давние, у них живы плоские пути — включая широкий арт героя
    art: { header: legacyArtUrl(appid, 'header'), hero: legacyArtUrl(appid, 'hero') },
    ...(priceFinal !== undefined ? { priceFinal } : {}),
  }
}

// Категории Steam: 2 SP, 1 MP, 9 Co-op, 38 Online Co-op, 36 Online PvP, 49 PvP, 39 Split Screen
const SP = [2]
const COOP = [2, 1, 9, 38]
const PVP = [1, 36, 49]
const MIXED = [2, 1, 9, 38, 36]

export const DEMO_METAS: GameMeta[] = [
  meta(570, 'Dota 2', { MOBA: 5000, Multiplayer: 4200, Competitive: 3800, Strategy: 2900, 'Team-Based': 2500 }, PVP, 'Командная MOBA, где каждая катка — новая история.'),
  meta(730, 'Counter-Strike 2', { FPS: 6000, Shooter: 5200, Competitive: 4800, Multiplayer: 4500, Tactical: 3000 }, PVP, 'Тактический шутер номер один.'),
  meta(292030, 'The Witcher 3: Wild Hunt', { RPG: 6500, 'Open World': 6000, 'Story Rich': 5800, Fantasy: 4200, Atmospheric: 3900 }, SP, 'Охотник на чудовищ в огромном открытом мире.', 3999),
  meta(1145360, 'Hades', { Roguelike: 5200, 'Action Roguelike': 4800, 'Story Rich': 3500, Difficult: 3000, 'Fast-Paced': 2600 }, SP, 'Побег из царства мёртвых, раз за разом.'),
  meta(413150, 'Stardew Valley', { 'Farming Sim': 6200, Relaxing: 5500, Cozy: 4800, 'Life Sim': 4200, Multiplayer: 3000, Pixel: 2800 }, COOP, 'Своя ферма, город и неспешная жизнь.'),
  meta(105600, 'Terraria', { Sandbox: 5800, Adventure: 4900, Crafting: 4100, '2D': 3800, Multiplayer: 3600, Exploration: 3300 }, COOP, 'Копай, строй, сражайся — 2D-песочница без границ.'),
  meta(504230, 'Celeste', { Platformer: 5400, Difficult: 5100, 'Pixel Graphics': 4200, 'Great Soundtrack': 3800, Atmospheric: 3200 }, SP, 'Платформер о подъёме на гору и о себе.', 1999),
  meta(367520, 'Hollow Knight', { Metroidvania: 6100, 'Souls-like': 4400, Atmospheric: 4900, Difficult: 4300, Exploration: 4000 }, SP, 'Мрачное королевство жуков и стали.', 1499),
  meta(427520, 'Factorio', { Automation: 6300, 'Base Building': 5200, Strategy: 4400, Sandbox: 3900, Multiplayer: 3100 }, COOP, 'Фабрика должна расти.'),
  meta(294100, 'RimWorld', { 'Colony Sim': 6000, Strategy: 4800, Sandbox: 4200, Survival: 3800, 'Story Generator': 3500 }, SP, 'Генератор историй о колонии на краю галактики.'),
  meta(646570, 'Slay the Spire', { 'Card Game': 5700, Roguelike: 5400, 'Deck Building': 5100, Strategy: 4300, 'Turn-Based': 3600 }, SP, 'Карточный рогалик, съевший тысячи вечеров.'),
  meta(548430, 'Deep Rock Galactic', { 'Co-op': 5900, FPS: 4700, Multiplayer: 4400, Mining: 3800, 'Class-Based': 3200 }, COOP, 'Гномы-шахтёры против пещерных жуков. Rock and Stone!'),
  meta(892970, 'Valheim', { Survival: 5800, 'Open World': 4900, Crafting: 4500, 'Co-op': 4300, Vikings: 3900 }, COOP, 'Выживание викингов в процедурном чистилище.'),
  meta(1086940, "Baldur's Gate 3", { RPG: 6600, 'Story Rich': 5900, 'Turn-Based': 4800, Fantasy: 4500, 'Co-op': 3800, 'Choices Matter': 3600 }, MIXED, 'Грандиозная RPG по D&D, где выбор решает всё.', 5999),
  meta(1245620, 'Elden Ring', { 'Souls-like': 6400, 'Open World': 5800, Difficult: 5200, Fantasy: 4600, Atmospheric: 4300 }, MIXED, 'Междуземье ждёт погасшего.'),
  meta(1091500, 'Cyberpunk 2077', { 'Open World': 6100, RPG: 5600, 'Story Rich': 5000, Cyberpunk: 4900, Atmospheric: 4000 }, SP, 'Найт-Сити: хром, неон и цена мечты.', 5999),
  meta(264710, 'Subnautica', { Survival: 5700, 'Open World': 4800, Underwater: 4500, Exploration: 4400, Atmospheric: 4200 }, SP, 'Океан чужой планеты: красиво и страшно.', 2999),
  meta(753640, 'Outer Wilds', { Exploration: 5900, Mystery: 5200, 'Space': 4800, Atmospheric: 4700, 'Story Rich': 4400 }, SP, 'Солнечная система в петле времени: 22 минуты до сверхновой.', 2499),
  meta(632470, 'Disco Elysium', { RPG: 6000, 'Story Rich': 5900, Detective: 5100, 'Choices Matter': 4800, Atmospheric: 4300 }, SP, 'Детектив, который забыл всё — даже себя.', 3999),
  meta(1794680, 'Vampire Survivors', { 'Action Roguelike': 5600, Arcade: 4900, Casual: 4400, 'Pixel Graphics': 3800, Relaxing: 3200 }, SP, 'Полчаса — и «ещё одна катка» до утра.'),
  meta(588650, 'Dead Cells', { Roguelike: 5500, Metroidvania: 5000, 'Fast-Paced': 4400, Difficult: 4100, Platformer: 3700 }, SP, 'Мёртвая клетка бежит, умирает и снова бежит.'),
  meta(620, 'Portal 2', { Puzzle: 6200, 'Co-op': 5100, 'Story Rich': 4600, Comedy: 4400, 'Sci-fi': 3900 }, COOP, 'Порталы, GLaDOS и лучший кооп-пазл на свете.'),
  // ---- пул «попробуй новое» (не куплены) ----
  meta(1426210, 'It Takes Two', { 'Co-op': 6500, 'Split Screen': 5200, Adventure: 4800, Platformer: 4200, Story: 3900 }, [1, 9, 38, 39], 'Кооп-приключение строго на двоих.', 3999),
  meta(814380, 'Sekiro: Shadows Die Twice', { 'Souls-like': 6100, Difficult: 5800, Ninja: 4600, Action: 4400, Atmospheric: 4000 }, SP, 'Стальной клинок, одна жизнь, никакой пощады.', 5999),
  meta(526870, 'Satisfactory', { Automation: 5900, 'Base Building': 5300, 'Open World': 4600, 'Co-op': 4300, Exploration: 3700 }, COOP, 'Фабрика от первого лица на чужой планете.', 3999),
  meta(632360, 'Risk of Rain 2', { 'Action Roguelike': 5500, 'Co-op': 4900, 'Third-Person Shooter': 4300, Difficult: 3900, 'Fast-Paced': 3600 }, COOP, 'Рогалик-шутер, где сложность растёт со временем.', 2499),
  meta(1966720, 'Lethal Company', { 'Co-op': 6000, Horror: 5400, Comedy: 4800, 'Online Co-Op': 4500, Survival: 3800 }, COOP, 'Собирай металлолом, кричи с друзьями.', 999),
  meta(2379780, 'Balatro', { 'Card Game': 6100, Roguelike: 5500, 'Deck Building': 5000, Casual: 4100, Addictive: 3900 }, SP, 'Покерный рогалик, ломающий мозг и время.', 1499),
  meta(1623730, 'Palworld', { 'Open World': 5600, Survival: 5100, 'Creature Collector': 4700, 'Co-op': 4400, Crafting: 4000 }, COOP, 'Ловля существ, база и выживание с друзьями.', 2999),
  meta(2358720, 'Black Myth: Wukong', { 'Souls-like': 5800, 'Action RPG': 5300, Mythology: 4700, Difficult: 4300, Atmospheric: 4100 }, SP, 'Царь обезьян в мире китайской мифологии.', 5999),
]

/** Библиотека демо-пользователя: перекошенное время, бэклог и заброшенные — как у живого человека */
export function demoLibrary(nowSec: number): LibraryGame[] {
  const lib = (
    appid: number,
    name: string,
    hoursTotal: number,
    hours2w = 0,
    lastPlayedDaysAgo?: number,
  ): LibraryGame => ({
    appid,
    name,
    playtimeForever: Math.round(hoursTotal * H),
    playtime2Weeks: Math.round(hours2w * H),
    ...(lastPlayedDaysAgo !== undefined ? { lastPlayed: nowSec - lastPlayedDaysAgo * DAY } : {}),
  })

  return [
    lib(570, 'Dota 2', 2400, 6, 1),
    lib(730, 'Counter-Strike 2', 800, 0, 60),
    lib(292030, 'The Witcher 3: Wild Hunt', 0.7), // куплена, не распакована
    lib(1145360, 'Hades', 34, 3, 2),
    lib(413150, 'Stardew Valley', 85, 0, 400),
    lib(105600, 'Terraria', 130, 0, 700),
    lib(504230, 'Celeste', 0),
    lib(367520, 'Hollow Knight', 1.4, 0, 300),
    lib(427520, 'Factorio', 310, 0, 250),
    lib(294100, 'RimWorld', 190, 0, 200),
    lib(646570, 'Slay the Spire', 150, 0, 90),
    lib(548430, 'Deep Rock Galactic', 60, 0, 180),
    lib(892970, 'Valheim', 45, 0, 500),
    lib(1086940, "Baldur's Gate 3", 0.3),
    lib(1245620, 'Elden Ring', 110, 0, 300),
    lib(1091500, 'Cyberpunk 2077', 0),
    lib(264710, 'Subnautica', 0),
    lib(753640, 'Outer Wilds', 0),
    lib(632470, 'Disco Elysium', 0.4),
    lib(1794680, 'Vampire Survivors', 28, 1.5, 3),
    lib(588650, 'Dead Cells', 47, 0, 150),
    lib(620, 'Portal 2', 12, 0, 900),
  ]
}

/** Второй демо-профиль («друг») — для локального теста пати: перекос в кооп */
export function demoLibrary2(nowSec: number): LibraryGame[] {
  const lib = (
    appid: number,
    name: string,
    hoursTotal: number,
    hours2w = 0,
    lastPlayedDaysAgo?: number,
  ): LibraryGame => ({
    appid,
    name,
    playtimeForever: Math.round(hoursTotal * H),
    playtime2Weeks: Math.round(hours2w * H),
    ...(lastPlayedDaysAgo !== undefined ? { lastPlayed: nowSec - lastPlayedDaysAgo * DAY } : {}),
  })

  return [
    lib(548430, 'Deep Rock Galactic', 120, 8, 1),
    lib(730, 'Counter-Strike 2', 300, 4, 2),
    lib(570, 'Dota 2', 50, 0, 200),
    lib(105600, 'Terraria', 80, 0, 100),
    lib(892970, 'Valheim', 60, 0, 60),
    lib(620, 'Portal 2', 15, 0, 300),
    lib(413150, 'Stardew Valley', 30, 0, 150),
    lib(646570, 'Slay the Spire', 20, 0, 90),
    lib(632360, 'Risk of Rain 2', 40, 2, 3),
    lib(1966720, 'Lethal Company', 25, 3, 2),
  ]
}

const DEMO_APPIDS = DEMO_METAS.map((m) => m.appid)

/**
 * Полная инициализация демо-режима: метаданные, снапшот, пользователь.
 * Метаданные пишутся только для отсутствующих appid — демо не должно
 * затирать реальный кэш (у DEMO_METAS настоящие Steam appid).
 *
 * Проверка «чего не хватает» — одним getGamesMeta, а не двадцатью двумя
 * getGameMeta подряд. Раньше цена анонимного демо-коннекта была 22 обхода
 * Turso плюс ещё 11 в seedOtherStores; после автодемо на /play этот путь
 * проходит каждый гость, дошедший до конца квиза, и поштучный цикл стал бы
 * самой дорогой строкой в воронке.
 */
export async function seedDemo(
  db: Db,
  steamid: string,
  nowSec: number,
  variant: 1 | 2 = 1,
): Promise<void> {
  const known = await getGamesMeta(db, DEMO_APPIDS)
  const missing = DEMO_METAS.filter((m) => !known.has(m.appid))
  if (missing.length) await upsertGamesMeta(db, missing, nowSec)
  await seedOtherStores(db, nowSec)
  await upsertUser(db, { steamid, personaName: variant === 2 ? 'Демо-друг' : 'Демо-игрок' }, nowSec)
  await saveLibrarySnapshot(
    db,
    steamid,
    variant === 2 ? demoLibrary2(nowSec) : demoLibrary(nowSec),
    nowSec,
  )
}
