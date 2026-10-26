import { resolveRobots } from 'next/dist/build/webpack/loaders/metadata/resolve-route-data'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { describe, expect, test } from 'vitest'
import robots from '../app/robots'
import nextConfig from '../next.config'
import {
  BLOCKED_CRAWLERS,
  noindexHeaders,
  NOINDEX_PAGES,
  PERSONAL_PREFIXES,
  ROBOTS_DISALLOW,
  SECRET_PREFIXES,
} from './robots'

/**
 * Сопоставление robots.txt по спецификации Google (RFC 9309 плюс * и $):
 * правило совпадает с началом пути, выигрывает самое длинное, при равной
 * длине — allow. Ровно так читают файл Googlebot и краулер X.
 */
function allowed(rules: { allow: string[]; disallow: string[] }, url: string): boolean {
  const matches = (pattern: string) => {
    const anchored = pattern.endsWith('$')
    const body = (anchored ? pattern.slice(0, -1) : pattern)
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    return new RegExp(`^${body}${anchored ? '$' : ''}`).test(url)
  }
  const best = (list: string[]) => Math.max(-1, ...list.filter(matches).map((p) => p.length))
  return best(rules.allow) >= best(rules.disallow)
}

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

/** Общая группа «*» — первая в файле (app/robots.ts) */
function rulesOf(): { allow: string[]; disallow: string[] } {
  const r = robots().rules
  const group = Array.isArray(r) ? r[0] : r
  return { allow: list(group.allow), disallow: list(group.disallow) }
}

type Group = { userAgent: string[]; allow: string[]; disallow: string[] }

function groups(): Group[] {
  const r = robots().rules
  return (Array.isArray(r) ? r : [r]).map((g) => ({
    userAgent: list(g.userAgent ?? '*'),
    allow: list(g.allow),
    disallow: list(g.disallow),
  }))
}

/**
 * Группа краулера по RFC 9309: та, где названа его метка продукта (без учёта
 * регистра), а нет такой — «*». Своя группа заменяет «*» целиком, правила
 * не складываются.
 */
function groupFor(token: string): Group {
  const all = groups()
  const own = all.find((g) => g.userAgent.some((ua) => ua.toLowerCase() === token.toLowerCase()))
  const star = all.find((g) => g.userAgent.includes('*'))
  if (!star) throw new Error('в robots.txt нет группы «*»')
  return own ?? star
}

const STEAMID = '76561198000000000'

describe('robots.txt', () => {
  test('файл отдаёт ровно список из lib/robots.ts', () => {
    expect(rulesOf().disallow).toEqual([...ROBOTS_DISALLOW])
  })

  /**
   * Закрытая страница не показывает краулеру свой noindex, а краулер X не
   * берёт картинку под закрытым префиксом — карточка в X не разворачивается.
   */
  test('личные страницы и их карточки открыты', () => {
    const rules = rulesOf()
    for (const url of [
      `/portrait/${STEAMID}`,
      `/portrait/${STEAMID}/opengraph-image?7a1c`,
      `/portrait/${STEAMID}/card.png`,
      `/portrait/${STEAMID}/year`,
      `/portrait/${STEAMID}/year/card.png`,
      `/portrait/${STEAMID}/year/opengraph-image`,
      `/compat/${STEAMID}`,
      `/compat/${STEAMID}/opengraph-image`,
      '/room/ABC234',
      '/room/ABC234/opengraph-image',
      '/pick/abcdefghjkmn',
      '/pick/abcdefghjkmn/opengraph-image',
    ]) {
      expect(allowed(rules, url), url).toBe(true)
    }
  })

  test('состояние сессии, хабы и /api закрыты', () => {
    const rules = rulesOf()
    for (const url of [
      '/portrait',
      '/compat',
      '/play',
      '/play?time=short',
      '/explore',
      '/library',
      '/api/prepare',
    ]) {
      expect(allowed(rules, url), url).toBe(false)
    }
  })

  /**
   * «Позвать в эту игру» ставит /room/new?game=<appid> обычной ссылкой на
   * карточке каждой сетевой игры — это тысячи разных адресов,
   * и все со страниц из карты сайта (ещё /pick, /compat и подборки про
   * компанию /games/coop, /games/split-screen — HubFacet.party). Под Disallow
   * Google индексирует такой адрес голым, по тексту ссылки, — та же механика,
   * что у /quiz ниже. Открыт он ради noindex заголовком (/room/:path*), а не
   * ради выдачи.
   */
  test('создание комнаты открыто краулеру — и с игрой в адресе', () => {
    const rules = rulesOf()
    for (const url of ['/room/new', '/room/new?game=730', '/room/new?game=-5&preset=evening']) {
      expect(allowed(rules, url), url).toBe(true)
    }
  })

  /**
   * Шапка ссылается на /quiz, /daily и /rooms с каждой из шести тысяч
   * страниц, а /quiz — ещё и единственная кнопка в продукт на каждой карточке
   * игры. Закрытый адрес с такой перелинковкой Google индексирует голым, без
   * заголовка и сниппета («Indexed, though blocked by robots.txt») — главная
   * страница конверсии в выдаче выглядела пустой. Каждый из трёх — один
   * адрес без вариантов в серверной разметке, так что бюджет обхода они не
   * съедают.
   */
  test('ссылки шапки открыты краулеру: /quiz, /daily, /rooms', () => {
    const rules = rulesOf()
    for (const url of ['/quiz', '/daily', '/rooms']) {
      expect(allowed(rules, url), url).toBe(true)
    }
  })

  test('разделы с содержанием открыты', () => {
    const rules = rulesOf()
    for (const url of [
      '/',
      '/game/730',
      '/game/730/news/5123894512345',
      // архив обновлений игры и подборки хаба (lib/patcharchive, HUB_FACETS)
      '/game/730/news',
      '/games',
      '/games/roguelike',
      '/games/point-and-click',
      '/games/coop',
      '/whatsnew',
      '/whatsnew/feed.xml',
      '/indexnow-key.txt',
      '/privacy',
      '/support',
      '/?next=%2Fplay',
    ]) {
      expect(allowed(rules, url), url).toBe(true)
    }
  })

  /**
   * Английская версия — те же правила под /en: личные страницы и карточки
   * открыты ради noindex и превью, состояние сессии и хабы закрыты.
   */
  test('английская версия закрыта и открыта там же, где русская', () => {
    const rules = rulesOf()
    for (const url of [
      `/en/portrait/${STEAMID}`,
      `/en/portrait/${STEAMID}/opengraph-image`,
      `/en/compat/${STEAMID}`,
      '/en/room/ABC234',
      // «Invite to this game» — как /room/new выше: открыт ради noindex заголовком
      '/en/room/new',
      '/en/room/new?game=730',
      '/en',
      '/en/quiz',
      '/en/game/730',
      '/en/games',
      '/en/whatsnew',
      '/en/privacy',
      // og:image русской страницы — по внутреннему пути
      `/ru/portrait/${STEAMID}/opengraph-image`,
      '/ru/games/roguelike/opengraph-image',
    ]) {
      expect(allowed(rules, url), url).toBe(true)
    }
    for (const url of ['/en/portrait', '/en/compat', '/en/play', '/en/play?time=short', '/en/explore', '/en/library']) {
      expect(allowed(rules, url), url).toBe(false)
    }
  })

  test('сопоставитель в тесте понимает $ и префиксы — иначе проверки выше пустые', () => {
    const rules = { allow: ['/'], disallow: ['/portrait$', '/room'] }
    expect(allowed(rules, '/portrait')).toBe(false)
    expect(allowed(rules, '/portrait/1')).toBe(true)
    expect(allowed(rules, '/rooms')).toBe(false)
  })
})

/**
 * Боты обучения моделей и SEO-сервисов людей не приводят, а их обход хвоста
 * ISR — рендер, запись и выдача с источника на каждом холодном адресе, то
 * есть лимиты Hobby (докблок BLOCKED_CRAWLERS). Поисковики, поиск
 * ассистентов, заходы по просьбе человека и превью ссылок — наоборот, ради
 * них сайт и открыт.
 */
describe('robots.txt: боты обучения и SEO-сервисов', () => {
  /** Те, кто приводит людей или рисует превью ссылки: им — общая группа */
  const KEPT = [
    'Googlebot',
    'Bingbot',
    'YandexBot',
    'DuckDuckBot',
    'Applebot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'PerplexityBot',
    'Perplexity-User',
    'Twitterbot',
    'facebookexternalhit',
    'TelegramBot',
    'Discordbot',
    'vkShare',
  ]

  test('файл — две группы: «*» с прежними правилами и закрытая для списка', () => {
    const [star, blocked, ...rest] = groups()
    expect(rest).toEqual([])
    expect(star).toEqual({ userAgent: ['*'], allow: ['/'], disallow: [...ROBOTS_DISALLOW] })
    expect(blocked).toEqual({ userAgent: [...BLOCKED_CRAWLERS], allow: [], disallow: ['/'] })
  })

  test('в списке нет повторов и нет «*»', () => {
    const lower = BLOCKED_CRAWLERS.map((ua) => ua.toLowerCase())
    expect(new Set(lower).size).toBe(lower.length)
    expect(lower).not.toContain('*')
  })

  test('боту из списка закрыто всё — и страницы, и карточки, и карта сайта', () => {
    for (const bot of BLOCKED_CRAWLERS) {
      const group = groupFor(bot)
      expect(group.userAgent, bot).not.toContain('*')
      for (const url of [
        '/',
        '/en',
        '/game/730',
        '/en/game/730',
        '/game/730/news/5123894512345',
        '/en/game/730/news',
        '/ru/game/730/opengraph-image',
        '/games/coop',
        '/whatsnew/feed.xml',
        `/portrait/${STEAMID}`,
        '/sitemap.xml',
      ]) {
        expect(allowed(group, url), `${bot} ${url}`).toBe(false)
      }
    }
  })

  test('поисковики, поиск ассистентов и превью ссылок читают общую группу', () => {
    for (const bot of KEPT) {
      expect(BLOCKED_CRAWLERS.map((ua) => ua.toLowerCase()), bot).not.toContain(bot.toLowerCase())
      const group = groupFor(bot)
      expect(group.userAgent, bot).toEqual(['*'])
      for (const url of [
        '/',
        '/game/730',
        '/en/game/730/news/5123894512345',
        '/games/coop',
        // превью: карточки личных страниц открыты ради X (PERSONAL_PREFIXES)
        `/portrait/${STEAMID}/opengraph-image`,
        '/ru/game/730/opengraph-image',
      ]) {
        expect(allowed(group, url), `${bot} ${url}`).toBe(true)
      }
      expect(allowed(group, '/api/prepare'), bot).toBe(false)
    }
  })

  /**
   * Текст файла — тем же разбором, что у Next (resolveRobots): одна группа
   * со строкой User-Agent на каждого бота и одним Disallow: /. Строки
   * User-Agent подряд — одна группа по RFC 9309, а не по группе на бота с
   * пустыми правилами.
   */
  test('в robots.txt группа идёт строками User-Agent подряд и одним Disallow: /', () => {
    const text = resolveRobots(robots())
    expect(text.startsWith('User-Agent: *\nAllow: /\n')).toBe(true)
    const block = `${BLOCKED_CRAWLERS.map((ua) => `User-Agent: ${ua}\n`).join('')}Disallow: /\n\n`
    expect(text).toContain(block)
    expect(text.indexOf(block)).toBeGreaterThan(text.indexOf('User-Agent: *'))
  })
})

describe('noindex заголовком', () => {
  const noindexed = (url: string) =>
    noindexHeaders().some((r) => getPathMatch(r.source)(url) !== false)

  test('стоит на всём под личными префиксами — и на страницах, и на PNG', () => {
    for (const url of [
      `/portrait/${STEAMID}`,
      `/portrait/${STEAMID}/card.png`,
      `/portrait/${STEAMID}/opengraph-image`,
      `/portrait/${STEAMID}/year`,
      `/portrait/${STEAMID}/year/card.png`,
      `/portrait/${STEAMID}/year/opengraph-image`,
      `/compat/${STEAMID}`,
      `/compat/${STEAMID}/opengraph-image`,
      '/room/ABC234',
      '/room/ABC234/opengraph-image',
      '/pick/abcdefghjkmn',
      '/pick/abcdefghjkmn/opengraph-image',
    ]) {
      expect(noindexed(url), url).toBe(true)
    }
  })

  /**
   * /daily гостю отдаёт заглушку «Изучаю твою библиотеку…», /rooms —
   * объяснение и пустую доску (живые комнаты приезжают из /api, а он
   * закрыт). Открыты они ради того, чтобы краулер увидел noindex, а не ради
   * выдачи.
   */
  test('английские личные страницы, карточки и заглушки — тоже noindex', () => {
    for (const url of [
      `/en/portrait/${STEAMID}`,
      `/en/portrait/${STEAMID}/card.png`,
      `/en/portrait/${STEAMID}/opengraph-image`,
      `/en/compat/${STEAMID}`,
      '/en/room/ABC234',
      '/en/pick/abcdefghjkmn',
      `/en/whatsnew/feed/${'a'.repeat(32)}`,
      '/en/daily',
      '/en/rooms',
      // карточки русских страниц по внутреннему пути, мимо редиректа с /ru
      `/ru/portrait/${STEAMID}/opengraph-image`,
      `/ru/compat/${STEAMID}/opengraph-image`,
      '/ru/room/ABC234/opengraph-image',
      '/ru/pick/abcdefghjkmn/opengraph-image',
    ]) {
      expect(noindexed(url), url).toBe(true)
    }
    for (const url of ['/en', '/en/quiz', '/en/game/730', '/en/games', '/en/whatsnew', '/en/whatsnew/feed.xml', '/en/rooms/x']) {
      expect(noindexed(url), url).toBe(false)
    }
  })

  test('открытые заглушки шапки — с noindex заголовком, /quiz — без', () => {
    expect([...NOINDEX_PAGES]).toEqual(['/daily', '/rooms'])
    expect(noindexed('/daily')).toBe(true)
    expect(noindexed('/rooms')).toBe(true)
    // квиз гостю показывает первый вопрос целиком — ему место в выдаче
    expect(noindexed('/quiz')).toBe(false)
    // точным адресом: соседей по префиксу не задевает
    expect(noindexed('/dailyx')).toBe(false)
    expect(noindexed('/roomsx')).toBe(false)
  })

  /**
   * Без Disallow единственное, что держит /room/new?game=… вне выдачи, —
   * заголовок. Сопоставитель Next смотрит на путь без строки запроса, так
   * что правило /room/:path* накрывает все варианты ?game= разом.
   */
  test('создание комнаты — с noindex заголовком: robots.txt его больше не прячет', () => {
    expect(noindexed('/room/new')).toBe(true)
    expect(noindexed('/en/room/new')).toBe(true)
  })

  test('правило /room/:path* не задевает /rooms — у того своё, точное', () => {
    expect(getPathMatch('/room/:path*')('/rooms')).toBe(false)
  })

  /**
   * Личная RSS-лента по секретной ссылке (app/whatsnew/feed/[token]). Ссылок
   * на неё нигде нет, но утечь адрес может — в переписку, в чужой ридер, — и
   * тогда в выдачу он не должен попасть ни с содержимым, ни голым. Поэтому в
   * robots.txt она открыта (закрытый адрес Google индексирует голым, по
   * тексту ссылки, — то есть вместе с ключом), а noindex стоит заголовком.
   * Общая лента feed.xml — соседний сегмент, и правило её не задевает.
   */
  test('секретная лента — noindex заголовком и открыта краулеру; общая feed.xml — без noindex', () => {
    const key = 'a'.repeat(32)
    expect(noindexed(`/whatsnew/feed/${key}`)).toBe(true)
    expect(allowed(rulesOf(), `/whatsnew/feed/${key}`)).toBe(true)
    expect(noindexed('/whatsnew/feed.xml')).toBe(false)
    expect(noindexed('/whatsnew')).toBe(false)
  })

  test('не задевает соседей и открытые разделы', () => {
    for (const url of [
      '/',
      '/quiz',
      '/game/730',
      '/game/730/news/5123894512345',
      '/game/730/news',
      '/games',
      '/games/roguelike',
      '/games/coop',
      '/whatsnew',
      '/portraits',
      '/compatibility',
    ]) {
      expect(noindexed(url), url).toBe(false)
    }
  })

  test('next.config отдаёт эти правила', async () => {
    const rules = await nextConfig.headers!()
    for (const source of [
      ...[...PERSONAL_PREFIXES, ...SECRET_PREFIXES].map((p) => `${p}/:path*`),
      ...NOINDEX_PAGES,
    ]) {
      const rule = rules.find((r) => r.source === source)
      expect(rule, source).toBeDefined()
      expect(rule!.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex' })
    }
  })
})
