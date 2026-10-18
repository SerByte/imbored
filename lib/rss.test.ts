import { describe, expect, test } from 'vitest'
import { escapeXml, rssFeed } from './rss'
import { blocksToText, decodeEntities, parseSteamHtml } from './steamhtml'

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
    // <description> — HTML (см. докблок rssFeed): текст экранирован дважды
    expect(feed).toContain('<description>Поправили &amp;lt;баланс&amp;gt; AWP.</description>')
  })

  /**
   * Ридер читает <description> в два слоя: XML снимает своё экранирование, а
   * остаток он рисует как HTML (Feedly, Inoreader, NetNewsWire, телеграм-боты
   * — и наш же разбор фида Steam, lib/news.ts: decodeEntities, потом
   * parseSteamHtml). Экранированный один раз «<Enter>» во втором слое снова
   * становился тегом, неизвестным — и пропадал из текста патча.
   */
  test('угловые скобки и & в описании ридер покажет текстом, а не съест как тег', () => {
    const xml = rssFeed({
      title: 't',
      link: 'l',
      description: 'd',
      builtAt: 0,
      items: [{ title: 'Fixed <Enter> & R&D', link: 'l', publishedAt: 0, description: 'Fixed <Enter> & R&D' }],
    })
    const desc = /<item>[\s\S]*<description>([\s\S]*?)<\/description>/.exec(xml)?.[1] ?? ''
    expect(desc).toBe('Fixed &amp;lt;Enter&amp;gt; &amp;amp; R&amp;amp;D')
    // так его прочтёт ридер: слой XML, затем HTML
    expect(blocksToText(parseSteamHtml(decodeEntities(desc)))).toBe('Fixed <Enter> & R&D')
    // А заголовок ридеры показывают текстом: второй слой в нём вылез бы
    // наружу буквальным «&lt;» — он экранирован однажды, только для XML
    expect(xml).toContain('<title>Fixed &lt;Enter&gt; &amp; R&amp;D</title>')
  })

  /**
   * Адрес личной ленты — секретная ссылка (lib/feedlink). Ридер её и так
   * знает, а повторять ключ в теле значило бы отдать его каждому, кому
   * ридер или бот покажет содержимое канала.
   */
  test('без self — канал без atom:link: адрес личной ленты в теле не повторяется', () => {
    const own = rssFeed({ title: 't', link: 'l', description: 'd', builtAt: 0, items: [] })
    expect(own).not.toContain('<atom:link')
    expect(own).toContain('<link>l</link>')
  })

  test('пустая лента — всё ещё валидный канал', () => {
    const empty = rssFeed({ title: 't', link: 'l', self: 's', description: 'd', builtAt: 0, items: [] })
    expect(empty).toContain('<channel>')
    expect(empty).not.toContain('<item>')
  })
})

describe('язык ленты', () => {
  const base = {
    title: "What's new — imbored",
    link: 'https://imbored.cc/en/whatsnew',
    description: 'Major patches, in short',
    builtAt: Date.parse('2026-09-26T12:00:00Z') / 1000,
    items: [],
  }

  test('английская лента так и называет себя: <language>en</language>', () => {
    const feed = rssFeed({ ...base, language: 'en' })
    expect(feed).toContain('<language>en</language>')
    expect(feed).not.toContain('<language>ru</language>')
    expect(feed).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('без языка — ru, как было', () => {
    expect(rssFeed(base)).toContain('<language>ru</language>')
  })
})
