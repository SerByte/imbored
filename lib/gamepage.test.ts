import type { InStatement } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import {
  createDb,
  replaceGameTags,
  setGameJson,
  upsertGameMeta,
  upsertNeighbors,
  upsertNewsItems,
  upsertSemantics,
  type Db,
} from './db'
import {
  DESCRIPTION_MAX,
  deadVerdict,
  gameDescription,
  gameTraits,
  hookTrait,
  isRussianText,
  loadGamePage,
  nearGames,
  pickSimilar,
  PULSE_MIN_GAP,
  PULSE_MIN_RECENT,
  PULSE_SHOW_MAX_AGE_SEC,
  reviewFacts,
  reviewPulse,
  RU_MIN_REVIEWS,
  SESSION_MIN_CONFIDENCE,
  sessionTrait,
  SIMILAR_CANDIDATES,
  SIMILAR_SHOWN,
  STUDIO_MAX_GAMES,
  STUDIO_SHOWN,
  studioLine,
  topTagOf,
} from './gamepage'
import { characterTrait, entryTrait } from './gametraits'
import { tagRu } from './tagsru'
import type { GameMeta, GameSemantics } from './types'

/**
 * Карточка игры — единственная публичная страница проекта, и правил у неё
 * ровно два. Оба нарушались, и оба стоили дорого, поэтому оба под тестом.
 */

const NOW = 1_700_000_000

function meta(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return { appid, name: `Игра ${appid}`, tags: { Action: 100 }, genres: [], categories: [], ...over }
}

async function addGame(db: Db, appid: number): Promise<void> {
  await upsertGameMeta(db, meta(appid), NOW)
  await replaceGameTags(db, appid, [{ tag: 'Action', weight: 100 }])
}

/** loadGamePage читает базу через getDb(), поэтому подменяем её на файловую. */
async function withDb(): Promise<Db> {
  const db = await createDb(':memory:')
  const g = globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }
  g.__imboredDb = Promise.resolve(db)
  return db
}

describe('loadGamePage', () => {
  test('незнакомый appid — null, чтобы краулер получил 404 после одного чтения', async () => {
    await withDb()
    expect(await loadGamePage(999_999_999)).toBeNull()
  })

  /*
   * Строка ленты на карточке — заголовок-ссылка на страницу патча, а та
   * сверяет запись с нынешним правилом классификатора и «дорожной карте»
   * отвечает 404 (loadPatch). Карточка обязана решать так же: иначе из её
   * серверного HTML вела бы ссылка в 404, а «Looking Ahead» стоял бы в ленте
   * патчем, пока опрос не перепишет kind.
   */
  test('лента патчей на карточке — по нынешнему правилу, а не по записанному kind', async () => {
    const db = await withDb()
    await addGame(db, 10)
    const post = (gid: string, title: string, publishedAt: number) => ({
      appid: 10,
      gid,
      title,
      url: `https://store.steampowered.com/news/app/10/view/${gid}`,
      publishedAt,
      kind: 'patch' as const,
      scale: 'major' as const,
      blocks: [{ kind: 'p' as const, runs: [{ text: 'Исправлен вылет при загрузке.' }] }],
      bodyHash: `h${gid}`,
      rank: 5000,
    })
    await upsertNewsItems(
      db,
      [
        post('1', 'Патч 2.31', NOW - 200),
        // записано патчем до правки классификатора
        post('2', 'Marathon: дорожная карта обновлений на 2026 год', NOW - 100),
      ],
      NOW,
    )
    const page = await loadGamePage(10)
    expect(page?.news.map((n) => n.gid)).toEqual(['1'])
  })

  /*
   * Правилу нужно тело, и отсев идёт в памяти — после LIMIT. Без дочитывания
   * «дорожная карта» среди восьми свежих съедала бы место настоящего патча, и
   * за окном ленты опроса так оставалось бы навсегда: kind такой записи никто
   * не перепишет.
   */
  test('отсеянная строка не съедает место: в ленте карточки всё равно восемь патчей', async () => {
    const db = await withDb()
    await addGame(db, 11)
    const post = (gid: string, title: string, publishedAt: number) => ({
      appid: 11,
      gid,
      title,
      url: `https://store.steampowered.com/news/app/11/view/${gid}`,
      publishedAt,
      kind: 'patch' as const,
      scale: 'major' as const,
      blocks: [{ kind: 'p' as const, runs: [{ text: 'Исправлен вылет при загрузке.' }] }],
      bodyHash: `h${gid}`,
      rank: 5000,
    })
    const patches = Array.from({ length: 9 }, (_, i) => post(`p${i}`, `Патч 2.${i}`, NOW - 1000 - i * 100))
    await upsertNewsItems(
      db,
      [
        // самая свежая запись — дорожная карта, записанная патчем старым правилом
        post('roadmap', 'Marathon: дорожная карта обновлений на 2026 год', NOW - 10),
        ...patches,
      ],
      NOW,
    )
    const page = await loadGamePage(11)
    expect(page?.news.map((n) => n.gid)).toEqual(patches.slice(0, 8).map((p) => p.gid))
  })

  /**
   * Эвристические pros/cons — это первые предложения самых залайканных отзывов
   * как есть. В проде это дало китайский, испанский, зацензуренный мат и прямую
   * непристойность в блоке «за что любят» на русскоязычной странице из карты
   * сайта. Отбор по числу голосов не помогает: залайкивают как раз шутки.
   */
  test('эвристические pros/cons наружу не отдаются', async () => {
    const db = await withDb()
    await addGame(db, 10)
    await setGameJson(db, 10, 'pros_cons_json', {
      pros: ['纯萌新，请问星星炮300颗星星能不能打过骷髅王'],
      cons: ['buen juego pero todavia no sacan un parche'],
      source: 'reviews',
    })

    const page = await loadGamePage(10)
    expect(page?.prosCons).toBeNull()
  })

  test('собранное моделью отдаётся как есть', async () => {
    const db = await withDb()
    await addGame(db, 20)
    const fromClaude = { pros: ['красиво'], cons: ['дорого'], source: 'claude' as const }
    await setGameJson(db, 20, 'pros_cons_json', fromClaude)

    expect((await loadGamePage(20))?.prosCons).toEqual(fromClaude)
  })

  test('остальное содержимое карточки от pros/cons не зависит', async () => {
    const db = await withDb()
    await addGame(db, 30)
    await setGameJson(db, 30, 'pros_cons_json', { pros: ['x'], cons: [], source: 'reviews' })
    await setGameJson(db, 30, 'reviews_summary_json', {
      scoreDesc: 'Very Positive',
      totalPositive: 900,
      totalNegative: 100,
    })

    const page = await loadGamePage(30)
    // блок отзывов и сама игра на месте — пустеет только pros/cons
    expect(page?.meta.name).toBe('Игра 30')
    expect(page?.reviewsSummary?.scoreDesc).toBe('Very Positive')
    expect(page?.prosCons).toBeNull()
  })

  test('строка игры читается один раз, битый блоб страницу не роняет', async () => {
    // getGamePageRow привозит строку вместе с обоими блобами: раньше страница
    // ходила за ней трижды (getGameMeta и дважды getGameJson)
    const db = await withDb()
    await addGame(db, 40)
    await db.execute({
      sql: `UPDATE games SET reviews_summary_json = '{оборвано', pros_cons_json = ? WHERE appid = 40`,
      args: [JSON.stringify({ pros: ['красиво'], cons: [], source: 'claude' })],
    })
    let чтенийИгры = 0
    const spy = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'execute') return Reflect.get(target, prop, receiver)
        return (q: InStatement) => {
          const sql = typeof q === 'string' ? q : q.sql
          if (/FROM games g\b[\s\S]*WHERE g\.appid = \?/.test(sql)) чтенийИгры++
          return target.execute(q)
        }
      },
    })
    const g = globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }
    g.__imboredDb = Promise.resolve(spy)

    const page = await loadGamePage(40)
    expect(page?.meta.name).toBe('Игра 40')
    expect(page?.reviewsSummary).toBeNull()
    expect(page?.prosCons?.pros).toEqual(['красиво'])
    expect(чтенийИгры).toBe(1)
  })

  /*
   * Фильтр после модели появился позже, чем сотни карточек в базе, а
   * пересобирает их крон раз в полгода. Поэтому битое прячется и при чтении:
   * «…справедливо'],» на /game/317400 и «неработает» на /game/730 уходят со
   * страницы и из её сниппета сразу, без похода в модель.
   */
  test('битые пункты, уже лежащие в базе, на страницу не идут', async () => {
    const db = await withDb()
    await addGame(db, 50)
    await setGameJson(db, 50, 'pros_cons_json', {
      pros: ["Сложность хорошо подобрана, справедливо'],", 'Атмосферные уровни'],
      cons: ['Античит система полностью неэффективна и неработает', 'Короткая кампания'],
      source: 'claude',
    })
    expect((await loadGamePage(50))?.prosCons).toEqual({
      pros: ['Атмосферные уровни'],
      cons: ['Короткая кампания'],
      source: 'claude',
    })
  })

  test('плюсы все битые — блока нет, а не одни жалобы', async () => {
    const db = await withDb()
    await addGame(db, 60)
    await setGameJson(db, 60, 'pros_cons_json', {
      pros: ['Отличный модификация Quake'],
      cons: ['Короткая кампания'],
      source: 'claude',
    })
    expect((await loadGamePage(60))?.prosCons).toBeNull()
  })

  /*
   * На CS2 минус «Разработчики не обновляют игру и забросили её развитие» стоял
   * над восемью патчами за три недели в «Что нового» той же страницы. Отзыв
   * мог писаться в затишье, но страница со свежими патчами с собой не спорит.
   */
  test('«не обновляют» не спорит со свежими патчами на той же странице', async () => {
    const db = await withDb()
    await addGame(db, 730)
    const prosCons = {
      pros: ['Точная стрельба'],
      cons: ['Разработчики не обновляют игру и забросили её развитие', 'Много читеров'],
      source: 'claude' as const,
    }
    await setGameJson(db, 730, 'pros_cons_json', prosCons)
    // патч полугодовой давности — утверждению не противоречит
    const nowSec = Math.floor(Date.now() / 1000)
    const patch = {
      appid: 730,
      title: 'Обновление',
      url: 'https://store.steampowered.com/news/app/730/view/1',
      kind: 'patch' as const,
      scale: 'hotfix' as const,
      blocks: [{ kind: 'p' as const, runs: [{ text: 'правки' }] }],
      bodyHash: 'h',
      rank: 0,
    }
    await upsertNewsItems(db, [{ ...patch, gid: '1', publishedAt: nowSec - 200 * 86_400 }], nowSec)
    expect((await loadGamePage(730))?.prosCons?.cons).toEqual(prosCons.cons)

    await upsertNewsItems(db, [{ ...patch, gid: '2', publishedAt: nowSec - 5 * 86_400 }], nowSec)
    expect((await loadGamePage(730))?.prosCons?.cons).toEqual(['Много читеров'])
  })
})

describe('topTagOf', () => {
  test('берёт самый характерный тег, а не первый попавшийся', () => {
    expect(topTagOf(meta(1, { tags: { Indie: 300, Roguelike: 900, Action: 500 } }))).toBe('Roguelike')
  })

  test('при равных весах порядок не зависит от порядка ключей', () => {
    // Страница кэшируется на неделю и пререндерится: блок «похожие» не имеет
    // права меняться от того, как Object.entries вернул ключи после пересборки
    const a = topTagOf(meta(1, { tags: { Zzz: 500, Aaa: 500 } }))
    const b = topTagOf(meta(1, { tags: { Aaa: 500, Zzz: 500 } }))
    expect(a).toBe('Aaa')
    expect(a).toBe(b)
  })

  test('игра без тегов не роняет карточку', () => {
    expect(topTagOf(meta(1, { tags: {} }))).toBeNull()
  })

  /** Доли тегов из копии каталога: Singleplayer — самый частый, он же шкала. */
  const STATS = new Map([
    ['Singleplayer', 3031],
    ['Action', 2383],
    ['Adventure', 2130],
    ['Story Rich', 1237],
    ['Open World', 981],
    ['Mythology', 60],
    ['Nudity', 176],
    ['MOBA', 30],
    ['Free to Play', 658],
    ['Unique', 3],
  ])

  test('с картой тегов берёт характерный, а не самый широкий', () => {
    // God of War: по весу первым стоит Action, у которого 2383 игры
    const gow = { Action: 911, Singleplayer: 840, 'Story Rich': 808, Mythology: 759, Adventure: 755 }
    expect(topTagOf(meta(1, { tags: gow }))).toBe('Action')
    expect(topTagOf(meta(1, { tags: gow }), STATS)).toBe('Mythology')
    // Dota 2 — MOBA, а не Free to Play
    expect(topTagOf(meta(2, { tags: { 'Free to Play': 3010, MOBA: 1019 } }), STATS)).toBe('MOBA')
  })

  test('редкость ищется только среди первых пяти тегов', () => {
    // иначе у The Witcher 3 полка стала бы «Похожие · Nudity»
    const witcher = {
      'Open World': 1158,
      Singleplayer: 975,
      'Story Rich': 905,
      Action: 617,
      Adventure: 598,
      Nudity: 566,
    }
    expect(topTagOf(meta(3, { tags: witcher }), STATS)).toBe('Open World')
  })

  test('тег, которым помечено меньше семи игр, полку не наполнит', () => {
    expect(topTagOf(meta(4, { tags: { Unique: 1000, Action: 900 } }), STATS)).toBe('Action')
  })

  test('без пригодной карты или когда все теги частотные — прежний порядок', () => {
    const tags = { Action: 900, Singleplayer: 950 }
    expect(topTagOf(meta(5, { tags }), new Map())).toBe('Singleplayer')
    // карта из пары тегов — непрогретая база, rarityScale её не принимает
    expect(topTagOf(meta(5, { tags }), new Map([['Action', 3]]))).toBe('Singleplayer')
    // Singleplayer — сама шкала, его редкость ноль; Action выигрывает честно
    expect(topTagOf(meta(5, { tags }), STATS)).toBe('Action')
    // а когда редкость у всех ноль — первый по весу
    expect(topTagOf(meta(5, { tags: { Singleplayer: 10, Zzz: 5 } }), STATS)).toBe('Singleplayer')
  })

  test('битый вес не роняет выбор', () => {
    expect(topTagOf(meta(6, { tags: { Action: Number.NaN, MOBA: 10 } }), STATS)).toBe('MOBA')
    expect(topTagOf(meta(6, { tags: { Action: Number.NaN } }))).toBeNull()
  })
})

describe('pickSimilar', () => {
  const ranked = Array.from({ length: SIMILAR_CANDIDATES }, (_, i) => i)

  test('кандидатов не больше полки — отдаются все, в том же порядке', () => {
    expect(pickSimilar([3, 1, 2], 730)).toEqual([3, 1, 2])
  })

  test('шесть из тридцати, в исходном порядке и одинаково на каждой пересборке', () => {
    const a = pickSimilar(ranked, 1_593_500)
    expect(a).toHaveLength(SIMILAR_SHOWN)
    expect(new Set(a).size).toBe(SIMILAR_SHOWN)
    expect([...a].sort((x, y) => x - y)).toEqual(a)
    // страница кэшируется на неделю: полка не должна прыгать между пересборками
    expect(pickSimilar(ranked, 1_593_500)).toEqual(a)
  })

  test('у разных страниц разные шестёрки, а верхние кандидаты попадают чаще', () => {
    // раньше у всех 339 карточек с тегом Action стояли одни и те же шесть игр
    const shelves = new Set<string>()
    const hits = new Array<number>(SIMILAR_CANDIDATES).fill(0)
    for (let appid = 1; appid <= 2000; appid++) {
      const shelf = pickSimilar(ranked, appid)
      shelves.add(shelf.join(','))
      for (const i of shelf) hits[i]++
    }
    expect(shelves.size).toBeGreaterThan(1500)
    // каждый кандидат хоть где-то стоит — ссылки расходятся по всем тридцати
    expect(hits.every((n) => n > 0)).toBe(true)
    expect(hits[0]).toBeGreaterThan(hits[SIMILAR_CANDIDATES - 1] * 3)
  })
})

describe('похожие на карточке', () => {
  test('подбираются по характерности тега, а не по популярности', async () => {
    const db = await withDb()
    // герой страницы + три соседа с разной характерностью Roguelike
    for (const [appid, weight, reviews] of [
      [1, 1000, 100],
      [2, 900, 5],
      [3, 200, 900_000],
      [4, 600, 50],
    ] as Array<[number, number, number]>) {
      await upsertGameMeta(
        db,
        meta(appid, { tags: { Roguelike: weight }, reviewsTotal: reviews }),
        NOW,
      )
      await replaceGameTags(db, appid, [{ tag: 'Roguelike', weight }])
    }

    const page = await loadGamePage(1)
    expect(page?.similarTag).toBe('Roguelike')
    // блокбастер с 900k отзывов, но слабым тегом, стоит ПОСЛЕДНИМ
    expect(page?.similar.map((g) => g.appid)).toEqual([2, 4, 3])
    // сама игра в свои же похожие не попадает
    expect(page?.similar.map((g) => g.appid)).not.toContain(1)
  })

  test('при равной характерности первым идёт тот, у кого больше отзывов', async () => {
    // Главный тег КАЖДОЙ игры весит 1000, и у широкого тега ничьих сотни. Без
    // второго ключа их порядок решал индекс — appid по возрастанию, — и у God
    // of War стоял Sniper Elite 2005 года
    const db = await withDb()
    for (const [appid, reviews] of [
      [1, 100],
      [3700, 5_000],
      [6020, 40],
      [2_000_000, 900_000],
      [1_500_000, 70_000],
    ] as Array<[number, number]>) {
      await upsertGameMeta(db, meta(appid, { tags: { Action: 1000 }, reviewsTotal: reviews }), NOW)
      await replaceGameTags(db, appid, [{ tag: 'Action', weight: 1000 }])
    }
    const page = await loadGamePage(1)
    expect(page?.similar.map((g) => g.appid)).toEqual([2_000_000, 1_500_000, 3700, 6020])
  })

  test('полка — шесть из тридцати первых кандидатов, свои у каждой страницы', async () => {
    const db = await withDb()
    // сорок равно характерных соседей: отзывы решают, кто в первой тридцатке
    for (let i = 1; i <= 40; i++) {
      await upsertGameMeta(db, meta(i, { tags: { Roguelike: 1000 }, reviewsTotal: i * 100 }), NOW)
      await replaceGameTags(db, i, [{ tag: 'Roguelike', weight: 1000 }])
    }
    const shelves = new Set<string>()
    for (const appid of [1, 2, 3, 4, 5]) {
      const page = await loadGamePage(appid)
      const ids = page?.similar.map((g) => g.appid) ?? []
      expect(ids).toHaveLength(SIMILAR_SHOWN)
      expect(ids).not.toContain(appid)
      // кандидаты — тридцать самых обсуждаемых (40…11), самые тихие в полку не идут
      expect(ids.every((id) => id > 10)).toBe(true)
      // и показаны по порядку: больше отзывов — левее
      expect([...ids].sort((a, b) => b - a)).toEqual(ids)
      shelves.add(ids.join(','))
    }
    expect(shelves.size).toBeGreaterThan(1)
  })

  test('тег полки выбирается по редкости из карты тегов каталога', async () => {
    const db = await withDb()
    const tags = { Action: 911, Mythology: 759 }
    await upsertGameMeta(db, meta(1, { tags }), NOW)
    await replaceGameTags(db, 1, [
      { tag: 'Action', weight: 1000 },
      { tag: 'Mythology', weight: 833 },
    ])
    await upsertGameMeta(db, meta(2, { tags: { Mythology: 900 } }), NOW)
    await replaceGameTags(db, 2, [{ tag: 'Mythology', weight: 1000 }])
    await upsertGameMeta(db, meta(3, { tags: { Action: 900 } }), NOW)
    await replaceGameTags(db, 3, [{ tag: 'Action', weight: 1000 }])
    await db.batch(
      [
        [1, 'Singleplayer', 3031],
        [2, 'Action', 2383],
        [3, 'Mythology', 60],
      ].map(([tagid, name, count]) => ({
        sql: 'INSERT INTO tags (tagid, name, game_count) VALUES (?, ?, ?)',
        args: [tagid, name, count],
      })),
      'write',
    )
    const page = await loadGamePage(1)
    expect(page?.similarTag).toBe('Mythology')
    expect(page?.similar.map((g) => g.appid)).toEqual([2])
  })

  test('игра без тегов отдаёт пустой список, а не падает', async () => {
    const db = await withDb()
    await upsertGameMeta(db, meta(50, { tags: {} }), NOW)
    const page = await loadGamePage(50)
    expect(page?.similar).toEqual([])
    expect(page?.similarTag).toBeNull()
  })

  test('соседи есть и у записей чужих магазинов', async () => {
    const db = await withDb()
    await upsertGameMeta(db, meta(-7, { tags: { Roguelike: 800 } }), NOW)
    await replaceGameTags(db, -7, [{ tag: 'Roguelike', weight: 800 }])
    await upsertGameMeta(db, meta(9, { tags: { Roguelike: 500 } }), NOW)
    await replaceGameTags(db, 9, [{ tag: 'Roguelike', weight: 500 }])

    const page = await loadGamePage(-7)
    // патчей и отзывов Steam у такой записи нет, а похожие — есть
    expect(page?.news).toEqual([])
    expect(page?.similar.map((g) => g.appid)).toEqual([9])
  })
})

/**
 * Готовые соседи (game_neighbors, npm run neighbors:build): похожие по всему
 * вектору тегов. Пока их не залили — прежняя полка по тегу, её тесты выше.
 */
describe('готовые соседи на карточке', () => {
  /** Страница 1 и десять соседей по порядку сходства: 20…29 */
  async function withNeighbors(): Promise<Db> {
    const db = await withDb()
    await upsertGameMeta(db, meta(1, { tags: { Mythology: 1000, Action: 900 } }), NOW)
    await replaceGameTags(db, 1, [{ tag: 'Mythology', weight: 1000 }])
    for (let appid = 20; appid < 30; appid++) {
      await upsertGameMeta(db, meta(appid, { tags: { Mythology: 800 } }), NOW)
    }
    await upsertNeighbors(
      db,
      new Map([
        [
          1,
          Array.from({ length: 10 }, (_, i) => ({
            neighbor: 20 + i,
            score: 0.9 - i / 100,
            shared: ['Mythology', 'Hack and Slash'],
          })),
        ],
      ]),
    )
    return db
  }

  test('полка — первые шесть по сходству, без тега в заголовке, с общим у плитки', async () => {
    await withNeighbors()
    const page = await loadGamePage(1)
    expect(page?.similar.map((g) => g.appid)).toEqual([20, 21, 22, 23, 24, 25])
    expect(page?.similarTag).toBeNull()
    expect(page?.similar[0].shared).toEqual(['Mythology', 'Hack and Slash'])
  })

  test('умершие соседи выпадают, а на их место встают следующие', async () => {
    const db = await withNeighbors()
    await db.execute('UPDATE games SET alive = 0 WHERE appid IN (21, 23)')
    const page = await loadGamePage(1)
    expect(page?.similar.map((g) => g.appid)).toEqual([20, 22, 24, 25, 26, 27])
  })

  test('живых меньше шести — прежняя полка по тегу', async () => {
    const db = await withNeighbors()
    await db.execute('UPDATE games SET alive = 0 WHERE appid BETWEEN 20 AND 25')
    await upsertGameMeta(db, meta(40, { tags: { Mythology: 900 } }), NOW)
    await replaceGameTags(db, 40, [{ tag: 'Mythology', weight: 900 }])
    const page = await loadGamePage(1)
    expect(page?.similarTag).toBe('Mythology')
    expect(page?.similar.map((g) => g.appid)).toEqual([40])
  })

  test('игре без тегов соседей не ищем вовсе — ни одного чтения', async () => {
    const db = await withDb()
    const reads: string[] = []
    const spy = {
      execute: (q: InStatement) => {
        reads.push(typeof q === 'string' ? q : q.sql)
        return db.execute(q)
      },
    } as unknown as Db
    expect(await nearGames(spy, meta(50, { tags: {} }), null)).toEqual({ games: [], tag: null, basis: 'none' })
    expect(reads).toEqual([])
  })
})

/**
 * Страница игры называется «стоит ли играть», а кольцо с процентом рисовалось
 * только из сводки отзывов, которую наполняет крон. В каталоге на тысячу игр
 * её нет у 278 — то есть 28% страниц не отвечали на вопрос из собственного
 * заголовка.
 *
 * Запасным путём тогда стали reviews_total и reviews_percent — «заполненные у
 * всех». Но это англоязычная шкала порогов: Hades с ней — «98% из 143 тыс.»
 * при 309 тысячах, и хаб с /play показывали те же урезанные числа. Теперь
 * кольцо, хабы и /play читают одно правило (shownReviews): все языки из
 * сверки каталога, а сводка карточки — только пока сверка до игры не дошла.
 */
describe('reviewFacts', () => {
  const summary = { scoreDesc: 'Very Positive', totalPositive: 90, totalNegative: 10 }
  /** Все языки из сверки каталога — то, что видят люди */
  const all = (total: number, percent: number, score?: number) => ({
    reviewsAllTotal: total,
    reviewsAllPercent: percent,
    ...(score === undefined ? {} : { reviewsAllScore: score }),
  })

  test('все языки из сверки — первыми, и слово Steam той же сводки', () => {
    // Сводка карточки старше (её перечитывают раз в полгода) и на плитках
    // хабов и /play её нет — одна игра везде одним числом только так
    expect(reviewFacts(all(309_180, 98, 9), summary)).toEqual({
      percent: 98,
      total: 309_180,
      label: 'Overwhelmingly Positive',
    })
  })

  test('сверка до игры не дошла — сводка карточки: процент из сырых количеств', () => {
    expect(reviewFacts({}, summary)).toEqual({ percent: 90, total: 100, label: 'Very Positive' })
  })

  test('англоязычная шкала порогов не показывается никогда — ни одна, ни рядом со сводкой', () => {
    // Hades: 142 783 англоязычных из 309 тысяч — «из 143 тыс. отзывов» выдавало
    // треть за целое
    const english = { reviewsPercent: 98, reviewsTotal: 142_783 } as Parameters<typeof reviewFacts>[0]
    expect(reviewFacts(english, null)).toBeNull()
    expect(reviewFacts(english, summary)).toEqual({ percent: 90, total: 100, label: 'Very Positive' })
  })

  /**
   * Числа — факт площадки, и мы их пересказываем. Словесная шкала — её
   * суждение, и придумывать его за неё нельзя, как бы ни хотелось заполнить
   * пустое место словом. И слово одной сводки к числам другой не пришивается:
   * на границе вышло бы «Очень положительные» при 79%.
   */
  test('слово без оценки той же сводки не выдумывается и не берётся у соседней', () => {
    expect(reviewFacts(all(60_000, 97), null)?.label).toBeNull()
    expect(reviewFacts(all(60_000, 79), summary)?.label).toBeNull()
    expect(reviewFacts(all(60_000, 97, 0), null)?.label).toBeNull()
  })

  test('пустая сводка не считается сводкой', () => {
    const empty = { scoreDesc: 'No user reviews', totalPositive: 0, totalNegative: 0 }
    expect(reviewFacts({}, empty)).toBeNull()
    expect(reviewFacts(all(10, 80), empty)).toEqual({ percent: 80, total: 10, label: null })
  })

  test('когда нечего показать — null, а не ноль процентов', () => {
    expect(reviewFacts({}, null)).toBeNull()
    expect(reviewFacts({ reviewsAllPercent: 90 }, null)).toBeNull()
    expect(reviewFacts({ reviewsAllTotal: 100 }, null)).toBeNull()
    expect(reviewFacts(all(0, 90), null)).toBeNull()
  })

  test('процент зажимается в 0…100', () => {
    expect(reviewFacts(all(5, 140), null)?.percent).toBe(100)
    expect(reviewFacts(all(5, -3), null)?.percent).toBe(0)
  })
})

/**
 * Пульс отзывов под кольцом карточки: последний месяц и русскоязычные.
 * «Раньше ругали — сейчас хвалят» и что думают игроки на русском — факты для
 * решения, которых не показывал ни один экран.
 */
describe('reviewPulse', () => {
  // 3 октября 2023 UTC — дата замера в подписи
  const AT = Date.UTC(2023, 9, 3, 12) / 1000
  const ring = { percent: 97, total: 309_180, label: 'Overwhelmingly Positive' }
  const pulse = (over: Partial<GameMeta> = {}) =>
    meta(1, { reviewsRecentTotal: 7948, reviewsRecentPercent: 71, reviewsRecentAt: AT, ...over })

  test('месяц разошёлся со всем временем — строка с датой и сравнением с кольцом', () => {
    expect(reviewPulse(pulse(), ring, AT + 86_400)).toEqual([
      { label: 'За 30 дней до 3 октября', value: '71% положительных из 7 948 отзывов — ниже, чем за всё время' },
    ])
    expect(reviewPulse(pulse({ reviewsRecentPercent: 95 }), { ...ring, percent: 80 }, AT)[0].value).toMatch(
      /— выше, чем за всё время$/,
    )
  })

  test('совпадающий месяц, полупустой месяц и давний замер — строки нет', () => {
    expect(reviewPulse(pulse({ reviewsRecentPercent: 97 - PULSE_MIN_GAP + 1 }), ring, AT)).toEqual([])
    expect(reviewPulse(pulse({ reviewsRecentTotal: PULSE_MIN_RECENT - 1 }), ring, AT)).toEqual([])
    expect(reviewPulse(pulse(), ring, AT + PULSE_SHOW_MAX_AGE_SEC + 1)).toEqual([])
    // без кольца сравнивать не с чем
    expect(reviewPulse(pulse(), null, AT)).toEqual([])
  })

  test('на русском — простым фактом, от двух сотен отзывов', () => {
    const ru = meta(1, { reviewsRuTotal: 16_893, reviewsRuPercent: 96 })
    expect(reviewPulse(ru, ring, AT)).toEqual([{ label: 'На русском', value: '96% положительных из 16 893 отзывов' }])
    expect(reviewPulse(meta(1, { reviewsRuTotal: RU_MIN_REVIEWS - 1, reviewsRuPercent: 96 }), ring, AT)).toEqual([])
  })

  test('вывод от часов внутри срока показа не зависит — недельный кэш карточки', () => {
    const m = pulse({ reviewsRuTotal: 16_893, reviewsRuPercent: 96 })
    expect(reviewPulse(m, ring, AT + 6 * 86_400)).toEqual(reviewPulse(m, ring, AT))
  })
})

describe('вердикт мёртвой игре', () => {
  const dead = (over: Partial<GameMeta>) =>
    meta(1, { alive: false, signalsAt: NOW, categories: [1, 36], ...over })

  test('живой и непроверенной игре вердикта нет', () => {
    expect(deadVerdict(meta(1))).toBeNull()
    expect(deadVerdict(meta(1, { alive: true, signalsAt: NOW }))).toBeNull()
  })

  test('пустые серверы — так и говорим', () => {
    // Team Fortress Classic: сетевая без одиночной, 49 человек на весь мир
    const v = deadVerdict(dead({ deadReason: 'dead-multiplayer', ccu: 49, reviewsTotal: 4242, reviewsPercent: 86 }))
    expect(v).toMatch(/почти не осталось людей/)
  })

  test('разгромные отзывы — своя фраза', () => {
    const v = deadVerdict(
      dead({ deadReason: 'panned', categories: [2], reviewsPercent: 31, reviewsTotal: 5_000 }),
    )
    expect(v).toMatch(/отрицательные/)
  })

  /**
   * Курация пишет alive раз в прогон, а онлайн и отзывы обновляются чаще.
   * Строка «2 400 сейчас играют» рядом с «почти не осталось людей» — ровно
   * та ложь, против которой вердикт и заведён.
   */
  test('свежие числа спорят с курацией — молчим', () => {
    expect(deadVerdict(dead({ deadReason: 'dead-multiplayer', ccu: 2_400 }))).toBeNull()
    expect(
      deadVerdict(dead({ deadReason: 'panned', categories: [2], reviewsPercent: 72, reviewsTotal: 5_000 })),
    ).toBeNull()
  })

  /*
   * «Большинство отзывов отрицательные» — за всё время. Починенную игру,
   * которую за последний месяц хвалят, это суждение не описывает, а строка
   * пульса под кольцом спорила бы с ним в сантиметре.
   */
  test('разгромленная, но за месяц её хвалят — молчим; без часов и по давнему замеру — нет', () => {
    const panned = dead({
      deadReason: 'panned',
      categories: [2],
      reviewsPercent: 31,
      reviewsTotal: 5_000,
      reviewsRecentTotal: 120,
      reviewsRecentPercent: 82,
      reviewsRecentAt: NOW - 86_400,
    })
    expect(deadVerdict(panned, NOW)).toBeNull()
    expect(deadVerdict(panned)).toMatch(/отрицательные/)
    expect(deadVerdict(panned, NOW + PULSE_SHOW_MAX_AGE_SEC + 86_400)).toMatch(/отрицательные/)
    expect(deadVerdict({ ...panned, reviewsRecentPercent: 55 }, NOW)).toMatch(/отрицательные/)
    expect(deadVerdict({ ...panned, reviewsRecentTotal: 12 }, NOW)).toMatch(/отрицательные/)
  })

  test('без свежих чисел спорить нечем — верим курации', () => {
    expect(deadVerdict(dead({ deadReason: 'dead-multiplayer' }))).toMatch(/почти не осталось людей/)
  })

  test('причина неизвестна — общая фраза, а не пустота', () => {
    expect(deadVerdict(dead({}))).toMatch(/снята/)
  })
})

/** Само правило и его примеры — в lib/textlang.test.ts; здесь только то, что реэкспорт жив */
describe('isRussianText', () => {
  test('реэкспорт из lib/textlang отвечает тем же', () => {
    expect(isRussianText('Станьте вором в VR! Ощутите азарт воровства.')).toBe(true)
    expect(isRussianText('Rise, Tarnished, and be guided by grace')).toBe(false)
  })
})

/**
 * Было `имя: 93% положительных отзывов · Action, FPS, Shooter · <120 символов
 * short_description>` — 190–207 символов и у трёх карточек из четырёх
 * английский хвост, оборванный посреди слова: «…brandish the power of the
 * Elden». Русские «любят» и «ругают» в сниппет не попадали вовсе.
 */
describe('gameDescription', () => {
  const ENGLISH =
    'THE NEW FANTASY ACTION RPG. Rise, Tarnished, and be guided by grace to brandish the power of the Elden Ring and become an Elden Lord in the Lands Between.'
  const RUSSIAN =
    'Новая фэнтезийная ролевая игра. Восстань, погасший, и отправляйся в путь по Междуземью, чтобы стать повелителем Элдена и найти свою судьбу среди руин древнего королевства, где каждый шаг даётся с боем.'
  const facts = { percent: 93, total: 700_012, label: null }
  const prosCons = {
    pros: ['Огромный открытый мир, который хочется исследовать!'],
    cons: ['Оптимизация на ПК.'],
    source: 'claude' as const,
  }

  test('не длиннее сниппета даже со всем сразу', () => {
    const d = gameDescription({
      meta: meta(1245620, { name: 'ELDEN RING', shortDescription: RUSSIAN }),
      facts,
      prosCons,
      verdict: null,
    })
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(d.startsWith('ELDEN RING: 93% из 700')).toBe(true)
    expect(d).toContain('Любят: Огромный открытый мир, который хочется исследовать.')
    expect(d).toContain('Ругают: Оптимизация на ПК.')
  })

  test('на хвост встаёт целое предложение, а не начало следующего', () => {
    const d = gameDescription({
      meta: meta(1245620, { name: 'ELDEN RING', shortDescription: RUSSIAN }),
      facts,
      prosCons: { pros: ['Огромный открытый мир'], cons: ['Оптимизация на ПК'], source: 'claude' },
      verdict: null,
    })
    // а не «…ролевая игра. Восстань…»
    expect(d.endsWith('Ругают: Оптимизация на ПК. Новая фэнтезийная ролевая игра.')).toBe(true)
  })

  test('описание магазина режется по слову, с многоточием', () => {
    const d = gameDescription({
      meta: meta(1, { name: 'Игра', shortDescription: RUSSIAN }),
      facts: null,
      prosCons: null,
      verdict: null,
    })
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(d.endsWith('…')).toBe(true)
    // перед многоточием — целое слово из исходного текста, а не обрубок
    const lastWord = d.slice(0, -1).split(' ').pop()!
    expect(RUSSIAN.split(/\s+/).map((w) => w.replace(/[.,!?]+$/, ''))).toContain(lastWord)
  })

  test('английское описание в сниппет не идёт', () => {
    const d = gameDescription({
      meta: meta(1, { name: 'ELDEN RING', shortDescription: ENGLISH }),
      facts,
      prosCons: null,
      verdict: null,
    })
    expect(d).not.toMatch(/Tarnished|Elden Lord/)
    // разряды — неразрывным пробелом, как toLocaleString('ru-RU') на странице
    expect(d).toBe('ELDEN RING: 93% из 700 012 отзывов — положительные.')
  })

  test('число отзывов склоняется', () => {
    const one = gameDescription({
      meta: meta(1, { name: 'X' }),
      facts: { percent: 100, total: 21, label: null },
      prosCons: null,
      verdict: null,
    })
    expect(one).toBe('X: 100% из 21 отзыва — положительные.')
  })

  test('вердикт мёртвой игре идёт первым', () => {
    const d = gameDescription({
      meta: meta(1, { name: 'Dirty Bomb' }),
      facts: { percent: 76, total: 90_000, label: null },
      prosCons: null,
      verdict: 'Сетевая игра, в которой почти не осталось людей, — матч, скорее всего, не соберётся.',
    })
    expect(d.startsWith('Dirty Bomb: Сетевая игра')).toBe(true)
    expect(d).toContain('76%')
  })

  test('сказать нечего — общая фраза, а не пустое имя с двоеточием', () => {
    const d = gameDescription({
      meta: meta(1, { name: 'X', shortDescription: ENGLISH }),
      facts: null,
      prosCons: null,
      verdict: null,
    })
    expect(d).toBe('X — отзывы, теги и патчноуты на русском.')
  })

  test('длинное название тоже укладывается в предел', () => {
    const name = 'Очень длинное название '.repeat(10).trim()
    const d = gameDescription({ meta: meta(1, { name }), facts, prosCons, verdict: null })
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
  })

  /*
   * /game/335300 — «Очень положительные» 84%, а в сниппете одна жалоба: имя в
   * 40 знаков, первый плюс не влез целиком, и следом встал короткий минус.
   * Тот же текст — og:description и twitter:description, то есть и превью в
   * мессенджерах. «Любят» и «Ругают» теперь пара: минус — только при плюсе,
   * если плюсы у игры вообще есть.
   */
  describe('«Любят» и «Ругают» — пара', () => {
    const DS2 = 'DARK SOULS™ II: Scholar of the First Sin'
    const DS2_FACTS = { percent: 84, total: 132_477, label: null }
    const FACTS_LINE = `84% из ${(132_477).toLocaleString('ru-RU')} отзывов — положительные.`
    const LONG_PRO = 'Огромное количество контента и вариантов прохождения на любой вкус'
    const PRO = 'Интересная система боевых статов и построения персонажей'
    const CON = 'Враги часто стоят в засадах и много групповых боёв'

    test('первый плюс не влез — берётся следующий, а не одна жалоба', () => {
      expect(LONG_PRO).toHaveLength(66)
      const d = gameDescription({
        meta: meta(335300, { name: DS2 }),
        facts: DS2_FACTS,
        prosCons: { pros: [LONG_PRO, PRO], cons: [CON], source: 'claude' },
        verdict: null,
      })
      expect(d).toBe(`${DS2}: ${FACTS_LINE} Любят: ${PRO}.`)
      expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    })

    test('ни один плюс не влез — жалоба без плюса в сниппет не идёт', () => {
      const d = gameDescription({
        meta: meta(335300, { name: DS2 }),
        facts: DS2_FACTS,
        prosCons: { pros: [LONG_PRO], cons: [CON], source: 'claude' },
        verdict: null,
      })
      expect(d).toBe(`${DS2}: ${FACTS_LINE}`)
    })

    // Пара ломается, только когда плюс был и не влез. Модель, которая честно
    // не нашла плюсов у провальной игры, — это ответ отзывов, а не перекос
    test('плюсов нет вовсе (провальная игра) — жалоба встаёт одна', () => {
      const d = gameDescription({
        meta: meta(1, { name: 'X' }),
        facts: { percent: 25, total: 900, label: null },
        prosCons: { pros: [], cons: [CON], source: 'claude' },
        verdict: null,
      })
      expect(d).toBe(`X: 25% из 900 отзывов — положительные. Ругают: ${CON}.`)
    })

    test('плюс и минус влезают оба — встают оба; минус — первый, что влез', () => {
      const d = gameDescription({
        meta: meta(1, { name: 'X' }),
        facts: { percent: 81, total: 900, label: null },
        prosCons: { pros: [PRO], cons: [CON, 'Много групповых боёв'], source: 'claude' },
        verdict: null,
      })
      expect(d).toBe(`X: 81% из 900 отзывов — положительные. Любят: ${PRO}. Ругают: Много групповых боёв.`)
    })

    // Хвост «DARK SOULS™…» после плюса — не описание, а обрубок имени
    test('в узкий остаток описание магазина не встаёт обрубком', () => {
      const d = gameDescription({
        meta: meta(335300, {
          name: DS2,
          shortDescription: `${DS2} — продолжение легендарной серии, в которой каждый шаг даётся с боем.`,
        }),
        facts: DS2_FACTS,
        prosCons: { pros: [PRO], cons: [], source: 'claude' },
        verdict: null,
      })
      expect(d).toBe(`${DS2}: ${FACTS_LINE} Любят: ${PRO}.`)
    })
  })
})

describe('причина смерти из базы', () => {
  test('читается вместе с вердиктом курации', async () => {
    const db = await withDb()
    await addGame(db, 60)
    await db.execute({
      sql: `UPDATE games SET alive = 0, dead_reason = 'panned', signals_at = ? WHERE appid = 60`,
      args: [NOW],
    })
    const page = await loadGamePage(60)
    expect(page?.meta.alive).toBe(false)
    expect(page?.meta.deadReason).toBe('panned')
  })

  test('незнакомая причина вердиктом не становится', async () => {
    const db = await withDb()
    await addGame(db, 61)
    await db.execute({
      sql: `UPDATE games SET alive = 0, dead_reason = 'из будущего', signals_at = ? WHERE appid = 61`,
      args: [NOW],
    })
    expect((await loadGamePage(61))?.meta).not.toHaveProperty('deadReason')
  })

  test('у живой игры причины нет, даже если колонка не пуста', async () => {
    const db = await withDb()
    await addGame(db, 62)
    await db.execute({
      sql: `UPDATE games SET alive = 1, dead_reason = 'panned', signals_at = ? WHERE appid = 62`,
      args: [NOW],
    })
    expect((await loadGamePage(62))?.meta).not.toHaveProperty('deadReason')
  })
})

/** Семантика с нужной длиной захода и уверенностью; остальное — нейтральное */
function semantics(over: {
  minutes?: number
  bucket?: GameSemantics['session']['bucket']
  canStopAnytime?: boolean
  confidence?: number
}): GameSemantics {
  const minutes = over.minutes ?? 40
  return {
    v: 1,
    axes: { challenge: 50, complexity: 50, pace: 50 },
    session: {
      bucket: over.bucket ?? (minutes <= 25 ? 'short' : minutes >= 75 ? 'long' : 'medium'),
      minutes,
      canStopAnytime: over.canStopAnytime ?? false,
    },
    timeToFun: { bucket: null, hours: null },
    confidence: over.confidence ?? 0.7,
    n: 40,
    basis: 'tags+reviews',
  }
}

describe('«Чем выделяется» и длина сессии', () => {
  const SOLO = [2]
  // Multi-player и Online PvP, без Single-player — как у Dota 2 и CS2
  const ONLINE_ONLY = [1, 49]

  test('без семантики строки о сессии нет', () => {
    expect(sessionTrait({ categories: SOLO })).toBeNull()
    expect(gameTraits({ categories: SOLO }, null)).toEqual([])
  })

  test('семантика по одним тегам недостаточно уверена для карточки', () => {
    // приор по тегам не поднимается выше 0.4 — это не факт, а догадка
    const s = semantics({ confidence: SESSION_MIN_CONFIDENCE - 0.01 })
    expect(sessionTrait({ categories: SOLO, semantics: s })).toBeNull()
    expect(
      sessionTrait({ categories: SOLO, semantics: semantics({ confidence: SESSION_MIN_CONFIDENCE }) }),
    ).not.toBeNull()
  })

  test('минуты — четырьмя корзинами, а не числом', () => {
    const value = (minutes: number) =>
      sessionTrait({ categories: SOLO, semantics: semantics({ minutes }) })?.value
    expect(value(10)).toBe('~20 мин')
    expect(value(25)).toBe('~20 мин')
    expect(value(40)).toBe('~40 мин')
    expect(value(55)).toBe('~40 мин')
    expect(value(90)).toBe('~1,5 ч')
    expect(value(160)).toBe('на вечер')
    expect(sessionTrait({ categories: SOLO, semantics: semantics({}) })?.label).toBe('Сессия')
  })

  test('у сетевой игры без одиночного режима — матч с минутами', () => {
    expect(sessionTrait({ categories: ONLINE_ONLY, semantics: semantics({ minutes: 45 }) })).toEqual({
      label: 'Матч',
      value: '~45 мин',
    })
  })

  test('не матч: заход на вечер или партию можно бросить в любой момент', () => {
    // Rust: одиночного режима нет, но вайп длится неделями
    const evening = sessionTrait({ categories: ONLINE_ONLY, semantics: semantics({ minutes: 160 }) })
    expect(evening).toEqual({ label: 'Сессия', value: 'на вечер' })
    // асинхронная партия — выходишь когда хочешь
    const async = sessionTrait({
      categories: ONLINE_ONLY,
      semantics: semantics({ minutes: 20, canStopAnytime: true }),
    })
    expect(async?.label).toBe('Сессия')
    // одиночный режим есть — это не матч, даже если по сети тоже играют
    expect(sessionTrait({ categories: [1, 2], semantics: semantics({})})?.label).toBe('Сессия')
  })

  /*
   * Кооп-кампания — не матч. Категории и теги (первые по голосам) сняты с
   * каталога продакшна. /game/1426210 писал «Матч: ~30 мин» у It Takes Two:
   * playMode у неё 'coop' (одиночного режима нет), и прежнее правило считало
   * матчем любой мультиплеер без одиночного. Та же строка едет на героя /play,
   * в колоду пати и на полки жанров — компания, выбирающая вечер, видела
   * десятичасовую кампанию тридцатиминутным матчем.
   *
   * PvP-категорией одной не обойтись: у Dota 2 её нет ([1, 9]), а матч у неё
   * самый что ни на есть — его выдают теги.
   */
  const IT_TAKES_TWO = {
    categories: [1, 9, 38, 39, 24],
    tags: {
      'Co-op': 1486, Multiplayer: 1078, 'Split Screen': 892, 'Local Co-Op': 864, 'Online Co-Op': 733,
      Puzzle: 681, Adventure: 564, 'Story Rich': 468, 'Local Multiplayer': 407, 'Co-op Campaign': 407,
    },
  }
  const A_WAY_OUT = {
    categories: [1, 9, 38, 39, 24],
    tags: {
      'Online Co-Op': 1300, 'Co-op': 1164, 'Split Screen': 993, 'Story Rich': 872, 'Local Co-Op': 845,
      Multiplayer: 658, 'Action-Adventure': 529, Action: 486, Adventure: 438, Crime: 396,
    },
  }
  const HELLDIVERS_2 = {
    categories: [1, 9, 38],
    tags: {
      'Online Co-Op': 847, PvE: 759, 'Third-Person Shooter': 730, Multiplayer: 719, Shooter: 654,
      Action: 645, 'Co-op': 584, 'Sci-fi': 575, 'Extraction Shooter': 551, Capitalism: 516,
    },
  }
  const DOTA_2 = {
    categories: [1, 9],
    tags: {
      'Free to Play': 3010, MOBA: 1019, Multiplayer: 778, Strategy: 723, eSports: 598,
      'Team-Based': 554, Competitive: 422, Action: 401, 'Online Co-Op': 378, PvP: 308,
    },
  }
  const AMONG_US = {
    categories: [1, 49, 36, 47, 9, 38, 48, 27],
    tags: { Multiplayer: 1080, 'Online Co-Op': 735, 'Social Deduction': 734, Space: 682, Survival: 567 },
  }
  const CS2 = {
    categories: [1, 27],
    tags: { FPS: 1160, Shooter: 834, Multiplayer: 795, Competitive: 681, Action: 604 },
  }
  const REMATCH = {
    categories: [1, 9, 38, 27],
    tags: { Sports: 900, 'Football (Soccer)': 800, Multiplayer: 700, PvP: 600, eSports: 500, 'Online Co-Op': 400 },
  }

  test('кооп-кампания — «Сессия», а не «Матч»', () => {
    const s = semantics({ minutes: 30 })
    expect(sessionTrait({ ...IT_TAKES_TWO, semantics: s })).toEqual({ label: 'Сессия', value: '~40 мин' })
    expect(sessionTrait({ ...A_WAY_OUT, semantics: s })?.label).toBe('Сессия')
    // кооп против ботов — тоже заход, а не матч: противника-человека нет
    expect(sessionTrait({ ...HELLDIVERS_2, semantics: semantics({ minutes: 40 }) })?.label).toBe('Сессия')
  })

  test('настоящий матч остаётся матчем — по категориям PvP или по тегам', () => {
    const s = semantics({ minutes: 35 })
    // Dota 2: PvP-категории нет, матч выдают теги
    expect(sessionTrait({ ...DOTA_2, semantics: s })).toEqual({ label: 'Матч', value: '~35 мин' })
    expect(sessionTrait({ ...REMATCH, semantics: s })?.label).toBe('Матч')
    expect(sessionTrait({ ...AMONG_US, semantics: semantics({ minutes: 15 }) })).toEqual({
      label: 'Матч',
      value: '~15 мин',
    })
    // сетевая игра без коопа — матч, как и прежде, тегов не спрашиваем
    expect(sessionTrait({ ...CS2, semantics: s })?.label).toBe('Матч')
    expect(sessionTrait({ categories: [1, 27], semantics: s })?.label).toBe('Матч')
  })

  test('PvP в хвосте тегов кооп матчем не делает', () => {
    // Хвост тегов — шум единичных голосов: у хоррор-кооперативов вроде
    // MIMESIS «PvP» стоит девятнадцатым из двадцати
    const tail: Record<string, number> = { PvP: 5 }
    for (let i = 0; i < 19; i++) tail[`Тег ${i}`] = 1000 - i * 10
    expect(sessionTrait({ categories: [1, 9, 38], tags: tail, semantics: semantics({}) })?.label).toBe(
      'Сессия',
    )
  })

  test('без тегов кооп судится по одним категориям', () => {
    // страница со старой метой: «Сессия» — осторожная сторона, «Матч» обещал бы противника
    expect(sessionTrait({ categories: [1, 9], semantics: semantics({}) })?.label).toBe('Сессия')
    expect(sessionTrait({ categories: [1, 49, 9], semantics: semantics({}) })?.label).toBe('Матч')
  })

  test('карточка игры передаёт теги в строку сессии', () => {
    expect(gameTraits({ ...DOTA_2, semantics: semantics({}) }, null)).toContainEqual({
      label: 'Матч',
      value: '~40 мин',
    })
    expect(gameTraits({ ...IT_TAKES_TWO, semantics: semantics({}) }, null)).toContainEqual({
      label: 'Сессия',
      value: '~40 мин',
    })
  })

  test('«Чем выделяется» — русскими подписями, по порядку характерности', () => {
    expect(hookTrait(['Automation', 'Base Building'])).toEqual({
      label: 'Чем выделяется',
      value: `${tagRu('Automation')}, ${tagRu('Base Building')}`,
    })
    expect(hookTrait(null)).toBeNull()
    expect(hookTrait([])).toBeNull()
  })

  test('обе строки вместе: сначала чем выделяется, потом сессия', () => {
    const traits = gameTraits({ categories: SOLO, semantics: semantics({}) }, ['Automation'])
    expect(traits.map((t) => t.label)).toEqual(['Чем выделяется', 'Сессия'])
  })

  test('русский — последней строкой и только когда Steam про него ответил', () => {
    const traits = gameTraits({ categories: SOLO, semantics: semantics({}), ruLang: 2 }, ['Automation'])
    expect(traits.map((t) => t.label)).toEqual(['Чем выделяется', 'Сессия', 'Русский'])
    expect(traits.at(-1)?.value).toBe('субтитры — по данным Steam')
    // «нет» — тоже ответ, и он нужен читателю не меньше «озвучки»
    expect(gameTraits({ categories: SOLO, ruLang: 0 }, null)).toEqual([
      { label: 'Русский', value: 'нет — по данным Steam' },
    ])
    // не знаем — строки нет: блок фактов не появляется ради пустоты
    expect(gameTraits({ categories: SOLO }, null)).toEqual([])
  })

  test('карточка читает семантику и характерные теги тем же чтением строки', async () => {
    const db = await withDb()
    await upsertGameMeta(
      db,
      meta(70, { tags: { Action: 1000, Automation: 800, 'Base Building': 500 }, categories: SOLO }),
      NOW,
    )
    await replaceGameTags(db, 70, [{ tag: 'Automation', weight: 800 }])
    await db.batch(
      [
        [1, 'Singleplayer', 3031],
        [2, 'Action', 2383],
        [3, 'Automation', 60],
        [4, 'Base Building', 90],
      ].map(([tagid, name, count]) => ({
        sql: 'INSERT INTO tags (tagid, name, game_count) VALUES (?, ?, ?)',
        args: [tagid, name, count],
      })),
      'write',
    )
    await upsertSemantics(db, [{ appid: 70, semantics: semantics({ minutes: 160 }), computedAt: NOW }])

    const page = await loadGamePage(70)
    // Action — жанр Steam, «выделяться» им нельзя; остальные два — редкие
    expect(page?.hook).toEqual(['Automation', 'Base Building'])
    expect(page?.meta.semantics?.session.minutes).toBe(160)
    expect(gameTraits(page!.meta, page!.hook)).toEqual([
      { label: 'Чем выделяется', value: `${tagRu('Automation')}, ${tagRu('Base Building')}` },
      { label: 'Сессия', value: 'на вечер' },
    ])
  })

  test('«Наиграли» приезжает на карточку тем же чтением строки, что и сессия', async () => {
    const db = await withDb()
    await upsertGameMeta(db, meta(72, { tags: { 'Story Rich': 900, Adventure: 500 }, categories: SOLO }), NOW)
    await upsertSemantics(db, [
      {
        appid: 72,
        semantics: { ...semantics({ minutes: 40 }), played: { posMedianMin: 7 * 60 + 20, posN: 55 } },
        computedAt: NOW,
      },
    ])

    const page = await loadGamePage(72)
    expect(gameTraits(page!.meta, page!.hook)).toContainEqual({ label: 'Наиграли', value: '~8 ч — те, кто её хвалит' })
  })

  test('без карты тегов «Чем выделяется» молчит, а не называет самые частые', async () => {
    const db = await withDb()
    await upsertGameMeta(db, meta(71, { tags: { Automation: 800 } }), NOW)
    const page = await loadGamePage(71)
    expect(page?.hook).toBeNull()
    expect(page?.meta.semantics).toBeUndefined()
    // «Вход» по одному жанру (Automation в ENTRY_HIGH_TAGS) — приор, а не
    // факт об игре: на публичной карточке его нет, как и сессии по тегам
    expect(gameTraits(page!.meta, page!.hook)).toEqual([])
  })
})

describe('вход и характер', () => {
  const sem = (over: Partial<GameSemantics> = {}): GameSemantics => ({
    v: 1,
    axes: { challenge: 50, complexity: 50, pace: 50 },
    session: { bucket: 'short', minutes: 20, canStopAnytime: false },
    timeToFun: { bucket: null, hours: null },
    confidence: 0.8,
    n: 40,
    basis: 'tags+reviews',
    ...over,
  })

  test('«можно бросить в любой момент» не пишем: признак — только из тегов', () => {
    const stop = sem({ session: { bucket: 'short', minutes: 20, canStopAnytime: true } })
    expect(gameTraits({ categories: [2], semantics: stop }, null)).toEqual([{ label: 'Сессия', value: '~20 мин' }])
  })

  test('вход — только из отзывов, со ссылкой на них и часами', () => {
    const slow = sem({ timeToFun: { bucket: 'slow', hours: 3.4 } })
    expect(entryTrait({ tags: {}, semantics: slow })).toEqual({
      label: 'Вход',
      value: 'раскрывается через 3 часа — по отзывам',
    })
    expect(entryTrait({ tags: {}, semantics: sem({ timeToFun: { bucket: 'fast', hours: 0.3 } }) })?.value).toBe(
      'затягивает с первых минут — по отзывам',
    )
    // корзина без числа — приор по тегам, а не слова отзывов: «по отзывам» здесь было бы неправдой
    expect(entryTrait({ tags: {}, semantics: sem({ timeToFun: { bucket: 'fast', hours: null } }) })).toBeNull()
    expect(entryTrait({ tags: {}, semantics: sem({ timeToFun: { bucket: 'slow', hours: null } }) })).toBeNull()
    // уверенная семантика без выраженного старта — ответ «не знаем», теги её не переспорят
    expect(entryTrait({ tags: { 'Grand Strategy': 900 }, semantics: sem() })).toBeNull()
    // по одним тегам — не на карточке: жанровый приор выдал бы себя за факт
    expect(entryTrait({ tags: { 'Grand Strategy': 900 } })).toBeNull()
  })

  test('характер — две самые выраженные оси, середина молчит', () => {
    const calm = sem({ axes: { challenge: 20, complexity: 60, pace: 30 } })
    expect(characterTrait({ semantics: calm })).toEqual({ label: 'Характер', value: 'спокойная, неторопливая' })
    const hard = sem({ axes: { challenge: 90, complexity: 80, pace: 70 } })
    expect(characterTrait({ semantics: hard })?.value).toBe('с вызовом, есть что осваивать')
    expect(characterTrait({ semantics: sem() })).toBeNull()
    // по одним тегам оси — приор жанра, а не факт об игре
    expect(characterTrait({ semantics: sem({ confidence: 0.4, axes: { challenge: 10, complexity: 50, pace: 50 } }) })).toBeNull()
  })

  test('порядок строк: выделяется → сессия → вход → характер', () => {
    const all = sem({
      axes: { challenge: 20, complexity: 50, pace: 50 },
      timeToFun: { bucket: 'fast', hours: 0.4 },
    })
    expect(gameTraits({ categories: [2], semantics: all }, ['Automation']).map((t) => t.label)).toEqual([
      'Чем выделяется',
      'Сессия',
      'Вход',
      'Характер',
    ])
  })

  test('«Наиграли» — после входа, до характера и русского: время к времени', () => {
    const all = sem({
      axes: { challenge: 20, complexity: 50, pace: 50 },
      timeToFun: { bucket: 'fast', hours: 0.4 },
      played: { posMedianMin: 12 * 60, posN: 70 },
    })
    const traits = gameTraits({ categories: [2], tags: { Puzzle: 900 }, semantics: all, ruLang: 3 }, ['Puzzle'])
    expect(traits.map((t) => t.label)).toEqual(['Чем выделяется', 'Сессия', 'Вход', 'Наиграли', 'Характер', 'Русский'])
    expect(traits.find((t) => t.label === 'Наиграли')?.value).toBe('~12 ч — те, кто её хвалит')
  })

  test('у игры без финала «Наиграли» нет — ни по тегам, ни по соревновательным категориям', () => {
    const long = sem({ played: { posMedianMin: 300 * 60, posN: 90 } })
    const labels = (m: Parameters<typeof gameTraits>[0]) => gameTraits(m, null).map((t) => t.label)
    // песочница: медиана хваливших — сотни часов, и это не длина игры
    expect(labels({ categories: [2], tags: { Sandbox: 900 }, semantics: long })).not.toContain('Наиграли')
    // Online PvP без одиночного режима — как у Dota 2
    expect(labels({ categories: [1, 49], tags: { Action: 900 }, semantics: long })).not.toContain('Наиграли')
    // та же семантика у сюжетной игры — строка есть
    expect(labels({ categories: [2], tags: { 'Story Rich': 900 }, semantics: long })).toContain('Наиграли')
  })

  test('PvP рядом с одиночным режимом «Наиграли» не гасит — у Elden Ring вопрос про кампанию', () => {
    const long = sem({ played: { posMedianMin: 90 * 60, posN: 90 } })
    const labels = (m: Parameters<typeof gameTraits>[0]) => gameTraits(m, null).map((t) => t.label)
    // одиночная + PvP: в неё можно сыграть и без арены — строка есть
    expect(labels({ categories: [2, 49], tags: { 'Story Rich': 900 }, semantics: long })).toContain('Наиграли')
    expect(labels({ categories: [2, 36, 38], tags: { 'Souls-like': 900 }, semantics: long })).toContain('Наиграли')
    // PvP без одиночного — арена и есть игра: строки нет
    expect(labels({ categories: [1, 49], tags: { 'Story Rich': 900 }, semantics: long })).not.toContain('Наиграли')
    // тег без финала гасит строку и у одиночной игры с PvP
    expect(labels({ categories: [2, 49], tags: { Survival: 900 }, semantics: long })).not.toContain('Наиграли')
  })
})

/**
 * «Ещё у <студии>» под полкой «Похожие» — строка текстовых ссылок. Правила,
 * которые легко потерять правкой: корпоративный каталог молчит, одна игра —
 * не строка, издания и уже показанное не повторяются, порядок не зависит от
 * порядка входа (страница живёт в ISR неделю).
 */
describe('studioLine', () => {
  const page = { appid: 1, name: 'Hades', developer: 'Supergiant Games' }
  const g = (appid: number, name: string, reviewsTotal: number) => ({ appid, name, reviewsTotal })
  const supergiant = [
    g(1, 'Hades', 300_000),
    g(2, 'Bastion', 60_000),
    g(3, 'Transistor', 50_000),
    g(4, 'Pyre', 20_000),
  ]
  const names = (line: ReturnType<typeof studioLine>) => line?.games.map((x) => x.name) ?? null

  test('Hades: Bastion · Transistor · Pyre — по отзывам, без самой страницы', () => {
    expect(studioLine(page, supergiant, [])).toEqual({
      developer: 'Supergiant Games',
      games: [
        { appid: 2, name: 'Bastion' },
        { appid: 3, name: 'Transistor' },
        { appid: 4, name: 'Pyre' },
      ],
    })
  })

  test('больше двенадцати живых игр — корпоративный каталог, строки нет', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => g(i + 1, `Игра ${i + 1}`, 1000 - i))
    expect(studioLine(page, many(STUDIO_MAX_GAMES), [])?.games).toHaveLength(STUDIO_SHOWN)
    expect(studioLine(page, many(STUDIO_MAX_GAMES + 1), [])).toBeNull()
  })

  test('меньше двух названий после отсева — строки нет', () => {
    expect(studioLine(page, supergiant.slice(0, 3), [])?.games).toHaveLength(2)
    expect(studioLine(page, supergiant.slice(0, 2), [])).toBeNull()
    // одна игра у студии — это сама страница
    expect(studioLine(page, supergiant.slice(0, 1), [])).toBeNull()
    expect(studioLine(page, [], [])).toBeNull()
  })

  test('издания страницы не выдают себя за «ещё игру», издания между собой схлопываются', () => {
    const witcher = { appid: 292030, name: 'The Witcher 3: Wild Hunt', developer: 'CD PROJEKT RED' }
    const line = studioLine(
      witcher,
      [
        g(292030, 'The Witcher 3: Wild Hunt', 900_000),
        g(499450, 'The Witcher 3: Wild Hunt - Game of the Year Edition', 50_000),
        g(20900, 'The Witcher: Enhanced Edition', 60_000),
        g(20901, 'The Witcher', 5_000),
        g(20920, 'The Witcher 2: Assassins of Kings Enhanced Edition', 70_000),
      ],
      [],
    )
    // издание страницы выпало, из двух первых Witcher осталось самое обсуждаемое
    expect(names(line)).toEqual(['The Witcher 2: Assassins of Kings Enhanced Edition', 'The Witcher: Enhanced Edition'])
  })

  test('то, что уже стоит в «Похожих», не повторяется — ни по appid, ни изданием', () => {
    const similar = [
      { appid: 2, name: 'Bastion' },
      { appid: 77, name: 'Transistor Remastered' },
    ]
    expect(studioLine(page, supergiant, similar)).toBeNull()
    expect(names(studioLine(page, [...supergiant, g(5, 'Hades II', 40_000)], similar))).toEqual(['Hades II', 'Pyre'])
  })

  test('саундтрек и демо студии — не игры, их не советуем', () => {
    const line = studioLine(
      page,
      [...supergiant, g(9, 'Transistor - Original Soundtrack', 90_000), g(10, 'Pyre Demo', 80_000)],
      [],
    )
    expect(names(line)).toEqual(['Bastion', 'Transistor', 'Pyre'])
  })

  test('порядок — отзывы, затем appid, от порядка входа не зависит', () => {
    const tied = [g(1, 'Hades', 1), g(40, 'Д', 500), g(30, 'Г', 500), g(20, 'В', 900), g(10, 'Б', 500)]
    const expected = ['В', 'Б', 'Г', 'Д']
    expect(names(studioLine(page, tied, []))).toEqual(expected)
    expect(names(studioLine(page, [...tied].reverse(), []))).toEqual(expected)
    // и не больше четырёх названий
    expect(names(studioLine(page, [...tied, g(50, 'Е', 100)], []))).toEqual(expected)
  })

  test('чужой магазин и игра без разработчика — строки нет', () => {
    expect(studioLine({ ...page, appid: -7 }, supergiant, [])).toBeNull()
    expect(studioLine({ ...page, developer: undefined }, supergiant, [])).toBeNull()
    expect(studioLine({ ...page, developer: '  ' }, supergiant, [])).toBeNull()
  })

  test('на карточке: живые игры той же студии, без «Похожих», мёртвые и чужие не в счёт', async () => {
    const db = await withDb()
    const dev = { developer: 'Supergiant Games' }
    await upsertGameMeta(db, meta(1, { name: 'Hades', tags: { Roguelike: 1000 }, reviewsTotal: 300_000, ...dev }), NOW)
    await replaceGameTags(db, 1, [{ tag: 'Roguelike', weight: 1000 }])
    // Hades II стоит в «Похожих» по тегу
    await upsertGameMeta(db, meta(5, { name: 'Hades II', tags: { Roguelike: 1000 }, reviewsTotal: 90_000, ...dev }), NOW)
    await replaceGameTags(db, 5, [{ tag: 'Roguelike', weight: 1000 }])
    for (const [appid, name, reviewsTotal] of [
      [2, 'Bastion', 60_000],
      [3, 'Transistor', 50_000],
      [4, 'Pyre', 20_000],
    ] as Array<[number, string, number]>) {
      await upsertGameMeta(db, meta(appid, { name, tags: { Action: 900 }, reviewsTotal, ...dev }), NOW)
    }
    await upsertGameMeta(db, meta(6, { name: 'Мёртвая', reviewsTotal: 99_000, ...dev }), NOW)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 6')
    await upsertGameMeta(db, meta(7, { name: 'Чужая', reviewsTotal: 99_000, developer: 'Klei' }), NOW)

    const data = await loadGamePage(1)
    expect(data?.similar.map((x) => x.appid)).toEqual([5])
    expect(data?.studio).toEqual({
      developer: 'Supergiant Games',
      games: [
        { appid: 2, name: 'Bastion' },
        { appid: 3, name: 'Transistor' },
        { appid: 4, name: 'Pyre' },
      ],
    })
  })

  test('на карточке: у студии тринадцать живых игр — строки нет', async () => {
    const db = await withDb()
    for (let appid = 1; appid <= STUDIO_MAX_GAMES + 1; appid++) {
      await upsertGameMeta(db, meta(appid, { tags: { Action: 900 }, reviewsTotal: appid, developer: 'Square Enix' }), NOW)
    }
    expect((await loadGamePage(1))?.studio).toBeNull()
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 13')
    expect((await loadGamePage(1))?.studio?.games).toHaveLength(STUDIO_SHOWN)
  })
})
