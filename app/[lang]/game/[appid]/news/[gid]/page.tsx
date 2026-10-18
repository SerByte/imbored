import type { Metadata } from 'next'
import Link from '@/components/Link'
import { notFound } from 'next/navigation'
import { GameArt } from '@/components/GameArt'
import { Icon } from '@/components/Icon'
import { Eyebrow, SectionLabel } from '@/components/Labels'
import { ForeignBody, NewsBody } from '@/components/NewsBody'
import { NewsDate, ScaleBadge } from '@/components/NewsMeta'
import { PatchShare } from '@/components/PatchShare'
import { getGamePatchHeads } from '@/lib/db'
import {
  newsDescription,
  newsHeading,
  newsIndexable,
  newsPageTitle,
  newsPath,
  newsTitleOn,
} from '@/lib/newspage'
import { patchArticleLd, patchBreadcrumbLd, ldScript } from '@/lib/jsonld'
import { appBaseUrl, getDb } from '@/lib/server'
import { lp, toLocale, tr } from '@/lib/i18n'
import { localeAlternates, ogSite } from '@/lib/site'
import { textLangOn } from '@/lib/textlang'
import { loadPatch } from './load'

/**
 * Страница одного патча: пересказ, тело поста и ссылка на оригинал.
 * Зачем свой адрес и что из этого идёт в поиск — в lib/newspage.
 *
 * На /en — те же блоки по-английски: пересказ и тело loadPatch отдаёт уже на
 * языке страницы (английского нет — нет и блока), заголовок поста —
 * newsTitleOn (titleEn, английский заголовок или «{Game} update»). В индекс
 * /en идёт только с английским пересказом: newsIndexable судит item.tldr
 * своего языка.
 *
 * Сутки на ISR — свой срок, а не срок карточки игры (у той неделя и сброс из
 * кронов, lib/gamecache): пост меняет только крон новостей, и редко — тело
 * правят раз-другой после публикации, пересказ пишется однажды.
 */
export const revalidate = 86_400

/**
 * Пустой список, и он обязателен: без generateStaticParams динамический
 * сегмент не попадает в dynamicRoutes манифеста, revalidate выше не значит
 * ничего, и каждый заход рендерится заново (тот же довод — у карточки игры).
 * Пустой — значит на сборке не предрендерим ни одного поста: их тысячи, а
 * заходят на единицы. Каждый рендерится при первом заходе и живёт сутки
 * (docs: generate-static-params, «All paths at runtime»).
 */
export async function generateStaticParams(): Promise<Array<{ appid: string; gid: string }>> {
  return []
}

type Params = { params: Promise<{ appid: string; gid: string; lang?: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { appid, gid, lang } = await params
  const locale = toLocale(lang)
  const page = await loadPatch(appid, gid, locale)
  if (!page) return {}
  const { item, game } = page

  // С датой, если заголовок патчи игры не различает: у CS2 все они —
  // «Обновление Counter-Strike 2» (см. newsPageTitle)
  const title = newsPageTitle(newsTitleOn(item, game?.name, locale), game?.name, item.publishedAt, locale)
  const description = newsDescription(item, game?.name, locale)
  const canonical = newsPath(item.appid, item.gid)
  /*
   * Картинки здесь нет намеренно: у патча своя карточка (opengraph-image.tsx
   * рядом), и Next подставляет её сам — но только пока у openGraph этого
   * уровня нет своего ключа images. Раньше здесь передавалась картинка
   * родителя, и патч разворачивался в чате карточкой игры — «СТОИТ ЛИ
   * ИГРАТЬ» вместо того, что изменилось.
   */

  return {
    title,
    description,
    alternates: localeAlternates(locale, canonical),
    ...(newsIndexable(item.tldr, game?.listed ?? false)
      ? {}
      : { robots: { index: false, follow: true } }),
    openGraph: {
      ...ogSite(locale),
      type: 'article',
      url: lp(locale, canonical),
      title,
      description,
      publishedTime: new Date(item.publishedAt * 1000).toISOString(),
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** Сколько соседних патчей показать внизу: перелинковка, а не архив */
const OTHERS = 6

export default async function PatchPage({ params }: Params) {
  const { appid: rawAppid, gid: rawGid, lang } = await params
  // Адреса в разметке — на языке страницы, как её canonical
  const locale = toLocale(lang)
  /*
   * notFound() даёт настоящий 404 потому же, почему у карточки игры: над
   * страницей нет границы Suspense — ни loading.tsx, ни своей. Каркас сюда
   * не добавлять, см. lib/firstpaint.test.ts.
   */
  const page = await loadPatch(rawAppid, rawGid, locale)
  if (!page) notFound()
  const { item, game } = page

  const others = (await getGamePatchHeads(await getDb(), item.appid, OTHERS + 1))
    .filter((h) => h.gid !== item.gid)
    .slice(0, OTHERS)
  const gameHref = `/game/${item.appid}`
  // Заголовок поста на языке страницы: русский заголовок издателя на /en не
  // показывается — его место занимает titleEn или «{Game} update» (newsTitleOn)
  const titleOn = newsTitleOn(item, game?.name, locale)
  const heading = newsHeading(titleOn, game?.name)

  const baseUrl = appBaseUrl()

  return (
    <div className="relative flex-1 overflow-x-clip">
      {/* Статья и крошки — из того же, что на экране (lib/jsonld): заголовок
          как в h1, «Коротко», кадр, ссылка назад на игру, оригинал */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldScript([
            patchArticleLd({ item, game, baseUrl, locale }),
            patchBreadcrumbLd({ item, game, baseUrl, locale }),
          ]),
        }}
      />
      {/*
        Свет игры за шапкой патча — тот же приём и тот же лёгкий файл, что
        у героя страницы игры (размытая капсула, а не library_hero): патч —
        продолжение её карточки, и открываться он должен в её цвете.
      */}
      {game && (
        <div aria-hidden className="news-glow">
          <GameArt
            appid={item.appid}
            name=""
            headerImage={game.headerImage}
            art={game.art}
            sizes="460px"
            fallback={null}
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <article className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-safe pt-28 pb-16">
        <header className="flex flex-col gap-4 anim-rise">
          {/* Игры в каталоге может не быть (пост пришёл по чьей-то
              библиотеке) — тогда и её карточки нет, и ссылаться некуда */}
          {game && (
            <Link href={gameHref} transitionTypes={['nav-back']} className="tap tap-tight link-more self-start">
              <Icon name="back" size={16} />
              {game.name}
            </Link>
          )}
          <Eyebrow as="p">{tr(locale, { ru: 'Что изменилось', en: 'What changed' })}</Eyebrow>
          {/* Заголовок и тело — текст издателя, обычно английский, а
              страница — lang="ru". Без пометки скринридер читал бы латиницу
              русским голосом (WCAG 3.1.2), см. lib/textlang; на /en чужим
              становится русский. Тело помечает NewsBody сам; пересказ
              «Коротко» наш и на языке страницы — без пометки.
              Название игры в подсчёт не входит: «Обновление Counter-Strike 2»
              — русский заголовок с именем собственным, а не английский. */}
          <h1 lang={textLangOn(locale, heading, game?.name)} className="font-display text-display-md">
            {heading}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <NewsDate at={item.publishedAt} locale={locale} />
            <ScaleBadge scale={item.scale} locale={locale} />
          </div>
        </header>

        {/* Пересказ — то, ради чего у страницы вообще есть адрес. Подпись
            честная, как у «За что любят» на карточке: это собрала модель, а
            ниже — текст издателя без изменений. */}
        {item.tldr && (
          <section className="panel-lift flex flex-col gap-2 p-5 md:p-6">
            <SectionLabel as="h2">{tr(locale, { ru: 'Коротко', en: 'In short' })}</SectionLabel>
            <p className="leading-relaxed text-ink/90">{item.tldr}</p>
            <p className="text-[11px] text-faint">
              {tr(locale, { ru: 'Пересказ собран ИИ по тексту патча', en: 'Summarized by AI from the patch notes' })}
            </p>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <SectionLabel as="h2">{tr(locale, { ru: 'Патч целиком', en: 'Full patch notes' })}</SectionLabel>
          {item.imageUrl && (
            // Кадр поста из RSS Steam, как в ленте (PatchRow, Cover). Не
            // next/image по той же причине, что в NewsBody: пришлось бы
            // открывать remotePatterns на весь CDN
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt=""
              decoding="async"
              className="w-full rounded-[var(--radius-card)] border border-edge object-cover"
            />
          )}
          {item.blocks.length > 0 ? (
            <NewsBody blocks={item.blocks} locale={locale} />
          ) : locale === 'en' ? (
            // На /en пустое тело — почти всегда не английское (loadPatch его
            // не отдаёт): та же строка, что в раскрытой строке ленты
            <ForeignBody locale={locale} />
          ) : (
            <p className="text-sm leading-relaxed text-dim">
              Текста патча у нас нет — он открывается в Steam по ссылке ниже.
            </p>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-5 text-sm">
          {game && (
            <Link
              href={gameHref}
              className="tap tap-tight font-semibold underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
            >
              {tr(locale, { ru: 'Всё об игре', en: 'About the game' })}
            </Link>
          )}
          {/* Пересказ есть только у нас — отсюда им и делятся (с меткой ref) */}
          <PatchShare
            appid={item.appid}
            gid={item.gid}
            title={newsPageTitle(titleOn, game?.name, item.publishedAt, locale)}
          />
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="tap tap-tight text-dim underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
          >
            {tr(locale, { ru: 'Оригинал в Steam', en: 'Original on Steam' })}
          </a>
        </div>

        {/*
          Мост «а у меня?». Пересказ — то, чем здесь делятся (PatchShare), и
          пришедший по ссылке читал о чужой игре, а нижняя строка вела только в
          неё, в Steam и к её же патчам: что то же самое собирают по его
          библиотеке, страница не говорила. Строка одна на всех и не знает,
          кто смотрит, — страница в ISR, и куку она не читает (сторож в
          page.test.ts). Гостю обещание не врёт: /whatsnew его не разворачивает,
          а над общей лентой сам зовёт подключить Steam. «Крупные» — потому что
          лента берёт только их; «твоих игр», а не «всех»: у ленты потолок
          библиотеки (LIBRARY_CAP).

          Английская фраза — своя целиком, а не перевод кусков вокруг ссылки:
          в ней ссылка — подлежащее («What's new has…»), в русской — заголовок
          перед тире.
        */}
        <p className="text-sm leading-relaxed text-dim">
          {tr(locale, { ru: 'А что изменилось в твоих играх?', en: 'What changed in your games?' })}{' '}
          <Link
            href="/whatsnew"
            className="tap tap-tight font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
          >
            {tr(locale, { ru: 'Что нового', en: "What's new" })}
          </Link>{' '}
          {tr(locale, {
            ru: '— крупные патчи твоей библиотеки одной лентой.',
            en: 'has the major patches from your library in one feed.',
          })}
        </p>

        {others.length > 0 && (
          <section>
            <SectionLabel as="h2" className="mb-2">
              {game
                ? tr(locale, { ru: `Другие патчи ${game.name}`, en: `More ${game.name} patches` })
                : tr(locale, { ru: 'Другие патчи', en: 'More patches' })}
            </SectionLabel>
            <ul className="flex flex-col">
              {others.map((o) => {
                const title = newsHeading(newsTitleOn(o, game?.name, locale), game?.name)
                return (
                  <li key={o.gid} className="border-b border-rule last:border-b-0">
                    <Link
                      href={newsPath(item.appid, o.gid)}
                      className="flex items-baseline justify-between gap-4 py-3 text-sm transition-opacity hover:opacity-70"
                    >
                      <span lang={textLangOn(locale, title, game?.name)} className="min-w-0 truncate">
                        {title}
                      </span>
                      <NewsDate at={o.publishedAt} locale={locale} className="shrink-0" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </article>
    </div>
  )
}
