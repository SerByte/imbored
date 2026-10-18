import Link from '@/components/Link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { createSharedPick, replaceGameTags, upsertGameMeta, type Db } from '@/lib/db'
import { quizHref, roomSeedHref } from '@/lib/presets'
import { nowSec } from '@/lib/server'
import { flight as flightOf, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import { pickCopy, quoted, type PickKind } from '@/lib/sharedpick'
import type { GameMeta } from '@/lib/types'
import PickPage, { generateMetadata } from './page'

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
async function share(
  id: string,
  meta: GameMeta,
  kind: PickKind = 'play',
): Promise<{ params: Promise<{ id: string }> }> {
  const now = nowSec()
  await upsertGameMeta(db, meta, now)
  await createSharedPick(
    db,
    { id, createdBy: '76561198000000001', appid: meta.appid, source: 'owned', kind, reason: 'Потому что' },
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
    const links = await partyLinks(params)
    expect(links.map((l) => l.href)).toEqual([roomSeedHref(10)])
    expect(textOf(links[0]?.children)).toBe('Позвать в эту игру')
  })

  /*
   * Пати — по тегам, как у колоды комнаты (isMultiplayerMeta). Но первой
   * картой такую комната не возьмёт: живость для компании колода судит по
   * категориям (filterActual → judgeLiveness 'party' → 'solo-only') и
   * сняла бы закреплённую. Поэтому ссылка — в пати, без обещания «в эту
   * игру»: иначе приглашение звало бы в карту, которой в колоде нет.
   */
  test('без категорий — пати по тегам, но без игры первой картой', async () => {
    const params = await share('bcdefghjkmnp', game(11, { tags: { 'Online Co-Op': 500 } }))
    const links = await partyLinks(params)
    expect(links.map((l) => l.href)).toEqual(['/room/new'])
    expect(textOf(links[0]?.children)).toBe('Позвать в пати')
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

/**
 * Заголовок вкладки — с брендом ровно один раз.
 *
 * Корневой шаблон «%s · imbored» (app/layout.tsx) дописывает бренд к любой
 * строке, а тексты pickCopy носят его сами: протухшая ссылка друга
 * читалась во вкладке и в истории «Выбор на вечер — imbored · imbored» —
 * на той самой странице, которая должна вернуть человека. Здесь — то, что
 * Next сделает с заголовком: строка идёт через шаблон, { absolute } — мимо.
 */
describe('вкладка /pick не повторяет бренд', () => {
  const tab = (title: unknown) =>
    typeof title === 'string' ? `${title} · imbored` : (title as { absolute: string }).absolute

  test('протухшая или чужая ссылка — «Выбор на вечер — imbored», без второго бренда', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'zzzzzzzz' }) })
    expect(tab(meta.title)).toBe('Выбор на вечер — imbored')
    // Карточка в чате — та же строка: шаблон её не касается
    expect(meta.openGraph?.title).toBe('Выбор на вечер — imbored')
  })

  test('живой выбор на вечер — бренд в самом тексте, и только там', async () => {
    const meta = await generateMetadata(await share('efghjkmnpqrs', game(14, { name: 'Subnautica' })))
    expect(tab(meta.title)).toBe('«Subnautica» — imbored выбрал мне на вечер')
  })

  test('игра дня — бренда в тексте нет, его дописывает шаблон', async () => {
    const meta = await generateMetadata(await share('fghjkmnpqrst', game(15, { name: 'Hades' }), 'daily'))
    expect(tab(meta.title)).toBe('«Hades» — моя игра дня · imbored')
  })
})

/**
 * Мост «а у меня?»: от чужого выбора — к своей библиотеке.
 *
 * «А тебе?» вёл на голый /quiz, и игра, которую человек только что видел,
 * терялась: квиз начинался с нуля, будто страницы не было. Затравка уже
 * умеет пережить и квиз, и вход (quizHref, playQuery в lib/destination) —
 * страница игры зовёт ею же. Ссылка — только там, где у игры есть соседи
 * (pickHasNear → nearGames): выдача с затравкой берёт кандидатов ровно
 * оттуда, и без них ссылка вела бы к «похожих не нашлось».
 */
describe('«Похожее на «X» — по моей библиотеке»', () => {
  const seedLinks = async (params: { params: Promise<{ id: string }> }, appid: number) =>
    islandsOf(flightOf(await PickPage(params), ISLANDS), 'Link').filter(
      (l) => l.href === quizHref(null, appid),
    )

  test('у игры есть соседи по тегу — ссылка в квиз с этой игрой затравкой', async () => {
    const params = await share('efghjkmnpqrs', game(20, { name: 'Hades', tags: { Roguelike: 900 } }))
    await upsertGameMeta(db, game(21, { tags: { Roguelike: 800 } }), nowSec())
    await replaceGameTags(db, 21, [{ tag: 'Roguelike', weight: 800 }])
    const links = await seedLinks(params, 20)
    expect(links.map((l) => l.href)).toEqual(['/quiz?seed=20'])
    expect(textOf(links[0]?.children)).toBe('Похожее на «Hades» — по моей библиотеке')
    // Главная кнопка — по-прежнему голый квиз: ссылка рядом, а не вместо
    expect(islandsOf(flightOf(await PickPage(params), ISLANDS), 'Link').map((l) => l.href)).toContain('/quiz')
  })

  test('соседей нет — ссылки нет, главная кнопка на месте', async () => {
    // Тег есть, но других игр с ним в каталоге нет: полка по тегу пуста
    const params = await share('fghjkmnpqrst', game(22, { tags: { Roguelike: 900 } }))
    expect(await seedLinks(params, 22)).toHaveLength(0)
    expect(islandsOf(flightOf(await PickPage(params), ISLANDS), 'Link').map((l) => l.href)).toContain('/quiz')
  })

  test('без тегов — соседей не ищем, ссылки нет', async () => {
    const params = await share('ghjkmnpqrstu', game(23, {}))
    expect(await seedLinks(params, 23)).toHaveLength(0)
  })
})

/**
 * Язык ссылки и язык страницы.
 *
 * Причину писал сервер на языке того, кто делился (shared_picks.lang), и
 * перевести её нечем. На своём языке страница цитирует её, как прежде; на
 * чужом — игра, откуда она и приглашение, без цитаты, а описание в чате —
 * общее обещание сайта: русская фраза посреди /en/pick читалась бы сбоем.
 */
describe('/en/pick: причина — только на своём языке', () => {
  const CYRILLIC = /[А-Яа-яЁё]/
  const en = (id: string) => ({ params: Promise.resolve({ id, lang: 'en' }) })

  async function shareIn(id: string, meta: GameMeta, lang: 'ru' | 'en', reason: string, kind: PickKind = 'play') {
    const now = nowSec()
    await upsertGameMeta(db, meta, now)
    await createSharedPick(
      db,
      { id, createdBy: '76561198000000001', appid: meta.appid, source: 'owned', kind, reason, lang },
      now,
    )
  }

  test('русский выбор на /en — игра и двери по-английски, без русской цитаты', async () => {
    await shareIn('hjkmnpqrstuv', game(30, { name: 'Hades', categories: [2, 9] }), 'ru', 'Потому что')
    const tree = flightOf(await PickPage(en('hjkmnpqrstuv')), ISLANDS)
    const text = textOf(tree)
    expect(text).toContain('imbored picked my game for tonight')
    expect(text).toContain('Hades')
    expect(text).toContain('From their own Steam library')
    expect(text).toContain('Your turn?')
    expect(text).not.toContain('Потому что')
    expect(text).not.toMatch(CYRILLIC)
    const links = islandsOf(tree, 'Link')
    expect(links.map((l) => textOf(l.children))).toEqual(
      expect.arrayContaining(['Pick a game for me', 'About the game', 'Invite to this game']),
    )

    const meta = await generateMetadata(en('hjkmnpqrstuv'))
    expect(meta.title).toEqual({ absolute: '“Hades” — imbored picked my game for tonight' })
    // Описание — не из чужой причины, а обещание сайта на языке страницы
    expect(meta.description).toBe(pickCopy(null, 'en').description)
    expect(String(meta.description)).not.toMatch(CYRILLIC)
    expect(meta.openGraph).toMatchObject({ locale: 'en_US', url: '/en/pick/hjkmnpqrstuv' })
    expect(meta.alternates?.canonical).toBe('/en/pick/hjkmnpqrstuv')
  })

  test('английский выбор на /en — цитата в “…”, описание из неё', async () => {
    const reason = '“Hades” fits a short evening: one run takes about 30 minutes.'
    await shareIn('jkmnpqrstuvw', game(31, { name: 'Hades' }), 'en', reason, 'daily')
    const text = textOf(flightOf(await PickPage(en('jkmnpqrstuvw')), ISLANDS))
    expect(text).toContain('My game of the day')
    expect(text).toContain(quoted(reason, 'en'))
    const meta = await generateMetadata(en('jkmnpqrstuvw'))
    expect(meta.title).toBe('“Hades” — my game of the day')
    expect(meta.description).toBe(reason)
  })

  test('английский выбор на русской странице — без английской цитаты, русская страница прежняя', async () => {
    await shareIn('kmnpqrstuvwx', game(32, { name: 'Hades' }), 'en', 'Because it fits tonight.')
    const params = { params: Promise.resolve({ id: 'kmnpqrstuvwx' }) }
    const text = textOf(flightOf(await PickPage(params), ISLANDS))
    expect(text).toContain('imbored выбрал мне на вечер')
    expect(text).not.toContain('Because it fits tonight')
    const meta = await generateMetadata(params)
    expect(meta.description).toBe(pickCopy(null).description)
  })
})
