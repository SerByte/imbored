import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { describe, expect, test } from 'vitest'
import robots from '../app/robots'
import nextConfig from '../next.config'
import { noindexHeaders, NOINDEX_PAGES, PERSONAL_PREFIXES, ROBOTS_DISALLOW, SECRET_PREFIXES } from './robots'

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

function rulesOf(): { allow: string[]; disallow: string[] } {
  const r = robots().rules
  const group = Array.isArray(r) ? r[0] : r
  const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])
  return { allow: list(group.allow), disallow: list(group.disallow) }
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

  test('сопоставитель в тесте понимает $ и префиксы — иначе проверки выше пустые', () => {
    const rules = { allow: ['/'], disallow: ['/portrait$', '/room'] }
    expect(allowed(rules, '/portrait')).toBe(false)
    expect(allowed(rules, '/portrait/1')).toBe(true)
    expect(allowed(rules, '/rooms')).toBe(false)
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
