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

const SEQUEL = 'Доступна версия 1.0 для Hades II!'

/**
 * Строки, какими их оставил опрос до правки классификатора: дорожная карта
 * записана патчем, а пересказ Hades II на странице первой Hades — крупным
 * патчем с текстом, который выдаёт сиквел за обновление этой игры. Плюс два
 * вердикта модели «не патч»: у поста, который эвристика и сейчас зовёт
 * патчем, и у того, который она уже сама считает новостью.
 */
async function seeded(): Promise<Db> {
  const db = await freshDb()
  await upsertNewsItems(
    db,
    [
      post('roadmap', 'Marathon: дорожная карта обновлений на 2026 год'),
      post('patch', 'Патч 2.31'),
      post('sale', 'Скидка 50% на выходных', { kind: 'news', scale: null }),
      post('sequel', SEQUEL, {
        blocks: [
          {
            kind: 'p',
            runs: [{ text: 'Мы завершили разработку первого в истории нашей команды сиквела — Hades II.' }],
          },
        ],
      }),
      /*
       * Тот же сиквел, но старше окна карты сайта. Ровно так на проде:
       * «Доступна версия 1.0 для Hades II!» от 25.09.2025 — последний крупный
       * патч на карточке первой Hades, со ссылкой на свою страницу в индексе.
       * Карточка показывает восемь свежих патчей любого возраста, и срок
       * давности пересказ не исправляет.
       */
      post('old', SEQUEL, {
        publishedAt: NOW - 200 * DAY,
        blocks: [{ kind: 'p', runs: [{ text: 'Первый сиквел в нашей истории.' }] }],
      }),
      // игра вне каталога: ни ссылки, ни индекса, но пересказ на карточке и
      // на странице патча виден всё равно
      post('offcat', SEQUEL, {
        rank: 0,
        blocks: [{ kind: 'p', runs: [{ text: 'Первый сиквел в нашей истории.' }] }],
      }),
      post('verdict', 'Патч 2.40'),
      post('ahead', 'Battlefield 6: Looking Ahead To Season 5'),
    ],
    NOW - DAY,
  )
  await db.execute("UPDATE news_items SET tldr = 'Вышла версия 1.0.', tldr_at = 1, tldr_tries = 1 WHERE gid <> 'sale'")
  // вердикт «не патч» пишется с пустым пересказом (setNewsDigest)
  await db.execute("UPDATE news_items SET scale = 'none', tldr = '' WHERE gid IN ('verdict', 'ahead')")
  return db
}

describe('news-reclass: необязательный прогон по уже записанному', () => {
  test('план: новости по нынешнему правилу, подозрительные пересказы любого возраста и вердикты «не патч»', async () => {
    const db = await seeded()
    const plan = await planNewsReclass(db)
    // вердикт у поста, который эвристика и так считает новостью, — в demote:
    // переспрашивать о нём модель незачем
    expect(plan.demote.map((r) => r.gid)).toEqual(['ahead', 'roadmap'])
    expect(plan.redigest.map((r) => r.gid)).toEqual(['offcat', 'old', 'sequel'])
    expect(plan.none.map((r) => r.gid)).toEqual(['verdict'])
  })

  test('без --apply база не меняется', async () => {
    // Скрипт показывает план и ничего не пишет: это прод, и решает владелец
    const db = await seeded()
    await planNewsReclass(db)
    expect((await getGameNews(db, 730)).map((n) => n.gid).sort()).toEqual(['offcat', 'old', 'patch', 'roadmap', 'sequel'])
    expect(await getUnsummarized(db)).toEqual([])
  })

  test('--apply переводит в новости, --redigest возвращает подозрительное к модели', async () => {
    const db = await seeded()
    const plan = await planNewsReclass(db)

    expect(await applyNewsReclass(db, plan, { redigest: false }, NOW)).toEqual({
      demoted: 2,
      redigested: 0,
      renoned: 0,
    })
    expect((await getGameNews(db, 730)).map((n) => n.gid).sort()).toEqual(['offcat', 'old', 'patch', 'sequel'])
    expect(await getUnsummarized(db)).toEqual([])

    // модель решит заново — теперь у неё есть ответ «не патч» (lib/llm)
    expect(await applyNewsReclass(db, plan, { redigest: true }, NOW)).toEqual({
      demoted: 0,
      redigested: 3,
      renoned: 0,
    })
    expect((await getUnsummarized(db)).map((n) => n.gid).sort()).toEqual(['offcat', 'old', 'sequel'])
  })

  /*
   * Вердикт «не патч» опрос не переписывает, пока тело то же, и он снимает
   * пост с карточки, ленты, карты сайта и страницы патча. Ошибка модели без
   * обратного хода была бы навсегда: --redigest берёт только scale 'major'.
   */
  test('--renone возвращает вердикт «не патч» модели: снова патч, снова в очереди пересказа', async () => {
    const db = await seeded()
    const plan = await planNewsReclass(db)
    expect((await getGameNews(db, 730)).map((n) => n.gid)).not.toContain('verdict')

    expect(await applyNewsReclass(db, plan, { renone: true }, NOW)).toEqual({
      demoted: 2,
      redigested: 0,
      renoned: 1,
    })
    expect((await getGameNews(db, 730)).map((n) => n.gid)).toContain('verdict')
    const queued = await getUnsummarized(db)
    expect(queued.map((n) => [n.gid, n.scale])).toEqual([['verdict', 'major']])

    // повтор ничего не трогает: строка уже не 'none'
    expect((await applyNewsReclass(db, plan, { renone: true }, NOW)).renoned).toBe(0)
  })

  test('--renone=appid/gid — только перечисленные, ключ не из плана не пишется', async () => {
    const db = await seeded()
    const plan = await planNewsReclass(db)
    // 'ahead' — тоже 'none', но в план вердиктов не попал: его ключ пропускается
    expect((await applyNewsReclass(db, plan, { renone: ['730/ahead', '730/nope'] }, NOW)).renoned).toBe(0)
    expect(await getUnsummarized(db)).toEqual([])
    expect((await applyNewsReclass(db, plan, { renone: ['730/verdict'] }, NOW)).renoned).toBe(1)
    expect((await getUnsummarized(db)).map((n) => n.gid)).toEqual(['verdict'])
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
