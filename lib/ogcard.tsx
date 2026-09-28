import { artCandidates, type ArtVariant, type GameArtUrls } from './art'
import { ogGlow, ogPoster, ogScrim } from './og'
import { wallColumns, wallSize, type WallSpec } from './ogwall'

/**
 * Общие слои карточек next/og: стена постеров, затемнение и одиночный арт.
 *
 * Жили в карточке портрета, пока карточка была одна. Их берут портрет, итоги
 * года, совместимость и пати — импортировать чужой сегмент маршрута значило
 * бы связать /compat с внутренностями /portrait. Здесь, а не в components/:
 * модуль тянет lib/og, а тот читает шрифты через node:fs при загрузке.
 */

type ArtSource = { art?: GameArtUrls | null; headerImage?: string | null }

/**
 * Уникальных постеров на стене. Каждый — загрузка при рендере; клеток больше,
 * и остальное — повтор, который ничего не стоит.
 */
export const WALL_POSTERS = 12

/** Постеры игр — параллельно, каждый со своим таймаутом (ogPoster) */
export async function postersOf(
  games: ReadonlyArray<{ appid: number }>,
  metaOf: (appid: number) => ArtSource | undefined,
): Promise<string[]> {
  const got = await Promise.all(
    games.map((g) => {
      const meta = metaOf(g.appid)
      return ogPoster(
        artCandidates({ appid: g.appid, art: meta?.art ?? null, headerImage: meta?.headerImage ?? null }, 'poster'),
      )
    }),
  )
  return got.filter((p): p is string => p !== null)
}

/**
 * Один широкий арт игры — фон карточки пати после матча и выбора (/pick).
 *
 * Кандидатов не больше max: ogPoster перебирает их по очереди, по таймауту
 * на каждого, а у героя адресов до шести — краулер столько не ждёт.
 */
export async function ogArt(
  g: { appid: number } & ArtSource,
  variant: ArtVariant = 'hero',
  max = 3,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<string | null> {
  const src = { appid: g.appid, art: g.art ?? null, headerImage: g.headerImage ?? null }
  const candidates = [...new Set([...artCandidates(src, variant), ...artCandidates(src)])].slice(0, max)
  return ogPoster(candidates, opts)
}

/**
 * Стена постеров под карточкой — тот же жест, что у героя портрета на сайте.
 * satori не знает grid: стена — ряд колонок, поворот — у контейнера.
 */
export function PosterWall({ posters, spec }: { posters: string[]; spec: WallSpec }) {
  const columns = wallColumns(posters, spec)
  if (!columns.length) return null
  const { width, height } = wallSize(spec)
  return (
    <div
      style={{
        position: 'absolute',
        left: spec.left,
        top: spec.top,
        width,
        height,
        display: 'flex',
        transform: `rotate(${spec.angleDeg}deg)`,
        opacity: 0.8,
      }}
    >
      {columns.map((column, c) => (
        <div
          key={c}
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginRight: c < columns.length - 1 ? spec.gap : 0,
            marginTop: c % 2 ? spec.stagger : 0,
          }}
        >
          {column.map((src, r) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={r}
              src={src}
              width={spec.cellW}
              height={spec.cellH}
              alt=""
              style={{
                width: spec.cellW,
                height: spec.cellH,
                objectFit: 'cover',
                borderRadius: 12,
                marginBottom: r < column.length - 1 ? spec.gap : 0,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Скрим и тёплое пятно поверх стены — текст ложится на погашенное. Размер —
 * пикселями: у satori абсолютный слой в процентах схлопывается в ноль, и
 * стена оставалась голой (замерено на первой отрисовке).
 */
export function WallShade({ canvas }: { canvas: { width: number; height: number } }) {
  const fill = { position: 'absolute', left: 0, top: 0, ...canvas, display: 'flex' } as const
  return (
    <>
      <div style={{ ...fill, backgroundImage: ogScrim() }} />
      <div style={{ ...fill, backgroundImage: ogGlow() }} />
    </>
  )
}

/** Один арт во весь холст под тем же затемнением — фон вместо стены */
export function ArtBackdrop({ src, canvas }: { src: string; canvas: { width: number; height: number } }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        width={canvas.width}
        height={canvas.height}
        alt=""
        style={{ position: 'absolute', left: 0, top: 0, ...canvas, objectFit: 'cover' }}
      />
      <WallShade canvas={canvas} />
    </>
  )
}
