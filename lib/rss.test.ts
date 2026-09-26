import { describe, expect, test } from 'vitest'
import { escapeXml, rssFeed } from './rss'

describe('escapeXml', () => {
  test('пять символов XML и управляющие — не ломают документ', () => {
    expect(escapeXml(`Tom & Jerry <3 "quotes" 'single'`)).toBe(
      'Tom &amp; Jerry &lt;3 &quot;quotes&quot; &apos;single&apos;',
    )
    expect(escapeXml('a\u0001b\u0008c\td\ne')).toBe('abc\td\ne')
  })
})

describe('rssFeed', () => {
  const feed = rssFeed({
    title: 'Что нового — imbored',
    link: 'https://imbored.cc/whatsnew',
    self: 'https://imbored.cc/whatsnew/feed.xml',
    description: 'Крупные патчи — коротко по-русски',
    builtAt: Date.parse('2026-09-26T12:00:00Z') / 1000,
    items: [
      {
        title: 'Counter-Strike 2: AWP & Mirage — что изменилось',
        link: 'https://imbored.cc/game/730/news/5123894512345',
        publishedAt: Date.parse('2026-09-25T18:00:00Z') / 1000,
        description: 'Поправили <баланс> AWP.',
      },
    ],
  })

  test('документ RSS 2.0 с atom:self и языком', () => {
    expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(feed).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">')
    expect(feed).toContain(
      '<atom:link href="https://imbored.cc/whatsnew/feed.xml" rel="self" type="application/rss+xml" />',
    )
    expect(feed).toContain('<language>ru</language>')
    expect(feed).toContain('<lastBuildDate>Sat, 26 Sep 2026 12:00:00 GMT</lastBuildDate>')
  })

  test('запись: экранированный заголовок, постоянный guid, дата RFC 822', () => {
    expect(feed).toContain('<title>Counter-Strike 2: AWP &amp; Mirage — что изменилось</title>')
    expect(feed).toContain('<guid isPermaLink="true">https://imbored.cc/game/730/news/5123894512345</guid>')
    expect(feed).toContain('<pubDate>Fri, 25 Sep 2026 18:00:00 GMT</pubDate>')
    expect(feed).toContain('<description>Поправили &lt;баланс&gt; AWP.</description>')
  })

  test('пустая лента — всё ещё валидный канал', () => {
    const empty = rssFeed({ title: 't', link: 'l', self: 's', description: 'd', builtAt: 0, items: [] })
    expect(empty).toContain('<channel>')
    expect(empty).not.toContain('<item>')
  })
})
