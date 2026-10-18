import type { ReactNode } from 'react'
import { artCandidates, artSrcSet, type GameArtUrls } from '@/lib/art'
import { GameMorph } from './Morph'

/**
 * Карточка игры в ряду — серверная, без клиентского GameArt.
 *
 * Та же разметка, что у GameCardBody (обложка .card-thumb и подпись под ней),
 * но картинка — обычный <img> с srcSet из lib/art. Нужна там, где карточка
 * стоит в общей части дерева: полка 404 входит в сегмент корневого layout, и
 * клиентский GameArt с обложкой для игр не из Steam ехал оттуда в первую
 * загрузку всех двадцати маршрутов (route-bundle-stats.json).
 *
 * И там, где карточек сотни: у каждого GameArt в RSC-части страницы едет весь
 * объект арта — пять ссылок плюс дубль header, — а браузер гидрирует по
 * островку на карточку. Хаб /games на 360 капсул весил так 761 КБ HTML, из
 * них около 528 КБ — RSC-данные (perf-10 аудита); здесь в разметке остаются
 * только src и srcSet. Хаб и страницы жанров живут в ISR, и каждый их
 * килобайт — ещё и ISR Writes (lib/gamecache).
 *
 * Цепочки запасных источников по onError здесь нет — только первый кандидат.
 * Поэтому годится лишь для игр каталога с разрешённым артом (appid > 0);
 * если картинка всё же не загрузится, под ней остаётся фон .card-thumb.
 *
 * EAGER-ОБЛОЖКА — ВНУТРИ <picture>, И ЭТО НЕ УКРАШЕНИЕ РАЗМЕТКИ.
 *
 * Серверный <img> без loading="lazy" React превращает в подсказку
 * предзагрузки — `:HL[…,"image"]` в RSC-части страницы (getChildFormatContext,
 * case "img", в react-server-dom-turbopack). А RSC-часть приезжает и с
 * префетчем: <Link> на /games стоит в шапке («Каталог»), в подвале и в
 * крошках каждой карточки игры, и браузер, получив префетч, качал обложки
 * первой полки хаба на ЧУЖОЙ странице. Замер на проде: 215 КБ на каждом
 * просмотре любой страницы с десктопа (401 КБ на ретине), около 676 КБ на
 * телефонной карточке игры вместе с полкой жанра — и всё мимо экрана, при
 * пяти «preloaded but not used» в консоли. Внутри <picture> (и <noscript>)
 * подсказку не ставит ни Flight, ни Fizz — то же правило, что для lazy и
 * fetchPriority="low". На самом хабе обложки находит сканер предзагрузки в
 * разметке страницы, теряется только дубль-preload в <head>. fetchPriority
 * «low» вместо обёртки не годится: он прижал бы и видимые обложки, включая
 * LCP хаба. Сторож — imageHints в app/games/page.test.ts.
 *
 * className="contents" — обёртка не создаёт своего бокса: картинка
 * по-прежнему заполняет .card-thumb, как прямой ребёнок.
 *
 * Обёртка — только у eager. Ленивой картинке подсказку React не ставит и
 * так, а <picture> на каждой из 360 капсул хаба — это около 20 КБ лишнего в
 * RSC-части и столько же в HTML на каждую перегенерацию страницы (замер
 * сборки: 358 → 400 КБ games.rsc с обёрткой у всех), то есть ещё и
 * ISR Writes.
 */
export function StaticGameCardBody({
  appid,
  name,
  headerImage,
  art,
  sizes,
  corner,
  meta,
  eager = false,
  fetchPriority,
  morph = false,
}: {
  appid: number
  name: string
  headerImage?: string | null
  art?: GameArtUrls | null
  sizes?: string
  /** угол обложки: номер в списке, бейдж — как у GameCardBody */
  corner?: ReactNode
  /** строка под названием: процент, длина захода */
  meta?: ReactNode
  /** обложка над сгибом — грузить сразу, а не лениво */
  eager?: boolean
  /**
   * Только для обложки, которая станет LCP экрана (как у GameArt): eager
   * снимает ленивость, но в очереди браузера картинка остаётся Low рядом с
   * соседями по полке.
   */
  fetchPriority?: 'high' | 'low' | 'auto'
  morph?: boolean
}) {
  const source = { appid, art, headerImage }
  const src = artCandidates(source, 'card')[0]
  const srcSet = artSrcSet(source, 'card')
  const img = src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={fetchPriority}
      decoding="async"
      className="h-full w-full object-cover"
    />
  ) : null
  const thumb = (
    <span className="card-thumb aspect-[460/215]">
      {img && eager ? <picture className="contents">{img}</picture> : img}
      {corner}
    </span>
  )
  return (
    <>
      {morph ? <GameMorph appid={appid}>{thumb}</GameMorph> : thumb}
      <span className="mt-3 block px-0.5">
        <span className="block truncate text-[15px] leading-tight font-extrabold tracking-[-0.01em]">
          {name}
        </span>
        {meta ? (
          <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[13px] leading-snug font-semibold text-dim">
            {meta}
          </span>
        ) : null}
      </span>
    </>
  )
}
