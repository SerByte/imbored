import Link from 'next/link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { createSharedPick, upsertGameMeta, type Db } from '@/lib/db'
import { roomSeedHref } from '@/lib/presets'
import { nowSec } from '@/lib/server'
import { flight as flightOf, islandsOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import PickPage from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * «Позвать в пати» на странице выбора, которым поделились.
 *
 * Кнопка стояла у любой игры — и у сюжетной одиночной тоже: адресат жал
 * «позвать в пати» под Disco Elysium и попадал в комнату, колода которой
 * такую игру не покажет никогда (buildGroupDeck берёт только совместные).
 * Мерка та же, что у колоды, — isMultiplayerMeta; здесь настоящая страница
 * на базе в памяти, раскрытая до островков (lib/testing/flight).
 *
 * Ссылка ведёт не на голый /room/new, а сразу в комнату с этой игрой первой
 * картой («Позвать в эту игру», roomSeedHref): раньше игра, ради которой
 * звали, терялась по дороге. Поэтому ссылка пати здесь — любой адрес
 * /room/new, а куда именно — отдельная проверка ниже.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [GameArt, 'GameArt'],
])

function game(appid: number, over: Partial<GameMeta>): GameMeta {
  return {
    appid,
    name: `Игра ${appid}`,
    tags: {},
    genres: [],
    categories: [],
    headerImage: undefined,
    reviewsTotal: 100,
    reviewsPercent: 90,
    ...over,
  }
}

/** Выбор с этой игрой — id в алфавите SHARED_PICK_ID_RE */
async function share(id: string, meta: GameMeta): Promise<{ params: Promise<{ id: string }> }> {
  const now = nowSec()
  await upsertGameMeta(db, meta, now)
  await createSharedPick(
    db,
    { id, createdBy: '76561198000000001', appid: meta.appid, source: 'owned', kind: 'play', reason: 'Потому что' },
    now,
  )
  return { params: Promise.resolve({ id }) }
}

const partyLinks = async (params: { params: Promise<{ id: string }> }) =>
  islandsOf(flightOf(await PickPage(params), ISLANDS), 'Link').filter((l) =>
    String(l.href).startsWith('/room/new'),
  )

describe('«Позвать в пати» — только у игры, в которую играют вместе', () => {
  test('кооп по категориям Steam — ссылка есть', async () => {
    const params = await share('abcdefghjkmn', game(10, { categories: [2, 9] }))
    expect((await partyLinks(params)).map((l) => l.href)).toEqual([roomSeedHref(10)])
  })

  test('без категорий — по тегам, как у колоды комнаты', async () => {
    const params = await share('bcdefghjkmnp', game(11, { tags: { 'Online Co-Op': 500 } }))
    expect((await partyLinks(params)).map((l) => l.href)).toEqual([roomSeedHref(11)])
  })

  test('одиночная — ссылки нет, остальные двери на месте', async () => {
    const params = await share('cdefghjkmnpq', game(12, { categories: [2], tags: { RPG: 900 } }))
    expect(await partyLinks(params)).toHaveLength(0)
    const hrefs = islandsOf(flightOf(await PickPage(params), ISLANDS), 'Link').map((l) => l.href)
    expect(hrefs).toContain('/quiz')
    expect(hrefs).toContain('/game/12')
  })

  /*
   * Мерка у ссылки та же, что у создания комнаты (seedable в lib/roomseed):
   * игру, которую офлайн-курация похоронила, комната первой картой не
   * возьмёт — и ссылка не обещает «в эту игру», а ведёт в пати как раньше.
   */
  test('сетевая, но похороненная каталогом — пати без игры первой картой', async () => {
    const params = await share('defghjkmnpqr', game(13, { categories: [1, 9] }))
    await db.execute('UPDATE games SET alive = 0, signals_at = 1 WHERE appid = 13')
    expect((await partyLinks(params)).map((l) => l.href)).toEqual(['/room/new'])
  })
})
