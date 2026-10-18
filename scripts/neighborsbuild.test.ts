import { describe, expect, test } from 'vitest'
import {
  createDb,
  getNeighbors,
  replaceGameTags,
  upsertGameMeta,
  upsertNeighbors,
  upsertSemantics,
  type Db,
} from '../lib/db'
import { deriveSemantics } from '../lib/semantics'
import type { GameMeta, GameSemantics } from '../lib/types'
import { buildNeighborTable, loadNeighborGames, publishNeighbors } from './neighborsbuild'

const NOW = 1_700_000_000
const freshDb = () => createDb(':memory:')

function meta(appid: number, tags: Record<string, number>, over: Partial<GameMeta> = {}): GameMeta {
  return { appid, name: `Игра ${appid}`, tags, genres: [], categories: [], ...over }
}

/** Игра каталога: мета, топ тегов в game_tags и вердикт курации, как у promote-catalog */
async function addGame(db: Db, appid: number, tags: Record<string, number>, over: Partial<GameMeta> = {}) {
  await upsertGameMeta(db, meta(appid, tags, over), NOW)
  await replaceGameTags(db, appid, Object.entries(tags).map(([tag, weight]) => ({ tag, weight })))
  await db.execute({ sql: 'UPDATE games SET signals_at = ?, alive = 1 WHERE appid = ?', args: [NOW, appid] })
}

/** Карта тегов каталога: без неё редкость неизвестна */
async function tagStats(db: Db, stats: Record<string, number>) {
  await db.batch(
    Object.entries(stats).map(([name, count], i) => ({
      sql: 'INSERT INTO tags (tagid, name, game_count) VALUES (?, ?, ?)',
      args: [i + 1, name, count],
    })),
    'write',
  )
}

/** Маленький каталог: два мифологических рогалика, рогалик, ферма и «костяк» */
async function catalog(db: Db) {
  await tagStats(db, {
    Singleplayer: 3031,
    Action: 2383,
    Indie: 1750,
    Roguelite: 400,
    'Action Roguelike': 300,
    Mythology: 60,
    'Farming Sim': 80,
  })
  await addGame(db, 1, { 'Action Roguelike': 1000, Mythology: 800, Action: 500 }, { name: 'Hades' })
  await addGame(db, 2, { 'Action Roguelike': 1000, Mythology: 900, Indie: 400 }, { name: 'Hades II' })
  await addGame(db, 3, { Roguelite: 1000, 'Action Roguelike': 900, Indie: 800 })
  await addGame(db, 4, { 'Farming Sim': 1000, Indie: 700 })
  await addGame(db, 5, { Singleplayer: 1000, Action: 900, Indie: 800 })
}

const rowsOf = async (db: Db) =>
  (await db.execute('SELECT appid, rank, neighbor FROM game_neighbors ORDER BY appid, rank')).rows.map(
    (r) => [Number(r.appid), Number(r.rank), Number(r.neighbor)],
  )

describe('векторы из game_tags', () => {
  test('только живые игры пула, теги — из game_tags', async () => {
    const db = await freshDb()
    await catalog(db)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 4')
    await db.execute('UPDATE games SET superseded_by = 1 WHERE appid = 5')
    const games = await loadNeighborGames(db)
    expect(games.map((g) => g.appid)).toEqual([1, 2, 3])
    expect(games[0]).toMatchObject({ name: 'Hades', tags: { 'Action Roguelike': 1000, Mythology: 800, Action: 500 } })
  })
})

describe('то, как в игру играют, — из базы', () => {
  test('режим по категориям, доля отзывов и только уверенная семантика', async () => {
    const db = await freshDb()
    await catalog(db)
    await db.execute(`UPDATE games SET categories_json = '[2]', reviews_percent = 64 WHERE appid = 1`)
    await db.execute(`UPDATE games SET categories_json = '[1,9,38]' WHERE appid = 2`)
    await db.execute(`UPDATE games SET categories_json = '[2,1,9]' WHERE appid = 3`)
    const sem = (pace: number, confidence: number): GameSemantics => ({
      ...deriveSemantics({ Roguelite: 1000 }, null),
      axes: { challenge: 50, complexity: 50, pace },
      confidence,
    })
    await upsertSemantics(db, [
      { appid: 1, semantics: sem(80, 0.7), computedAt: NOW, reviewsAt: NOW },
      // по одним тегам — ниже порога: поправка за ощущение её не слышит
      { appid: 2, semantics: sem(20, 0.4), computedAt: NOW, reviewsAt: null },
    ])
    const games = new Map((await loadNeighborGames(db)).map((g) => [g.appid, g]))
    expect(games.get(1)).toMatchObject({ mode: 'solo', percent: 64, feel: { session: 'short', pace: 80 } })
    expect(games.get(2)).toMatchObject({ mode: 'multi' })
    expect(games.get(2)?.feel).toBeUndefined()
    expect(games.get(3)).toMatchObject({ mode: 'both' })
    // категорий нет — режима нет, и поправки за него тоже
    expect(games.get(4)?.mode).toBeUndefined()
  })
})

/*
 * Золотые списки — на настоящих векторах. Теги, веса, категории и доли
 * отзывов — из копии каталога (game_tags, games), число игр у тега — из
 * карты тегов (tags.game_count) того же каталога. Двадцать четыре игры вместо
 * шести тысяч, поэтому проверяется порядок и первая шестёрка — то, что
 * увидит полка «Похожие», — а не список целиком.
 */
const REAL_STATS: Record<string, number> = {
  Singleplayer: 3031, Action: 2383, Adventure: 2130, Indie: 1750, Multiplayer: 1708, RPG: 1353,
  Simulation: 1282, Strategy: 1250, 'Story Rich': 1237, Casual: 1107, 'First-Person': 1075, '2D': 1047,
  Atmospheric: 1013, 'Open World': 981, Exploration: 904, 'Co-op': 818, Shooter: 748, Puzzle: 732,
  Horror: 724, Sandbox: 704, 'Pixel Graphics': 680, 'Free to Play': 658, Funny: 651, 'Third Person': 626,
  Fantasy: 602, FPS: 587, 'Great Soundtrack': 567, 'Online Co-Op': 565, 'Female Protagonist': 540,
  'Sci-fi': 539, Survival: 538, Building: 487, Relaxing: 441, 'Action-Adventure': 415, Platformer: 408,
  'Character Customization': 406, Comedy: 397, Gore: 376, Realistic: 371, Arcade: 370, 'Action RPG': 370,
  'Choices Matter': 367, Roguelike: 350, Roguelite: 336, Crafting: 323, 'Hack and Slash': 298, Violent: 293,
  'Turn-Based': 291, 'Turn-Based Strategy': 291, Physics: 291, Classic: 256, 'Action Roguelike': 238,
  'Third-Person Shooter': 237, PvE: 228, RTS: 214, 'City Builder': 206, 'Dark Fantasy': 205, 'Life Sim': 200,
  Zombies: 197, 'Local Multiplayer': 193, 'Top-Down': 192, 'Dungeon Crawler': 191, Isometric: 174,
  'Dating Sim': 169, Combat: 156, 'Fast-Paced': 152, '3D Platformer': 147, 'Procedural Generation': 146,
  'Bullet Hell': 133, 'Dark Humor': 129, 'Puzzle Platformer': 126, 'Souls-like': 125, Metroidvania: 118,
  'Colony Sim': 112, 'Replay Value': 110, Robots: 99, 'Team-Based': 96, Loot: 94, 'Farming Sim': 94,
  'Top-Down Shooter': 83, Mythology: 60, 'Arena Shooter': 54, 'Looter Shooter': 48, Agriculture: 45,
  Mining: 41, Vampires: 40, Science: 39, 'Class-Based': 31, 'Bullet Heaven': 31, 'Time Manipulation': 25,
  Philosophical: 25, Dwarves: 21, Elves: 2,
}

type Real = { name: string; percent: number; categories: number[]; tags: Record<string, number> }

/* prettier-ignore */
const REAL: Record<number, Real> = {
  548430: { name: 'Deep Rock Galactic', percent: 97, categories: [2, 1, 9, 38], tags: { Dwarves: 1000, 'Co-op': 394, PvE: 330, FPS: 304, 'Procedural Generation': 281, 'Class-Based': 275, Shooter: 271, Exploration: 264, 'First-Person': 255, Loot: 240, 'Sci-fi': 233, Action: 230 } },
  445310: { name: 'Might and Magic: Heroes VII – Trial by Fire', percent: 65, categories: [2, 1], tags: { Strategy: 1000, RPG: 816, Dwarves: 674, 'Turn-Based': 469, 'Turn-Based Strategy': 326, 'Local Multiplayer': 143 } },
  213650: { name: 'Dwarfs - F2P', percent: 85, categories: [2], tags: { 'Free to Play': 1000, Dwarves: 631, Strategy: 601, Casual: 496, Indie: 481, Singleplayer: 240, Arcade: 233, Mining: 203, '2D': 180, Sandbox: 150, Multiplayer: 105, RTS: 90 } },
  248390: { name: 'Craft The World', percent: 82, categories: [2, 1, 9, 38], tags: { Dwarves: 1000, 'Colony Sim': 916, Crafting: 912, Sandbox: 892, Building: 890, Survival: 645, 'Open World': 546, Strategy: 541, Indie: 409, 'City Builder': 365, Simulation: 365, RPG: 362 } },
  2605790: { name: 'Deep Rock Galactic: Rogue Core', percent: 70, categories: [2, 1, 9, 38], tags: { FPS: 1000, Dwarves: 992, 'Co-op': 989, PvE: 952, Roguelite: 861, 'Action Roguelike': 842, Shooter: 797, 'Fast-Paced': 784, Action: 780, Combat: 759, 'First-Person': 756, 'Online Co-Op': 750 } },
  2321470: { name: 'Deep Rock Galactic: Survivor', percent: 87, categories: [2], tags: { Dwarves: 1000, 'Action Roguelike': 438, 'Bullet Heaven': 421, Roguelite: 397, 'Bullet Hell': 376, 'Top-Down Shooter': 348, PvE: 293, 'Top-Down': 278, 'Arena Shooter': 248, 'Procedural Generation': 247, Action: 236, Arcade: 229 } },
  1361210: { name: 'Warhammer 40,000: Darktide', percent: 75, categories: [1, 9, 38, 27], tags: { 'Co-op': 1000, PvE: 981, FPS: 970, 'Class-Based': 968, Combat: 955, 'Action RPG': 944, Gore: 944, Violent: 944, Atmospheric: 937, Horror: 928, Realistic: 924, 'Character Customization': 917 } },
  552500: { name: 'Warhammer: Vermintide 2', percent: 90, categories: [2, 1, 9, 38], tags: { 'Co-op': 1000, 'Dark Fantasy': 957, 'Hack and Slash': 704, Multiplayer: 698, 'Online Co-Op': 698, Dwarves: 683, Gore: 675, PvE: 671, 'First-Person': 670, Fantasy: 651, RPG: 489, Elves: 485 } },
  550: { name: 'Left 4 Dead 2', percent: 97, categories: [2, 1, 49, 36, 9, 38], tags: { Zombies: 1000, 'Co-op': 541, FPS: 475, Multiplayer: 451, Shooter: 336, 'Online Co-Op': 324, Action: 315, Survival: 274, Horror: 267, 'First-Person': 217, Gore: 217, 'Team-Based': 171 } },
  632360: { name: 'Risk of Rain 2', percent: 95, categories: [2, 1, 49, 36, 9, 38], tags: { 'Third-Person Shooter': 1000, 'Action Roguelike': 979, Multiplayer: 958, 'Co-op': 853, Roguelike: 783, Roguelite: 781, Action: 766, 'Looter Shooter': 713, Loot: 580, 'Online Co-Op': 491, Shooter: 441, 'Great Soundtrack': 424 } },
  1145360: { name: 'Hades', percent: 98, categories: [2], tags: { 'Action Roguelike': 1000, Roguelite: 729, 'Hack and Slash': 711, Indie: 701, Mythology: 694, Action: 606, Roguelike: 590, Singleplayer: 550, 'Great Soundtrack': 528, 'Story Rich': 518, 'Dungeon Crawler': 487, RPG: 479 } },
  1145350: { name: 'Hades II', percent: 96, categories: [2], tags: { Action: 1000, Roguelike: 950, Roguelite: 905, 'Hack and Slash': 862, Mythology: 796, 'Action Roguelike': 777, 'Female Protagonist': 733, RPG: 721, 'Dungeon Crawler': 683, 'Action RPG': 635, 'Story Rich': 589, Singleplayer: 576 } },
  1763250: { name: 'SWORN', percent: 83, categories: [2, 1, 9, 38], tags: { Roguelite: 1000, 'Co-op': 975, Indie: 938, 'Action Roguelike': 934, 'Hack and Slash': 900, Action: 869, 'Online Co-Op': 867, Roguelike: 854, RPG: 852, Mythology: 826, 'Dungeon Crawler': 787, Isometric: 774 } },
  588650: { name: 'Dead Cells', percent: 96, categories: [2], tags: { Adventure: 1000, Roguelike: 950, Metroidvania: 947, 'Pixel Graphics': 945, 'Action Roguelike': 944, '2D': 937, Roguelite: 905, 'Souls-like': 903, 'Hack and Slash': 876, 'Replay Value': 874, Platformer: 868, Singleplayer: 866 } },
  475150: { name: 'Titan Quest Anniversary Edition', percent: 89, categories: [2, 1, 49, 36, 9, 38], tags: { RPG: 1000, 'Hack and Slash': 826, 'Action RPG': 751, Loot: 676, Mythology: 593, Multiplayer: 491, 'Co-op': 409, Singleplayer: 366, Classic: 333, Isometric: 328, Adventure: 300, 'Top-Down': 297 } },
  413150: { name: 'Stardew Valley', percent: 98, categories: [2, 1, 9, 38, 48, 39, 24], tags: { 'Farming Sim': 1000, 'Pixel Graphics': 920, Multiplayer: 908, 'Life Sim': 896, RPG: 798, Relaxing: 796, Simulation: 648, Agriculture: 642, Crafting: 550, Indie: 548, Sandbox: 548, Building: 450 } },
  666140: { name: 'My Time at Portia', percent: 91, categories: [2], tags: { 'Life Sim': 1000, RPG: 982, 'Open World': 968, 'Farming Sim': 951, Crafting: 913, Simulation: 856, Casual: 725, Adventure: 659, Singleplayer: 658, Building: 598, Agriculture: 595, Sandbox: 514 } },
  1158160: { name: 'Coral Island', percent: 89, categories: [2, 1, 9, 38, 27], tags: { 'Farming Sim': 1000, 'Life Sim': 885, 'Dating Sim': 737, Relaxing: 732, Simulation: 656, Agriculture: 589, RPG: 575, 'Character Customization': 555, Crafting: 542, Singleplayer: 523, 'Open World': 499, Building: 494 } },
  620: { name: 'Portal 2', percent: 98, categories: [2, 1, 9, 38, 39, 24], tags: { Singleplayer: 1000, Platformer: 975, Puzzle: 970, 'First-Person': 929, 'Dark Humor': 925, 'Story Rich': 920, 'Puzzle Platformer': 910, Funny: 899, 'Female Protagonist': 894, '3D Platformer': 882, 'Action-Adventure': 857, 'Co-op': 856 } },
  400: { name: 'Portal', percent: 98, categories: [2], tags: { Puzzle: 1000, 'Puzzle Platformer': 753, 'First-Person': 608, '3D Platformer': 588, Singleplayer: 530, 'Sci-fi': 487, Comedy: 391, 'Female Protagonist': 385, Physics: 283, Funny: 268, Action: 256, Classic: 223 } },
  200010: { name: 'Quantum Conundrum', percent: 84, categories: [2], tags: { 'Puzzle Platformer': 1000, Puzzle: 955, '3D Platformer': 669, 'First-Person': 637, Physics: 439, Comedy: 421, Casual: 395, Platformer: 388, Singleplayer: 312, Strategy: 306, 'Time Manipulation': 286, Science: 223 } },
  257510: { name: 'The Talos Principle', percent: 95, categories: [2], tags: { Puzzle: 1000, Philosophical: 588, 'First-Person': 520, 'Sci-fi': 501, 'Story Rich': 472, Atmospheric: 470, Singleplayer: 456, 'Great Soundtrack': 335, Robots: 322, Exploration: 270, Adventure: 269, Indie: 197 } },
  1794680: { name: 'Vampire Survivors', percent: 98, categories: [2, 1, 9, 38], tags: { 'Action Roguelike': 1000, 'Bullet Hell': 873, Roguelite: 716, Vampires: 716, 'Pixel Graphics': 683, '2D': 524, Indie: 523, Singleplayer: 477, Casual: 387, Arcade: 381, Roguelike: 377, Action: 346 } },
  427290: { name: 'Vampyr', percent: 76, categories: [2], tags: { Vampires: 1000, RPG: 447, 'Choices Matter': 396, 'Story Rich': 384, 'Open World': 366, Singleplayer: 336, Action: 335, Atmospheric: 290, 'Third Person': 250, 'Dark Fantasy': 244, Horror: 242, Violent: 212 } },
}

async function realCatalog(db: Db) {
  await tagStats(db, REAL_STATS)
  for (const [appid, g] of Object.entries(REAL)) {
    await addGame(db, Number(appid), g.tags, { name: g.name, categories: g.categories, reviewsPercent: g.percent })
  }
  await buildNeighborTable(db)
}

/** Первые шесть — ровно то, что покажет полка «Похожие» на карточке */
async function shelfOf(db: Db, appid: number): Promise<string[]> {
  return (await getNeighbors(db, appid, 6)).map((g) => g.name)
}

describe('золотые списки: похожие по тому, как в неё играют', () => {
  test('Deep Rock Galactic — кооперативные шутеры, а не всё про гномов', async () => {
    const db = await freshDb()
    await realCatalog(db)
    const list = (await getNeighbors(db, 548430)).map((g) => g.name)
    // До правки первой стояла Heroes VII, за ней Dwarfs!? и Craft The World:
    // общего у них с DRG — один Dwarves. Кооперативных шутеров в этой
    // выборке всего три, поэтому про гномов здесь ещё доходит до полки; на
    // живом каталоге их место занимают FBC: Firebreak и Codename CURE.
    const coop = ['Deep Rock Galactic: Rogue Core', 'Warhammer 40,000: Darktide', 'Warhammer: Vermintide 2']
    expect(list.slice(0, 2)).toEqual(coop.slice(0, 2))
    for (const theme of ['Might and Magic: Heroes VII – Trial by Fire', 'Dwarfs - F2P', 'Craft The World']) {
      for (const shooter of coop) expect(list.indexOf(theme), `${theme} ниже ${shooter}`).toBeGreaterThan(list.indexOf(shooter))
    }
  })

  test('Hades держит Hades II и рогаликов, а не всё мифологическое', async () => {
    const db = await freshDb()
    await realCatalog(db)
    const shelf = await shelfOf(db, 1145360)
    expect(shelf.slice(0, 2)).toContain('Hades II')
    expect(shelf.indexOf('Dead Cells')).toBeGreaterThan(-1)
    expect(shelf.indexOf('Dead Cells')).toBeLessThan(
      shelf.includes('Titan Quest Anniversary Edition') ? shelf.indexOf('Titan Quest Anniversary Edition') : Infinity,
    )
  })

  test('Stardew Valley держит фермы, хотя у неё кооп, а у Portia — нет', async () => {
    const db = await freshDb()
    await realCatalog(db)
    expect((await shelfOf(db, 413150)).slice(0, 2).sort()).toEqual(['Coral Island', 'My Time at Portia'])
  })

  test('Portal 2 держит головоломки от первого лица', async () => {
    const db = await freshDb()
    await realCatalog(db)
    expect((await shelfOf(db, 620)).slice(0, 3).sort()).toEqual(['Portal', 'Quantum Conundrum', 'The Talos Principle'])
  })

  test('Vampire Survivors — рогалики, а не всё про вампиров', async () => {
    const db = await freshDb()
    await realCatalog(db)
    const shelf = await shelfOf(db, 1794680)
    expect(shelf).not.toContain('Vampyr')
    expect(shelf).toEqual(expect.arrayContaining(['Hades', 'Dead Cells']))
  })
})

describe('таблица соседей в локальной базе', () => {
  test('считается и читается getNeighbors по порядку', async () => {
    const db = await freshDb()
    await catalog(db)
    const res = await buildNeighborTable(db)
    expect(res).toMatchObject({ games: 5, weighted: true })

    const hades = await getNeighbors(db, 1)
    // Подпись называет сначала механику: Mythology — тема, и в сходство она
    // идёт приглушённой (THEME_DAMP в lib/neighbors), хотя редкостью и выше
    expect(hades[0]).toMatchObject({ appid: 2, name: 'Hades II', shared: ['Action Roguelike', 'Mythology'] })
    expect(hades.map((g) => g.appid)).not.toContain(1)
    expect(await getNeighbors(db, 1, 1)).toHaveLength(1)
  })

  test('умершего с пересчёта соседа getNeighbors не отдаёт', async () => {
    const db = await freshDb()
    await catalog(db)
    await buildNeighborTable(db)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 2')
    expect((await getNeighbors(db, 1)).map((g) => g.appid)).not.toContain(2)
  })

  test('игра, ушедшая из пула, теряет строки при следующей сборке', async () => {
    const db = await freshDb()
    await catalog(db)
    await buildNeighborTable(db)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 3')
    await buildNeighborTable(db)
    const rows = await rowsOf(db)
    expect(rows.some(([appid]) => appid === 3)).toBe(false)
    expect(rows.some(([, , neighbor]) => neighbor === 3)).toBe(false)
  })

  test('игра, которой соседей не посчитали, отдаёт пустой список', async () => {
    const db = await freshDb()
    await catalog(db)
    expect(await getNeighbors(db, 1)).toEqual([])
  })
})

describe('заливка в облако', () => {
  test('везёт списки как есть; повтор на том же не пишет ни строки', async () => {
    const local = await freshDb()
    const remote = await freshDb()
    await catalog(local)
    const built = await buildNeighborTable(local)

    const first = await publishNeighbors(local, remote)
    expect(first).toEqual({ games: 5, written: built.rows })
    expect(await rowsOf(remote)).toEqual(await rowsOf(local))

    expect(await publishNeighbors(local, remote)).toEqual({ games: 5, written: 0 })
  })

  test('короче ставший список снимает хвост, чужие игры облака не трогаются', async () => {
    const local = await freshDb()
    const remote = await freshDb()
    await upsertNeighbors(
      remote,
      new Map([
        [1, [2, 3, 4].map((neighbor) => ({ neighbor, score: 0.5, shared: [] }))],
        [99, [{ neighbor: 1, score: 0.4, shared: [] }]],
      ]),
    )
    await upsertNeighbors(local, new Map([[1, [{ neighbor: 3, score: 0.7, shared: ['Roguelite'] }]]]))

    // одна строка переписана, две снесены
    expect(await publishNeighbors(local, remote)).toEqual({ games: 1, written: 3 })
    expect(await rowsOf(remote)).toEqual([
      [1, 0, 3],
      [99, 0, 1],
    ])
  })
})
