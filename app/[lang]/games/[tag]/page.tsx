import type { Metadata } from 'next'
import Link from '@/components/Link'
import { notFound } from 'next/navigation'
import { GameLink } from '@/components/GameLink'
import { Icon } from '@/components/Icon'
import { StaticGameCardBody } from '@/components/StaticGameCard'
import { clip } from '@/lib/clip'
import { HUB_GENRES, HUB_MIN_SHELF, HUB_TAGS, hubPath } from '@/lib/gamehub'
import { genreBreadcrumbLd, genreItemListLd, ldScript } from '@/lib/jsonld'
import { appBaseUrl } from '@/lib/server'
import { lp, pl, toLocale, tr, type Locale } from '@/lib/i18n'
import { localeAlternates, ogSite } from '@/lib/site'
import { tagLabel } from '@/lib/tagsru'
import { loadGenre, type GenreGame } from './load'

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
 * Сутки на ISR, как у хаба: выборка та же и читает все игры тега выше порога.
 * Адресов ровно тридцать и они известны заранее — собираются на сборке, а
 * чужой адрес — 404 без вызова функции (dynamicParams = false).
 *
 * Карточки серверные (StaticGameCardBody) — по тому же доводу, что на хабе:
 * сорок островков GameArt везли по объекту арта каждый, а страница живёт в
 * ISR, и её вес — это ещё и ISR Writes.
 *
 * Язык — из params маршрута (у страницы тесты, next/root-params там не
 * работает). /en/games/<slug> под dynamicParams = false существует, потому
 * что язык приходит от корневого layout: Next зовёт generateStaticParams
 * ниже на каждый его язык, и тридцать адресов собираются для обоих.
 */
export const revalidate = 86_400
export const dynamicParams = false

export function generateStaticParams(): Array<{ tag: string }> {
  return HUB_TAGS.map((tag) => ({ tag: HUB_GENRES[tag].slug }))
}

type Params = { params: Promise<{ tag: string; lang?: string }> }

/** Полка короче этого — страница есть, но в поиск её не пускаем: список из трёх игр — не ответ */
const thin = (games: readonly GenreGame[]) => games.length < HUB_MIN_SHELF

/** «40 игр» / «40 games» — счёт игр жанра в описании и на странице */
const gamesWord = (locale: Locale, n: number) => pl(locale, n, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })

/**
 * Карточка превью на /en — та же opengraph-image.tsx рядом, с английским alt.
 * Русская страница своего images не объявляет и получает файловую карточку
 * до байта. Почему так можно и почему размеры — копия, а не импорт, — у
 * карточки игры (enCard в app/[lang]/game/[appid]/page.tsx); сторож — в
 * app/[lang]/games/page.test.ts.
 */
const EN_CARD = { width: 1200, height: 630, type: 'image/png', alt: 'Genre — imbored' }

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
  // Заголовок жанра — как есть, с заглавной: hubTitle уже в нужном регистре,
  // и по-английски он встаёт внутрь фразы («The best Roguelikes on Steam…»)
  const heading = tr(locale, {
    ru: `${title} — лучшие в Steam по отзывам`,
    en: `The best ${title} on Steam, by reviews`,
  })
  const description = tr(locale, {
    ru: `${title}: ${n} ${gamesWord(locale, n)}, для которых жанр главный, — с долей положительных отзывов, длиной захода и тем, за что их любят.`,
    en: `${title}: ${n} ${gamesWord(locale, n)} where it's the main genre, with the share of positive reviews, session length and what players love about them.`,
  })
  return {
    title: heading,
    description,
    alternates: localeAlternates(locale, canonical),
    ...(thin(games) ? { robots: { index: false, follow: true } } : {}),
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
  const genre = await loadGenre(slug, locale)
  if (!genre) notFound()
  const { tag, title, games } = genre
  const path = `/games/${slug}`
  const n = games.length
  const baseUrl = appBaseUrl()
  // Подпись под «за что любят» — один раз на страницу, если такие строки есть
  const anyLoved = games.some((g) => g.loved.length > 0)

  return (
    <div className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldScript([
            genreBreadcrumbLd({ title, path, baseUrl, locale }),
            ...(thin(games) ? [] : [genreItemListLd({ title, games, baseUrl, locale })]),
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
            ) : locale === 'en' ? (
              <>
                {n} {gamesWord(locale, n)} where “{tagLabel(tag, locale)}” is one of the main tags, not one buried at the
                end of the list. Sorted by number of Steam reviews.
              </>
            ) : (
              <>
                {n} {gamesWord(locale, n)}, для которых «{tagLabel(tag, locale)}» — один из главных
                тегов, а не метка в хвосте списка. Порядок — по числу отзывов в Steam.
              </>
            )}
          </p>
          <div>
            {/* Квиз, а не /play: страница статическая и про сессию не знает,
                а квиз открыт любому — гостя он сам доведёт до входа или демо */}
            <Link href="/quiz" className="btn-ember px-6 py-3">
              {tr(locale, { ru: 'Подобрать из своей библиотеки ', en: 'Pick from your library ' })}
              <Icon name="arrow" className="ml-1.5 inline-block align-[-0.125em]" />
            </Link>
          </div>
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

        <nav aria-label={tr(locale, { ru: 'Другие жанры', en: 'Other genres' })} className="flex flex-col gap-4">
          <h2 className="section-title">{tr(locale, { ru: 'Другие жанры', en: 'Other genres' })}</h2>
          <ul className="flex flex-wrap gap-2">
            {HUB_TAGS.filter((t) => t !== tag).map((t) => (
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

/**
 * Строка под карточкой: за что игру любят — или, пока это не собрано, её
 * описание витрины на языке страницы (loadGenre отдаёт только такое). Чужой
 * абзац посреди страницы хуже, чем ничего: английский — на русской, русский —
 * на английской.
 */
function Why({ game, locale }: { game: GenreGame; locale: Locale }) {
  if (game.loved.length) {
    return (
      <p className="mt-2 text-sm leading-snug text-dim">
        <span className="font-semibold text-ink">{tr(locale, { ru: 'За что любят:', en: 'Loved for:' })}</span>{' '}
        {game.loved.slice(0, 2).join('; ')}
      </p>
    )
  }
  if (game.about) {
    return <p className="mt-2 text-sm leading-snug text-dim">{clip(game.about, 140) ?? game.about.slice(0, 140)}</p>
  }
  return null
}
