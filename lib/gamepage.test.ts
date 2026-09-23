import type { InStatement } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import {
  createDb,
  replaceGameTags,
  setGameJson,
  upsertGameMeta,
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
  pickSimilar,
  reviewFacts,
  SESSION_MIN_CONFIDENCE,
  sessionTrait,
  SIMILAR_CANDIDATES,
  SIMILAR_SHOWN,
  topTagOf,
} from './gamepage'
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
})

describe('topTagOf', () => {
  test('берёт самый характерный тег, а не первый попавшийся', () => {
    expect(topTagOf(meta(1, { tags: { Indie: 300, Roguelike: 900, Action: 500 } }))).toBe('Roguelike')
  })

  test('при равных весах порядок не зависит от порядка ключей', () => {
    // Страница кэшируется на сутки и пререндерится: блок «похожие» не имеет
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
    // страница кэшируется на сутки: полка не должна прыгать между пересборками
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
 * Страница игры называется «стоит ли играть», а кольцо с процентом рисовалось
 * только из сводки отзывов, которую наполняет крон. В каталоге на тысячу игр
 * её нет у 278 — то есть 28% страниц не отвечали на вопрос из собственного
 * заголовка, при том что процент и количество лежат в той же строке базы и
 * заполнены у всех до одной.
 */
describe('reviewFacts', () => {
  const summary = { scoreDesc: 'Very Positive', totalPositive: 90, totalNegative: 10 }

  test('сводка точнее: процент считается из сырых количеств', () => {
    expect(reviewFacts({ reviewsPercent: 50, reviewsTotal: 2 }, summary)).toEqual({
      percent: 90,
      total: 100,
      label: 'Very Positive',
    })
  })

  test('без сводки берутся колонки — ровно тот случай, ради которого всё и делалось', () => {
    expect(reviewFacts({ reviewsPercent: 95, reviewsTotal: 13_440 }, null)).toEqual({
      percent: 95,
      total: 13_440,
      label: null,
    })
  })

  /**
   * Числа — факт площадки, и мы их пересказываем. Словесная шкала — её
   * суждение, и придумывать его за неё нельзя, как бы ни хотелось заполнить
   * пустое место словом.
   */
  test('слово без сводки не выдумывается', () => {
    expect(reviewFacts({ reviewsPercent: 97, reviewsTotal: 60_000 }, null)?.label).toBeNull()
  })

  test('пустая сводка не считается сводкой', () => {
    const empty = { scoreDesc: 'No user reviews', totalPositive: 0, totalNegative: 0 }
    expect(reviewFacts({ reviewsPercent: 80, reviewsTotal: 10 }, empty)).toEqual({
      percent: 80,
      total: 10,
      label: null,
    })
  })

  test('когда нечего показать — null, а не ноль процентов', () => {
    expect(reviewFacts({}, null)).toBeNull()
    expect(reviewFacts({ reviewsPercent: 90 }, null)).toBeNull()
    expect(reviewFacts({ reviewsTotal: 100 }, null)).toBeNull()
    expect(reviewFacts({ reviewsPercent: 90, reviewsTotal: 0 }, null)).toBeNull()
  })

  test('процент из колонок зажимается в 0…100', () => {
    expect(reviewFacts({ reviewsPercent: 140, reviewsTotal: 5 }, null)?.percent).toBe(100)
    expect(reviewFacts({ reviewsPercent: -3, reviewsTotal: 5 }, null)?.percent).toBe(0)
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

  test('без свежих чисел спорить нечем — верим курации', () => {
    expect(deadVerdict(dead({ deadReason: 'dead-multiplayer' }))).toMatch(/почти не осталось людей/)
  })

  test('причина неизвестна — общая фраза, а не пустота', () => {
    expect(deadVerdict(dead({}))).toMatch(/снята/)
  })
})

describe('isRussianText', () => {
  test('русское описание с латинскими названиями — русское', () => {
    expect(isRussianText('Станьте вором в VR! Ощутите азарт воровства.')).toBe(true)
  })

  test('английское — нет, даже с одним русским словом', () => {
    expect(isRussianText('Rise, Tarnished, and be guided by grace')).toBe(false)
    expect(isRussianText('A game about Москва and everything else in the world')).toBe(false)
  })

  test('пусто — не русское', () => {
    expect(isRussianText(undefined)).toBe(false)
    expect(isRussianText('')).toBe(false)
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

  test('без карты тегов «Чем выделяется» молчит, а не называет самые частые', async () => {
    const db = await withDb()
    await upsertGameMeta(db, meta(71, { tags: { Automation: 800 } }), NOW)
    const page = await loadGamePage(71)
    expect(page?.hook).toBeNull()
    expect(page?.meta.semantics).toBeUndefined()
    expect(gameTraits(page!.meta, page!.hook)).toEqual([])
  })
})
