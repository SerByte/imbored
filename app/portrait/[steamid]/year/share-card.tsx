import { getGamesMetaLite, getLatestSnapshot, getLibraryBaselines, getPersonaName } from '@/lib/db'
import { dateLabel } from '@/lib/freshness'
import { OG_BG, OG_DIM, OG_EMBER, OG_INK, ogFonts } from '@/lib/og'
import { WALL_TALL, WALL_WIDE } from '@/lib/ogwall'
import { playedLine } from '@/lib/outcome'
import { plural } from '@/lib/plural'
import { getDb } from '@/lib/server'
import {
  buildWrappedYear,
  isEmptyYear,
  pickYearWindow,
  yearCandidates,
  yearEyebrow,
  yearsToRead,
} from '@/lib/wrapped'
import { CANVAS_TALL, CANVAS_WIDE, PosterWall, postersOf, WALL_POSTERS, WallShade } from '../share-card'

/**
 * Карточка итогов года — OG-превью 1200×630 и сторис 1080×1350. Та же
 * основа, что у карточки портрета: стена постеров, скрим, текст снизу.
 *
 * Окно года — от последнего снимка, как у страницы (yearsToRead,
 * pickYearWindow), а не от часов сервера: иначе в новогоднюю ночь карточка
 * и страница показали бы разные годы. Картинка кэшируется на час, и строка
 * с датами держит её честной: «по 26 сентября» — это снимок, а не сегодня.
 */

export const fonts = ogFonts

export type YearCardData = {
  name: string
  eyebrow: string
  minutes: number
  from: number
  to: number
  fromPrevYear: boolean
  closed: boolean
  top: Array<{ name: string; minutes: number }>
  unpackedCount: number
  addedCount: number
  posters: string[]
}

export async function loadYearCardData(steamid: string): Promise<YearCardData | null> {
  if (!/^\d{17}$/.test(steamid)) return null
  const db = await getDb()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return null
  const [fromYear, toYear] = yearsToRead(snapshot.takenAt)
  const window = pickYearWindow(snapshot, await getLibraryBaselines(db, steamid, fromYear, toYear))
  if (!window) return null
  // Мета — только игр года, как у страницы: остальная библиотека итогам не нужна
  const metas = await getGamesMetaLite(db, yearCandidates(window))
  const metaOf = (id: number) => metas.get(id)
  const year = buildWrappedYear(window, metaOf)
  if (isEmptyYear(year)) return null

  const wall = [...year.top, ...year.unpacked.games, ...year.added.games]
    .filter((g, i, all) => g.appid > 0 && all.findIndex((x) => x.appid === g.appid) === i)
    .slice(0, WALL_POSTERS)

  return {
    name: (await getPersonaName(db, steamid)) ?? `Игрок ${steamid.slice(-4)}`,
    eyebrow: yearEyebrow(year).toUpperCase(),
    minutes: year.minutes,
    from: year.from,
    to: year.to,
    fromPrevYear: year.fromPrevYear,
    closed: year.closed,
    top: year.top.slice(0, 3).map((g) => ({ name: g.name, minutes: g.minutes })),
    unpackedCount: year.unpacked.count,
    addedCount: year.added.count,
    posters: await postersOf(wall, metaOf),
  }
}

export function YearCardImage({ data, wide }: { data: YearCardData; wide: boolean }) {
  const counts = [
    data.unpackedCount > 0
      ? `${data.unpackedCount} ${plural(data.unpackedCount, 'впервые запущена', 'впервые запущены', 'впервые запущено')}`
      : null,
    data.addedCount > 0
      ? `${data.addedCount} ${plural(data.addedCount, 'появилась', 'появились', 'появилось')} в библиотеке`
      : null,
  ].filter(Boolean)
  const dates = `с ${dateLabel(data.from, { year: data.fromPrevYear })} по ${dateLabel(data.to, { year: data.closed })}`

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: OG_BG,
        color: OG_INK,
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
        <div style={{ fontSize: 20, letterSpacing: 6, color: OG_EMBER, marginBottom: 18 }}>
          {`IMBORED.CC · ${data.eyebrow}`}
        </div>
        {/* Запас снизу — под хвосты кириллицы, как у карточки портрета */}
        <div style={{ fontSize: wide ? 64 : 80, lineHeight: 1.15, marginBottom: wide ? 18 : 28 }}>
          {data.name.slice(0, 22)}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: wide ? 18 : 30 }}>
          <div style={{ fontSize: wide ? 64 : 88, color: OG_EMBER }}>{`+${playedLine(data.minutes)}`}</div>
          <div style={{ fontSize: wide ? 22 : 26, color: OG_DIM, marginLeft: 18 }}>в играх</div>
        </div>
        {data.top.map((g, i) => (
          <div key={i} style={{ fontSize: wide ? 22 : 28, color: OG_INK, marginBottom: 8 }}>
            {`${i + 1}. «${g.name.slice(0, 30)}» — +${playedLine(g.minutes)}`}
          </div>
        ))}
        {counts.length > 0 && (
          <div style={{ fontSize: wide ? 20 : 24, color: OG_DIM, marginTop: wide ? 10 : 18 }}>
            {counts.join(' · ')}
          </div>
        )}
        <div style={{ fontSize: wide ? 18 : 20, color: OG_DIM, marginTop: wide ? 10 : 22 }}>
          {`По снимкам библиотеки: ${dates}`}
        </div>
      </div>
    </div>
  )
}
