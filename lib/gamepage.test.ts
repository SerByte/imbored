import type { InStatement } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import { createDb, replaceGameTags, setGameJson, upsertGameMeta, type Db } from './db'
import {
  DESCRIPTION_MAX,
  deadVerdict,
  gameDescription,
  isRussianText,
  loadGamePage,
  reviewFacts,
  topTagOf,
} from './gamepage'
import type { GameMeta } from './types'

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
          if (/FROM games WHERE appid = \?/.test(sql)) чтенийИгры++
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
