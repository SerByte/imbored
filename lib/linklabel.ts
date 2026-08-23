/**
 * ПОДПИСЬ ССЫЛКИ В ЧУЖОМ ТЕКСТЕ.
 *
 * Тело патчнота пишет издатель, и подписи ссылок в нём бывают двух видов,
 * которые подписями не являются вовсе.
 *
 * ГОЛЫЙ АДРЕС. Замерено на 824 ссылках из локальной базы: у 227 — больше
 * четверти — подпись это сам URL со схемой, хвостом и параметрами. На экране
 * получается строка в полтысячи пикселей, которую невозможно прочитать
 * глазами и бессмысленно слушать вслух. Показываем хост и начало пути:
 * адрес остаётся в href нетронутым, меняется только то, что видно.
 *
 * ЛИНКФИЛЬТР STEAM. Внешние ссылки Valve заворачивает в
 * `steamcommunity.com/linkfilter/?u=<адрес>`. Показать хост обёртки значило бы
 * сказать человеку неправду о том, куда он идёт: на экране «steamcommunity»,
 * а откроется форум Factorio. Разворачиваем и показываем настоящий адрес.
 *
 * ПОДПИСЬ ДЛИНОЙ В АБЗАЦ. Издатель заворачивает в ссылку целый кусок текста —
 * в базе нашлись подписи в 5567 и 1304 символа. Акцентным цветом это
 * перестаёт быть ссылкой и становится стеной. Обрезаем по границе слова.
 *
 * Чего здесь НЕТ намеренно: коротких подписей вроде «more», «here» и «X» никто
 * не трогает, хотя их 303 из 824. Такая ссылка стоит внутри предложения, а
 * предложение и есть её контекст — критерий 2.4.4 прямо разрешает определять
 * назначение ссылки вместе с окружающим текстом. Дописывать им aria-label
 * значило бы заставить диктор читать то же предложение дважды.
 */

/** Дальше этого подпись перестаёт быть подписью. */
const MAX_LABEL = 120

/** Сколько символов пути показываем после хоста. */
const MAX_PATH = 24

/** Достаём настоящий адрес из обёртки Valve. */
function unwrapLinkfilter(url: URL): URL {
  if (!/(^|\.)steamcommunity\.com$/i.test(url.hostname)) return url
  if (!url.pathname.startsWith('/linkfilter')) return url
  const inner = url.searchParams.get('u')
  if (!inner) return url
  try {
    return new URL(inner)
  } catch {
    return url
  }
}

/** Человеческий вид адреса: хост без www и начало пути. */
function prettyUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url = unwrapLinkfilter(url)

  const host = url.hostname.replace(/^www\./i, '')
  const path = url.pathname.replace(/\/+$/, '')
  if (!path) return host
  const tail = path.length > MAX_PATH ? `${path.slice(0, MAX_PATH)}…` : path
  return host + tail
}

/** Обрезка по границе слова — посреди слова обрыв читается как поломка. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * Что показать вместо подписи ссылки. Адрес в href не меняется никогда —
 * правится только видимый текст.
 */
export function linkLabel(text: string, href: string): string {
  const t = (text ?? '').trim()
  if (!t) return t

  /*
   * Подпись — сам адрес. Показываем по-человечески, причём разбираем HREF, а
   * не текст: ведёт ссылка туда, куда ведёт href, и подпись обязана говорить
   * про место назначения, а не про то, что издатель написал буквами.
   * Совпадают они почти всегда — Steam линкует голые адреса сам, — но когда
   * разойдутся, правым будет href.
   */
  if (/^https?:\/\/\S*$/i.test(t)) {
    const pretty = prettyUrl(href) ?? prettyUrl(t)
    if (pretty) return clamp(pretty, MAX_LABEL)
  }

  if (t.length > MAX_LABEL) return clamp(t, MAX_LABEL)
  return t
}
