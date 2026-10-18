import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { LinkPending } from '@/components/LinkPending'
import { PatchShare } from '@/components/PatchShare'
import { setNewsDigest, upsertGameMeta, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { flight as flightOf, imageHints, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import { loadPatch } from './load'
import PatchPage, { revalidate } from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Мост «а у меня?» со страницы патча.
 *
 * Пересказ патча — вторая по пересылаемости ссылка после выбора на вечер
 * (PatchShare делится ею с меткой ref), а нижняя строка страницы вела только
 * в игру, в Steam и к соседним патчам этой же игры. Пришедший по ссылке
 * прочитал, что изменилось в чужой игре, — и ниоткуда не узнавал, что то же
 * самое здесь собирают по его собственной библиотеке. Ссылка на «Что нового»
 * — одна строка, серверная, без скрипта.
 *
 * Страница при этом остаётся одной на всех: она в ISR на сутки, и мост не
 * знает, кто смотрит. Гостя /whatsnew не разворачивает — показывает общую
 * ленту и сам зовёт подключить Steam, — так что и сессии здесь читать
 * незачем. Сторож ниже держит это правило в исходнике: чтение куки сделало
 * бы страницу динамической, и сутки кэша молча кончились бы.
 */

const APPID = 730
const GID = '5123894512345'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [GameArt, 'GameArt'],
  [PatchShare, 'PatchShare'],
  [LinkPending, 'LinkPending'],
])

function patch(gid: string, publishedAt: number, extra: Partial<StoredNews> = {}): StoredNews {
  return {
    appid: APPID,
    gid,
    title: `Обновление ${gid}`,
    url: `https://store.steampowered.com/news/app/${APPID}/view/${gid}`,
    publishedAt,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: 'Починили сеть' }] }],
    bodyHash: `h${gid}`,
    rank: 9000,
    ...extra,
  }
}

async function render(extra: Partial<StoredNews> = {}): Promise<unknown> {
  const now = nowSec()
  await upsertGameMeta(
    db,
    {
      appid: APPID,
      name: 'Counter-Strike 2',
      tags: {},
      genres: [],
      categories: [],
      reviewsTotal: 1000,
      reviewsPercent: 80,
    },
    now,
  )
  await upsertNewsItems(db, [patch(GID, now - 3600, extra)], now)
  await setNewsDigest(db, APPID, GID, { tldr: 'Починили сеть.', scale: 'major' }, now)
  return flightOf(await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID }) }), ISLANDS)
}

describe('страница патча: мост к своей ленте', () => {
  test('ведёт в «Что нового» — по играм своей библиотеки', async () => {
    const links = islandsOf(await render(), 'Link').filter((l) => l.href === '/whatsnew')
    expect(links).toHaveLength(1)
    expect(textOf(links[0]?.children)).toBe('Что нового')
  })

  /*
   * /whatsnew — force-dynamic (lib/nav, DYNAMIC_SECTIONS), и префетч этой
   * ссылки будил функцию на каждом просмотре патча, докрученного до низа:
   * на проде MISS и private, no-store. Нажатие без префетча не выглядит
   * зависшим — подпись мерцает, пока едет сервер (LinkPending), как у той
   * же ссылки в шапке.
   */
  test('мост не префетчит динамическую ленту, а нажатие видно сразу', async () => {
    const [link] = islandsOf(await render(), 'Link').filter((l) => l.href === '/whatsnew')
    expect(link?.prefetch).toBe(false)
    expect(islandsOf(link?.children, 'LinkPending')).toHaveLength(1)
  })
})

/**
 * Префетч страницы патча не тащит её кадр туда, где стоит ссылка.
 *
 * «Читать патч» на обложке /whatsnew префетчит эту страницу, а подсказку
 * предзагрузки кадра поста из её RSC-части браузер исполнял на самой
 * ленте: на телефоне 138 КБ вперёд героя обложки — и это при том, что
 * обложка нарочно не показывает кадр уже md (Cover.tsx).
 */
describe('страница патча: префетч', () => {
  test('кадр поста не уезжает подсказкой предзагрузки', async () => {
    const page = await render({ imageUrl: 'https://clan.akamai.steamstatic.com/images/1/patch.png' })
    expect(JSON.stringify(page), 'кадр поста не нарисован — тест ослеп').toContain('patch.png')
    expect(imageHints(page)).toEqual([])
  })

  test('мост не читает сессию: страница остаётся в ISR на сутки', () => {
    expect(revalidate).toBe(86_400)
    // Без комментариев: докблоки как раз объясняют, почему здесь нет cookies()
    const src = fs
      .readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(src).not.toMatch(/next\/headers|currentSession|cookies\(|headers\(\)|searchParams/)
  })
})

/*
 * Уже опубликованные «патчи», которые патчами не были: Battlefield 6 «Looking
 * Ahead To Season 5», Marathon «Дорожная карта обновлений» — h1 «Что
 * изменилось», бейдж «Крупное» и пересказ «добавлен режим…» о планах, в карте
 * сайта и с NewsArticle. Прогон по базе прода для них не нужен: страница
 * сверяет строку с нынешним правилом сама (isStoredPatch в lib/news) и
 * отдаёт 404, как распродаже, — Google выкинет её при следующем обходе.
 */
describe('страница патча: не патч — 404, даже если база думает иначе', () => {
  async function stored(item: StoredNews, verdict?: 'none') {
    const now = nowSec()
    await upsertNewsItems(db, [item], now)
    const digest = verdict
      ? { tldr: 'Планы на сезон.', scale: verdict }
      : { tldr: 'Добавлен режим Rapid Royale.', scale: 'major' as const }
    await setNewsDigest(db, APPID, item.gid, digest, now)
  }

  test('строка, записанная старым правилом как патч, по нынешнему — не патч', async () => {
    await stored({
      ...patch('703281025618281700', nowSec() - 3600),
      title: 'Battlefield 6/REDSEC: Looking Ahead To Season 5 And Beyond',
      blocks: [
        {
          kind: 'ul',
          items: [
            [{ text: 'Rapid Royale: added as a limited-time mode' }],
            [{ text: 'Vehicle balance: changed armor values' }],
            [{ text: 'Fixed spawn camping — currently exploring options' }],
          ],
        },
      ],
    })
    // kind в базе — 'patch': так его записал опрос до правки классификатора
    const row = await db.execute("SELECT kind FROM news_items WHERE gid = '703281025618281700'")
    expect(row.rows[0]?.kind).toBe('patch')
    expect(await loadPatch(String(APPID), '703281025618281700')).toBeNull()
  })

  test('вердикт модели «не патч» — тоже 404', async () => {
    await stored(patch('519725096071334702', nowSec() - 3600), 'none')
    expect(await loadPatch(String(APPID), '519725096071334702')).toBeNull()
  })

  test('настоящий патч страницу не теряет', async () => {
    await stored(patch('42', nowSec() - 3600))
    expect((await loadPatch(String(APPID), '42'))?.item.gid).toBe('42')
  })
})
