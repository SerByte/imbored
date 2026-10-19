import { feedLinkOwner, getGamesMetaLite, getLatestSnapshotMinutes, getRssFeedForApps } from '@/lib/db'
import { FEED_POLL_LIMIT, FEED_POLL_WINDOW_SEC, feedTokenHash, isFeedToken } from '@/lib/feedlink'
import { newsDescription, newsPageTitle, newsPath, newsTitleOn } from '@/lib/newspage'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { rssFeed } from '@/lib/rss'
import { appBaseUrl, getDb, isDemoId, nowSec } from '@/lib/server'
import { resolveWhatsNew } from '@/lib/whatsnewfeed'
import { htmlLang, isLocale, lp, tr } from '@/lib/i18n'

/**
 * Личная RSS-лента по секретной ссылке: крупные патчи игр из твоей
 * библиотеки — для ридера или телеграм-бота, без захода на сайт.
 *
 * ЧТО В НЕЙ — ровно вкладка «В твоих играх» с /whatsnew, и ничего сверх.
 * Ветка та же (resolveWhatsNew): те же LIBRARY_CAP игр, то же окно свежести,
 * тот же FEED_LIMIT. Добивки популярным нет — major отдаёт пусто: она ушла
 * бы в ридер под заголовком про твои игры, а у общей ленты есть свой адрес
 * (/whatsnew/feed.xml). Добивка вдобавок выдавала бы состав библиотеки
 * отсутствием: из неё выброшены ВСЕ твои игры.
 *
 * Полки «Из желаемого подешевело» тут нет намеренно. Её нет и на /whatsnew,
 * а утёкшая ссылка открывала бы тогда ещё и список желаемого — расширять
 * то, что видно по ключу, за пределы страницы, которую он повторяет, мы не
 * стали.
 *
 * Ни SteamID, ни имени профиля в документе нет; адреса записей — публичные
 * страницы патчей. Сам ключ в тело не повторяется (rssFeed без self).
 *
 * Имя канала — по владельцу ключа. Выпуск открыт и демо-личности, но
 * библиотека у неё чужая, и «твои игры» были бы неправдой — той, которую ей
 * уже не говорит строка на /whatsnew (докблок components/whatsnew/FeedLink).
 * А имя канала ридер показывает постоянно: в списке подписок, над каждой
 * записью. Владелец — тот, кого нашёл ключ, а не кука: ридер ходит без неё.
 *
 * КЛЮЧ — единственное доказательство: ридер ходит без нашей куки. Поэтому:
 *   • формат — до базы: мусор в адресе не стоит ни одного чтения;
 *   • владелец — по sha256 ключа (lib/feedlink, там же — почему равенства
 *     в индексе достаточно и timingSafeEqual не нужен);
 *   • не нашёлся — 404, одинаковый для «не было», «перевыпущен»,
 *     «отключён» и «человека забыли»: снаружи их не различить.
 *
 * КЭШ. Только у читателя: private. s-maxage положил бы ленту в общий кэш
 * CDN по адресу, и отозванная ссылка отвечала бы оттуда до конца срока —
 * перевыпуск и «удалить всё» перестали бы значить «сразу». Отказ — no-store:
 * иначе ридер помнил бы 404 дольше, чем он правда. Vary не нужен: ответ
 * зависит только от адреса, кука в нём не участвует.
 *
 * ЦЕНА ОПРОСА. Каждый опрос будит функцию — CDN мы сознательно не даём,
 * — поэтому он стоит как можно меньше: снимок библиотеки — парами [appid,
 * минуты] вместо блоба (getLatestSnapshotMinutes), тела патчей — только у
 * тех, чьё описание без них не собрать, то есть без пересказа
 * (getRssFeedForApps), к Steam ничего не ходит, и потолок на ссылку
 * (FEED_POLL_LIMIT) отсекает утёкшую ссылку под скриптом.
 * Потолок — по steamid владельца: под этим ключом forgetUser найдёт счётчик.
 *
 * Журнал запросов хостинга видит путь, а с ним и ключ, — как у любой
 * секретной ссылки. Ключ даёт только чтение этой ленты и гасится
 * перевыпуском; поэтому мы его и не прячем от журнала, а делаем дешёвым
 * для отзыва.
 *
 * ЯЗЫК — из адреса: ключ один, а лент две, /whatsnew/feed/<ключ> и
 * /en/whatsnew/feed/<ключ> (строка FeedLink ставит язык своей страницы).
 * Английская — вкладка «In your games» английской версии: те же записи,
 * заголовок — newsTitleOn, описание — английский пересказ, а без него
 * начало поста, только если оно английское (ридер getRssFeedForApps с 'en'
 * русское тело не отдаёт вовсе), иначе заголовок. Запись без пересказа здесь
 * остаётся, в отличие от общей ленты: это патч твоей игры, и знать о нём
 * важнее, чем читать его пересказ.
 */
export const dynamic = 'force-dynamic'

/** Отказ: noindex и no-store — 404 не кэшируется нигде, ни у читателя, ни на CDN */
const MISS_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex',
} as const

function miss(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { ...MISS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function GET(_req: Request, ctx: { params: Promise<{ lang: string; token: string }> }): Promise<Response> {
  const { lang, token } = await ctx.params
  // Язык не из LOCALES (/_x/…) — 404: notFound() корневого layout до обработчика не доходит
  if (!isLocale(lang)) return miss()
  const locale = lang
  if (!isFeedToken(token)) return miss()

  const db = await getDb()
  const steamid = await feedLinkOwner(db, feedTokenHash(token))
  if (!steamid) return miss()

  const now = nowSec()
  const gate = await checkRate(db, {
    bucket: 'feedrss',
    id: steamid,
    limit: FEED_POLL_LIMIT,
    windowSec: FEED_POLL_WINDOW_SEC,
    nowSec: now,
  })
  if (!gate.ok) {
    const res = rateLimitedResponse(gate.retryAfterSec)
    for (const [k, v] of Object.entries(MISS_HEADERS)) res.headers.set(k, v)
    return res
  }

  const { items } = await resolveWhatsNew({
    steamid,
    wantsPopular: false,
    nowSec: now,
    snapshot: (id) => getLatestSnapshotMinutes(db, id),
    forApps: (appids, limit, since) => getRssFeedForApps(db, appids, limit, undefined, since, locale),
    // Добивки нет: в ридер идёт только личный блок — см. докблок
    major: async () => [],
  })
  const metas = await getGamesMetaLite(
    db,
    items.map((i) => i.appid),
  )

  const base = appBaseUrl()
  const demo = isDemoId(steamid)
  const xml = rssFeed({
    title: demo
      ? tr(locale, {
          ru: 'Что нового в играх демо-библиотеки — imbored',
          en: "What's new in the demo library's games — imbored",
        })
      : tr(locale, { ru: 'Что нового в твоих играх — imbored', en: "What's new in your games — imbored" }),
    link: `${base}${lp(locale, '/whatsnew')}`,
    description: demo
      ? tr(locale, {
          ru: 'Крупные патчи игр демо-библиотеки — коротко и по-русски.',
          en: "Major patches for the demo library's games, in short.",
        })
      : tr(locale, {
          ru: 'Крупные патчи игр из твоей библиотеки — коротко и по-русски.',
          en: 'Major patches for games in your library, in short.',
        }),
    language: htmlLang(locale),
    builtAt: now,
    items: items.map((item) => {
      const game = metas.get(item.appid)?.name
      // Пересказ — на языке ленты: на /en русского нет (docs/i18n.md, п. 8)
      const shown = locale === 'en' ? { ...item, tldr: item.tldrEn } : item
      return {
        // Те же заголовок и описание, что у общей ленты и страницы патча
        title: newsPageTitle(newsTitleOn(item, game, locale), game, item.publishedAt, locale),
        link: `${base}${lp(locale, newsPath(item.appid, item.gid))}`,
        publishedAt: item.publishedAt,
        description: newsDescription(shown, game, locale),
      }
    }),
  })
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // Десять минут — как перегенерация общей ленты: чаще новые патчи и не
      // приезжают, а вежливый ридер не будит функцию лишний раз
      'Cache-Control': 'private, max-age=600',
      'X-Robots-Tag': 'noindex',
    },
  })
}
