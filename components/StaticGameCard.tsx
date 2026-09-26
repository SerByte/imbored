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
  morph = false,
}: {
  appid: number
  name: string
  headerImage?: string | null
  art?: GameArtUrls | null
  sizes?: string
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
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : null}
    </span>
  )
  return (
    <>
      {morph ? <GameMorph appid={appid}>{thumb}</GameMorph> : thumb}
      <span className="mt-3 block px-0.5">
        <span className="block truncate text-[15px] leading-tight font-extrabold tracking-[-0.01em]">
          {name}
        </span>
      </span>
    </>
  )
}
