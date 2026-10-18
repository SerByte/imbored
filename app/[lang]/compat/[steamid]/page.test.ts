import type { InStatement } from '@libsql/client'
import Link from '@/components/Link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Ambient } from '@/components/Ambient'
import { GameArt } from '@/components/GameArt'
import { TilePending } from '@/components/TilePending'
import { Magnet } from '@/components/Magnet'
import { SplitHeading } from '@/components/SplitHeading'
import { saveLibrarySnapshot, upsertGamesMeta, upsertUser, type Db } from '@/lib/db'
import { roomSeedHref } from '@/lib/presets'
import { flight, islandsOf, textOf } from '@/lib/testing/flight'
import { hiddenLibrary, hiddenLibraryMetas } from '@/lib/testing/hiddenlibrary'
import { freshDb, params, signIn } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import { CopyCompatLink } from '../CopyCompatLink'
import CompatPage, { generateMetadata } from './page'

/**
 * Память cache() из react на один «запрос».
 *
 * Вне сервера Next cache() — сквозной вызов: памяти запроса у него нет, и
 * то, ради чего страница его зовёт, в тесте не видно вовсе. Подмена делает
 * то же, что настоящий cache в рендере: помнит промис по функции и по
 * аргументам — объекты по ссылке, остальное по значению, число аргументов
 * тоже различается. Сбрасывается перед каждым тестом: один тест — один запрос.
 */
const request = vi.hoisted(() => {
  const RESULT = Symbol('результат')
  type Node = Map<unknown, unknown>
  let memo = new Map<unknown, Node>()
  return {
    reset: () => {
      memo = new Map()
    },
    cache: <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R => {
        let node = memo.get(fn)
        if (!node) memo.set(fn, (node = new Map()))
        for (const arg of args) {
          let next = node.get(arg) as Node | undefined
          if (!next) node.set(arg, (next = new Map()))
          node = next
        }
        if (!node.has(RESULT)) node.set(RESULT, fn(...args))
        return node.get(RESULT) as R
      },
  }
})

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: request.cache,
}))
vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /compat/[steamid] — сколько раз запрос платит за владельца ссылки.
 *
 * Страница объявлена force-dynamic, и на каждый заход её метаданные и тело
 * собираются заново. Обоим нужен владелец ссылки: метаданным — для превью в
 * чате, телу — для приглашения или расчёта. Тело читало его снапшот, ник и
 * обложки ещё раз в обход памяти запроса, и гость по разосланной ссылке —
 * главный путь этой страницы — платил за games_json владельца дважды: у
 * большой библиотеки это блоб на сотни килобайт.
 */

const OWNER = '76561198000000041'
const VIEWER = '76561198000000042'
const NOW = 1_780_000_000

let db: Db

beforeEach(async () => {
  db = await freshDb()
  request.reset()
  await upsertGamesMeta(db, hiddenLibraryMetas(), NOW)
  await upsertUser(db, { steamid: OWNER, personaName: 'Владелец' }, NOW)
  await saveLibrarySnapshot(db, OWNER, hiddenLibrary(12), NOW)
})

/** Счётчик чтений по виду: снапшоты по steamid, ники по steamid, метаданные игр */
function countReads(): { snapshots: string[]; personas: string[]; metas: number } {
  const seen = { snapshots: [] as string[], personas: [] as string[], metas: 0 }
  const spy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'execute') return Reflect.get(target, prop, receiver)
      return (q: InStatement) => {
        const sql = typeof q === 'string' ? q : q.sql
        const first = typeof q === 'string' || !Array.isArray(q.args) ? undefined : String(q.args[0])
        if (sql.includes('FROM library_snapshots')) seen.snapshots.push(first ?? '')
        if (sql.includes('SELECT persona_name FROM users')) seen.personas.push(first ?? '')
        if (sql.startsWith('SELECT g.appid')) seen.metas++
        return target.execute(q)
      }
    },
  })
  ;(globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }).__imboredDb = Promise.resolve(spy)
  return seen
}

/** Один заход: метаданные и тело страницы в одном «запросе», как их зовёт Next */
async function visit(steamid: string): Promise<void> {
  await generateMetadata(params({ steamid }))
  await CompatPage(params({ steamid }))
}

describe('/compat/[steamid]: владелец ссылки — один раз на запрос', () => {
  test('гость: снапшот, ник и обложки владельца читаются по разу', async () => {
    const reads = countReads()
    await visit(OWNER)
    expect(reads.snapshots).toEqual([OWNER])
    expect(reads.personas).toEqual([OWNER])
    expect(reads.metas).toBe(1)
  })

  test('вошедший с библиотекой: снапшот владельца — один на метаданные и расчёт', async () => {
    await saveLibrarySnapshot(db, VIEWER, hiddenLibrary(8), NOW)
    await signIn(db, VIEWER, { verified: true })
    const reads = countReads()
    await visit(OWNER)
    expect(reads.snapshots.filter((s) => s === OWNER)).toHaveLength(1)
    expect(reads.snapshots.filter((s) => s === VIEWER)).toHaveLength(1)
    expect(reads.personas.filter((s) => s === OWNER)).toHaveLength(1)
    // Метаданные игр — одним чтением, объединением двух библиотек. Обложки
    // приглашения превью не нужны, а экран посчитанного сравнения красит героя
    // из того же объединения: раньше их читали метаданные страницы — вторым
    // чтением на каждый такой заход
    expect(reads.metas).toBe(1)
  })

  test('своя ссылка: обложки фона читаются один раз — телом, не метаданными', async () => {
    await signIn(db, OWNER, { verified: true })
    const reads = countReads()
    await visit(OWNER)
    expect(reads.snapshots).toEqual([OWNER])
    expect(reads.personas).toEqual([OWNER])
    expect(reads.metas).toBe(1)
  })
})

/**
 * «Позвать в эту игру» под общими играми. Глазу «эта игра» — карточка над
 * ссылкой, а скринридеру их ничего не связывает: соседний div — не абзац, не
 * пункт списка и не ячейка. В списке ссылок полка звучала одинаковыми
 * «Позвать в эту игру», и какая куда зовёт, было не понять (WCAG 2.4.4).
 * Здесь настоящая страница сравнения на базе в памяти, раскрытая до
 * островков (lib/testing/flight).
 */
describe('/compat/[steamid]: «Позвать в эту игру» называет свою игру', () => {
  const ISLANDS = new Map<unknown, string>([
    [Link, 'Link'],
    [GameArt, 'GameArt'],
    [Magnet, 'Magnet'],
    [SplitHeading, 'SplitHeading'],
    [CopyCompatLink, 'CopyCompatLink'],
    // знак ожидания внутри плиток-ссылок на карточку (components/GameLink)
    [TilePending, 'TilePending'],
  ])
  const coop = (appid: number, name: string): GameMeta => ({
    appid,
    name,
    tags: { 'Co-op': 100 },
    genres: [],
    categories: [1, 9],
  })
  const SHARED = [coop(2001, 'Deep Rock Galactic'), coop(2002, 'Valheim'), coop(2003, 'Raft')]

  test('у каждой ссылки — имя своей игры, и видимый текст в нём первым', async () => {
    await upsertGamesMeta(db, SHARED, NOW)
    const owned = SHARED.map((g) => ({ appid: g.appid, name: g.name, playtimeForever: 600, playtime2Weeks: 0 }))
    await saveLibrarySnapshot(db, OWNER, [...hiddenLibrary(12), ...owned], NOW)
    await saveLibrarySnapshot(db, VIEWER, owned, NOW)
    await signIn(db, VIEWER, { verified: true })

    const page = flight(await CompatPage(params({ steamid: OWNER })), ISLANDS)
    const invites = islandsOf(page, 'Link').filter((l) => String(l.href).startsWith('/room/new?'))
    expect(invites.map((l) => l.href).sort()).toEqual(SHARED.map((g) => roomSeedHref(g.appid)).sort())
    for (const l of invites) {
      const name = SHARED.find((g) => roomSeedHref(g.appid) === l.href)?.name
      expect(l['aria-label']).toBe(`Позвать в эту игру — «${name}»`)
      // Голосовое управление ищет ссылку по написанному на ней (WCAG 2.5.3):
      // видимый текст прежний, и имя с него начинается
      expect(textOf(l.children).trim()).toBe('Позвать в эту игру')
    }
  })

  test('на /en — «Invite to this game — “X”»: та же связь имени со ссылкой', async () => {
    await upsertGamesMeta(db, SHARED, NOW)
    const owned = SHARED.map((g) => ({ appid: g.appid, name: g.name, playtimeForever: 600, playtime2Weeks: 0 }))
    await saveLibrarySnapshot(db, OWNER, [...hiddenLibrary(12), ...owned], NOW)
    await saveLibrarySnapshot(db, VIEWER, owned, NOW)
    await signIn(db, VIEWER, { verified: true })

    const page = flight(await CompatPage(params({ steamid: OWNER, lang: 'en' })), ISLANDS)
    const invites = islandsOf(page, 'Link').filter((l) => String(l.href).startsWith('/room/new?'))
    expect(invites).toHaveLength(SHARED.length)
    for (const l of invites) {
      const name = SHARED.find((g) => roomSeedHref(g.appid) === l.href)?.name
      expect(l['aria-label']).toBe(`Invite to this game — “${name}”`)
      expect(textOf(l.children).trim()).toBe('Invite to this game')
    }
  })
})

/**
 * /en/compat/[steamid] целиком: каждая строка страницы — на языке адреса.
 *
 * Кириллица на английской странице допустима только в данных: ник владельца
 * («Владелец») и названия игр фикстуры («Игра 1000») — их не переводят
 * (docs/i18n.md, «Чего НЕ переводить»). Всё остальное — подписи, кнопки,
 * aria-label, адреса — обязано быть английским; забытый tr() молча оставил бы
 * русскую строку, не сломав ни одного теста поведения.
 */
describe('/compat/[steamid] на /en: ни одной русской строки вне данных', () => {
  const ISLANDS = new Map<unknown, string>([
    [Link, 'Link'],
    [GameArt, 'GameArt'],
    [Magnet, 'Magnet'],
    [SplitHeading, 'SplitHeading'],
    [CopyCompatLink, 'CopyCompatLink'],
    [TilePending, 'TilePending'],
    [Ambient, 'Ambient'],
  ])
  /** Раскрытая страница строкой без данных: ников и названий игр */
  const bare = (page: unknown, data: string[]) =>
    data.reduce((s, d) => s.split(d).join(''), JSON.stringify(page))
  const DATA = ['Владелец', ...hiddenLibrary(12).map((g) => g.name)]
  const CYRILLIC = /[А-Яа-яЁё]/

  test('гость: приглашение по-английски, вход через Steam несёт lang=en', async () => {
    const page = flight(await CompatPage(params({ steamid: OWNER, lang: 'en' })), ISLANDS)
    expect(bare(page, DATA)).not.toMatch(CYRILLIC)
    expect(textOf(page)).toContain('Владелец wants to compare libraries')
    expect(textOf(page)).toContain('12 games · playtime hidden')
    // Язык входа — в адресе: Referer браузер может и не прислать
    expect(JSON.stringify(page)).toContain(`"href":"/api/auth/steam?compat=${OWNER}&lang=en"`)
  })

  test('гость на русской: вход без lang, текст прежний', async () => {
    const page = flight(await CompatPage(params({ steamid: OWNER })), ISLANDS)
    expect(JSON.stringify(page)).toContain(`"href":"/api/auth/steam?compat=${OWNER}"`)
    expect(textOf(page)).toContain('Владелец зовёт сравнить библиотеки')
    expect(textOf(page)).toContain('12 игр · время скрыто')
  })

  test('посчитанное сравнение: подписи, полки и общие игры', async () => {
    const coop: GameMeta = { appid: 2001, name: 'Deep Rock Galactic', tags: { 'Co-op': 100 }, genres: [], categories: [1, 9] }
    await upsertGamesMeta(db, [coop], NOW)
    // У владельца время скрыто целиком (нули у всех игр), у зрителя — 25 минут
    const owned = { appid: 2001, name: coop.name, playtimeForever: 25, playtime2Weeks: 0 }
    await saveLibrarySnapshot(db, OWNER, [...hiddenLibrary(12), { ...owned, playtimeForever: 0 }], NOW)
    await saveLibrarySnapshot(db, VIEWER, [owned], NOW)
    await upsertUser(db, { steamid: VIEWER, personaName: 'Mira' }, NOW)
    await signIn(db, VIEWER, { verified: true })

    const page = flight(await CompatPage(params({ steamid: OWNER, lang: 'en' })), ISLANDS)
    expect(bare(page, DATA)).not.toMatch(CYRILLIC)
    const text = textOf(page)
    expect(text).toContain('Mira × Владелец')
    expect(text).toContain('taste match')
    expect(text).toContain('Games in common')
    // Время владельца скрыто: колонка его часов — словом, своих — минутами
    expect(text).toContain('Deep Rock Galactic25 minhidden')
    expect(text).toContain("You have 25 minutes in them; Владелец's playtime is hidden.")
    expect(text).toContain("Владелец's player portrait")
  })

  test('своя ссылка и «ещё не подключал»', async () => {
    await signIn(db, OWNER, { verified: true })
    const self = flight(await CompatPage(params({ steamid: OWNER, lang: 'en' })), ISLANDS)
    expect(bare(self, DATA)).not.toMatch(CYRILLIC)
    expect(textOf(self)).toContain('This is your own link')
    expect(islandsOf(self, 'CopyCompatLink').map((c) => c.label)).toEqual(['My compatibility link'])

    const stranger = flight(await CompatPage(params({ steamid: '76561198000000099', lang: 'en' })), ISLANDS)
    expect(bare(stranger, DATA)).not.toMatch(CYRILLIC)
    expect(textOf(stranger)).toContain("This player hasn't connected a library yet")
  })

  /*
   * Подпись карточки превью: alt файловой карточки — константа без языка, и
   * на /en страница ставит свою карточку того же маршрута с английской
   * подписью. Русская images не объявляет — Next подставляет файловую, как
   * было.
   */
  test('метаданные: английская фраза и карточка с английской подписью, русская — как была', async () => {
    const en = await generateMetadata(params({ steamid: OWNER, lang: 'en' }))
    expect(en.title).toBe('Владелец wants to compare libraries')
    expect(en.description).toBe(
      "Compare your Steam library with Владелец's: 12 games, playtime hidden. " +
        'See your taste match, the games you have in common and what to play together.',
    )
    expect(en.openGraph).toMatchObject({
      url: `/en/compat/${OWNER}`,
      locale: 'en_US',
      images: [{ url: `/en/compat/${OWNER}/opengraph-image`, width: 1200, height: 630, alt: 'Compare tastes — imbored' }],
    })

    request.reset()
    const ru = await generateMetadata(params({ steamid: OWNER }))
    expect(ru.title).toBe('Владелец зовёт сравнить библиотеки')
    expect(ru.description).toBe(
      'Сравни свою библиотеку Steam с библиотекой Владелец: 12 игр, время скрыто. ' +
        'Процент совпадения вкусов, общие игры и во что вам зайти вместе.',
    )
    expect(ru.openGraph).not.toHaveProperty('images')
  })

  test('метаданные игрока без библиотеки: на /en — та же карточка с английской подписью, русская без своего openGraph', async () => {
    const STRANGER = '76561198000000099'
    const en = await generateMetadata(params({ steamid: STRANGER, lang: 'en' }))
    expect(en.title).toBe('Compatibility')
    expect(en.openGraph).toMatchObject({
      url: `/en/compat/${STRANGER}`,
      siteName: 'imbored',
      locale: 'en_US',
      images: [{ url: `/en/compat/${STRANGER}/opengraph-image`, alt: 'Compare tastes — imbored' }],
    })
    expect(await generateMetadata(params({ steamid: STRANGER }))).toEqual({
      title: 'Совместимость',
      robots: { index: false },
    })
  })
})
