import { beforeEach, describe, expect, test, vi } from 'vitest'
import { upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import type { NewsBlock } from '@/lib/steamhtml'
import { freshDb } from '@/lib/testing/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Тело патча по требованию — и признак, годится ли оно для /en.
 *
 * Признак — о самом теле, а не о читателе: ответ один для обеих версий и
 * кэшируется на грани одной записью, а строка ленты на /en по нему решает,
 * показать тело или ссылку на оригинал (русского тела на /en нет).
 */

const NOW = 1_760_000_000
let db: Db

function patch(gid: string, blocks: NewsBlock[]): StoredNews {
  return {
    appid: 730,
    gid,
    title: 'Patch',
    url: `https://store.steampowered.com/news/app/730/view/${gid}`,
    publishedAt: NOW,
    kind: 'patch',
    scale: 'major',
    blocks,
    bodyHash: `h${gid}`,
    rank: 1,
  }
}

beforeEach(async () => {
  db = await freshDb()
  await upsertNewsItems(
    db,
    [
      patch('1', [{ kind: 'p', runs: [{ text: 'Fixed a crash when loading the map and reduced the recoil.' }] }]),
      patch('2', [{ kind: 'p', runs: [{ text: 'Исправлен вылет при загрузке карты и уменьшена отдача.' }] }]),
    ],
    NOW,
  )
})

const body = (gid: string) => GET(new Request(`http://localhost/api/news?appid=730&gid=${gid}`))

describe('/api/news', () => {
  test('английское тело — english: true, русское — false; ответ общий и кэшируется', async () => {
    const en = await body('1')
    expect(en.status).toBe(200)
    expect(await en.json()).toMatchObject({ english: true, blocks: [{ kind: 'p' }] })
    expect(en.headers.get('Cache-Control')).toContain('s-maxage=')

    const ru = await body('2')
    expect(await ru.json()).toMatchObject({ english: false, blocks: [{ kind: 'p' }] })
  })

  test('мусор и чужой пост — как раньше: 400 и 404', async () => {
    expect((await body('../x')).status).toBe(400)
    expect((await body('3')).status).toBe(404)
  })
})
