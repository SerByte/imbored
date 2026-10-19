import type { InStatement } from '@libsql/client'
import Link from '@/components/Link'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Ambient } from '@/components/Ambient'
import { GameArt } from '@/components/GameArt'
import { PriceTag } from '@/components/PriceTag'
import { TilePending } from '@/components/TilePending'
import { Magnet } from '@/components/Magnet'
import { SplitHeading } from '@/components/SplitHeading'
import { replaceGameTags, saveLibrarySnapshot, upsertGamesMeta, upsertUser, type Db } from '@/lib/db'
import { rotationSlot } from '@/lib/pool'
import { roomSeedHref } from '@/lib/presets'
import { flight, islandsOf, textOf } from '@/lib/testing/flight'
import { hiddenLibrary, hiddenLibraryMetas } from '@/lib/testing/hiddenlibrary'
import { freshDb, params, signIn, signOut } from '@/lib/testing/route'
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

/**
 * Русский ник на /en — своим lang="ru".
 *
 * Ник из Steam не переводят, но голос скринридера выбирается по lang, и
 * английский читает «Костя» по буквам. Аудитория сайта по большей части
 * русскоязычная, так что это частый случай, а не редкий. Проверка — по
 * каждому вхождению ника в раскрытой странице: текстом или в пропсах
 * островка (aria-label заголовка «A × B» — его children). Русская страница
 * атрибута не получает вовсе: она обязана остаться прежней до байта.
 */
describe('/compat/[steamid] на /en: русский ник помечен lang="ru"', () => {
  const ISLANDS = new Map<unknown, string>([
    [Link, 'Link'],
    [GameArt, 'GameArt'],
    [Magnet, 'Magnet'],
    [SplitHeading, 'SplitHeading'],
    [CopyCompatLink, 'CopyCompatLink'],
    [TilePending, 'TilePending'],
    [Ambient, 'Ambient'],
    // ценник полки «на будущее» — клиентский ради языка (useLocale): в кэш
    // уходят его пропсы, а вызовом вне рендера React хук упал бы
    [PriceTag, 'PriceTag'],
  ])
  const NICK = 'Костя'

  /** Вхождения ника вне lang="ru": строки целиком, где он стоит без пометки */
  function unmarked(node: unknown, nick: string, marked = false): string[] {
    if (typeof node === 'string') return !marked && node.includes(nick) ? [node] : []
    if (Array.isArray(node)) return node.flatMap((n) => unmarked(n, nick, marked))
    if (node === null || typeof node !== 'object') return []
    const props = (node as { props?: Record<string, unknown> }).props
    const here = marked || props?.lang === 'ru'
    return Object.values(props ?? node).flatMap((v) => unmarked(v, nick, here))
  }

  const coop = (appid: number, name: string): GameMeta => ({
    appid,
    name,
    tags: { 'Co-op': 100 },
    genres: [],
    categories: [1, 9],
  })
  const SHARED = coop(2001, 'Deep Rock Galactic')
  const MINE = coop(2002, 'Valheim')
  const THEIRS = coop(2003, 'Raft')
  const NOBODYS = coop(2004, 'Lethal Company')
  const played = (g: GameMeta, minutes: number) => ({ appid: g.appid, name: g.name, playtimeForever: minutes, playtime2Weeks: 0 })

  beforeEach(async () => {
    await upsertGamesMeta(db, [SHARED, MINE, THEIRS, NOBODYS], NOW)
    // Полка «на будущее» берёт игры из пула каталога — по проекции тегов
    for (const g of [MINE, THEIRS, NOBODYS]) await replaceGameTags(db, g.appid, [{ tag: 'Co-op', weight: 100 }])
    await upsertUser(db, { steamid: OWNER, personaName: NICK }, NOW)
    await upsertUser(db, { steamid: VIEWER, personaName: 'Mira' }, NOW)
    await saveLibrarySnapshot(db, OWNER, [...hiddenLibrary(12), played(SHARED, 600), played(THEIRS, 90)], NOW)
    await saveLibrarySnapshot(db, VIEWER, [played(SHARED, 25), played(MINE, 300)], NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('посчитанное сравнение: заголовок, легенда, «Not owned by», время, портрет и отметка', async () => {
    // Каталожное окно пары сдвигается по неделям (rotationSlot), и в каталоге
    // из трёх игр окно со сдвигом пусто — страница берёт время сама, поэтому
    // ставим ей неделю без сдвига
    let now = NOW
    while (rotationSlot([OWNER, VIEWER].sort().join(':'), now) !== 0) now += 7 * 86_400
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now * 1000)
    await signIn(db, VIEWER, { verified: true })
    const page = flight(await CompatPage(params({ steamid: OWNER, lang: 'en' })), ISLANDS)
    const text = textOf(page)
    // Ник правда стоит на всех этих местах — иначе проверка ниже пуста
    expect(text).toContain(`${NICK}'s player portrait`)
    expect(text).toContain(`${NICK} will see that you compared, and your percentage.`)
    expect(text).toContain(`Not owned by: ${NICK}`)
    expect(text).toContain(`Not owned by: Mira, ${NICK}`)
    expect(islandsOf(page, 'SplitHeading').map((h) => h.children)).toEqual([`Mira × ${NICK}`])
    expect(unmarked(page, NICK)).toEqual([])
    // Ссылка на портрет — inline-flex с gap: фраза с ником обязана остаться
    // одним её ребёнком, иначе ник отъезжает от «'s» на ширину зазора
    const portrait = islandsOf(page, 'Link').find((l) => l.href === `/portrait/${OWNER}`)
    expect((portrait?.children as unknown[])[0]).toMatchObject({ tag: 'span' })
    // Латинский ник пометки не получает: он и так на языке страницы
    expect(unmarked(page, 'Mira').length).toBeGreaterThan(0)
  })

  test('приглашение гостю: заголовок и обещание отметки', async () => {
    const page = flight(await CompatPage(params({ steamid: OWNER, lang: 'en' })), ISLANDS)
    expect(textOf(page)).toContain(`${NICK} wants to compare libraries`)
    expect(textOf(page)).toContain(`Once you sign in with Steam, ${NICK} will see that you compared.`)
    expect(unmarked(page, NICK)).toEqual([])
  })

  test('«ещё не подключал библиотеку» с русским ником', async () => {
    const STRANGER = '76561198000000099'
    await upsertUser(db, { steamid: STRANGER, personaName: NICK }, NOW)
    const page = flight(await CompatPage(params({ steamid: STRANGER, lang: 'en' })), ISLANDS)
    expect(textOf(page)).toContain(`${NICK} hasn't connected a library yet`)
    expect(unmarked(page, NICK)).toEqual([])
  })

  test('русская страница — без единого lang: та же разметка, что до перевода', async () => {
    await signIn(db, VIEWER, { verified: true })
    const ok = flight(await CompatPage(params({ steamid: OWNER })), ISLANDS)
    expect(textOf(ok)).toContain(`Портрет игрока ${NICK}`)
    expect(JSON.stringify(ok)).not.toContain('"lang"')
    request.reset()
    signOut()
    const invite = flight(await CompatPage(params({ steamid: OWNER })), ISLANDS)
    expect(textOf(invite)).toContain(`${NICK} зовёт сравнить библиотеки`)
    expect(JSON.stringify(invite)).not.toContain('"lang"')
  })
})
