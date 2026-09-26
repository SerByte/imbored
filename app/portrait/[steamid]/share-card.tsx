import { artCandidates, type GameArtUrls } from '@/lib/art'
import { getGamesMetaLite, getLatestSnapshot, getPersonaName } from '@/lib/db'
import { ogFonts, ogGlow, ogNum, ogPoster, ogScrim, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { WALL_TALL, WALL_WIDE, wallColumns, wallSize, type WallSpec } from '@/lib/ogwall'
import { buildPortrait } from '@/lib/portrait'
import { getDb } from '@/lib/server'
import { buildWrapped } from '@/lib/wrapped'
import { gamesCaption, hoursCaption, unplayedCaption } from '@/lib/factcaptions'

/**
 * Общая начинка для двух картинок: OG-превью 1200×630 и скачиваемой карточки
 * 1080×1350. Рисуется на сервере через next/og.
 *
 * Почему не canvas на клиенте: steamstatic не отдаёт CORS-заголовков, любая
 * обложка делает canvas tainted и toBlob() падает.
 *
 * Шрифты и палитра переехали в lib/og.ts — со второй карточкой (совместимость)
 * они перестали быть частной деталью портрета.
 */

export const fonts = ogFonts

export type CardData = {
  name: string
  totalHours: number
  gamesCount: number
  unplayedCount: number
  archetypes: string[]
  /** Постеры стены — data-URI (ogPoster), самые наигранные первыми */
  posters: string[]
  topGame: { name: string; sharePercent: number } | null
}

/**
 * Уникальных постеров на стене. Каждый — загрузка при рендере; клеток больше,
 * и остальное — повтор, который ничего не стоит.
 */
export const WALL_POSTERS = 12

export async function loadCardData(steamid: string): Promise<CardData | null> {
  if (!/^\d{17}$/.test(steamid)) return null
  const db = await getDb()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return null

  const games = snapshot.games
  const metas = await getGamesMetaLite(
    db,
    games.map((g) => g.appid),
  )
  const metaOf = (id: number) => metas.get(id)
  const portrait = buildPortrait(games, metaOf)
  const wrapped = buildWrapped(games, metaOf)

  // Стена — самые наигранные, как у героя портрета на сайте
  const played = games
    .filter((g) => g.appid > 0 && g.playtimeForever > 0)
    .sort((a, b) => b.playtimeForever - a.playtimeForever)
    .slice(0, WALL_POSTERS)
  const posters = await postersOf(played, metaOf)

  return {
    name: (await getPersonaName(db, steamid)) ?? `Игрок ${steamid.slice(-4)}`,
    totalHours: wrapped.totalHours,
    gamesCount: wrapped.gamesCount,
    unplayedCount: wrapped.unplayedCount,
    archetypes: portrait.archetypes.filter((a) => a.known).slice(0, 2).map((a) => a.label),
    posters,
    topGame: portrait.facts.topGame,
  }
}

const BG = OG_BG
const INK = OG_INK
const DIM = OG_DIM
const EMBER = OG_EMBER
const num = ogNum

/** Постеры игр — параллельно, каждый со своим таймаутом (ogPoster) */
export async function postersOf(
  games: ReadonlyArray<{ appid: number }>,
  metaOf: (appid: number) => { art?: GameArtUrls | null; headerImage?: string | null } | undefined,
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

/** Холсты карточек: OG и сторис */
export const CANVAS_WIDE = { width: 1200, height: 630 }
export const CANVAS_TALL = { width: 1080, height: 1350 }

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

/**
 * Раскладка карточки. Ориентация задаёт всё остальное: у широкой OG числа
 * встают в строку, у вертикальной — в колонку под ником.
 *
 * Библиотека — стеной постеров во весь холст, текст — снизу, поверх скрима:
 * раньше здесь была полоска из пяти обложек на прозрачности 0.3, и карточка
 * в чате читалась как таблица, а не как чей-то портрет.
 */
export function CardImage({ data, wide }: { data: CardData; wide: boolean }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: BG,
        color: INK,
        fontFamily: 'Manrope',
        overflow: 'hidden',
      }}
    >
      <PosterWall posters={data.posters} spec={wide ? WALL_WIDE : WALL_TALL} />
      <WallShade canvas={wide ? CANVAS_WIDE : CANVAS_TALL} />

      <div
        style={{
          position: 'absolute',
          left: 64,
          right: 64,
          bottom: wide ? 44 : 56,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            fontFamily: 'Manrope',
            fontSize: 20,
            letterSpacing: 6,
            color: EMBER,
            marginBottom: 18,
          }}
        >
          IMBORED.CC · ПОРТРЕТ ИГРОКА
        </div>

        {/* Отступ большой намеренно: у кириллицы «р», «у», «д» уходят заметно
            ниже базовой линии и вылезают за границу строки, съедая margin.
            Замерено по пикселям: при marginBottom 30 живой зазор был 6px против
            38px ниже. Прибавка через lineHeight тут не помогает — она делится
            поровну сверху и снизу. */}
        <div style={{ fontSize: wide ? 72 : 84, lineHeight: 1.15, marginBottom: wide ? 26 : 34 }}>
          {data.name.slice(0, 22)}
        </div>

        {data.archetypes.length > 0 && (
          <div style={{ fontSize: wide ? 28 : 30, color: DIM, marginBottom: wide ? 26 : 44 }}>
            {data.archetypes.join(' · ')}
          </div>
        )}

        {/* Числа строкой и в сторис: колонкой они поднимали текст на полкарточки и прятали стену */}
        <div style={{ display: 'flex' }}>
          <Stat value={num(data.totalHours)} caption={hoursCaption(data.totalHours)} wide={wide} />
          <Stat value={num(data.gamesCount)} caption={gamesCaption(data.gamesCount)} wide={wide} />
          <Stat
            value={num(data.unplayedCount)}
            caption={unplayedCaption(data.unplayedCount)}
            wide={wide}
          />
        </div>

        {/* Одной строкой, а не склейкой из выражений: satori требует явный
            display:flex у любого div с несколькими детьми, и смешанный текст
            роняет рендер целиком. */}
        {!wide && data.topGame && data.topGame.sharePercent >= 25 && (
          <div style={{ fontSize: 22, color: DIM, marginTop: 22 }}>
            {`${data.topGame.sharePercent}% всего времени — «${data.topGame.name.slice(0, 34)}»`}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ value, caption, wide }: { value: string; caption: string; wide: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginRight: wide ? 72 : 56 }}>
      <div style={{ fontFamily: 'Manrope', fontSize: wide ? 54 : 64, color: INK }}>{value}</div>
      <div style={{ fontSize: wide ? 20 : 22, color: DIM, marginTop: 4 }}>{caption}</div>
    </div>
  )
}
