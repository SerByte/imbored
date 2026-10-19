import type { Metadata } from 'next'
import Link from '@/components/Link'
import { notFound } from 'next/navigation'
import { cache, Fragment, type ReactNode } from 'react'
import { GameArt } from '@/components/GameArt'
import { GameMorph } from '@/components/Morph'
import { GameNews } from '@/components/GameNews'
import { GameShots } from '@/components/GameShots'
import { DiscountEnds, PriceTag, PriceWhere } from '@/components/PriceTag'
import { ShownUntil } from '@/components/ShownUntil'
import { Eyebrow, MetaLine } from '@/components/Labels'
import { PlayersNow } from '@/components/PlayersNow'
import { ProgressRing } from '@/components/ProgressRing'
import { RefundNote } from '@/components/RefundNote'
import { OwnedLaunch } from '@/components/OwnedLaunch'
import { OwnedNear } from '@/components/OwnedNear'
import { sitemapGames } from '@/lib/db'
import { discountTrustedUntil, discountView, lapsedRegularPrice, trustedPrice } from '@/lib/discount'
import { trimArt } from '@/lib/art'
import { PRERENDER_TOP, prerenderAtBuild } from '@/lib/gamecache'
import { hubPath, hubTitle, primaryGenre } from '@/lib/gamehub'
import { byline } from '@/lib/byline'
import { descriptionFor, storeUrlFor } from '@/lib/gamedesc'
import {
  deadVerdict,
  gameDescription,
  gameTraits,
  isRussianText,
  loadGamePage,
  reviewFacts,
  reviewPulse,
  type StudioLine,
} from '@/lib/gamepage'
import { reviewsLine, steamScoreLabel } from '@/lib/gametraits'
import { gameBreadcrumbLd, gameJsonLd, ldScript, pageNameRu } from '@/lib/jsonld'
import { patchArchivePath } from '@/lib/patcharchive'
import { priceRegion, regionCurrency } from '@/lib/steamregion'
import { DEFAULT_LOCALE, fmtNumber, lp, pl, toLocale, tr, type Locale } from '@/lib/i18n'
import { localeAlternates, ogSite } from '@/lib/site'
import { quizHref, roomSeedHref } from '@/lib/presets'
import { isReplayable } from '@/lib/recommend'
import { refundEligible } from '@/lib/refund'
import { seedable } from '@/lib/roomseed'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'
import { shotUrl } from '@/lib/shots'
import { storeLink } from '@/lib/storelink'
import { STORE_LABEL } from '@/lib/stores'
import { tagLabel } from '@/lib/tagsru'
import { langOn, textLangOn, withForeignRuns } from '@/lib/textlang'
import { heroTitleClass } from '@/lib/titlesize'
import { SectionLabel } from '@/components/Labels'
import { TrailerPreview } from '@/components/TrailerPreview'
import { GameCardBody } from '@/components/GameCard'
import { GameLink } from '@/components/GameLink'
import { Icon } from '@/components/Icon'

/**
 * Страница кэшируется на неделю вместо force-dynamic — GAME_PAGE_REVALIDATE_SEC
 * в lib/gamecache, литералом, потому что Next читает его только так.
 *
 * Кэш вообще стал возможен ровно потому, что loadGamePage больше не ходит в
 * сеть: пока карточка собиралась из appdetails, appreviews и Claude прямо на
 * рендере, кэшировать было нечего. Теперь всё тяжёлое наполняет крон
 * (lib/pagejob.ts), а страница только читает базу.
 *
 * Неделя, а не сутки, — ради ISR Writes (лимит Hobby выбран, см.
 * lib/gamecache). Свежесть при этом держат не часы, а события: кроны карточек,
 * новостей и пересказов сбрасывают адрес сами, когда поменяли его данные
 * (revalidateGamePages). По часам доезжает только медленное — сверка отзывов
 * и онлайна раз в неделю (lib/catalogsignals), ей неделя и есть родной шаг.
 *
 * Неделя бесплатна, только пока вывод СТАБИЛЕН: перегенерация без новых
 * данных обязана дать ту же страницу байт в байт, иначе Vercel пишет её
 * заново. Поэтому в разметке нет ничего, что меняется от одних часов:
 *   • онлайн — всегда прошедшим временем (PlayersNow ниже);
 *   • срок скидки — датой, а не «осталось 2 дня» (discountView, calendar);
 *   • в островок новостей едет только видимое (cardNews в lib/gamepage).
 * Часы остаются только на порогах, которые назначили сами данные: конец
 * скидки, выход игры. Конец скидки к тому же сбрасывает крон карточек
 * (revalidateEndedDeals в lib/gamecache): строку цены клиент гасит сам, а
 * Offer в JSON-LD иначе обещал бы акционную цену до конца недели. Сторож —
 * app/game/[appid]/page.test.ts.
 */
export const revalidate = 604_800

/**
 * Обязателен, и не ради предрендера.
 *
 * Без generateStaticParams динамический сегмент не попадает в dynamicRoutes
 * манифеста вовсе — то есть `revalidate` выше не значит ничего, и каждый заход
 * рендерится заново (проверено: Cache-Control приходил no-store). На продовой
 * сборке отдаём верх каталога, остальные appid досоздаются по требованию и
 * кэшируются на ту же неделю: dynamicParams по умолчанию true.
 *
 * Везде, кроме прода, список пустой (prerenderAtBuild): каждая пререндеренная
 * карточка — запись ISR на каждой сборке, и превью платили за это наравне с
 * продом. Сколько и почему столько — PRERENDER_TOP.
 *
 * Только русская ветка. Next зовёт эту функцию на каждый язык корневого
 * layout (generate-static-params.md: child — «once for each set of params
 * the parent generates»), и одинаковый список удвоил бы пререндер: двести
 * карточек вместо PRERENDER_TOP, вдвое больше записей ISR на каждой сборке.
 * Английские карточки досоздаются по требованию, как хвост каталога, и это
 * решение, а не недоделка: пререндер окупается там, где адрес посетят
 * наверняка (докблок PRERENDER_TOP), а своего верха у английской версии на
 * старте ещё нет. Первый заход на /en/game/<appid> платит холодным рендером и
 * дальше живёт в кэше ту же неделю.
 *
 * Сборка не должна падать из-за базы: локально TURSO_DATABASE_URL может быть
 * не задан, и тогда предрендерить просто нечего.
 */
export async function generateStaticParams({
  params,
}: {
  params: { lang: string }
}): Promise<Array<{ appid: string }>> {
  if (params.lang !== DEFAULT_LOCALE || !prerenderAtBuild()) return []
  try {
    const games = await sitemapGames(await getDb(), PRERENDER_TOP)
    return games.map((g) => ({ appid: String(g.appid) }))
  } catch {
    return []
  }
}

/** generateMetadata и сам компонент рендерят один запрос — читаем базу однажды. */
const loadOnce = cache(loadGamePage)

/**
 * Карточка превью на /en — та же opengraph-image.tsx рядом, но с английской
 * подписью. alt файловой карточки — константа модуля, одна на все языки, и
 * на /en og:image:alt был бы русским. Свой images этого уровня Next ставит
 * вместо файла, а twitter:image дозаполняет из openGraph сам. Русская
 * страница images не объявляет и получает файловую карточку как была: адрес
 * с хешем, размеры и alt — оттуда. Хеша у английского адреса нет — его
 * ставит только файловая метадата; карточку и так перерисовывает revalidate.
 *
 * Размеры и тип — копия size и contentType карточки, а не импорт: модуль
 * карточки тянет next/og и шрифты в рендер страницы. Что они совпадают —
 * сторож в page.test.ts. Не «мёртвый images» из lib/social.test.ts: тот —
 * images, которые перекрыл бы файл, а здесь images перекрывают файл.
 */
const EN_CARD = { width: 1200, height: 630, type: 'image/png', alt: 'Is it worth playing? — imbored' }

function enCard(locale: Locale, canonical: string) {
  if (locale !== 'en') return {}
  return { images: [{ url: lp(locale, `${canonical}/opengraph-image`), ...EN_CARD }] }
}

/**
 * Метаданные 404 под /en/game/<appid> — та же карточка с английским alt.
 *
 * Голов у такой 404 две. В HTML сервера, пустой оболочке __next_error__,
 * Next собирает голову заново по not-found: layout по пути и файлы корня
 * последним уровнем (errorMetadataItem в resolve-metadata), generateMetadata
 * страницы туда не входит, и подпись там ставит метадата границы —
 * generateMetadata в app/[lang]/not-found.tsx (docs/i18n.md, п. 10). А
 * голову, которую видит браузер, клиент ставит из обычного прохода —
 * файловая карточка сегмента плюс то, что вернул generateMetadata (замер на
 * next dev, /en/game/999999999 до и после гидрации). Пустой объект оставлял
 * в ней на /en русский alt файла («Стоит ли играть — imbored»). Так же
 * устроены 404 архива и патча (news/page.tsx, news/[gid]/page.tsx). Русская
 * 404 получает пустой объект, как была, и её голова не меняется. type и
 * siteName — корневого layout: свой
 * openGraph этого уровня заменяет его целиком; url — свой адрес, как у
 * каждого своего openGraph (lib/social.test.ts).
 */
function missingMeta(locale: Locale, raw: string): Metadata {
  if (locale !== 'en') return {}
  const path = `/game/${encodeURIComponent(raw)}`
  return { openGraph: { type: 'website', ...ogSite(locale), url: lp(locale, path), ...enCard(locale, path) } }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ appid: string; lang?: string }>
}): Promise<Metadata> {
  const { appid: raw, lang } = await params
  const locale = toLocale(lang)
  const appid = Number(raw)
  if (!Number.isInteger(appid) || appid === 0) return missingMeta(locale, raw)

  const data = await loadOnce(appid, locale)
  if (!data) return missingMeta(locale, raw)
  const { meta, reviewsSummary, prosCons } = data

  // Описание собираем из того, что на странице и так есть, а не из шаблона:
  // в выдаче должно стоять то, ради чего на неё имеет смысл заходить.
  // Правила длины и языка — в gameDescription, там же почему. prosCons уже
  // на языке страницы: его отдал loadGamePage того же locale. Часы вердикта —
  // ради пульса отзывов, как у самой страницы (см. verdict ниже)
  const description = gameDescription(
    {
      meta,
      facts: reviewFacts(meta, reviewsSummary),
      prosCons,
      verdict: deadVerdict(meta, nowSec(), locale),
    },
    locale,
  )

  const canonical = `/game/${appid}`

  /*
   * Картинки у русской страницы здесь нет, и это не потеря, а переезд. Раньше
   * в openGraph подставлялся сырой header-файл из Steam 920×430: чужая
   * пропорция, которую мессенджеры режут по краям, без названия поверх и без
   * единого следа imbored. Теперь карточку рисует opengraph-image.tsx рядом —
   * арт во всю карточку, скрим и текст, как на самой странице.
   *
   * Файл Next подставляет сам, но только пока у openGraph этого уровня нет
   * своего ключа images (resolve-metadata, mergeStaticMetadata): свой images
   * встаёт ВМЕСТО файла. Поэтому чужой картинки здесь быть не должно, а на
   * /en images есть — но это та же карточка, только с английским alt
   * (enCard ниже).
   */
  /*
   * Записи, которые каталог сам считает мёртвыми, не идут в индекс.
   *
   * Замер по проду 20 августа: 181 карточка с alive = 0, шесть с
   * superseded_by и четыре без тегов — 191 адрес, отдающий 200. В карте сайта
   * их нет (ALIVE_POOL), в блоке «Похожие» тоже (тот же предикат) — то есть
   * это страницы-сироты, живущие только по прямой ссылке. Соседний lib/junk
   * прячет ровно эти записи от выдачи, а поиск про них ничего не знал.
   *
   * Шесть замещённых (/game/10 при живой /game/730) стоят с noindex, как
   * прочие мёртвые, но canonical и og:url у них СВОИ. Стоял canonical на
   * преемника — «это дубликат, вес отдай живой». Только это не дубликат:
   * другая игра, другие отзывы, описание и цена. canonical между разными
   * страницами Google не применяет, а в паре с noindex это два спорящих
   * сигнала — переноса веса не случалось. og:url на преемника был хуже
   * бесполезного: VK и Facebook строят карточку по og:url, а не по присланной
   * ссылке (см. ownAddress в lib/site), и ссылка на Counter-Strike 1.6
   * разворачивалась в чате карточкой CS2. 308 на преемника тоже не выход:
   * сюда приходят из портрета и библиотеки ради той игры, в которую человек
   * играл. Сторож — app/game/[appid]/page.test.ts.
   *
   * Безтеговые сюда же, и раньше их не было: докблок считал их частью тех же
   * 191, а условие ловило 187. Разница видна на самой странице. Замер на
   * развёрнутой ветке: /game/43160 и /game/623990 отдают 397 и 427 видимых
   * символов при 2342 у обычной карточки, ноль разделов, ноль похожих — а в
   * сниппете при этом стоит «отзывы, теги и патчноуты», то есть страница
   * обещает поиску ровно то, чего у неё нет. Тег — это то, из чего собраны и
   * похожие, и половина текста; без него карточки нет.
   *
   * Условие пересчитывается на каждый рендер, а страница живёт на ISR: игра,
   * у которой теги появятся, вернётся в индекс сама.
   */
  const мёртвая =
    meta.alive === false ||
    meta.supersededBy !== undefined ||
    Object.keys(meta.tags).length === 0

  // Вопрос — целой фразой своего языка: по-английски название встаёт внутрь
  // вопроса, а не перед тире
  const title = tr(locale, { ru: `${meta.name} — стоит ли играть`, en: `Is ${meta.name} worth playing?` })

  return {
    title,
    description,
    alternates: localeAlternates(locale, canonical),
    ...(мёртвая ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      ...ogSite(locale),
      title,
      description,
      url: lp(locale, canonical),
      type: 'article',
      ...enCard(locale, canonical),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

/**
 * Строка цены со сроком годности — только у скидки.
 *
 * Со скидкой вся строка — акционное число, и гаснет она вместе с акцией
 * (discountTrustedUntil): страница из недельного кэша иначе обещала бы
 * «−70%» после конца распродажи. Без скидки цене верим без срока
 * (trustedPrice), и клиентский островок ей ни к чему. Разметку островок не
 * трогает — её после конца скидки освежает крон карточек сбросом адреса
 * (revalidateEndedDeals).
 */
function PriceLine({ until, children }: { until: number | null; children: ReactNode }) {
  return until === null ? children : <ShownUntil untilSec={until}>{children}</ShownUntil>
}

/**
 * «Ещё у Supergiant Games: Bastion · Transistor · Pyre» — что ещё сделали
 * авторы. Какие игры и когда строки нет вовсе — studioLine в lib/gamepage.
 *
 * Строка текста, а не сетка карточек, и это про соседнюю кнопку: «Подобрать
 * игру под настроение» — единственная ссылка страницы в продукт, и её уже
 * поднимали с 96% глубины до половины. Ещё шесть обложек над ней утопили бы
 * её обратно, а заодно стоили бы шести картинок на каждой из пяти тысяч
 * карточек. Ссылки без prefetch: строку видят все, а идут по ней редко.
 *
 * Имя студии — ровно как в подписи героя: та же строка из базы, без
 * «исправлений», которые разошлись бы с ней на той же странице. Неразрывный
 * пробел — только у русского «у»: короткий предлог не остаётся в конце строки
 * один, а у «from» такого правила нет.
 */
function StudioLinks({
  studio,
  locale,
  className = '',
}: {
  studio: StudioLine
  locale: Locale
  className?: string
}) {
  return (
    <p className={`text-sm text-dim leading-relaxed ${className}`}>
      {tr(locale, { ru: 'Ещё у ', en: 'More from ' })}
      {studio.developer}:{' '}
      {studio.games.map((g, i) => (
        <Fragment key={g.appid}>
          {i > 0 && ' · '}
          <Link
            href={`/game/${g.appid}`}
            prefetch={false}
            transitionTypes={['nav-forward']}
            className="tap tap-tight text-ink/80 underline decoration-1 underline-offset-4 decoration-ink/30 transition-colors hover:text-ink hover:decoration-ink"
          >
            {g.name}
          </Link>
        </Fragment>
      ))}
    </p>
  )
}

/**
 * Подпись под кольцом. По-русски: «из 1 000 отзывов» рядом со словом Steam,
 * без него — «положительных из 1 000 отзывов». По-английски кольцо и подпись
 * читаются одной фразой глоссария: «80% · of 1,000 reviews are positive»; со
 * словом Steam хвост «are positive» уже сказан им. Целым шаблоном на язык, а
 * не русской склейкой: порядок слов у них разный.
 */
function ReviewsTail({ total, labelled, locale }: { total: number; labelled: boolean; locale: Locale }) {
  const n = fmtNumber(locale, total)
  const reviews = pl(locale, total, { ru: ['отзыва', 'отзывов', 'отзывов'], en: ['review', 'reviews'] })
  if (locale === 'en') return labelled ? `of ${n} ${reviews}` : `of ${n} ${reviews} ${total === 1 ? 'is' : 'are'} positive`
  return (
    <>
      {labelled ? 'из' : 'положительных из'} {n} {reviews}
    </>
  )
}

export default async function GamePage({ params }: { params: Promise<{ appid: string; lang?: string }> }) {
  const { appid: raw, lang } = await params
  // Адреса в разметке — на языке страницы, как её canonical
  const locale = toLocale(lang)
  const appid = Number(raw)
  /*
   * Оба notFound() дают настоящий 404 только потому, что над страницей нет
   * границы Suspense: ни корневого loading.tsx, ни своего. С ними сервер
   * успевал отдать каркас со статусом 200, и /game/abc уходил в поиск мягким
   * 404. Каркас сюда не возвращать — см. lib/firstpaint.test.ts.
   */
  // отрицательные appid — кураторский пул других магазинов
  if (!Number.isInteger(appid) || appid === 0) notFound()

  const data = await loadOnce(appid, locale)
  if (!data) notFound()

  const { meta, reviewsSummary, prosCons } = data
  // Второе, русское название под заголовком — по тому же правилу, что
  // alternateName в разметке: видимое и размеченное не расходятся. На /en
  // его нет ни там, ни там: по русскому названию игру ищут в русской выдаче,
  // а английскому читателю вторая строка кириллицей под заголовком — шум
  const altName = locale === 'en' ? null : data.nameRu
  const nameRu = pageNameRu(meta, altName)
  const now = nowSec()
  // Срок — датой: отсчёт «осталось 2 дня» менял бы страницу каждые сутки и
  // врал бы из недельного кэша (см. докблок revalidate). Подпись — на языке
  // страницы («until Oct 14»): её собирает сервер, ценник рисует как есть
  const deal = discountView(meta, now, { calendar: true, locale })
  // Страница переживёт скидку — после этого момента цену прячет клиент
  const dealUntil = deal ? discountTrustedUntil(meta, now) : null
  // null — цене верить нечему (сгоревшая распродажа), см. trustedPrice. Плашку
  // тогда не рисуем вовсе: пустое стекло в герое хуже отсутствия цены.
  const price = trustedPrice(meta, now)
  // Спрятанная цена погасшей распродажи — не молчание: обычную цену той же
  // пары герой называет с подписью, пока сверка не переснимет (lapsedRegularPrice)
  const regular = price === null ? lapsedRegularPrice(meta, now) : null
  // Страница публичная и не знает, куплена ли игра у читающего, — поэтому
  // строка про возврат здесь нейтральная, без «не зайдёт»
  const refund = refundEligible(meta, now)
  const studio = byline(meta.developer, meta.releaseYear)
  const facts = reviewFacts(meta, reviewsSummary)
  // Месяц и русские под кольцом (reviewPulse): пустой список — строк нет
  const pulse = reviewPulse(meta, facts, now, locale)
  // Ответ мёртвой игре — он же прячет «Запустить»: звать в пустой матчмейкинг
  // кнопкой запуска значит спорить с собственным вердиктом. Часы — ради
  // пульса: свежий месяц похвал снимает «большинство отзывов отрицательные»
  const verdict = deadVerdict(meta, now, locale)
  /*
   * «Похожее уже есть у тебя» (lib/ownednear) — у игры Steam, где стоит
   * OwnedLaunch (он и спрашивает), и только при готовых соседях: полка по
   * тегу (similarTag) значит, что таблицы соседей у игры нет, и роут
   * искать своих будет не в чем — спрашивать незачем.
   */
  const nearAsk = !meta.storeUrl && !verdict && data.similar.length > 0 && !data.similarTag
  // При равных весах — по имени: тот же порядок, что у жанров в разметке
  // (gameJsonLd), иначе видимое и размеченное расходились бы на ничьих
  const topTags = Object.entries(meta.tags)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([t]) => t)
  const traits = gameTraits(meta, data.hook, locale)
  // Главный жанр — путь над названием и в крошках разметки (одно и то же)
  const genreTag = primaryGenre(meta.tags)
  const genre = genreTag ? { tag: genreTag, title: hubTitle(genreTag, locale), path: hubPath(genreTag)! } : null
  // Описание магазина на языке страницы: на /en только английское
  // (descriptionFor), русского абзаца там нет вовсе — блок молчит
  const about = descriptionFor(meta, locale)
  // Своя страница магазина у игры не из Steam — на языке страницы
  // (storeUrlFor). Английская подпись — целым шаблоном глоссария (storeLink:
  // «Open in Epic Games», без метки — «Open store page»); русская — прежней
  // разметкой, «Открыть в» и имя магазина
  const storeHref = storeUrlFor(meta, locale)
  const storeOpen =
    storeHref && locale === 'en' ? storeLink({ appid, store: meta.store ?? null, storeUrl: storeHref }, locale)?.open : null
  /*
   * Арт героя — срезанный под card: обе его картинки рисуют этот вариант и
   * читают header, header2x и capsule. GameArt — клиентский островок, так что
   * meta.art целиком уезжал в RSC и в HTML недельного кэша каждой карточки
   * вместе с library_hero, hero_2x и постерами, которых никто не запросит.
   *
   * Один объект на обе картинки, а не trimArt(meta.art) в каждой: Flight
   * сериализует общий объект один раз и дальше ссылается на него, а два
   * отдельных среза уехали бы двумя копиями.
   */
  const coverArt = trimArt(meta.art)
  /*
   * Название — данные, и на /en оно бывает русским: games.name у части верха
   * каталога держит русское имя магазина, пока его не перепишет английская
   * запись (nameSql в lib/db; замер на копии базы — God of War Рагнарёк,
   * Marvel Человек-Паук 2). Переводить его нельзя (docs/i18n.md, п. 6), а
   * пометить — нужно: английский голос скринридера читал бы кириллицу по
   * буквам (WCAG 3.1.2). langOn — 'ru' только на /en и только при перевесе
   * кириллицы: русская страница и латинские названия — без атрибута и без
   * лишнего <span>, как были.
   */
  const nameLang = langOn(locale, meta.name)
  const nameRun = nameLang ? <span lang={nameLang}>{meta.name}</span> : meta.name

  return (
    <div className="flex-1">
      {/*
        Микроразметка карточки — в разметке страницы, а не в generateMetadata:
        Metadata API умеет только те теги, которые знает сам, а ld+json — это
        произвольный <script>. Рекомендация Next ровно такая, см.
        node_modules/next/dist/docs/01-app/02-guides/json-ld.md.

        Собирается из тех же data, что и всё ниже: loadOnce кэширован на запрос,
        второго чтения базы здесь нет.

        Массив в одном теге, а не два тега: у каждой сущности свой @context,
        и JSON-LD такой список разбирает так же, как два отдельных скрипта.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldScript([
            gameJsonLd({
              meta,
              // то же второе название, что рядом под заголовком (pageNameRu);
              // на /en его нет и здесь
              nameRu: altName,
              // Оценки (facts) здесь нет намеренно: доля отзывов — Steam, а
              // чужие оценки размечать нельзя. Почему — докблок lib/jsonld
              baseUrl: appBaseUrl(),
              locale,
              // Та же валюта, что на ценнике: цену другого региона rowToMeta
              // сюда не пропускает, и Offer без неё не строится вовсе
              currency: regionCurrency(priceRegion()),
              now,
            }),
            gameBreadcrumbLd({ meta, baseUrl: appBaseUrl(), locale, genre }),
          ]),
        }}
      />
      {/* hero */}
      <section className="game-hero relative overflow-hidden">
        {/*
          Подложка берёт ТУ ЖЕ картинку, что и обложка ниже, и это не
          небрежность, а расчёт.

          Здесь стоял variant="hero", то есть library_hero: 231 КБ у Dota 2
          против 38 КБ у header. Изображение при этом проходит blur-3xl
          (радиус 64 пикселя) и opacity-30 — разрешение в нём не значит
          ничего. Правило уже было записано в components/ArtWash.tsx
          («растянутая на весь экран и размытая в кисель»), просто не
          применено здесь.

          sizes повторяет обложку дословно, чтобы браузер выбрал тот же
          файл и взял его из кэша. Не «поменьше», а «тот же самый»: любой
          другой размер — это вторая загрузка вместо нуля байт.

          И eager, как у обложки, — по той же причине. Подложка шире
          обложки, поэтому LCP страницы — она (замер на /game/730: IMG
          blur-3xl, а не обложка 380×178). Ленивая, она ждала раскладки,
          хотя её файл к тому моменту уже лежал в кэше: браузер откладывал
          не загрузку, а показ. Тот же URL делает eager бесплатным — байт
          это не добавляет ни одного.

          fetchPriority="high" — у обеих картинок героя, и не для красоты.
          React выносит неленивые картинки в <link rel="preload"> и склеивает
          одинаковые по srcSet и sizes в один, а приоритет берёт у ПЕРВОЙ
          встреченной. Первой в разметке стоит подложка: без приоритета у неё
          preload уходил бы в общую очередь, сколько ни ставь его обложке.
          Сторожит lib/herolcp.test.ts.
        */}
        <GameArt
          appid={meta.appid}
          name=""
          headerImage={meta.headerImage ?? null}
          art={coverArt}
          sizes="(min-width: 1024px) 380px, 100vw"
          eager
          fetchPriority="high"
          fallback={null}
          className="absolute inset-0 h-full w-full object-cover blur-3xl opacity-60 scale-125"
        />
        {/* Скрим «Премьеры»: подложка — цветной свет игры, а не пятно; текст
            слева и низ стоят на ровном тёмном, как у героя выдачи */}
        <div aria-hidden className="game-hero-scrim" />
        {/*
          Разрез на две колонки с lg, а не с md: раньше он включался там, где
          ещё вредил.

          Замер на 768px: контейнер 728, из него 380 забирает арт и 32 зазор —
          правой колонке остаётся 316. Это УЖЕ, чем одна колонка на телефоне
          (335 на 375px). В неё восемь тегов ложились в три ряда, описание в
          шесть строк, четыре кнопки в три ряда, а слева под коротким артом
          зияла пустота почти на 470×400.

          Одной колонкой на той же ширине: арт баннером 727×340, все восемь
          тегов в ряд, описание в три строки, все кнопки в ряд, пустоты нет.

          Десктоп не тронут: max-w-5xl держит контейнер на 984, и с 1024 разрез
          даёт те же колонки, что и до правки: 380 и 556 (984 − 380 − зазор
          lg:gap-12 в 48; 572 — это ещё при gap-8).

          Порог в sizes у обеих картинок героя сдвинут вместе с разрезом: между
          768 и 1024 арт теперь во всю ширину, и подсказка «380px» дала бы
          браузеру выбрать файл вдвое мельче слота.

          Приоритет у обложки тот же, что у подложки выше, и должен
          совпадать: запрос у них один, и ни одна из двух не имеет права
          сказать браузеру «можно позже».
        */}
        <div className="relative mx-auto max-w-5xl px-5 pt-28 pb-12 lg:pt-32 lg:pb-16 grid lg:grid-cols-[380px_1fr] gap-8 lg:gap-12 items-start">
          {/*
            Вторая половина пары морфа: капсула с полки перелетает сюда.
            Своего проявления (.anim-reveal) у обложки больше нет: оно
            начиналось с прозрачности и размытия, и морф приземлялся в пустое
            место — на кадре оставался размытый призрак. А при прямом заходе
            это LCP, и показывать его сразу только быстрее.
          */}
          <GameMorph appid={meta.appid}>
            <GameArt
              appid={meta.appid}
              name={meta.name}
              headerImage={meta.headerImage ?? null}
              art={coverArt}
              sizes="(min-width: 1024px) 380px, 100vw"
              eager
              fetchPriority="high"
              className="game-cover w-full aspect-[460/215] object-cover"
            />
          </GameMorph>
          <div className="flex flex-col gap-4 anim-rise">
            {/*
              Путь к игре через её главный жанр: «Игры по жанрам → Рогалики».
              Это выход «посмотреть ещё такого же» для человека и путь для
              краулера — и та же цепочка, что в крошках разметки выше: разметка
              не говорит больше, чем страница. Главного жанра нет — нет строки.
            */}
            {genre && (
              <nav aria-label={tr(locale, { ru: 'Жанр игры', en: 'Game genre' })} className="-mb-2 flex flex-wrap items-center gap-1.5">
                <Link href="/games" className="tap tap-tight link-more">
                  {tr(locale, { ru: 'Игры по жанрам', en: 'Games by genre' })}
                </Link>
                <Icon name="arrow" size={14} className="text-faint" />
                <Link href={genre.path} className="tap tap-tight link-more">
                  {genre.title}
                </Link>
              </nav>
            )}
            {/* Кегль — по длине имени: у 108-знаковых display-lg давал стену в
                восемь строк, и оценка с кнопками уходили за первый экран. И
                по самому широкому слову: «TROUBLESHOOTER:» в display-lg шире
                колонки, а рваться посреди слова ему незачем — ступенью ниже
                оно целое. Пороги и замеры — lib/titlesize */}
            <h1 lang={nameLang} className={heroTitleClass(meta.name)}>{meta.name}</h1>
            {/*
              Русское название магазина — вторым рядом, если оно у игры своё.
              Заголовок — английское, как в Steam (nameSql в lib/db), а по
              русскому игру ищут здесь: «Ведьмак 3: Дикая Охота» под «The
              Witcher 3: Wild Hunt». Без этой строки ~70 страниц верха
              каталога потеряли бы русское название вовсе — до правила двух
              названий оно стояло прямо в заголовке. Та же строка — в
              alternateName разметки, и по тому же правилу (pageNameRu).
            */}
            {nameRu && (
              <p className="-mt-2 text-dim text-lg [overflow-wrap:anywhere]">
                {nameRu}
              </p>
            )}
            {/*
              Студия и год. Оба поля заполнены у ВСЕХ игр каталога (1000 из
              1000, проверено запросом), а страница не показывала ни одного из
              них — при том что лента «Что нового» показывает эту же подпись
              под каждым патчем. То есть продукт знал, как это сказать, и
              говорил везде, кроме главной публичной страницы.

              Для вопроса «стоит ли играть» это самый быстрый опознавательный
              знак: «Gearbox Software · 1999» сразу говорит, что за вещь перед
              тобой, — быстрее тегов и раньше процента.

              MetaLine, а не свои классы: роль ровно её — строка фактов через
              разделитель.
            */}
            {/* typeof, а не голый meta.ccu: у игры без студии ноль онлайна
                иначе выпал бы в разметку литералом «0» вместо строки */}
            {(studio || typeof meta.ccu === 'number') && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {studio && <MetaLine>{studio}</MetaLine>}
                {/*
                  Живой онлайн есть у 563 игр из тысячи, и показывали его четыре
                  экрана — выдача, игра дня, колода пати и лента, — но не эта
                  страница. А «стоит ли играть» для мультиплеера решается именно
                  им: у игры 2011 года бывает и двести тысяч человек, и двести.

                  Часы — не момент рендера, а последний момент, когда этот
                  рендер ещё могут показать: страница живёт в кэше неделю
                  (revalidate выше), и «сейчас», верное при сборке, через день
                  было бы тем же неправдивым утверждением, ради которого
                  PlayersNow и спрашивает возраст замера. Замер свежее шести
                  часов на неделю вперёд не бывает, так что здесь всегда
                  «играли» и без пульса.

                  Поэтому часы — бесконечность, а не now + revalidate: вывод тот
                  же, но PlayersNow клиентский (язык — из useLocale), и его
                  пропсы лежат в RSC-части страницы. now + revalidate был бы
                  там новым числом на каждой перегенерации — и новой записью
                  ISR без единой видимой перемены. Бесконечность от часов не
                  зависит, и «сейчас» с ней не наступает никогда.
                */}
                <PlayersNow ccu={meta.ccu ?? null} ccuAt={meta.ccuAt} nowSec={Number.POSITIVE_INFINITY} />
              </p>
            )}
            {/*
              Оценка собирается из того, что есть (reviewFacts): все языки из
              сверки каталога — те же, что на плитках хабов и /play, — а пока
              сверка до игры не дошла, сводка карточки. Англоязычная шкала
              порогов сюда не выходит: «из 143 тыс.» у Hades при 309 тысячах.
              Раньше блок целиком висел на сводке, и почти треть страниц не
              отвечала на вопрос из собственного заголовка.

              Слово — только той же сводки, что числа. Проценты и количество мы
              пересказываем, а словесную шкалу Steam придумывать за неё нельзя;
              без слова рядом с кольцом остаётся «положительных из N отзывов»,
              и этого хватает — процент уже стоит внутри кольца.
            */}
            {facts && (
              <div className="flex items-center gap-3.5 text-sm">
                <ProgressRing
                  percent={facts.percent}
                  size={56}
                  stroke={4}
                  duration={800}
                  ariaLabel={reviewsLine(facts.percent, facts.total, locale)}
                />
                <div className="flex flex-col gap-0.5">
                  {/* Слово Steam: по-русски — ярлык русского магазина, по-английски —
                      официальный ярлык как есть (steamScoreLabel) */}
                  {facts.label && (
                    <span className="text-ember-text font-medium">
                      {steamScoreLabel(facts.label, locale)}
                    </span>
                  )}
                  {/* Было «из N отзывов — за»: «за» здесь значило «голосов
                      за», но читалось как обрубленное «за …» — будто строку
                      срезало на полуслове. Со словом Steam процент уже назван
                      дважды (кольцо и шкала), без него — называем сами. */}
                  <span className="tabular-nums text-dim text-xs">
                    <ReviewsTail total={facts.total} labelled={!!facts.label} locale={locale} />
                  </span>
                </div>
              </div>
            )}
            {/*
              Пульс отзывов — прямо под кольцом: последний месяц, когда он
              расходится со всем временем, и отзывы на русском (reviewPulse).
              Это то же «стоит ли играть», только про сейчас и про своих: «раньше
              ругали — сейчас хвалят» не видно ни по какому числу за всё время.
              dl, как у фактов ниже: пары «подпись — значение» скринридер
              читает парами.
            */}
            {pulse.length > 0 && (
              <dl className="-mt-1 flex flex-col gap-0.5 text-xs text-dim">
                {pulse.map((t) => (
                  <div key={t.label} className="flex flex-wrap gap-x-1.5">
                    <dt>{t.label}:</dt>
                    <dd className="tabular-nums text-ink/80">{t.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {/*
              Вердикт мёртвой игре — сразу под оценкой, выше тегов: это и есть
              ответ на вопрос из заголовка, а теги и описание — справка к нему.
              role="note": скринридер объявит его как примечание к карточке, а
              не как очередной абзац описания.
            */}
            {verdict && (
              <div role="note" className="panel-lift px-4 py-3 flex flex-col gap-1">
                <Eyebrow>{tr(locale, { ru: 'Сейчас не советуем', en: 'Not recommended right now' })}</Eyebrow>
                <p className="text-sm leading-relaxed">{verdict}</p>
              </div>
            )}
            {/* Жанры строкой через точку, как под названием у стриминга. Жанр
                со своей страницей — ссылка туда: «ещё таких» в одно касание */}
            {topTags.length > 0 && (
              <p className="text-sm font-semibold text-ink/80">
                {topTags.map((t, i) => {
                  const path = hubPath(t)
                  return (
                    <Fragment key={t}>
                      {i > 0 && ' · '}
                      {path ? (
                        <Link
                          href={path}
                          prefetch={false}
                          className="tap tap-tight underline decoration-1 underline-offset-4 decoration-ink/30 transition-colors hover:text-ink hover:decoration-ink"
                        >
                          {tagLabel(t, locale)}
                        </Link>
                      ) : (
                        tagLabel(t, locale)
                      )}
                    </Fragment>
                  )
                })}
              </p>
            )}
            {/*
              Чем игра выделяется и сколько длится заход — без модели: первое
              из редких тегов Steam (lib/hook), второе из семантики по тегам и
              отзывам (lib/semantics). Под тегами, потому что первая строка их
              и объясняет: из восьми чипсов — вот эти два про неё.

              Строки нет, когда сказать честно нечего: общие теги, непрогретая
              карта тегов, семантика по одним тегам (см. SESSION_MIN_CONFIDENCE).
              «Наиграли: ~8 ч — те, кто её хвалит» — из минут позитивных
              отзывов, только когда крон карточек их разобрал и у игры есть
              финал (lengthTrait). Последней — «Русский: …» по отметкам Steam
              (languageTrait), и только когда Steam про язык ответил: «не
              знаем» не равно «нет».
              dl, а не абзацы: это пары «подпись — значение», и скринридер
              читает их парами.
            */}
            {traits.length > 0 && (
              <dl className="flex flex-col gap-1 text-sm">
                {traits.map((t) => (
                  <div key={t.label} className="flex flex-wrap gap-x-2">
                    <dt className="text-dim">{t.label}:</dt>
                    <dd>{t.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {/* Описание у трёх карточек из четырёх английское (каталог берёт
                его у магазина по-английски, см. isRussianText). Без lang его
                читали русским голосом — латиницу по-русски. На /en описание
                только английское (descriptionFor), и lang решает textLangOn:
                кусок наследует lang="en" страницы. Русское правило — прежнее:
                всё не русское помечено английским. */}
            {about && (
              <p
                lang={locale === 'en' ? textLangOn(locale, about) : isRussianText(about) ? undefined : 'en'}
                className="text-dim leading-relaxed"
              >
                {about}
              </p>
            )}
            <div className="flex flex-wrap gap-3 mt-1">
              {storeHref ? (
                <a
                  href={storeHref}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ember px-6 py-3"
                >
                  {storeOpen ?? <>Открыть в {STORE_LABEL[meta.store ?? ''] ?? 'магазине'}</>}
                </a>
              ) : (
                <>
                  {/*
                    Главная кнопка — страница магазина, а не запуск.

                    «Запустить» (steam://run) стояла здесь у каждого: у гостя из
                    поиска и у вошедшего, у которого игры нет. Страница общая и
                    живёт на ISR, про сессию не знает — вот и предлагала запуск
                    всем. Теперь запуск дорисовывает OwnedLaunch и только
                    владельцу, а общая часть разметки говорит то, что верно для
                    любого читателя.

                    Мёртвой игре и магазин — справка, а не призыв: без заливки
                    и без запуска, спорить с собственным вердиктом кнопкой
                    незачем.
                  */}
                  <a
                    href={`https://store.steampowered.com/app/${appid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className={verdict ? 'btn-glass' : 'btn-ember px-6 py-3'}
                  >
                    {tr(locale, { ru: 'Страница в Steam', en: 'Steam page' })}
                  </a>
                  {!verdict && (
                    <OwnedLaunch
                      appid={appid}
                      name={meta.name}
                      finishable={!isReplayable(meta)}
                      follow={data.similar.length > 0}
                      near={nearAsk}
                      className="btn-glass"
                    />
                  )}
                </>
              )}
              {/* Поиск — на языке страницы: «обзор» нашёл бы англоязычному
                  русские ролики */}
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                  tr(locale, { ru: `${meta.name} обзор`, en: `${meta.name} review` }),
                )}`}
                target="_blank"
                rel="noreferrer"
                className="btn-glass"
              >
                <Icon name="play" size={16} />
                {tr(locale, { ru: 'Обзоры на YouTube', en: 'YouTube reviews' })}
              </a>
              {/*
                «Позвать в эту игру» — комната с ней первой картой
                (roomSeedHref). Карточку игры чаще всего открывают, чтобы
                скинуть друзьям, и «го в неё?» уходило в чат голой ссылкой на
                Steam: дальше договаривались словами. Теперь та же ссылка —
                пати с артом и колодой на случай, если не зайдёт.

                Только у игры, которую комната возьмёт (seedable в
                lib/roomseed): сетевая, живая, не вытесненная преемником.
                Живая — для компании, а не только для одного: у сетевой игры
                с одиночной кампанией и пустыми серверами вердикта выше нет,
                а колода пати её снимет. У мёртвой кнопки нет и так — звать в
                пустой матчмейкинг значит спорить с вердиктом выше. Сессии странице знать не нужно:
                адрес один на всех, ISR не тронут; свой бан хоста проверит уже
                создание комнаты. Стекло, а не заливка: главное действие здесь —
                магазин, пати — второе.
              */}
              {seedable(meta) && (
                <Link href={roomSeedHref(appid)} prefetch={false} className="btn-glass">
                  <Icon name="users" size={16} />
                  {tr(locale, { ru: 'Позвать в эту игру', en: 'Invite to this game' })}
                </Link>
              )}
              {/* Бесплатная игра тоже получает плашку. Условие было «цена больше
                  нуля», и у free-to-play — а это Dota, CS2, Warframe, то есть
                  верх каталога по онлайну — в герое не оказывалось ни цены, ни
                  слова «бесплатно». Читалось это не как «платить не надо», а
                  как «про цену мы ничего не знаем» — то есть ровно тот вопрос,
                  на который страница с заголовком «стоит ли играть» и должна
                  отвечать. PriceTag такой случай умел с самого начала. */}
              {/* «Не продаётся в российском Steam» — тоже ответ на вопрос о
                  цене, и плашка для него рисуется так же, как для цены */}
              {(meta.isFree || meta.storeHidden || (price !== null && price > 0)) && (
                <PriceLine until={dealUntil}>
                  {/* Цена — строкой рядом с кнопками, а не стеклянной плашкой
                      их формы: в ряду кнопок плашка притворялась ещё одной
                      кнопкой */}
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm">
                    <PriceTag
                      priceFinal={price}
                      cc={meta.priceCc ?? null}
                      unsold={meta.storeHidden}
                      isFree={meta.isFree}
                      discount={deal}
                      size="hero"
                    />
                    <DiscountEnds discount={deal} />
                    {/* Чья это цена: у KZ и СНГ-доллара она другая. Только у
                        цены — «бесплатно» и «не продаётся» говорят сами */}
                    {!meta.isFree && !meta.storeHidden && price !== null && price > 0 && (
                      <PriceWhere cc={meta.priceCc} />
                    )}
                  </span>
                </PriceLine>
              )}
              {/* Погасшая распродажа: само акционное число прячет
                  trustedPrice, а обычную цену той же пары называем — с
                  подписью, потому что текущий ценник (обычный или продлённой
                  акции) отсюда не узнать. Без неё герой молчал о цене, хотя
                  «Steam возвращает деньги» под кнопками стоял. Без ShownUntil:
                  срока у этой строки нет, её снимает перезамер цены.

                  Подпись — видимым текстом, а не title: подсказку при
                  наведении не видят ни на телефоне, ни скринридером, а без
                  неё «обычная цена» читалась бы как «сейчас столько». И
                  правдивая в обоих случаях, что прячет trustedPrice: срок
                  акции вышел (её могли и продлить) или замер без срока
                  протух — кончилась ли скидка, отсюда не узнать */}
              {!meta.isFree && !meta.storeHidden && regular !== null && (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm">
                  <span className="text-dim">{tr(locale, { ru: 'обычная цена', en: 'regular price' })}</span>
                  {/* бесплатной строки здесь не бывает — её отсекает условие выше */}
                  <PriceTag priceFinal={regular} cc={meta.priceCc ?? null} isFree={false} size="hero" />
                  <PriceWhere cc={meta.priceCc} />
                  <span className="basis-full text-xs text-dim">
                    {tr(locale, {
                      ru: 'Цену сняли во время скидки, а идёт ли она ещё, мы не знаем — в Steam может быть дешевле',
                      en: "We checked this price during a sale and don't know if the sale is still on — it may be cheaper on Steam",
                    })}
                  </span>
                </span>
              )}
            </div>
            {refund && <RefundNote tone="neutral" />}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-5 pb-16 flex flex-col gap-10">
        {/*
          Как игра выглядит в движении — первым под героем, раньше мнений о
          ней: «стоит ли играть» начинается с того, что это вообще такое, а
          единственным способом увидеть это была ссылка на YouTube в герое.

          Микротрейлер Steam, несколько секунд без звука. Ничего не качается,
          пока не нажали, и постер ленивый — см. TrailerPreview. Страница живёт
          на ISR, а островок клиентский и про кэш ничего не знает.
        */}
        {meta.trailer && (
          <section>
            <SectionLabel className="mb-4">{tr(locale, { ru: 'В движении', en: 'In motion' })}</SectionLabel>
            <TrailerPreview
              trailer={meta.trailer}
              name={meta.name}
              // Телефону — кадр 600×338 вместо movie_full 1920×1080: тот же
              // файл, что берёт блок «Скриншоты» ниже (см. TrailerPreview)
              smallPoster={meta.screenshots?.[0] ? shotUrl(meta.screenshots[0], 'small') : undefined}
              className="max-w-3xl"
            />
          </section>
        )}

        {/* pros / cons из реальных отзывов */}
        {/* Сюда доходит только собранное моделью — эвристику отсекает
            loadGamePage, там же объяснено почему. На /en — только английский
            слот: нет его — prosCons null, и блока нет вместе с подписью «Summarized
            by AI…», а не русский блок на английской странице. */}
        {/*
          ХВАЛА И КРИТИКА ОДНОГО ВЕСА.
          Панели стояли парой, а набраны были по-разному: у «любят»
          надзаголовок акцентом, текст --ink/90 и плюс акцентом, у «ругают» —
          всё в --dim. Замерено в браузере: 16.73:1 против 6.00:1, то есть
          критика читалась втрое тише похвалы. На странице, которая называется
          «стоит ли играть» и рядом с кнопкой покупки и скидкой −67%.
          Это оформление, спорящее с обещанием продукта: «рекомендация — это
          доверие, а доверие не продаётся».
          Различают панели теперь заголовок и знак, а не громкость. Цветовой
          валентности нет ни у одной: зелёного и красного в палитре нет
          намеренно — то же правило записано в колоде пати. Заодно ember у
          «любят» был единственным акцентным надзаголовком на странице, где
          все остальные разделы набраны обычным SectionLabel.
        */}
        {prosCons && (prosCons.pros.length > 0 || prosCons.cons.length > 0) && (
          <section className="grid md:grid-cols-2 gap-4">
            {prosCons.pros.length > 0 && (
              <div className="panel-lift p-6 anim-rise">
                <SectionLabel className="mb-3">{tr(locale, { ru: 'За что любят', en: 'Loved for' })}</SectionLabel>
                <ul className="space-y-2 text-sm text-ink/90">
                  {prosCons.pros.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <span className="text-faint">+</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {prosCons.cons.length > 0 && (
              <div className="panel-lift p-6 anim-rise" style={{ animationDelay: '80ms' }}>
                <SectionLabel className="mb-3">{tr(locale, { ru: 'За что ругают', en: 'Criticized for' })}</SectionLabel>
                <ul className="space-y-2 text-sm text-ink/90">
                  {prosCons.cons.map((c) => (
                    <li key={c} className="flex gap-2.5">
                      <span className="text-faint">−</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Ветка «Цитаты из отзывов» ушла вместе с показом эвристики:
                сюда доходит только собранное моделью. */}
            <p className="md:col-span-2 text-[11px] text-faint">
              {tr(locale, {
                ru: 'Собрано ИИ из самых полезных отзывов Steam',
                en: 'Summarized by AI from the most helpful Steam reviews',
              })}
            </p>
          </section>
        )}

        {/* что нового — здесь показываем и мелкие патчи тоже,
            фильтр «только крупные» действует лишь в общей ленте */}
        {data.news.length > 0 && (
          <section>
            <SectionLabel className="mb-4">{tr(locale, { ru: 'Что нового', en: "What's new" })}</SectionLabel>
            <GameNews items={data.news} name={meta.name} />
            {/*
              Архив обновлений (/game/<appid>/news) — все патчи, что держит
              ретенция, а карточка показывает восемь. Ссылка — только когда
              патчей у игры больше, чем мест (newsMore, cardPatches в
              lib/gamepage): при восьми и меньше все они уже здесь, и архив
              повторил бы эти строки. Полная лента об этом не говорит —
              восемь из восьми и восемь из тридцати выглядят одинаково. Без
              префетча: архив на ISR и рендерится по первому заходу, а
              карточку смотрят тысячи раз.
            */}
            {data.newsMore && (
              <Link href={patchArchivePath(appid)} prefetch={false} className="tap link-more mt-4">
                {withForeignRuns(locale, tr(locale, { ru: `Все обновления «${meta.name}»`, en: `All ${meta.name} updates` }), [meta.name])}
                <Icon name="arrow" size={16} />
              </Link>
            )}
          </section>
        )}

        {/* скриншоты */}
        {meta.screenshots && meta.screenshots.length > 0 && (
          <section>
            <SectionLabel className="mb-4">{tr(locale, { ru: 'Скриншоты', en: 'Screenshots' })}</SectionLabel>
            {/* сколько кадров показывать, решает сам блок: это упирается в
                бюджет видеопамяти слайдера, а не в вёрстку страницы */}
            <GameShots images={meta.screenshots} name={meta.name} />
          </section>
        )}

        {/* Похожие: единственная перелинковка между пятью тысячами карточек.
            До неё страница была тупиком — из поиска сюда приходили и упирались
            в ссылку на /play, которая гостя разворачивала на лендинг.
            Соседи — в основном хвост каталога вне PRERENDER_TOP, поэтому
            GameLink без префетча: шесть холодных рендеров с записью ISR на
            каждый просмотр карточки, до которой доскроллили, — не цена за
            шесть ссылок, по которым уйдут в лучшем случае по одной. */}
        {/* Свои из этих же соседей — над ними: до покупки сначала то, что
            уже лежит на полке. Разметка ISR пуста, строку дорисовывает
            островок по ответу владения (lib/ownednear) */}
        {nearAsk && <OwnedNear appid={appid} />}
        {data.similar.length > 0 && (
          <section>
            <SectionLabel className="mb-4">
              {tr(locale, { ru: 'Похожие', en: 'Similar games' })}
              {data.similarTag ? <> · {tagLabel(data.similarTag, locale)}</> : null}
            </SectionLabel>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-6">
              {data.similar.map((g) => (
                <GameLink
                  key={g.appid}
                  appid={g.appid}
                  transitionTypes={['nav-forward']}
                  className="game-card block"
                >
                  <GameCardBody
                    morph
                    appid={g.appid}
                    name={g.name}
                    headerImage={g.headerImage}
                    // плитка — вариант card: hero и постеры ей не нужны
                    art={trimArt(g.art)}
                    sizes="(min-width: 768px) 33vw, 50vw"
                    /* Чем похожи — у готовых соседей: заголовок блока у них без
                       тега, и без этой строки «похожие» было бы голословным.
                       Строка режется по ширине плитки, и английская не шире
                       русской: «shared:», а не «in common:» — замер на десяти
                       парах частых тегов, «in common:» выходил шире «общее:»
                       на двух из них, «shared:» уже на всех */
                    meta={
                      g.shared && g.shared.length > 0 ? (
                        <span className="truncate">
                          {tr(locale, { ru: 'общее: ', en: 'shared: ' })}
                          {g.shared
                            .slice(0, 2)
                            .map((t) => tagLabel(t, locale))
                            .join(', ')}
                        </span>
                      ) : undefined
                    }
                  />
                </GameLink>
              ))}
            </div>
            {/* Под сеткой, внутри её секции: отдельная секция добавила бы ещё
                один межблочный отступ над кнопкой ниже */}
            {data.studio && <StudioLinks studio={data.studio} locale={locale} className="mt-6" />}
          </section>
        )}
        {/* Полки нет (у игры нет тегов), а игры студии есть — строка сама по себе */}
        {data.similar.length === 0 && data.studio && <StudioLinks studio={data.studio} locale={locale} />}

        {/* /quiz, а не /play: страница кэшируется на неделю и пререндерится, то
            есть про сессию тут знать нечего. Гостя /play разворачивал на
            лендинг через экран прогрева, а квиз работает обоим — участник
            выбирает настроение и попадает в ту же выдачу. */}
        {/*
          Настоящая кнопка, а не подпись.

          Замер на проде, Cyberpunk 2077: из двенадцати ссылок страницы пять
          уводят наружу — в Steam и на YouTube, — шесть ведут на соседние
          карточки, и РОВНО ОДНА ведёт в продукт. Она же была единственной без
          подложки, цветом --dim и видимой высотой 18px (зону пальца ей
          добавлял .tap, но не вид), то есть самой тихой на странице. Две
          заметные кнопки уводили со страницы, самая тихая — внутрь.

          Это точка конверсии всей поисковой воронки: пять тысяч карточек
          существуют затем, чтобы человек, спросивший «стоит ли играть»,
          получил ответ и остался. Соседняя правка (свёрнутые патчи) подняла
          её с 96% глубины страницы примерно до половины; вес — вторая
          половина того же вопроса.

          Ember тут не спорит с «Страница в Steam»: та кнопка лежит пятью
          экранами выше, и на своём месте каждая единственная.
        */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          {/* btn-ember — тот же класс и размер, что у «Страница в Steam» выше:
              вид парадной кнопки на сайте один, и своя заливка здесь
              разъехалась бы с ним на первой же правке. */}
          <Link href="/quiz" className="btn-ember px-6 py-3">
            {tr(locale, { ru: 'Подобрать игру под настроение ', en: 'Find a game for your mood ' })}
            <Icon name="arrow" className="ml-1.5 inline-block align-[-0.125em]" />
          </Link>
          {/*
            «Как «X», но…» отсюда. Человек, дочитавший карточку, часто хочет
            не эту игру, а такую же — а до сих пор «похожие» были только
            шестью ссылками на другие карточки, и под настроение их было не
            подобрать: затравка жила лишь кнопкой у героя /play, то есть
            «хочу как Hades» не работало, пока Hades сам не выпадет героем.
            Ссылка ведёт в квиз с затравкой (quizHref): настроение спросит он,
            гость пройдёт через вход как обычно, и выдача будет из соседей
            этой игры. Адрес один на всех — разметка ISR не зависит от того,
            кто смотрит. Только там, где соседи есть, — по той же полке,
            из которой их берёт и выдача (nearGames): без неё ссылка вела бы
            к экрану «похожих не нашлось». Той же мерой решается и «Дальше — в
            духе X» после «Уже прошёл» наверху (OwnedLaunch, follow).
          */}
          {data.similar.length > 0 && (
            <Link href={quizHref(null, appid)} className="tap link-more">
              {locale === 'en' ? (
                <>Similar to “{nameRun}”, for your mood</>
              ) : (
                <>Похожее на «{meta.name}» — под моё настроение</>
              )}
              <Icon name="arrow" size={16} />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
