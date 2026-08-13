import { describe, expect, test } from 'vitest'
import {
  createDb,
  enrollNewsPoll,
  getGameNews,
  getMajorFeed,
  getUnsummarized,
  upsertGameMeta,
  type Db,
} from './db'
import type { RawNewsItem } from './news'
import { LlmUnavailableError } from './llm'
import { nextPollAt, runNewsSlice } from './newsjob'
import type { GameMeta } from './types'

const NOW = 1_700_000_000
const DAY = 86_400

const freshDb = () => createDb(':memory:')

function post(appid: number, gid: string, title: string, bullets: string[]): RawNewsItem {
  return {
    appid,
    gid,
    title,
    url: `https://store.steampowered.com/news/app/${appid}/view/${gid}`,
    publishedAt: NOW - 3600,
    blocks: [{ kind: 'ul', items: bullets.map((b) => [{ text: b }]) }],
  }
}

/** Тело заметно длиннее 120 символов: иначе его отсечёт looksTrivial */
const PATCH = [
  'Исправлен вылет при загрузке сохранения на некоторых видеокартах',
  'Добавлен новый режим «Схватка» с поддержкой восьми игроков одновременно',
  'Улучшена стабильность сетевого кода и снижены задержки на дальних серверах',
]

/** Никогда не ходит в сеть и мимо лимитера темпа */
const feedOf =
  (map: Record<number, RawNewsItem[] | null>) =>
  async (appid: number): Promise<RawNewsItem[] | null> =>
    map[appid] ?? []

type DigestArgs = { gameName: string; title: string; body: string; lang: 'ru' | 'en' }

const okDigest = async () => ({
  tldr: 'Починили сеть и добавили режим.',
  scale: 'major' as const,
})
const noDigest = async () => null

async function seedGame(db: Db, appid: number, name: string, reviews: number) {
  const meta: GameMeta = {
    appid,
    name,
    tags: { Action: 100 },
    genres: ['Action'],
    categories: [1],
    reviewsTotal: reviews,
  }
  await upsertGameMeta(db, meta, NOW)
}

describe('nextPollAt: каденция от того, как часто игра патчится', () => {
  const base = { tier: 1 as const, status: 'ok' as const, failCount: 0 }

  test('игра, патчившаяся на этой неделе, опрашивается ежедневно', () => {
    expect(nextPollAt({ ...base, lastPubAt: NOW - 2 * DAY }, NOW)).toBe(NOW + 24 * 3600)
  })

  test('давно молчащая игра каталога уходит в длинный интервал', () => {
    expect(nextPollAt({ ...base, lastPubAt: NOW - 200 * DAY }, NOW)).toBe(NOW + 28 * DAY)
    expect(nextPollAt({ ...base, lastPubAt: NOW - 60 * DAY }, NOW)).toBe(NOW + 7 * DAY)
  })

  test('игра из библиотеки опрашивается чаще игры из каталога', () => {
    const lib = nextPollAt({ ...base, tier: 0, lastPubAt: NOW - 60 * DAY }, NOW)
    const cat = nextPollAt({ ...base, tier: 1, lastPubAt: NOW - 60 * DAY }, NOW)
    expect(lib).toBeLessThan(cat)
  })

  test('ошибки отступают по экспоненте, но не дальше суток', () => {
    expect(nextPollAt({ ...base, status: 'error', failCount: 0 }, NOW)).toBe(NOW + 1800)
    expect(nextPollAt({ ...base, status: 'error', failCount: 2 }, NOW)).toBe(NOW + 7200)
    expect(nextPollAt({ ...base, status: 'error', failCount: 20 }, NOW)).toBe(NOW + DAY)
  })
})

describe('runNewsSlice', () => {
  test('записывает патчи, отделяя их от новостей', async () => {
    const db = await freshDb()
    await seedGame(db, 730, 'CS2', 9_000_000)
    await enrollNewsPoll(db, [730], 1, NOW)

    const res = await runNewsSlice(db, {
      nowSec: NOW + 4000,
      deadlineAt: Date.now() + 5000,
      fetchNews: feedOf({
        730: [
          post(730, '1', 'Обновление Counter-Strike 2', PATCH),
          post(730, '2', 'Скидки выходного дня', ['Скидка 50%']),
        ],
      }),
      digestFn: okDigest,
    })

    expect(res.polled).toBe(1)
    expect(res.inserted).toBe(2)
    const news = await getGameNews(db, 730)
    expect(news.map((n) => n.title)).toEqual(['Обновление Counter-Strike 2'])
  })

  test('пересказ доезжает до записи и попадает в общую ленту', async () => {
    const db = await freshDb()
    await seedGame(db, 730, 'CS2', 9_000_000)
    await enrollNewsPoll(db, [730], 1, NOW)

    const res = await runNewsSlice(db, {
      nowSec: NOW + 4000,
      deadlineAt: Date.now() + 5000,
      fetchNews: feedOf({ 730: [post(730, '1', 'Обновление Counter-Strike 2', PATCH)] }),
      digestFn: okDigest,
    })

    expect(res.digested).toBe(1)
    const [feed] = await getMajorFeed(db)
    expect(feed.tldr).toBe('Починили сеть и добавили режим.')
    expect(feed.scale).toBe('major')
  })

  test('повторный прогон не пересказывает то же самое второй раз', async () => {
    const db = await freshDb()
    await seedGame(db, 730, 'CS2', 9_000_000)
    await enrollNewsPoll(db, [730], 1, NOW)
    const feed = feedOf({ 730: [post(730, '1', 'Обновление Counter-Strike 2', PATCH)] })

    let calls = 0
    const counting = async (a: DigestArgs) => {
      calls++
      void a
      return okDigest()
    }
    const opts = { deadlineAt: Date.now() + 5000, fetchNews: feed, digestFn: counting }

    await runNewsSlice(db, { ...opts, nowSec: NOW + 4000 })
    // курсор аренды двигается, поэтому вторую выборку надо звать позже
    await runNewsSlice(db, { ...opts, nowSec: NOW + 200_000 })
    expect(calls).toBe(1)
  })

  test('игра без ленты не считается сбоем и уходит в долгий ящик', async () => {
    const db = await freshDb()
    await enrollNewsPoll(db, [999], 1, NOW)
    const res = await runNewsSlice(db, {
      nowSec: NOW + 4000,
      deadlineAt: Date.now() + 5000,
      fetchNews: feedOf({ 999: [] }),
      digestFn: noDigest,
    })
    expect(res.polled).toBe(1)
    expect(res.inserted).toBe(0)
    const row = await db.execute('SELECT status FROM news_poll WHERE appid = 999')
    expect(row.rows[0].status).toBe('empty')
  })

  test('три отказа подряд означают блокировку IP, а не мёртвые игры', async () => {
    // Steam закрывается от IP датацентра целиком; штамповать в этот момент
    // весь набор как «мёртвый» нельзя — аренда истечёт и мы вернёмся
    const db = await freshDb()
    await enrollNewsPoll(db, [1, 2, 3, 4, 5], 1, NOW)
    const res = await runNewsSlice(db, {
      nowSec: NOW + 4000,
      deadlineAt: Date.now() + 5000,
      fetchNews: async () => null,
      digestFn: noDigest,
    })
    expect(res.stopped).toBe('blocked')
    expect(res.polled).toBe(3)
    const left = await db.execute("SELECT COUNT(*) AS n FROM news_poll WHERE status = 'new'")
    expect(Number(left.rows[0].n)).toBe(2)
  })

  test('без ключа Claude лента живёт, просто без пересказов', async () => {
    const db = await freshDb()
    await seedGame(db, 730, 'CS2', 9_000_000)
    await enrollNewsPoll(db, [730], 1, NOW)
    const res = await runNewsSlice(db, {
      nowSec: NOW + 4000,
      deadlineAt: Date.now() + 5000,
      fetchNews: feedOf({ 730: [post(730, '1', 'Обновление Counter-Strike 2', PATCH)] }),
      digestFn: noDigest,
    })
    expect(res.inserted).toBe(1)
    expect(res.digested).toBe(0)
    expect(await getGameNews(db, 730)).toHaveLength(1)
  })

  test('запись выпадает из очереди пересказа после трёх отказов модели', async () => {
    const db = await freshDb()
    await seedGame(db, 730, 'CS2', 9_000_000)
    await enrollNewsPoll(db, [730], 1, NOW)
    const opts = {
      deadlineAt: Date.now() + 5000,
      fetchNews: feedOf({ 730: [post(730, '1', 'Обновление Counter-Strike 2', PATCH)] }),
      digestFn: noDigest,
    }
    for (let i = 0; i < 3; i++) {
      await runNewsSlice(db, { ...opts, nowSec: NOW + 4000 + i * 200_000 })
    }
    expect(await getUnsummarized(db)).toHaveLength(0)
  })

  test('тривиальный патч сразу минорный и общую ленту не засоряет', async () => {
    const db = await freshDb()
    await seedGame(db, 730, 'CS2', 9_000_000)
    await enrollNewsPoll(db, [730], 1, NOW)
    await runNewsSlice(db, {
      nowSec: NOW + 4000,
      deadlineAt: Date.now() + 5000,
      fetchNews: feedOf({
        730: [
          {
            ...post(730, '9', 'Обновление Counter-Strike 2', []),
            blocks: [{ kind: 'p', runs: [{ text: 'Карта обновлена до версии из мастерской.' }] }],
          },
        ],
      }),
      digestFn: okDigest,
    })
    expect(await getMajorFeed(db)).toEqual([])
    expect(await getGameNews(db, 730)).toHaveLength(1)
  })
})

describe('нет ключа Claude — не жжём попытки', () => {
  test('без модели очередь пересказа не трогается вовсе', async () => {
    // Иначе временно забытый ключ НАВСЕГДА выбивает записи из очереди:
    // три холостых прогона — и патч уже никогда не получит пересказ
    const db = await freshDb()
    await seedGame(db, 730, 'CS2', 9_000_000)
    await enrollNewsPoll(db, [730], 1, NOW)
    const key = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      await runNewsSlice(db, {
        nowSec: NOW + 4000,
        deadlineAt: Date.now() + 5000,
        fetchNews: feedOf({ 730: [post(730, '1', 'Обновление Counter-Strike 2', PATCH)] }),
        // digestFn НЕ передаём: проверяем реальную ветку «модели нет»
      })
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key
    }
    const r = await db.execute('SELECT tldr_tries FROM news_items WHERE appid = 730')
    expect(Number(r.rows[0].tldr_tries)).toBe(0)
    // запись осталась в очереди и дождётся ключа
    expect(await getUnsummarized(db)).toHaveLength(1)
  })
})
describe('сервис пересказов недоступен', () => {
  test('системный отказ не тратит попытки записей', async () => {
    // Пустой баланс Anthropic отвечает 400 на КАЖДЫЙ запрос. Без этого три
    // прогона крона выбросили бы сотни патчей из очереди навсегда — из-за счёта
    const db = await freshDb()
    await seedGame(db, 730, 'CS2', 9_000_000)
    await enrollNewsPoll(db, [730], 1, NOW)
    await runNewsSlice(db, {
      nowSec: NOW + 4000,
      deadlineAt: Date.now() + 5000,
      fetchNews: feedOf({ 730: [post(730, '1', 'Обновление Counter-Strike 2', PATCH)] }),
      digestFn: async () => {
        throw new LlmUnavailableError(400, 'credit balance is too low')
      },
    })
    const r = await db.execute('SELECT tldr_tries FROM news_items WHERE appid = 730')
    expect(Number(r.rows[0].tldr_tries)).toBe(0)
    expect(await getUnsummarized(db)).toHaveLength(1)
  })

  test('а плохой ответ живой модели попытку засчитывает', async () => {
    // иначе битая запись крутилась бы в очереди вечно
    const db = await freshDb()
    await seedGame(db, 730, 'CS2', 9_000_000)
    await enrollNewsPoll(db, [730], 1, NOW)
    await runNewsSlice(db, {
      nowSec: NOW + 4000,
      deadlineAt: Date.now() + 5000,
      fetchNews: feedOf({ 730: [post(730, '1', 'Обновление Counter-Strike 2', PATCH)] }),
      digestFn: noDigest,
    })
    const r = await db.execute('SELECT tldr_tries FROM news_items WHERE appid = 730')
    expect(Number(r.rows[0].tldr_tries)).toBe(1)
  })
})
