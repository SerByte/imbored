import type { Metadata } from 'next'
import Link from '@/components/Link'
import { notFound, permanentRedirect } from 'next/navigation'
import { GameLink } from '@/components/GameLink'
import { Icon } from '@/components/Icon'
import { StaticGameCardBody } from '@/components/StaticGameCard'
import { clip } from '@/lib/clip'
import { prerenderAtBuild } from '@/lib/gamecache'
import {
  facetCopy,
  facetPath,
  HUB_FACETS,
  HUB_GENRES,
  HUB_TAGS,
  hubFacetOf,
  hubPath,
  hubTagOf,
  type HubFacet,
} from '@/lib/gamehub'
import { genreBreadcrumbLd, genreItemListLd, ldScript } from '@/lib/jsonld'
import { lp, pl, toLocale, tr, type Locale } from '@/lib/i18n'
import { pointsLine } from '@/lib/modeltext'
import { navPrefetch } from '@/lib/nav'
import { presetHref, presetLabel, quizHref, roomSeedHref, VIBE_PRESETS } from '@/lib/presets'
import { appBaseUrl } from '@/lib/server'
import { localeAlternates, ogSite } from '@/lib/site'
import { tagLabel } from '@/lib/tagsru'
import { langOn } from '@/lib/textlang'
import { loadGenre, thinList, type Genre, type GenreGame } from './load'

/**
 * Страница жанра: /games/<slug>.
 *
 * Хаб /games — тридцать полок по двенадцать игр, и игра стоит только на одной
 * (lib/gamehub, assembleHub). Для поиска этого мало: «лучшие рогалики» ищут
 * жанром, и отвечать на такой запрос нужно страницей, где жанр — весь её
 * смысл. Здесь игры жанра без правила «одна игра — одна полка», до сорока, и у
 * каждой то, по чему выбирают: доля положительных отзывов, длина захода и за
 * что её любят.
 *
 * Неделя на ISR, как у хаба и у карточек игр (lib/gamecache). Запись такой
 * страницы — 0,45–0,7 МБ: HTML, RSC и сегменты, 55–90 блоков ISR Writes по
 * 8 КБ (замер локальной сборки). И вывод расходится с прошлым почти каждый
 * день: отбор и порядок — по сырому reviews_total, который недельная сверка
 * (lib/catalogsignals) переписывает каждый день у седьмой части каталога, а
 * плитка печатает точные числа отзывов. На сутках это была запись в день у
 * каждого из 68 адресов (два языка) — до ~130 тысяч блоков в месяц из
 * двухсот тысяч лимита Hobby; на неделе — около двадцати тысяч. Чаще верх
 * жанра заметно и не сдвигается: темп тот же, что у самой сверки.
 *
 * Адреса известны заранее — тридцать жанров и подборки по факту (HUB_FACETS:
 * «с другом», «на одном экране», «бесплатные», «на 20 минут»), — но
 * собираются на сборке только на продовой (prerenderAtBuild, lib/gamecache).
 * Превью делят с продом базу и пререндерили те же 68 страниц — ~4,4 тысячи
 * блоков ISR на каждую сборку ради деплоев, которые почти никто не
 * открывает. Вне прода список пустой, и страница досоздаётся первым заходом —
 * поэтому dynamicParams = true, а не false: с false пустой список значил бы
 * 404 на каждый жанр превью.
 *
 * Чужой адрес — по-прежнему 404, только решает его теперь страница, а не
 * сборка: loadGenre не знает такого slug (hubTagOf и hubFacetOf — без базы)
 * и отдаёт null, страница зовёт notFound(), generateMetadata — пустую
 * голову. По-русски чужой жанр сюда почти не доходит: rewrites переписывают
 * в /ru/… только известные slug, остальное забирает статическая /_not-found
 * (SECTION_SHAPES и garbageRewrites в lib/i18nroutes.ts). Почти — потому что
 * правила rewrites регистр не различают, и /games/ROGUELIKE доходит сюда как
 * известный: его страница уводит постоянным редиректом на строчный адрес
 * (caseFold ниже), а не кладёт 404 в кэш. Под /en чужой slug — notFound()
 * самой страницы — та же 404 и та же цена, что у /en/game/<нет такой>:
 * рендер функцией и запись ISR на адрес (Next кладёт ответ 404 в кэш вместе
 * с кодом — status в записи, next/dist/build/templates/app-page-runtime.js).
 *
 * Подборка — та же страница с другим отбором: вид, порог «тонкой» страницы,
 * разметка и карточка для чатов у них общие, а выход дальше у подборки про
 * компанию свой — /compat и «Позвать в эту игру».
 *
 * Карточки серверные (StaticGameCardBody) — по тому же доводу, что на хабе:
 * сорок островков GameArt везли по объекту арта каждый, а страница живёт в
 * ISR, и её вес — это ещё и ISR Writes.
 *
 * Язык — из params маршрута (у страницы тесты, next/root-params там не
 * работает). /en/games/<slug> существует, потому что язык приходит от
 * корневого layout: на продовой сборке Next зовёт generateStaticParams ниже
 * на каждый его язык, и все адреса — жанры и подборки — собираются для
 * обоих; вне прода оба языка досоздаются по требованию. Тексты подборки на
 * языке страницы — facetCopy (lib/gamehub).
 */
export const revalidate = 604_800
export const dynamicParams = true

export function generateStaticParams(): Array<{ tag: string }> {
  if (!prerenderAtBuild()) return []
  return [...HUB_TAGS.map((tag) => ({ tag: HUB_GENRES[tag].slug })), ...HUB_FACETS.map((f) => ({ tag: f.slug }))]
}

type Params = { params: Promise<{ tag: string; lang?: string }> }

/**
 * Известный slug не в своём регистре (/games/ROGUELIKE) — строчный адрес, на
 * который его надо увести; иначе null. Без базы, тем же hubTagOf/hubFacetOf,
 * что у loadGenre.
 */
function caseFold(slug: string): string | null {
  const lower = slug.toLowerCase()
  if (lower === slug) return null
  return hubTagOf(lower) || hubFacetOf(lower) ? lower : null
}

/** «40 игр» / «40 games» — счёт игр жанра или подборки в описании и на странице */
const gamesWord = (locale: Locale, n: number) => pl(locale, n, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })

/**
 * Карточка превью на /en — та же opengraph-image.tsx рядом, с английским alt.
 * Русская страница своего images не объявляет и получает файловую карточку
 * до байта. Почему так можно и почему размеры — копия, а не импорт, — у
 * карточки игры (enCard в app/[lang]/game/[appid]/page.tsx); сторож — в
 * app/[lang]/games/page.test.ts. Подпись — та же, что у файла по-русски:
 * одна на жанры и подборки («Подборка игр»), а не «Жанр».
 */
const EN_CARD = { width: 1200, height: 630, type: 'image/png', alt: 'Game collection — imbored' }

function enCard(locale: Locale, canonical: string) {
  if (locale !== 'en') return {}
  return { images: [{ url: lp(locale, `${canonical}/opengraph-image`), ...EN_CARD }] }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tag: slug, lang } = await params
  const locale = toLocale(lang)
  const genre = await loadGenre(slug, locale)
  if (!genre) return {}
  const { title, games } = genre
  const n = games.length
  const canonical = `/games/${slug}`
  const count = `${n} ${gamesWord(locale, n)}`
  // Подборку ищут вопросом («во что поиграть с другом»), и <title> отвечает
  // на него — heading подборки (facetCopy); жанр — названием жанра, как раньше.
  //
  // Заголовок жанра — первым и как есть: hubTitle уже с заглавной, и
  // по-английски его не опустить в середину фразы («The best Roguelikes…»
  // читается опечаткой), а строчной его делать нельзя — JRPGs, CRPGs.
  // Хвост — фраза глоссария, тем же порядком, что по-русски.
  const facetHeading = genre.kind === 'facet' ? facetCopy(genre.facet, locale).heading : null
  const heading =
    facetHeading ??
    tr(locale, {
      ru: `${title} — лучшие в Steam по отзывам`,
      en: `${title} — the best on Steam, by reviews`,
    })
  const description =
    facetHeading !== null
      ? tr(locale, {
          ru: `${facetHeading}: ${count} по числу отзывов в Steam — с долей положительных, длиной захода и тем, за что их любят.`,
          en: `${facetHeading}: ${count}, most-reviewed on Steam first, with the share of positive reviews, session length and what players love about each.`,
        })
      : tr(locale, {
          ru: `${title}: ${count}, для которых жанр главный, — с долей положительных отзывов, длиной захода и тем, за что их любят.`,
          en: `${title}: ${count} where this genre is one of the main tags, with the share of positive reviews, session length and what players love about each.`,
        })
  return {
    title: heading,
    description,
    alternates: localeAlternates(locale, canonical),
    ...(thinList(games) ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      ...ogSite(locale),
      type: 'website',
      url: lp(locale, canonical),
      title: heading,
      description,
      ...enCard(locale, canonical),
    },
  }
}

export default async function GenrePage({ params }: Params) {
  const { tag: slug, lang } = await params
  // Адреса в разметке — на языке страницы, как её canonical
  const locale = toLocale(lang)
  const folded = caseFold(slug)
  if (folded) permanentRedirect(lp(locale, `/games/${folded}`))
  const genre = await loadGenre(slug, locale)
  if (!genre) notFound()
  const { title, games } = genre
  const path = `/games/${slug}`
  const n = games.length
  const baseUrl = appBaseUrl()
  // Подпись под «за что любят» — один раз на страницу, если такие строки есть
  const anyLoved = games.some((g) => g.loved.length > 0)
  // У подборки все жанры — «другие»: своего у неё нет
  const otherGenres =
    genre.kind === 'facet'
      ? tr(locale, { ru: 'Жанры', en: 'Genres' })
      : tr(locale, { ru: 'Другие жанры', en: 'Other genres' })

  return (
    <div className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldScript([
            genreBreadcrumbLd({ title, path, baseUrl, locale }),
            ...(thinList(games) ? [] : [genreItemListLd({ title, games, baseUrl, locale })]),
          ]),
        }}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-safe pt-28 pb-16">
        <header className="flex max-w-2xl flex-col gap-4 anim-rise">
          {/* Путь — тот же, что в разметке крошек (genreBreadcrumbLd): разметка
              не говорит больше, чем страница */}
          <nav aria-label={tr(locale, { ru: 'Путь по разделу', en: 'Breadcrumb' })} className="flex flex-wrap items-center gap-1.5">
            <Link href="/games" className="tap tap-tight link-more">
              {tr(locale, { ru: 'Игры по жанрам', en: 'Games by genre' })}
            </Link>
            <Icon name="arrow" size={14} className="text-faint" />
            <span aria-current="page" className="text-sm font-semibold text-ink">
              {title}
            </span>
          </nav>
          <h1 className="font-display text-display-lg">{title}</h1>
          <p className="leading-relaxed text-dim">
            {/* По-английски — своим порядком слов, целой фразой, а не склейкой русской */}
            {n === 0 ? (
              tr(locale, { ru: 'Список собирается — загляни чуть позже.', en: 'The list is still coming together — check back soon.' })
            ) : genre.kind === 'facet' ? (
              // Основание подборки — продолжение фразы «40 игр — …» на обоих языках
              <>
                {n} {gamesWord(locale, n)} — {facetCopy(genre.facet, locale).basis}{' '}
                {tr(locale, { ru: 'Порядок — по числу отзывов в Steam.', en: 'Sorted by number of Steam reviews.' })}
              </>
            ) : locale === 'en' ? (
              <>
                {n} {gamesWord(locale, n)} where “{tagLabel(genre.tag, locale)}” is one of the main tags, not one buried at
                the end of the list. Sorted by number of Steam reviews.
              </>
            ) : (
              <>
                {n} {gamesWord(locale, n)}, для которых «{tagLabel(genre.tag, locale)}» — один из главных
                тегов, а не метка в хвосте списка. Порядок — по числу отзывов в Steam.
              </>
            )}
          </p>
          <Onward genre={genre} locale={locale} />
        </header>

        {n > 0 && (
          <ol className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((g, i) => (
              <li key={g.appid} className="flex min-w-0 flex-col">
                {/* Без префетча — как на хабе: сорок карточек в экране будили бы
                    функцию на каждую, по которой никто не пойдёт */}
                <GameLink appid={g.appid} className="game-card block">
                  <StaticGameCardBody
                    appid={g.appid}
                    name={g.name}
                    locale={locale}
                    headerImage={g.headerImage}
                    art={g.art}
                    sizes="(min-width: 1024px) 360px, (min-width: 640px) 45vw, 90vw"
                    eager={i < 3}
                    corner={<span className="lib-badge badge-line tabular-nums">{i + 1}</span>}
                    meta={
                      (g.reviews || g.session) && (
                        <>
                          {/* Короткое — глазу, полное — скринридеру: «92% из
                              48 тыс.» вслух не говорит, чего 92% (как на /play) */}
                          {g.reviews ? (
                            <span className="truncate" title={g.reviews.full}>
                              <span aria-hidden>{g.reviews.short}</span>
                              <span className="sr-only">{g.reviews.full}</span>
                            </span>
                          ) : (
                            <span />
                          )}
                          {g.session && (
                            <span className="shrink-0">
                              {g.session.label}: {g.session.value}
                            </span>
                          )}
                        </>
                      )
                    }
                  />
                </GameLink>
                <Why game={g} locale={locale} />
                {/* Позвать — комната с этой игрой первой картой (roomSeedHref),
                    как кнопка на странице игры. Без префетча: сорок ссылок в
                    экране будили бы /room/new на каждую */}
                {g.invite && (
                  <Link
                    href={roomSeedHref(g.appid)}
                    prefetch={false}
                    className="tap tap-tight mt-2 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
                  >
                    <Icon name="users" size={14} />
                    {tr(locale, { ru: 'Позвать в эту игру', en: 'Invite to this game' })}
                    {/* Название — данные: на /en русское — своим lang, как
                        подпись карточки выше (langOn); на ru — как было */}
                    <span className="sr-only">: {langOn(locale, g.name) ? <span lang="ru">{g.name}</span> : g.name}</span>
                  </Link>
                )}
              </li>
            ))}
          </ol>
        )}
        {anyLoved && (
          <p className="-mt-4 text-xs text-faint">
            {tr(locale, {
              ru: '«За что любят» собрано ИИ из самых полезных отзывов Steam.',
              en: '“Loved for” is summarized by AI from the most helpful Steam reviews.',
            })}
          </p>
        )}

        {/* Подборке — сначала соседние подборки: пришедший за «с другом»
            скорее пойдёт в «на одном экране», чем в «Градостроение» */}
        {genre.kind === 'facet' && (
          <nav aria-label={tr(locale, { ru: 'Другие подборки', en: 'Other collections' })} className="flex flex-col gap-4">
            <h2 className="section-title">{tr(locale, { ru: 'Другие подборки', en: 'Other collections' })}</h2>
            <ul className="flex flex-wrap gap-2">
              {HUB_FACETS.filter((f) => f.slug !== slug).map((f) => (
                <li key={f.slug}>
                  <Link href={facetPath(f)} prefetch={false} className="pill">
                    {facetCopy(f, locale).label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <nav aria-label={otherGenres} className="flex flex-col gap-4">
          <h2 className="section-title">{otherGenres}</h2>
          <ul className="flex flex-wrap gap-2">
            {HUB_TAGS.filter((t) => genre.kind !== 'genre' || t !== genre.tag).map((t) => (
              <li key={t}>
                <Link href={hubPath(t) ?? '/games'} prefetch={false} className="pill">
                  {tagLabel(t, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}

/** «30 минут до сна» — пресет, которым выход подборки «на 20 минут» ведёт в подбор */
const SLEEP = VIBE_PRESETS.find((p) => p.key === 'sleep')

/**
 * Куда страница ведёт дальше — одна кнопка под заголовком.
 *
 *   • Жанр и «бесплатные» — квиз, а не /play: страница статическая и про
 *     сессию не знает, а квиз открыт любому — гостя он сам доведёт до входа
 *     или демо.
 *   • Подборка про компанию (HubFacet.party) — /compat, «что есть у вас
 *     обоих»: пришедший по «во что поиграть с другом» уже с другом, и ответ
 *     точнее любой подборки — пересечение двух библиотек. Без префетча:
 *     /compat собирается на каждый запрос (navPrefetch, lib/nav).
 *   • «На 20 минут» — пресет «30 минут до сна»: то же короткое настроение,
 *     только из своей библиотеки. Гостя /play сам развернёт на вход, унося
 *     настроение в адресе (bounceTo в lib/destination), и вернёт в выдачу.
 *
 * Адреса — без префикса языка: его ставит Link (components/Link).
 */
function Onward({ genre, locale }: { genre: Genre; locale: Locale }) {
  const facet: HubFacet | null = genre.kind === 'facet' ? genre.facet : null
  const arrow = <Icon name="arrow" className="ml-1.5 inline-block align-[-0.125em]" />
  if (facet?.party) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Link href="/compat" prefetch={navPrefetch('/compat')} className="btn-ember px-6 py-3">
          {tr(locale, { ru: 'Что есть у вас обоих', en: 'What you both own' })} {arrow}
        </Link>
        <p className="text-sm text-dim">
          {tr(locale, {
            ru: 'Сравни библиотеки с другом — и увидишь, во что вам зайти вместе.',
            en: 'Compare libraries with a friend and see what you could play together.',
          })}
        </p>
      </div>
    )
  }
  if (facet?.drop === 'match' && SLEEP) {
    return (
      <div>
        <Link href={presetHref(SLEEP)} className="btn-ember px-6 py-3">
          {tr(locale, {
            ru: `${presetLabel(SLEEP, locale)} — из своей библиотеки`,
            en: `${presetLabel(SLEEP, locale)} — from your library`,
          })}{' '}
          {arrow}
        </Link>
      </div>
    )
  }
  /*
   * Квиз, а не /play: страница статическая и про сессию не знает, а квиз
   * открыт любому — гостя он сам доведёт до входа или демо.
   *
   * У жанра — с жанром (quizHref → /quiz?genre=<slug>): человек пришёл из
   * поиска «лучшие рогалики», и голый квиз терял жанр ровно на входе в
   * продукт — кнопка обещала «из своей библиотеки», а выдача была обо всём
   * подряд. Теперь квиз спросит настроение и подберёт рогалики, сначала свои;
   * своих нет — магазинные того же жанра, и выдача скажет об этом (genreLine
   * в lib/playflow). У подборки (facet) жанра нет — квиз голый. Адрес один на
   * всех — разметка ISR от смотрящего не зависит.
   *
   * По-английски заголовок жанра начинает подпись и стоит как есть — тот же
   * ход, что у строк квиза и выдачи, куда ведёт кнопка («Roguelikes — yours
   * first», «Roguelikes only»): hubTitle не понижается (docs/i18n.md), а
   * заглавная посреди фразы («Pick Roguelikes…») читалась бы опечаткой.
   * Хвост — подпись соседней кнопки подборки, «Pick from your library».
   */
  if (genre.kind === 'genre') {
    return (
      <div>
        <Link href={quizHref(null, null, genre.slug)} className="btn-ember px-6 py-3">
          {tr(locale, {
            ru: `Подобрать ${inPhrase(genre.title)} из своей библиотеки`,
            en: `${genre.title} — pick from your library`,
          })}{' '}
          {arrow}
        </Link>
      </div>
    )
  }
  return (
    <div>
      <Link href="/quiz" className="btn-ember px-6 py-3">
        {tr(locale, { ru: 'Подобрать из своей библиотеки', en: 'Pick from your library' })} {arrow}
      </Link>
    </div>
  )
}

/**
 * Русский заголовок жанра внутри фразы кнопки: «Подобрать рогалики…».
 * Строчной — только первая буква и только у обычного слова: аббревиатура
 * осталась бы как есть. Русские заголовки жанров с аббревиатуры не
 * начинаются, и это ровно прежнее «первая буква строчной». Английский
 * заголовок сюда не идёт вовсе: hubTitle не понижается никогда (docs/i18n.md),
 * и английская кнопка ставит его первым (Onward выше).
 */
function inPhrase(title: string): string {
  if (/^\p{Lu}{2}/u.test(title)) return title
  return title.charAt(0).toLowerCase() + title.slice(1)
}

/**
 * Строка под карточкой: за что игру любят — или, пока это не собрано, её
 * описание витрины на языке страницы (loadGenre отдаёт только такое). Чужой
 * абзац посреди страницы хуже, чем ничего: английский — на русской, русский —
 * на английской.
 *
 * Два пункта — двумя предложениями (pointsLine), а не через «; »: второй
 * пункт начинается с заглавной, и выходило «…повторяемость; Богатая
 * история».
 */
function Why({ game, locale }: { game: GenreGame; locale: Locale }) {
  if (game.loved.length) {
    return (
      <p className="mt-2 text-sm leading-snug text-dim">
        <span className="font-semibold text-ink">{tr(locale, { ru: 'За что любят:', en: 'Loved for:' })}</span>{' '}
        {pointsLine(game.loved.slice(0, 2))}
      </p>
    )
  }
  if (game.about) {
    return <p className="mt-2 text-sm leading-snug text-dim">{clip(game.about, 140) ?? game.about.slice(0, 140)}</p>
  }
  return null
}
