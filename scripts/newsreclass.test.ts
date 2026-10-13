import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { createDb, getGameNews, getUnsummarized, upsertNewsItems, type Db, type StoredNews } from '../lib/db'
import { applyNewsReclass, planNewsReclass } from './newsreclass'

const NOW = 1_700_000_000
const DAY = 86_400
const freshDb = () => createDb(':memory:')

const CHANGES = ['Исправлен вылет при загрузке', 'Добавлен новый режим', 'Улучшена стабильность сети']

function post(gid: string, title: string, over: Partial<StoredNews> = {}): StoredNews {
  return {
    appid: 730,
    gid,
    title,
    url: `https://store.steampowered.com/news/app/730/view/${gid}`,
    publishedAt: NOW - DAY,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'ul', items: CHANGES.map((text) => [{ text }]) }],
    bodyHash: `h${gid}`,
    rank: 5000,
    ...over,
  }
}

/**
 * Строки, какими их оставил опрос до правки классификатора: дорожная карта
 * записана патчем, а пересказ Hades II на странице первой Hades — крупным
 * патчем с текстом, который выдаёт сиквел за обновление этой игры.
 */
async function seeded(): Promise<Db> {
  const db = await freshDb()
  await upsertNewsItems(
    db,
    [
      post('roadmap', 'Marathon: дорожная карта обновлений на 2026 год'),
      post('patch', 'Патч 2.31'),
      post('sale', 'Скидка 50% на выходных', { kind: 'news', scale: null }),
      post('sequel', 'Доступна версия 1.0 для Hades II!', {
        blocks: [
          {
            kind: 'p',
            runs: [{ text: 'Мы завершили разработку первого в истории нашей команды сиквела — Hades II.' }],
          },
        ],
      }),
      // тот же сиквел, но давно: за окном карты сайта повторный пересказ не нужен
      post('old', 'Доступна версия 1.0 для Hades II!', {
        publishedAt: NOW - 200 * DAY,
        blocks: [{ kind: 'p', runs: [{ text: 'Первый сиквел в нашей истории.' }] }],
      }),
    ],
    NOW - DAY,
  )
  await db.execute("UPDATE news_items SET tldr = 'Вышла версия 1.0.', tldr_at = 1, tldr_tries = 1 WHERE gid <> 'sale'")
  return db
}

describe('news-reclass: необязательный прогон по уже записанному', () => {
  test('план: патчи, которые нынешнее правило считает новостями, и подозрительные пересказы окна', async () => {
    const db = await seeded()
    const plan = await planNewsReclass(db, NOW)
    expect(plan.demote.map((r) => r.gid)).toEqual(['roadmap'])
    expect(plan.redigest.map((r) => r.gid)).toEqual(['sequel'])
  })

  test('без --apply база не меняется', async () => {
    // Скрипт показывает план и ничего не пишет: это прод, и решает владелец
    const db = await seeded()
    await planNewsReclass(db, NOW)
    expect((await getGameNews(db, 730)).map((n) => n.gid).sort()).toEqual(['old', 'patch', 'roadmap', 'sequel'])
    expect(await getUnsummarized(db)).toEqual([])
  })

  test('--apply переводит в новости, --redigest возвращает подозрительное к модели', async () => {
    const db = await seeded()
    const plan = await planNewsReclass(db, NOW)

    expect(await applyNewsReclass(db, plan, { redigest: false }, NOW)).toEqual({ demoted: 1, redigested: 0 })
    expect((await getGameNews(db, 730)).map((n) => n.gid).sort()).toEqual(['old', 'patch', 'sequel'])
    expect(await getUnsummarized(db)).toEqual([])

    // модель решит заново — теперь у неё есть ответ «не патч» (lib/llm)
    expect(await applyNewsReclass(db, plan, { redigest: true }, NOW)).toEqual({ demoted: 0, redigested: 1 })
    expect((await getUnsummarized(db)).map((n) => n.gid)).toEqual(['sequel'])
  })

  test('скрипт без --apply уходит до первой записи и облако не мигрирует', () => {
    // Сам скрипт зовёт main() при загрузке и ходит в облако — порядок шагов
    // сверяется по тексту, как в scripts/opendb.test.ts
    const src = readFileSync('scripts/news-reclass.ts', 'utf8')
    const main = src.slice(src.indexOf('async function main'))
    const stop = main.indexOf('if (!apply)')
    expect(stop, 'ветка без --apply не найдена').toBeGreaterThan(-1)
    expect(stop).toBeLessThan(main.indexOf('applyNewsReclass('))
    expect(src).not.toMatch(/createDb\(/)
  })
})
