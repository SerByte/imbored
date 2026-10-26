import type { Metadata, ResolvingMetadata } from 'next'
import Link from '@/components/Link'
import { notFound } from 'next/navigation'
import { GameArt } from '@/components/GameArt'
import { Icon } from '@/components/Icon'
import { Eyebrow, SectionLabel } from '@/components/Labels'
import { LinkPending } from '@/components/LinkPending'
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
import { archiveCrumb, patchArticleLd, patchBreadcrumbLd, ldScript } from '@/lib/jsonld'
import { navPrefetch } from '@/lib/nav'
import { patchArchivePath } from '@/lib/patcharchive'
import { appBaseUrl, getDb } from '@/lib/server'
import { LOCALES, lp, toLocale, tr } from '@/lib/i18n'
import { gameCard, ogSite } from '@/lib/site'
import { langAttr, oneItem, textLangOn, withForeignRuns } from '@/lib/textlang'
import { indexedHreflang } from '../alternates'
import { loadPatch, patchHeading } from './load'

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
 * Месяц на ISR — срок карточки игры (GAME_PAGE_REVALIDATE_SEC в
 * lib/gamecache, литералом: Next читает его только так), и сброс, как у неё,
 * из кронов. Часов в выводе нет — даты абсолютные, — а меняют пост только
 * кроны: опрос, когда издатель правит тело или заголовок, и пересказ, когда
 * пишет «Коротко» и английский заголовок. Оба сбрасывают его адрес сами
 * (posts в resetSliceCards; свежепересказанные — ещё и announceFreshPatches
 * с пингом IndexNow). Новый патч игры старые страницы не меняет: внизу — только
 * вышедшие раньше этого («Предыдущие патчи», others ниже).
 *
 * Сутки здесь стояли раньше и стоили перегенерации почти на каждый заход
 * краулера: к адресу хвоста он возвращается раз в несколько дней, то есть
 * всегда после суток, — а страница при этом не менялась.
 */
export const revalidate = 2_592_000

/**
 * Пустой список, и он обязателен: без generateStaticParams динамический
 * сегмент не попадает в dynamicRoutes манифеста, revalidate выше не значит
 * ничего, и каждый заход рендерится заново (тот же довод — у карточки игры).
 * Пустой — значит на сборке не предрендерим ни одного поста: их тысячи, а
 * заходят на единицы. Каждый рендерится при первом заходе и живёт свой срок
 * (docs: generate-static-params, «All paths at runtime»).
 */
export async function generateStaticParams(): Promise<Array<{ appid: string; gid: string }>> {
  return []
}

type Params = { params: Promise<{ appid: string; gid: string; lang?: string }> }

/**
 * parent — метадата корня: из неё корневая карточка, когда у поста нет шапки
 * игры (игры нет в каталоге, gameCard в lib/site). Тест зовёт без него.
 */
export async function generateMetadata({ params }: Params, parent?: ResolvingMetadata): Promise<Metadata> {
  const { appid, gid, lang } = await params
  const locale = toLocale(lang)
  const page = await loadPatch(appid, gid, locale)
  /*
   * 404 (не патч или нет такого поста) — пустой объект на обоих языках, и
   * голова у неё корневая, с подписью карточки на языке адреса — как у 404
   * самой игры (../../page.tsx). Своя запись здесь была, пока у патча стояла
   * своя файловая карточка: её alt без языка оставлял на /en русскую подпись.
   */
  if (!page) return {}
  const { item, game } = page

  // С датой, если заголовок патчи игры не различает: у CS2 все они —
  // «Обновление Counter-Strike 2» (см. newsPageTitle)
  const title = newsPageTitle(newsTitleOn(item, game?.name, locale), game?.name, item.publishedAt, locale)
  const description = newsDescription(item, game?.name, locale)
  const canonical = newsPath(item.appid, item.gid)
  /*
   * Картинка превью — шапка игры из Steam, та же, что у карточки игры
   * (gameCard в lib/site). Своя PNG-карточка у патча была — заголовок и
   * пересказ на арте игры, — и стоила своей записи ISR на каждый пост и
   * язык, полсекунды функции на рендер и перерисовку на каждом заходе бота
   * превью после каждого деплоя. Что это патч, а не игра, в чате говорит
   * og:title («— что изменилось») и описание с пересказом рядом с картинкой.
   */

  /*
   * Какие версии поста в поиске — у каждого языка по своему пересказу
   * (newsIndexable), и hreflang ведёт только на них (indexedHreflang).
   * Пересказы обоих языков — у русского чтения: оно отдаёт пост как лежит, с
   * tldr и tldrEn. На русской странице это тот же вызов, что выше (cache), на
   * /en — ещё одно чтение строки на перегенерацию ISR.
   */
  const stored = (await loadPatch(appid, gid, 'ru'))?.item
  const listed = game?.listed ?? false
  const has = LOCALES.filter((l) => newsIndexable(l === 'en' ? stored?.tldrEn : stored?.tldr, listed))

  return {
    title,
    description,
    alternates: { canonical: lp(locale, canonical), ...indexedHreflang(canonical, has) },
    ...(has.includes(locale) ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      ...ogSite(locale),
      type: 'article',
      url: lp(locale, canonical),
      title,
      description,
      publishedTime: new Date(item.publishedAt * 1000).toISOString(),
      ...(await gameCard(game && { appid: item.appid, ...game }, locale, parent)),
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/**
 * Сколько предыдущих патчей показать внизу: перелинковка, а не архив.
 *
 * Только вышедшие РАНЬШЕ этого, а не шесть свежих у игры. Свежие менялись с
 * каждым новым патчем: новый вставал в голову списка, шестой уходил — и
 * каждая сохранённая страница патча этой игры, на обоих языках, при
 * следующем заходе перерисовывалась и писалась в ISR заново. Предыдущие
 * у страницы уже не меняются: новый пост встаёт после неё, а не перед.
 */
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

  // Строго раньше по времени: сам пост в список не попадает и без фильтра
  const others = await getGamePatchHeads(await getDb(), item.appid, item.publishedAt, OTHERS)
  const gameHref = `/game/${item.appid}`
  // Заголовок поста на языке страницы: русский заголовок издателя на /en не
  // показывается — его место занимает titleEn или «{Game} update» (newsTitleOn)
  const titleOn = newsTitleOn(item, game?.name, locale)
  // Общий «{Game} update» в h1 не режется до голого «Update» (patchHeading)
  const heading = patchHeading(item, game?.name, locale)

  const baseUrl = appBaseUrl()
  /*
   * Заголовок разметки — тот же, что в h1. patchArticleLd и patchBreadcrumbLd
   * строят его сами через newsHeading и общий «{Game} update» режут до
   * «Update» (lib/jsonld) — поэтому он ставится отсюда. На русской странице
   * patchHeading и есть newsHeading, и разметка та же байт в байт: ключ
   * перезаписывается на своём месте.
   */
  const article = { ...patchArticleLd({ item, game, baseUrl, locale }), headline: heading }
  const crumbs = patchBreadcrumbLd({ item, game, baseUrl, locale })
  const lastCrumb = crumbs.itemListElement.length - 1
  const breadcrumb = {
    ...crumbs,
    itemListElement: crumbs.itemListElement.map((step, i) => (i === lastCrumb ? { ...step, name: heading } : step)),
  }

  return (
    <div className="relative flex-1 overflow-x-clip">
      {/* Статья и крошки — из того же, что на экране (lib/jsonld): заголовок
          как в h1, «Коротко», кадр, ссылка назад на игру, оригинал */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ldScript([article, breadcrumb]) }}
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
              библиотеке) — тогда нет ни её карточки, ни архива, и ссылаться
              некуда. Путь — тот же, что в разметке крошек (patchBreadcrumbLd):
              игра → её архив обновлений → этот патч. Был одной ссылкой
              «← игра»; архив (/game/<appid>/news) встал между ними, и
              подняться к остальным патчам теперь можно одним шагом. Архив —
              без префетча: он на ISR и рендерится по первому заходу */}
          {game && (
            <nav aria-label={tr(locale, { ru: 'Путь к патчу', en: 'Breadcrumb' })} className="flex flex-wrap items-center gap-1.5">
              {/* Название — данные: на /en русское — своим lang, как h1
                  карточки игры (langAttr: на ru пропса нет и в RSC-части);
                  ссылка целиком — название */}
              <Link href={gameHref} transitionTypes={['nav-back']} {...langAttr(locale, game.name)} className="tap tap-tight link-more">
                {game.name}
              </Link>
              <Icon name="arrow" size={14} className="text-faint" />
              <Link
                href={patchArchivePath(item.appid)}
                transitionTypes={['nav-back']}
                prefetch={false}
                className="tap tap-tight link-more"
              >
                {archiveCrumb(locale)}
              </Link>
            </nav>
          )}
          <Eyebrow as="p">{tr(locale, { ru: 'Что изменилось', en: 'What changed' })}</Eyebrow>
          {/* Заголовок и тело — текст издателя, обычно английский, а
              страница — lang="ru". Без пометки скринридер читал бы латиницу
              русским голосом (WCAG 3.1.2), см. lib/textlang; на /en чужим
              становится русский. Тело помечает NewsBody сам; пересказ
              «Коротко» наш и на языке страницы — без пометки.
              Название игры в подсчёт не входит: «Обновление Counter-Strike 2»
              — русский заголовок с именем собственным, а не английский.
              Зато оно само бывает русским на /en (games.name у части верха
              каталога): общий «{Game} update» несёт его целиком, и такое
              название — своим <span lang="ru"> (withForeignRuns), как в
              ссылках ниже; на ru и у латинского — та же строка. */}
          <h1 lang={textLangOn(locale, heading, game?.name)} className="font-display text-display-md">
            {withForeignRuns(locale, heading, [game?.name])}
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
            /*
              Кадр поста из RSS Steam, как в ленте (PatchRow, Cover). Не
              next/image по той же причине, что в NewsBody: пришлось бы
              открывать remotePatterns на весь CDN.

              В <picture> — чтобы префетч страницы не тащил кадр туда, где
              стоит ссылка. Серверный <img> без lazy Flight превращает в
              подсказку предзагрузки, а страницу патча префетчит «Читать
              патч» на обложке /whatsnew: на телефоне кадр 138 КБ качался
              вперёд героя ленты, рядом с которым его не показывают вовсе
              (подробно — у StaticGameCardBody). lazy здесь не годится: под
              коротким «Коротко» кадр бывает над сгибом, и его ждали бы до
              раскладки. Сторож — imageHints в page.test.ts.
            */
            <picture className="contents">
              <img
                src={item.imageUrl}
                alt=""
                decoding="async"
                className="w-full rounded-[var(--radius-card)] border border-edge object-cover"
              />
            </picture>
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

          Без префетча: /whatsnew собирается на каждый запрос (lib/nav,
          DYNAMIC_SECTIONS), и префетч будил функцию на каждом просмотре
          патча, докрученного до низа, — MISS и private, no-store на проде,
          а пришедших из поиска и по ссылкам на ~530 патчей много больше,
          чем нажавших. Паузу перехода закрывает мерцание подписи
          (LinkPending) — как у той же ссылки в шапке.
        */}
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

        {others.length > 0 && (
          <section>
            <SectionLabel as="h2" className="mb-2">
              {/* «Предыдущие», а не «другие»: в списке только вышедшие раньше
                  (OTHERS). Русское название во фразе на /en — своим
                  <span lang="ru"> (withForeignRuns), как «Все обновления» на
                  карточке игры */}
              {game
                ? withForeignRuns(locale, tr(locale, { ru: `Предыдущие патчи ${game.name}`, en: `Earlier ${game.name} patches` }), [game.name])
                : tr(locale, { ru: 'Предыдущие патчи', en: 'Earlier patches' })}
            </SectionLabel>
            <ul className="flex flex-col">
              {others.map((o) => {
                const title = newsHeading(newsTitleOn(o, game?.name, locale), game?.name)
                return (
                  <li key={o.gid} className="border-b border-rule last:border-b-0">
                    {/* Без префетча: шесть страниц патчей на ISR, и каждая
                        ненаписанная или устаревшая рендерилась бы и писалась
                        ради того, что читатель докрутил до низа */}
                    <Link
                      href={newsPath(item.appid, o.gid)}
                      prefetch={false}
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
            {/* Шесть предыдущих — перелинковка, а все хранящиеся патчи игры
                списком — в её архиве обновлений */}
            {game && (
              <Link href={patchArchivePath(item.appid)} prefetch={false} className="tap link-more mt-3">
                {oneItem(withForeignRuns(locale, tr(locale, { ru: `Все обновления «${game.name}»`, en: `All ${game.name} updates` }), [game.name]))}
                <Icon name="arrow" size={16} />
              </Link>
            )}
          </section>
        )}
      </article>
    </div>
  )
}
