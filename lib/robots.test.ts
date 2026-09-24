import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { describe, expect, test } from 'vitest'
import robots from '../app/robots'
import nextConfig from '../next.config'
import { noindexHeaders, PERSONAL_PREFIXES, ROBOTS_DISALLOW } from './robots'

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
      `/compat/${STEAMID}`,
      `/compat/${STEAMID}/opengraph-image`,
      '/room/ABC234',
      '/room/ABC234/opengraph-image',
    ]) {
      expect(allowed(rules, url), url).toBe(true)
    }
  })

  test('состояние сессии, хабы и /api закрыты', () => {
    const rules = rulesOf()
    for (const url of [
      '/portrait',
      '/compat',
      '/rooms',
      '/room/new',
      '/play',
      '/play?time=short',
      '/explore',
      '/quiz',
      '/library',
      '/daily',
      '/api/prepare',
    ]) {
      expect(allowed(rules, url), url).toBe(false)
    }
  })

  test('разделы с содержанием открыты', () => {
    const rules = rulesOf()
    for (const url of ['/', '/game/730', '/whatsnew', '/privacy', '/support', '/?next=%2Fplay']) {
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
      `/compat/${STEAMID}`,
      `/compat/${STEAMID}/opengraph-image`,
      '/room/ABC234',
      '/room/ABC234/opengraph-image',
    ]) {
      expect(noindexed(url), url).toBe(true)
    }
  })

  test('не задевает соседей и открытые разделы', () => {
    for (const url of ['/', '/rooms', '/game/730', '/whatsnew', '/portraits', '/compatibility']) {
      expect(noindexed(url), url).toBe(false)
    }
  })

  test('next.config отдаёт эти правила', async () => {
    const rules = await nextConfig.headers!()
    for (const prefix of PERSONAL_PREFIXES) {
      const rule = rules.find((r) => r.source === `${prefix}/:path*`)
      expect(rule, prefix).toBeDefined()
      expect(rule!.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex' })
    }
  })
})
