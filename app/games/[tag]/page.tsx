import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GameCardBody } from '@/components/GameCard'
import { Icon } from '@/components/Icon'
import { clip } from '@/lib/clip'
import { HUB_GENRES, HUB_MIN_SHELF, HUB_TAGS, hubPath } from '@/lib/gamehub'
import { genreBreadcrumbLd, genreItemListLd, ldScript } from '@/lib/jsonld'
import { plural } from '@/lib/plural'
import { appBaseUrl } from '@/lib/server'
import { OG_SITE } from '@/lib/site'
import { tagRu } from '@/lib/tagsru'
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
 */
export const revalidate = 86_400
export const dynamicParams = false

export function generateStaticParams(): Array<{ tag: string }> {
  return HUB_TAGS.map((tag) => ({ tag: HUB_GENRES[tag].slug }))
}

type Params = { params: Promise<{ tag: string }> }

/** Полка короче этого — страница есть, но в поиск её не пускаем: список из трёх игр — не ответ */
const thin = (games: readonly GenreGame[]) => games.length < HUB_MIN_SHELF

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tag: slug } = await params
  const genre = await loadGenre(slug)
  if (!genre) return {}
  const { title, games } = genre
  const n = games.length
  const canonical = `/games/${slug}`
  const heading = `${title} — лучшие в Steam по отзывам`
  const description = `${title}: ${n} ${plural(n, 'игра', 'игры', 'игр')}, для которых жанр главный, — с долей положительных отзывов, длиной захода и тем, за что их любят.`
  return {
    title: heading,
    description,
    alternates: { canonical },
    ...(thin(games) ? { robots: { index: false, follow: true } } : {}),
    openGraph: { ...OG_SITE, type: 'website', url: canonical, title: heading, description },
  }
}

export default async function GenrePage({ params }: Params) {
  const { tag: slug } = await params
  const genre = await loadGenre(slug)
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
            genreBreadcrumbLd({ title, path, baseUrl }),
            ...(thin(games) ? [] : [genreItemListLd({ title, games, baseUrl })]),
          ]),
        }}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-safe pt-28 pb-16">
        <header className="flex max-w-2xl flex-col gap-4 anim-rise">
          {/* Путь — тот же, что в разметке крошек (genreBreadcrumbLd): разметка
              не говорит больше, чем страница */}
          <nav aria-label="Путь по разделу" className="flex flex-wrap items-center gap-1.5">
            <Link href="/games" className="tap tap-tight link-more">
              Игры по жанрам
            </Link>
            <Icon name="arrow" size={14} className="text-faint" />
            <span aria-current="page" className="text-sm font-semibold text-ink">
              {title}
            </span>
          </nav>
          <h1 className="font-display text-display-lg">{title}</h1>
          <p className="leading-relaxed text-dim">
            {n > 0 ? (
              <>
                {n} {plural(n, 'игра', 'игры', 'игр')}, для которых «{tagRu(tag)}» — один из главных
                тегов, а не метка в хвосте списка. Порядок — по числу отзывов в Steam.
              </>
            ) : (
              'Список собирается — загляни чуть позже.'
            )}
          </p>
          <div>
            {/* Квиз, а не /play: страница статическая и про сессию не знает,
                а квиз открыт любому — гостя он сам доведёт до входа или демо */}
            <Link href="/quiz" className="btn-ember px-6 py-3">
              Подобрать из своей библиотеки <Icon name="arrow" className="ml-1.5 inline-block align-[-0.125em]" />
            </Link>
          </div>
        </header>

        {n > 0 && (
          <ol className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((g, i) => (
              <li key={g.appid} className="flex min-w-0 flex-col">
                {/* Без префетча — как на хабе: сорок карточек в экране будили бы
                    функцию на каждую, по которой никто не пойдёт */}
                <Link href={`/game/${g.appid}`} prefetch={false} className="game-card block">
                  <GameCardBody
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
                          <span className="truncate" title={g.reviews?.full}>
                            {g.reviews?.short}
                          </span>
                          {g.session && (
                            <span className="shrink-0">
                              {g.session.label}: {g.session.value}
                            </span>
                          )}
                        </>
                      )
                    }
                  />
                </Link>
                <Why game={g} />
              </li>
            ))}
          </ol>
        )}
        {anyLoved && (
          <p className="-mt-4 text-xs text-faint">«За что любят» собрано ИИ из самых полезных отзывов Steam.</p>
        )}

        <nav aria-label="Другие жанры" className="flex flex-col gap-4">
          <h2 className="section-title">Другие жанры</h2>
          <ul className="flex flex-wrap gap-2">
            {HUB_TAGS.filter((t) => t !== tag).map((t) => (
              <li key={t}>
                <Link href={hubPath(t) ?? '/games'} prefetch={false} className="pill">
                  {tagRu(t)}
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
 * описание витрины, если оно по-русски. Английский абзац посреди русской
 * страницы хуже, чем ничего.
 */
function Why({ game }: { game: GenreGame }) {
  if (game.loved.length) {
    return (
      <p className="mt-2 text-sm leading-snug text-dim">
        <span className="font-semibold text-ink">За что любят:</span> {game.loved.slice(0, 2).join('; ')}
      </p>
    )
  }
  if (game.about) {
    return <p className="mt-2 text-sm leading-snug text-dim">{clip(game.about, 140) ?? game.about.slice(0, 140)}</p>
  }
  return null
}
