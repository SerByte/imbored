import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GameLink } from '@/components/GameLink'
import { Icon } from '@/components/Icon'
import { StaticGameCardBody } from '@/components/StaticGameCard'
import { clip } from '@/lib/clip'
import {
  facetPath,
  HUB_FACETS,
  HUB_GENRES,
  HUB_TAGS,
  hubPath,
  type HubFacet,
} from '@/lib/gamehub'
import { genreBreadcrumbLd, genreItemListLd, ldScript } from '@/lib/jsonld'
import { pointsLine } from '@/lib/modeltext'
import { navPrefetch } from '@/lib/nav'
import { plural } from '@/lib/plural'
import { presetHref, roomSeedHref, VIBE_PRESETS } from '@/lib/presets'
import { appBaseUrl } from '@/lib/server'
import { OG_SITE } from '@/lib/site'
import { tagRu } from '@/lib/tagsru'
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
 * Сутки на ISR, как у хаба: выборка та же и читает все игры тега выше порога.
 * Адреса известны заранее — тридцать жанров и подборки по факту (HUB_FACETS:
 * «с другом», «на одном экране», «бесплатные», «на 20 минут»), — собираются
 * на сборке, а чужой адрес — 404 без вызова функции (dynamicParams = false).
 * Подборка — та же страница с другим отбором: вид, порог «тонкой» страницы,
 * разметка и карточка для чатов у них общие, а выход дальше у подборки про
 * компанию свой — /compat и «Позвать в эту игру».
 *
 * Карточки серверные (StaticGameCardBody) — по тому же доводу, что на хабе:
 * сорок островков GameArt везли по объекту арта каждый, а страница живёт в
 * ISR, и её вес — это ещё и ISR Writes.
 */
export const revalidate = 86_400
export const dynamicParams = false

export function generateStaticParams(): Array<{ tag: string }> {
  return [...HUB_TAGS.map((tag) => ({ tag: HUB_GENRES[tag].slug })), ...HUB_FACETS.map((f) => ({ tag: f.slug }))]
}

type Params = { params: Promise<{ tag: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tag: slug } = await params
  const genre = await loadGenre(slug)
  if (!genre) return {}
  const { title, games } = genre
  const n = games.length
  const canonical = `/games/${slug}`
  const count = `${n} ${plural(n, 'игра', 'игры', 'игр')}`
  // Подборку ищут вопросом («во что поиграть с другом»), и <title> отвечает
  // на него — HubFacet.heading; жанр — названием жанра, как раньше
  const heading = genre.kind === 'facet' ? genre.facet.heading : `${title} — лучшие в Steam по отзывам`
  const description =
    genre.kind === 'facet'
      ? `${genre.facet.heading}: ${count} по числу отзывов в Steam — с долей положительных, длиной захода и тем, за что их любят.`
      : `${title}: ${count}, для которых жанр главный, — с долей положительных отзывов, длиной захода и тем, за что их любят.`
  return {
    title: heading,
    description,
    alternates: { canonical },
    ...(thinList(games) ? { robots: { index: false, follow: true } } : {}),
    openGraph: { ...OG_SITE, type: 'website', url: canonical, title: heading, description },
  }
}

export default async function GenrePage({ params }: Params) {
  const { tag: slug } = await params
  const genre = await loadGenre(slug)
  if (!genre) notFound()
  const { title, games } = genre
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
            ...(thinList(games) ? [] : [genreItemListLd({ title, games, baseUrl })]),
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
            {n === 0 ? (
              'Список собирается — загляни чуть позже.'
            ) : genre.kind === 'facet' ? (
              <>
                {n} {plural(n, 'игра', 'игры', 'игр')} — {genre.facet.basis} Порядок — по числу отзывов в
                Steam.
              </>
            ) : (
              <>
                {n} {plural(n, 'игра', 'игры', 'игр')}, для которых «{tagRu(genre.tag)}» — один из главных
                тегов, а не метка в хвосте списка. Порядок — по числу отзывов в Steam.
              </>
            )}
          </p>
          <Onward genre={genre} />
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
                <Why game={g} />
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
                    Позвать в эту игру
                    <span className="sr-only">: {g.name}</span>
                  </Link>
                )}
              </li>
            ))}
          </ol>
        )}
        {anyLoved && (
          <p className="-mt-4 text-xs text-faint">«За что любят» собрано ИИ из самых полезных отзывов Steam.</p>
        )}

        {/* Подборке — сначала соседние подборки: пришедший за «с другом»
            скорее пойдёт в «на одном экране», чем в «Градостроение» */}
        {genre.kind === 'facet' && (
          <nav aria-label="Другие подборки" className="flex flex-col gap-4">
            <h2 className="section-title">Другие подборки</h2>
            <ul className="flex flex-wrap gap-2">
              {HUB_FACETS.filter((f) => f.slug !== slug).map((f) => (
                <li key={f.slug}>
                  <Link href={facetPath(f)} prefetch={false} className="pill">
                    {f.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <nav aria-label={genre.kind === 'facet' ? 'Жанры' : 'Другие жанры'} className="flex flex-col gap-4">
          <h2 className="section-title">{genre.kind === 'facet' ? 'Жанры' : 'Другие жанры'}</h2>
          <ul className="flex flex-wrap gap-2">
            {HUB_TAGS.filter((t) => genre.kind !== 'genre' || t !== genre.tag).map((t) => (
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
 */
function Onward({ genre }: { genre: Genre }) {
  const facet: HubFacet | null = genre.kind === 'facet' ? genre.facet : null
  const arrow = <Icon name="arrow" className="ml-1.5 inline-block align-[-0.125em]" />
  if (facet?.party) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Link href="/compat" prefetch={navPrefetch('/compat')} className="btn-ember px-6 py-3">
          Что есть у вас обоих {arrow}
        </Link>
        <p className="text-sm text-dim">Сравни библиотеки с другом — и увидишь, во что вам зайти вместе.</p>
      </div>
    )
  }
  if (facet?.drop === 'match' && SLEEP) {
    return (
      <div>
        <Link href={presetHref(SLEEP)} className="btn-ember px-6 py-3">
          {SLEEP.label} — из своей библиотеки {arrow}
        </Link>
      </div>
    )
  }
  return (
    <div>
      <Link href="/quiz" className="btn-ember px-6 py-3">
        Подобрать из своей библиотеки {arrow}
      </Link>
    </div>
  )
}

/**
 * Строка под карточкой: за что игру любят — или, пока это не собрано, её
 * описание витрины, если оно по-русски. Английский абзац посреди русской
 * страницы хуже, чем ничего.
 *
 * Два пункта — двумя предложениями (pointsLine), а не через «; »: второй
 * пункт начинается с заглавной, и выходило «…повторяемость; Богатая
 * история».
 */
function Why({ game }: { game: GenreGame }) {
  if (game.loved.length) {
    return (
      <p className="mt-2 text-sm leading-snug text-dim">
        <span className="font-semibold text-ink">За что любят:</span> {pointsLine(game.loved.slice(0, 2))}
      </p>
    )
  }
  if (game.about) {
    return <p className="mt-2 text-sm leading-snug text-dim">{clip(game.about, 140) ?? game.about.slice(0, 140)}</p>
  }
  return null
}
