import type { Metadata, ResolvingMetadata } from 'next'
import Link from '@/components/Link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { GameArt } from '@/components/GameArt'
import { Icon } from '@/components/Icon'
import { Eyebrow, SectionLabel } from '@/components/Labels'
import { LinkPending } from '@/components/LinkPending'
import { NewsDate, ScaleBadge } from '@/components/NewsMeta'
import { trimArt } from '@/lib/art'
import { dateLabel } from '@/lib/freshness'
import { lp, pl, toLocale, tr, type Locale } from '@/lib/i18n'
import { archiveBreadcrumbLd, archiveCrumb, ldScript } from '@/lib/jsonld'
import { navPrefetch } from '@/lib/nav'
import { newsHeading } from '@/lib/newspage'
import { archiveIndexable, patchArchivePath, type ArchiveItem } from '@/lib/patcharchive'
import { appBaseUrl } from '@/lib/server'
import { localeAlternates, ogSite } from '@/lib/site'
import { textLangOn } from '@/lib/textlang'
import { loadArchive } from './load'
import { archiveDescriptionOn, archiveHeading, archiveMonthsOn, archiveTitleOn } from './page.copy'

/**
 * Архив обновлений игры: все её патчи, что держит ретенция, по месяцам —
 * с датой, масштабом и пересказом. Зачем и что из этого идёт в поиск — в
 * lib/patcharchive.
 *
 * Только серверная разметка: ни одной кнопки раскрытия, тело патча живёт на
 * его странице. Островков два: свет игры за шапкой, как у страницы патча, и
 * мерцание подписи моста «Что нового» (LinkPending).
 *
 * На /en — те же строки по-английски: пересказ и заголовок loadArchive отдаёт
 * уже на языке страницы (английского пересказа нет — нет и строки пересказа),
 * тексты страницы — page.copy.ts. В индекс /en идёт по тому же правилу
 * (archiveIndexable), только считает английские пересказы: ссылку заголовка
 * на /en даёт лишь английский.
 *
 * Сутки на ISR — как у страницы патча: список меняет только крон новостей, и
 * его новые патчи и пересказы сбрасывают адрес сами (resetSliceCards с
 * archives в lib/gamecache), не дожидаясь суток.
 */
export const revalidate = 86_400

/**
 * Пустой список, и он обязателен — тот же довод, что у страницы патча: без
 * generateStaticParams сегмент не попадает в dynamicRoutes манифеста, и
 * revalidate выше не значит ничего. Пустой — на сборке не рендерим ни одного
 * архива: игр с патчами сотни, заходят на единицы.
 */
export async function generateStaticParams(): Promise<Array<{ appid: string }>> {
  return []
}

type Params = { params: Promise<{ appid: string; lang?: string }> }

/**
 * alt карточки игры на /en — тот же, что ставит сама карточка игры (EN_CARD в
 * ../page.tsx): файловая карточка сегмента выше несёт alt своего модуля, один
 * на все языки, то есть русский.
 */
const EN_CARD_ALT = 'Is it worth playing? — imbored'

export async function generateMetadata({ params }: Params, parent: ResolvingMetadata): Promise<Metadata> {
  const { appid, lang } = await params
  const locale = toLocale(lang)
  const archive = await loadArchive(appid, locale)
  if (!archive) return {}
  const { game, items } = archive
  const title = archiveTitleOn(game.name, locale)
  const description = archiveDescriptionOn(game.name, items, locale)
  const canonical = patchArchivePath(archive.appid)
  /*
   * Своей карточки для чатов у архива нет — он показывает карточку игры
   * (opengraph-image.tsx сегмента выше). Свой openGraph заменяет унаследованный
   * целиком, вместе с картинкой, поэтому её берём у родителя как есть — тот же
   * приём, что у ownAddress в lib/site. На /en — с английским alt: адрес,
   * размеры и тип остаются от файла.
   */
  const inherited = (await parent).openGraph?.images
  const images =
    locale === 'en' && inherited?.length
      ? inherited.map((img) => (typeof img === 'object' && !(img instanceof URL) ? { ...img, alt: EN_CARD_ALT } : img))
      : inherited
  return {
    title,
    description,
    alternates: localeAlternates(locale, canonical),
    ...(archiveIndexable(items, game.listed) ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      ...ogSite(locale),
      type: 'website',
      url: lp(locale, canonical),
      title,
      description,
      ...(images?.length ? { images } : {}),
    },
  }
}

export default async function PatchArchivePage({ params }: Params) {
  const { appid: raw, lang } = await params
  // Адреса в разметке — на языке страницы, как её canonical
  const locale = toLocale(lang)
  /*
   * notFound() даёт настоящий 404 потому же, почему у карточки игры и
   * страницы патча: над страницей нет границы Suspense. Каркас сюда не
   * добавлять, см. lib/firstpaint.test.ts.
   */
  const archive = await loadArchive(raw, locale)
  if (!archive) notFound()
  const { appid, game, items } = archive
  const gameHref = `/game/${appid}`
  const n = items.length
  const months = archiveMonthsOn(items, locale)
  const baseUrl = appBaseUrl()
  const steamNews = `https://store.steampowered.com/news/app/${appid}`
  const told = items.some((i) => i.tldr?.trim())

  return (
    <div className="relative flex-1 overflow-x-clip">
      {/* Крошки — тот же путь, что строкой над заголовком */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldScript(archiveBreadcrumbLd({ appid, gameName: game.name, baseUrl, locale })),
        }}
      />
      {/* Свет игры за шапкой — как у страницы патча: архив — продолжение
          её карточки. Срезанный арт: островку нужны две картинки, а не пять */}
      <div aria-hidden className="news-glow">
        <GameArt
          appid={appid}
          name=""
          headerImage={game.headerImage}
          art={trimArt(game.art)}
          sizes="460px"
          fallback={null}
          className="h-full w-full object-cover"
        />
      </div>
      <article className="relative mx-auto flex w-full max-w-3xl flex-col gap-10 px-safe pt-28 pb-16">
        <header className="flex flex-col gap-4 anim-rise">
          <nav
            aria-label={tr(locale, { ru: 'Путь к обновлениям', en: 'Path to updates' })}
            className="flex flex-wrap items-center gap-1.5"
          >
            <Link href={gameHref} transitionTypes={['nav-back']} className="tap tap-tight link-more">
              {game.name}
            </Link>
            <Icon name="arrow" size={14} className="text-faint" />
            <span aria-current="page" className="text-sm font-semibold text-ink">
              {archiveCrumb(locale)}
            </span>
          </nav>
          <Eyebrow as="p">{tr(locale, { ru: 'Что изменилось', en: 'What changed' })}</Eyebrow>
          {/* Кегль уже ступенью ниже, display-md, а перенос внутри слова —
              последний рубеж, как у героя карточки: «Touhou Hero of Ice
              Fairy» набран через U+00A0 и на 360 шире колонки даже здесь, а
              кавычки прилипают к первому и последнему слову и делают кусок
              ещё шире. Под overflow-x-clip он бы срезался у края, а не
              переносился. Замеры — lib/titlesize */}
          <h1 className="font-display text-display-md [overflow-wrap:anywhere]">{archiveHeading(game.name, locale)}</h1>
          {/* Глубина — честно: тридцать последних ПОСТОВ игры, а не вся её
              история; у часто патчащихся это месяц-два. Английская фраза —
              своя целиком: даты без «г.», и точка после срока ставится всегда */}
          {locale === 'en' ? (
            <p className="leading-relaxed text-dim">
              {n} {pl(locale, n, { ru: ['патч', 'патча', 'патчей'], en: ['patch', 'patches'] })}
              {n > 1
                ? ` — ${dateLabel(items[n - 1]!.publishedAt, { year: true, locale })} to ${dateLabel(items[0]!.publishedAt, { year: true, locale })}`
                : ''}
              . Anything older is in the{' '}
              <SteamNewsLink href={steamNews}>game&apos;s news on Steam</SteamNewsLink>
              .{told && ' Summaries are written by AI from the patch notes.'}
            </p>
          ) : (
            <p className="leading-relaxed text-dim">
              {n} {pl(locale, n, { ru: ['патч', 'патча', 'патчей'], en: ['patch', 'patches'] })}
              {n > 1
                ? ` — с ${dateLabel(items[n - 1]!.publishedAt, { year: true })} по ${dateLabel(items[0]!.publishedAt, { year: true })}`
                : ''}
              {/* «г.» у даты уже с точкой — вторая не нужна */}
              {n > 1 ? ' ' : '. '}
              Что старше — в{' '}
              <SteamNewsLink href={steamNews}>новостях игры в Steam</SteamNewsLink>
              .{/* Подпись — только там, где пересказ правда стоит: у списка из
                  одних хотфиксов её не за что ставить */}
              {told && ' Пересказы собраны ИИ по тексту патчей.'}
            </p>
          )}
        </header>

        {months.map((m) => (
          <section key={m.key} aria-labelledby={`m-${m.key}`} className="flex flex-col gap-2">
            <SectionLabel as="h2" className="mb-1">
              <span id={`m-${m.key}`}>{m.label}</span>
            </SectionLabel>
            <ol className="flex flex-col">
              {m.items.map((item) => (
                <Row key={item.gid} item={item} gameName={game.name} locale={locale} />
              ))}
            </ol>
          </section>
        ))}

        {/* Тот же мост «а у меня?», что внизу страницы патча: архив одной
            игры — а то же самое собирается по всей своей библиотеке. Страница
            в ISR и сессию не читает, поэтому строка одна на всех. И так же
            без префетча: /whatsnew собирается на каждый запрос (lib/nav,
            DYNAMIC_SECTIONS), а паузу перехода закрывает мерцание подписи
            (LinkPending) — как у той же ссылки в шапке и на странице патча.
            Английская фраза — та же, что у страницы патча: ссылка в ней —
            подлежащее («What's new has…») */}
        <p className="text-sm leading-relaxed text-dim">
          {tr(locale, { ru: 'А что изменилось в твоих играх?', en: 'What changed in your games?' })}{' '}
          <Link
            href="/whatsnew"
            prefetch={navPrefetch('/whatsnew')}
            className="tap tap-tight font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
          >
            <LinkPending>{tr(locale, { ru: 'Что нового', en: "What's new" })}</LinkPending>
          </Link>{' '}
          {tr(locale, {
            ru: '— крупные патчи твоей библиотеки одной лентой.',
            en: 'has the major patches from your library in one feed.',
          })}
        </p>
      </article>
    </div>
  )
}

/** Ссылка на ленту новостей игры в Steam — за тем, что старше ретенции */
function SteamNewsLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="tap tap-tight underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
    >
      {children}
    </a>
  )
}

/**
 * Строка архива: дата и масштаб первыми, затем пересказ, затем заголовок.
 *
 * Не заголовком вперёд, как на карточке игры: в архиве строки читают
 * подряд, а заголовок Steam у патчей одной игры часто один и тот же — у CS2
 * их восемнадцать «Обновление Counter-Strike 2» (F78 аудита). Различает их
 * дата и пересказ.
 *
 * Заголовок — ссылкой на страницу патча, только если она в поиске
 * (indexedNewsPath, как на карточке игры); иначе — текстом и ссылкой на
 * оригинал в Steam. Без префетча: тридцать ссылок в экране будили бы
 * функцию на каждую.
 */
function Row({ item, gameName, locale }: { item: ArchiveItem; gameName: string; locale: Locale }) {
  const heading = newsHeading(item.title, gameName)
  // Чужой язык заголовка — своим lang (lib/textlang): английский на русской
  // странице, русский на /en; имя игры в подсчёт не входит
  const lang = textLangOn(locale, heading, gameName)
  return (
    <li className="flex flex-col gap-1.5 border-b border-rule py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <NewsDate at={item.publishedAt} locale={locale} />
        <ScaleBadge scale={item.scale} locale={locale} />
      </div>
      {item.tldr?.trim() && <p className="leading-relaxed text-ink/90">{item.tldr.trim()}</p>}
      {item.href ? (
        <Link
          href={item.href}
          prefetch={false}
          lang={lang}
          className="tap tap-tight self-start text-sm font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
        >
          {heading}
        </Link>
      ) : (
        <p className="text-sm text-dim">
          <span lang={lang}>{heading}</span>
          {' · '}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="tap tap-tight underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
          >
            {tr(locale, { ru: 'в Steam', en: 'on Steam' })}
          </a>
        </p>
      )}
    </li>
  )
}
