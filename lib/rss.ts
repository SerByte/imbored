/**
 * RSS 2.0 — лента крупных патчей (/whatsnew/feed.xml).
 *
 * Пересказы патчей по-русски — текст, которого больше нигде нет, и у него
 * есть свой читатель: тот, кто следит за обновлениями в ридере или в
 * телеграм-боте, подписанном на RSS. До ленты такой читатель мог только
 * заходить на /whatsnew руками.
 *
 * Модуль чистый: строка из списка, без базы и без Next. Экранирование — своё:
 * заголовок патча приходит из Steam как есть, и «&» или «<» в нём сломали бы
 * документ целиком, а не одну запись.
 */

export type RssItem = {
  title: string
  /** Абсолютный адрес страницы — он же guid: у патча он постоянный */
  link: string
  /** Секунды */
  publishedAt: number
  description: string
}

export type RssChannel = {
  title: string
  /** Абсолютный адрес страницы, которую лента повторяет */
  link: string
  /** Абсолютный адрес самой ленты — для atom:link rel=self */
  self: string
  description: string
  items: readonly RssItem[]
  /** Секунды: время сборки ленты */
  builtAt: number
}

/** Пять символов, которые XML не пропускает в тексте и атрибутах, и управляющие */
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Дата по RFC 822, как требует RSS 2.0; toUTCString — ровно этот формат */
const rfc822 = (sec: number) => new Date(sec * 1000).toUTCString()

export function rssFeed(ch: RssChannel): string {
  const items = ch.items
    .map(
      (i) => `    <item>
      <title>${escapeXml(i.title)}</title>
      <link>${escapeXml(i.link)}</link>
      <guid isPermaLink="true">${escapeXml(i.link)}</guid>
      <pubDate>${rfc822(i.publishedAt)}</pubDate>
      <description>${escapeXml(i.description)}</description>
    </item>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(ch.title)}</title>
    <link>${escapeXml(ch.link)}</link>
    <atom:link href="${escapeXml(ch.self)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(ch.description)}</description>
    <language>ru</language>
    <lastBuildDate>${rfc822(ch.builtAt)}</lastBuildDate>
${items}
  </channel>
</rss>
`
}
