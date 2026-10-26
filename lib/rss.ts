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
 *
 * Слоёв экранирования у полей РАЗНОЕ число, и это не небрежность. <description>
 * записи в RSS 2.0 — HTML («entity-encoded HTML is allowed» в спецификации), и
 * ридеры — Feedly, Inoreader, NetNewsWire, телеграм-боты, наш же разбор фида
 * Steam в lib/news.ts — снимают слой XML и рисуют остаток как HTML. Описание у
 * нас — текст (пересказ или начало поста), поэтому оно экранируется дважды:
 * сперва как текст HTML (htmlText), потом для XML. С одним слоем «Fixed <Enter>»
 * доезжал до читателя как «Fixed » — ридер принимал <Enter> за неизвестный тег.
 * <title> ридеры показывают текстом — второй слой вылез бы в нём буквальным
 * «&lt;», — и он, как адреса и описание канала, экранируется только для XML.
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
  /**
   * Абсолютный адрес самой ленты — для atom:link rel=self. Нет — нет и
   * atom:link: у личной ленты адрес — секретная ссылка (lib/feedlink), и
   * повторять её в теле канала незачем — ридер знает, откуда взял ленту.
   */
  self?: string
  description: string
  items: readonly RssItem[]
  /**
   * Секунды: <lastBuildDate>. Нет — дата самой свежей записи канала, а без
   * записей нет и тега (в RSS 2.0 он необязателен).
   *
   * Не время сборки, хотя имя к нему и тянет. Общая лента (/whatsnew/feed.xml)
   * — запись ISR, и её перегенерация ничего не пишет, только если вывод тот
   * же байт в байт; личная отвечает 304 по ETag от тела. «Сейчас» в документе
   * делало каждую сборку новой: запись ISR на каждую перегенерацию и полное
   * тело ридеру на каждый опрос.
   */
  builtAt?: number
  /**
   * Язык ленты — <language> канала: htmlLang(locale) той версии сайта, чью
   * ленту отдаём. Без него — 'ru', как было: ридер по нему выбирает словарь
   * переносов и голос, и английская лента с «ru» читалась бы русским.
   */
  language?: string
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

/**
 * Текст в текст HTML: три знака, которые HTML прочёл бы разметкой или
 * сущностью. &apos; не нужен — кавычка в тексте HTML ничего не значит, а
 * ридеры эпохи HTML4 этой сущности не знают. Управляющие снимет escapeXml.
 */
function htmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
      <description>${escapeXml(htmlText(i.description))}</description>
    </item>`,
    )
    .join('\n')
  const self =
    ch.self === undefined
      ? ''
      : `    <atom:link href="${escapeXml(ch.self)}" rel="self" type="application/rss+xml" />\n`
  const builtAt = ch.builtAt ?? (ch.items.length ? Math.max(...ch.items.map((i) => i.publishedAt)) : undefined)
  const built = builtAt === undefined ? '' : `    <lastBuildDate>${rfc822(builtAt)}</lastBuildDate>\n`
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(ch.title)}</title>
    <link>${escapeXml(ch.link)}</link>
${self}    <description>${escapeXml(ch.description)}</description>
    <language>${escapeXml(ch.language ?? 'ru')}</language>
${built}${items}
  </channel>
</rss>
`
}
