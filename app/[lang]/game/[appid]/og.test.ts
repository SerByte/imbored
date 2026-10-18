import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { replaceGameTags, upsertGameMeta, type Db } from '@/lib/db'
import { legacyArtUrl } from '@/lib/art'
import { freshDb } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * ImageResponse подменён: satori и resvg здесь не нужны, нужна композиция —
 * что карточка отдала бы рисовать. Конструктор просто запоминает дерево.
 */
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(
      public element: unknown,
      public init: unknown,
    ) {}
  },
}))

const { default: Image } = await import('./opengraph-image')

const T0 = 1_760_000_000
let db: Db

beforeEach(async () => {
  db = await freshDb()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type El = { type?: unknown; props?: Record<string, unknown> }

/** Все <img> дерева карточки — по props.children, как его читает satori */
function imgs(node: unknown): El[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(imgs)
  const el = node as El
  const own = el.type === 'img' ? [el] : []
  return [...own, ...imgs(el.props?.children)]
}

const jpeg = () => new Response(new Uint8Array([9]), { headers: { 'content-type': 'image/jpeg' } })

/**
 * Five Nights at Freddy's: в art_json только header и capsule, своего
 * library_hero у игры нет, и плоский путь отвечает 404 — замер на деплое.
 */
const FNAF: GameMeta = {
  appid: 319510,
  name: "Five Nights at Freddy's",
  tags: { Horror: 900 },
  genres: [],
  categories: [2],
  art: {
    header: 'https://cdn.example/319510/header.jpg',
    capsule: 'https://cdn.example/319510/capsule_616x353.jpg',
  },
  reviewsTotal: 50_000,
  reviewsPercent: 95,
}

async function card(appid: number) {
  const res = (await Image({ params: Promise.resolve({ lang: 'ru', appid: String(appid) }) })) as unknown as {
    element: El
  }
  return res.element
}

describe('карточка игры в чате', () => {
  test('у игры без library_hero арт берётся со следующего кандидата, а не пустота', async () => {
    await upsertGameMeta(db, FNAF, T0)
    await replaceGameTags(db, FNAF.appid, [{ tag: 'Horror', weight: 900 }])
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        return url === legacyArtUrl(FNAF.appid, 'hero') ? new Response('nope', { status: 404 }) : jpeg()
      }),
    )

    const [img] = imgs(await card(FNAF.appid))
    // satori получает уже скачанную картинку: свой fetch у него без таймаута,
    // а 404 он запоминает пустым местом — та самая тёмная карточка без арта
    expect(img?.props?.src).toBe('data:image/jpeg;base64,CQ==')
    expect(calls).toEqual([legacyArtUrl(FNAF.appid, 'hero'), FNAF.art!.capsule])
  })

  test('не дотянулся ни один кандидат — карточка без <img>, а не с битым адресом', async () => {
    await upsertGameMeta(db, FNAF, T0)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    )
    expect(imgs(await card(FNAF.appid))).toEqual([])
  })
})

/**
 * notFound() корневого layout до файловой карточки не доходит, а адрес под
 * чужим языком (/_x/game/730/opengraph-image) маршрут находит. Без проверки
 * карточка отдавалась бы под любым «языком» — с кодом 200 и новой записью
 * ISR на каждый.
 */
describe('карточка игры под чужим языком', () => {
  test('404, и база не спрашивается', async () => {
    await upsertGameMeta(db, FNAF, T0)
    const res = (await Image({ params: Promise.resolve({ lang: '_x', appid: String(FNAF.appid) }) })) as Response
    expect(res.status).toBe(404)
  })
})
