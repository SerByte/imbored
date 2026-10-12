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
  morph?: boolean
}) {
  const source = { appid, art, headerImage }
  const src = artCandidates(source, 'card')[0]
  const srcSet = artSrcSet(source, 'card')
  const thumb = (
    <span className="card-thumb aspect-[460/215]">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          srcSet={srcSet}
          sizes={srcSet ? sizes : undefined}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : null}
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
