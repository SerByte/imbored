import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { LinkPending } from '@/components/LinkPending'
import { setNewsDigest, upsertGameMeta, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { flight as flightOf, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import PatchArchivePage, { generateMetadata, revalidate } from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Архив обновлений игры — /game/<appid>/news (lib/patcharchive).
 *
 * Карточка игры показывает восемь последних патчей, а хранится до тридцати
 * постов: всё старше восьмого раньше не было видно ниоткуда. Здесь — что
 * архив показывает их все, ведёт заголовком только на страницы патчей из
 * поиска и сам идёт в индекс, только когда в нём есть своё: пересказы.
 */

const APPID = 730
const DAY = 86_400

let db: Db
let now: number

beforeEach(async () => {
  db = await freshDb()
  now = nowSec()
  await upsertGameMeta(
    db,
    {
      appid: APPID,
      name: 'Counter-Strike 2',
      tags: { FPS: 1000 },
      genres: [],
      categories: [1],
      reviewsTotal: 1000,
      reviewsPercent: 80,
    },
    now,
  )
})

const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [GameArt, 'GameArt'],
  [LinkPending, 'LinkPending'],
])

function patch(gid: string, daysAgo: number, over: Partial<StoredNews> = {}): StoredNews {
  return {
    appid: APPID,
    gid,
    title: 'Обновление Counter-Strike 2',
    url: `https://store.steampowered.com/news/app/${APPID}/view/${gid}`,
    publishedAt: now - daysAgo * DAY,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: 'Починили сеть' }] }],
    bodyHash: `h${gid}`,
    rank: 9000,
    ...over,
  }
}

/** Патчи и пересказы к тем, чьи gid названы в told */
async function seed(items: StoredNews[], told: string[]): Promise<void> {
  await upsertNewsItems(db, items, now)
  for (const gid of told) await setNewsDigest(db, APPID, gid, { tldr: `Пересказ ${gid}.`, scale: 'major' }, now)
}

const params = (appid = String(APPID)) => ({ params: Promise.resolve({ appid }) })
/** Метаданные сегмента выше: картинка — карточка игры (app/game/[appid]/opengraph-image.tsx) */
const inherited = { images: [{ url: 'https://imbored.cc/game/730/opengraph-image' }] }
const parent = Promise.resolve({ openGraph: inherited })
const meta = (appid?: string) => generateMetadata(params(appid), parent as never)
const render = async () => flightOf(await PatchArchivePage(params()), ISLANDS)

describe('архив обновлений игры', () => {
  test('все хранящиеся патчи, а не восемь, как на карточке; распродаж нет', async () => {
    const items = Array.from({ length: 12 }, (_, i) => patch(String(i + 1), i * 5))
    await seed([...items, patch('sale', 1, { kind: 'news', title: 'Weekend Deal' })], [])
    const page = await render()
    const text = textOf(page)
    // двенадцать строк — у каждой ссылка на оригинал в Steam (пересказов нет)
    expect(JSON.stringify(page).match(/news\/app\/730\/view\//g)).toHaveLength(12)
    expect(text).not.toContain('Weekend Deal')
    expect(text).toContain('12 патчей')
    // ни одного пересказа — и подписи про ИИ нет: подписывать нечего
    expect(text).not.toContain('Пересказы собраны ИИ')
  })

  /*
   * Патч ли запись — по нынешнему правилу классификатора, как у ленты
   * карточки и страницы патча (isStoredPatch в lib/news), а не по kind,
   * записанному опросом. Иначе дорожная карта, записанная патчем до правки
   * lib/news, стояла бы здесь строкой с пересказом и ссылкой на страницу,
   * которая отдаёт ей 404. Вердикт модели «не патч» (scale 'none') — тоже мимо.
   */
  test('дорожная карта, записанная патчем старым правилом, и вердикт «не патч» — не строки архива', async () => {
    await seed(
      [
        patch('real', 1),
        patch('roadmap', 2, {
          title: 'Looking Ahead To Season 5',
          blocks: [{ kind: 'p', runs: [{ text: 'Рассказываем, что готовим к следующему сезону.' }] }],
        }),
        patch('verdict', 3),
      ],
      ['real', 'roadmap'],
    )
    await setNewsDigest(db, APPID, 'verdict', { tldr: 'Планы на будущее.', scale: 'none' }, now)
    const page = await render()
    const text = textOf(page)
    expect(text).toContain('1 патч')
    expect(text).not.toContain('Looking Ahead')
    expect(text).not.toContain('Пересказ roadmap.')
    expect(islandsOf(page, 'Link').some((l) => String(l.href).endsWith('/roadmap'))).toBe(false)
    expect(JSON.stringify(page)).not.toContain('/view/verdict')
  })

  test('строка ведёт пересказом; заголовок — ссылкой только у патча из поиска', async () => {
    await seed([patch('told', 1), patch('hotfix', 2, { scale: 'hotfix' })], ['told'])
    const page = await render()
    const hrefs = islandsOf(page, 'Link').map((l) => ({ href: l.href, prefetch: l.prefetch }))
    expect(hrefs).toContainEqual({ href: `/game/${APPID}/news/told`, prefetch: false })
    // хотфикс без пересказа — страница с noindex: краулера туда не зовём
    expect(hrefs.some((l) => l.href === `/game/${APPID}/news/hotfix`)).toBe(false)
    const text = textOf(page)
    expect(text).toContain('Пересказ told.')
    expect(text).toContain('Пересказы собраны ИИ')
    // путь над заголовком — назад в карточку игры
    expect(hrefs).toContainEqual({ href: `/game/${APPID}`, prefetch: undefined })
  })

  test('по месяцам: заголовок месяца над его патчами', async () => {
    await seed([patch('1', 1), patch('2', 40), patch('3', 80)], [])
    const text = textOf(await render())
    const months = text.match(/(Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь) \d{4}/g)
    expect(new Set(months).size).toBeGreaterThanOrEqual(3)
  })

  test('в поиск — от трёх пересказов у живой игры; меньше — noindex, follow', async () => {
    await seed([patch('1', 1), patch('2', 2), patch('3', 3)], ['1', '2'])
    expect((await meta()).robots).toEqual({ index: false, follow: true })
    await setNewsDigest(db, APPID, '3', { tldr: 'Третий.', scale: 'major' }, now)
    const indexed = await meta()
    expect(indexed.robots).toBeUndefined()
    expect(indexed.alternates?.canonical).toBe(`/game/${APPID}/news`)
    expect(indexed.title).toBe('Обновления «Counter-Strike 2» — что изменилось в патчах')
    // карточка для чатов — унаследованная карточка игры, а не пустота
    expect(indexed.openGraph?.images).toEqual([{ url: 'https://imbored.cc/game/730/opengraph-image' }])
  })

  test('игра, которую каталог считает мёртвой, — вне поиска при любых пересказах', async () => {
    await seed([patch('1', 1), patch('2', 2), patch('3', 3)], ['1', '2', '3'])
    // курация пишет вердикт вместе с отметкой проверки (promote-catalog, rowToMeta)
    await db.execute({ sql: 'UPDATE games SET alive = 0, signals_at = ? WHERE appid = ?', args: [now, APPID] })
    expect((await meta()).robots).toEqual({ index: false, follow: true })
  })

  test('нет патчей, нет игры или кривой адрес — 404, а не пустой архив', async () => {
    await seed([patch('sale', 1, { kind: 'news' })], [])
    await expect(PatchArchivePage(params())).rejects.toThrow()
    expect(await meta('570')).toEqual({})
    expect(await meta('abc')).toEqual({})
    expect(await meta('-730')).toEqual({})
  })

  /*
   * Мост «Что нового» внизу — тот же, что у страницы патча, и с тем же
   * правилом: /whatsnew динамическая (lib/nav, DYNAMIC_SECTIONS), префетч
   * будил бы функцию на каждом просмотре архива, а нажатие без него видно по
   * мерцанию подписи (LinkPending).
   */
  test('мост не префетчит динамическую ленту, а нажатие видно сразу', async () => {
    await seed([patch('1', 1)], [])
    const [link] = islandsOf(await render(), 'Link').filter((l) => l.href === '/whatsnew')
    expect(link?.prefetch).toBe(false)
    expect(islandsOf(link?.children, 'LinkPending')).toHaveLength(1)
  })

  test('сутки ISR, и страница не читает сессию', () => {
    expect(revalidate).toBe(86_400)
    const src = fs
      .readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(src).not.toMatch(/next\/headers|currentSession|cookies\(|headers\(\)|searchParams/)
  })
})
