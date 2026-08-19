import { getGamesMeta, upsertGamesMeta, type Db } from './db'
import type { GameMeta } from './types'

/**
 * Кураторский пул заметных игр вне Steam (Epic, Battle.net, Riot, ...).
 * Отрицательные appid — чтобы не пересекаться с пространством Steam.
 * Библиотеки этих магазинов недоступны по API (этап 2 — сканер ПК),
 * но рекомендовать их игры можно уже сейчас.
 */

export { STORE_LABEL } from './stores'

function ext(
  appid: number,
  name: string,
  store: string,
  storeUrl: string,
  tags: Record<string, number>,
  categories: number[],
  shortDescription: string,
): GameMeta {
  return { appid, name, tags, genres: [], categories, shortDescription, store, storeUrl }
}

const MP = [1, 36, 49]
const COOP = [1, 9, 38]

export const OTHER_STORE_GAMES: GameMeta[] = [
  ext(-101, 'Fortnite', 'epic', 'https://store.epicgames.com/ru/p/fortnite', { 'Battle Royale': 5000, Multiplayer: 4600, 'Free to Play': 4400, Building: 3200, PvP: 3000 }, MP, 'Королевская битва, строительство и вечные кроссоверы. Бесплатно.'),
  ext(-102, 'Rocket League', 'epic', 'https://store.epicgames.com/ru/p/rocket-league', { Sports: 4800, Multiplayer: 4500, Competitive: 4200, 'Free to Play': 4000, Casual: 3000 }, MP, 'Футбол на реактивных машинах. Бесплатно.'),
  ext(-103, 'Fall Guys', 'epic', 'https://store.epicgames.com/ru/p/fall-guys', { Party: 4600, Casual: 4400, Multiplayer: 4200, 'Free to Play': 4000, Funny: 3500 }, MP, 'Весёлая полоса препятствий на 60 человек. Бесплатно.'),
  ext(-104, 'Alan Wake 2', 'epic', 'https://store.epicgames.com/ru/p/alan-wake-2', { Horror: 5200, 'Story Rich': 5000, Atmospheric: 4600, Thriller: 4000, 'Survival Horror': 3600 }, [2], 'Психологический хоррор от Remedy — только в Epic Games Store.'),
  ext(-105, 'VALORANT', 'riot', 'https://playvalorant.com/ru-ru/', { 'Tactical FPS': 5000, Competitive: 4800, Shooter: 4400, 'Free to Play': 4200, 'Team-Based': 3800 }, MP, 'Тактический шутер 5×5 от Riot. Бесплатно.'),
  ext(-106, 'League of Legends', 'riot', 'https://www.leagueoflegends.com/ru-ru/', { MOBA: 5200, Competitive: 4800, Multiplayer: 4600, 'Free to Play': 4400, Strategy: 3600 }, MP, 'Та самая MOBA. Бесплатно.'),
  ext(-107, 'World of Warcraft', 'battlenet', 'https://worldofwarcraft.blizzard.com/ru-ru/', { MMORPG: 5200, Fantasy: 4600, Multiplayer: 4400, 'Open World': 3800, Adventure: 3400 }, COOP, 'Азерот всё ещё ждёт. Подписка Battle.net.'),
  ext(-108, 'Hearthstone', 'battlenet', 'https://hearthstone.blizzard.com/ru-ru', { 'Card Game': 5000, Casual: 4200, 'Free to Play': 4000, Strategy: 3600, 'Turn-Based': 3200 }, MP, 'Карточные дуэли по вселенной Warcraft. Бесплатно.'),
  ext(-109, 'Overwatch 2', 'battlenet', 'https://overwatch.blizzard.com/ru-ru/', { 'Hero Shooter': 4800, Multiplayer: 4600, Competitive: 4200, 'Free to Play': 4000, 'Team-Based': 3800 }, MP, 'Геройский шутер Blizzard. Бесплатно.'),
  ext(-110, 'Genshin Impact', 'hoyoverse', 'https://genshin.hoyoverse.com/ru/', { 'Open World': 4800, Anime: 4600, RPG: 4200, 'Free to Play': 4000, Adventure: 3800, Gacha: 3000 }, COOP, 'Аниме-приключение в открытом мире Тейвата. Бесплатно.'),
  ext(-111, 'Minecraft', 'mojang', 'https://www.minecraft.net/ru-ru', { Sandbox: 5400, Crafting: 4800, Survival: 4400, Multiplayer: 4200, Building: 4000 }, COOP, 'Кубики, из которых сделано детство интернета.'),
]

const OTHER_STORE_APPIDS = OTHER_STORE_GAMES.map((m) => m.appid)

/**
 * Кураторский пул сеется один раз и живёт вечно — но зовут эту функцию с
 * каждого POST /api/prepare, а прогрев дёргает prepare до восьмидесяти раз
 * (lib/warmup: WARMUP_MAX_CALLS). Поштучный getGameMeta в цикле давал до
 * 880 последовательных обходов Turso на один прогрев, и все, кроме первых
 * одиннадцати, — вхолостую.
 *
 * Отсюда два уровня. Защёлка на процесс гасит повторные вызовы внутри
 * инстанса, не сходив в базу вообще. Когда сходить всё же надо — один
 * getGamesMeta вместо N и одна пачка апсертов вместо N.
 *
 * Час, а не «навсегда»: инстансы живут долго, а запись из пула может уехать
 * из games (чистка каталога, ручной прогон скриптов), и вечная защёлка
 * оставила бы пул недосеянным до следующего холодного старта.
 *
 * Защёлка ставится ПОСЛЕ успеха: упавший сид должен повториться, а не
 * замолчать на час.
 */
const SEED_TTL_SEC = 3600
let seededAt = 0

/** Досеивает кураторский пул, не затирая уже существующие записи */
export async function seedOtherStores(db: Db, nowSec: number): Promise<void> {
  if (nowSec - seededAt < SEED_TTL_SEC) return
  const known = await getGamesMeta(db, OTHER_STORE_APPIDS)
  const missing = OTHER_STORE_GAMES.filter((m) => !known.has(m.appid))
  if (missing.length) await upsertGamesMeta(db, missing, nowSec)
  seededAt = nowSec
}
