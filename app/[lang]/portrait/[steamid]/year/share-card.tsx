import { getGamesMetaLite, getLatestSnapshot, getLibraryBaselines, getPersonaName } from '@/lib/db'
import { dateLabel } from '@/lib/freshness'
import { OG_BG, OG_DIM, OG_EMBER, OG_INK, ogFonts, ogNum } from '@/lib/og'
import { CANVAS_TALL, CANVAS_WIDE, WALL_TALL, WALL_WIDE } from '@/lib/ogwall'
import { pl, tr, type Locale } from '@/lib/i18n'
import { playedLine } from '@/lib/outcome'
import { plural } from '@/lib/plural'
import { getDb } from '@/lib/server'
import { quoted } from '@/lib/sharedpick'
import {
  buildWrappedYear,
  isEmptyYear,
  pickYearWindow,
  yearCandidates,
  yearEyebrow,
  yearsToRead,
} from '@/lib/wrapped'
import { PosterWall, postersOf, WALL_POSTERS, WallShade } from '@/lib/ogcard'
import { playerName } from '../portrait-text'

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
  /** Язык карточки — адреса картинки; подписи YearCardImage — на нём же, как ник и надзаголовок */
  locale: Locale
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

export async function loadYearCardData(steamid: string, locale: Locale = 'ru'): Promise<YearCardData | null> {
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
    locale,
    name: playerName(steamid, await getPersonaName(db, steamid), locale),
    eyebrow: yearEyebrow(year, locale).toUpperCase(),
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
  const locale = data.locale
  const counts = [
    data.minutes > 0 && data.unpackedCount > 0
      ? tr(locale, {
          ru: `${data.unpackedCount} ${plural(data.unpackedCount, 'впервые запущена', 'впервые запущены', 'впервые запущено')}`,
          en: `${ogNum(data.unpackedCount, locale)} first launched`,
        })
      : null,
    data.minutes > 0 && data.addedCount > 0
      ? tr(locale, {
          ru: `${data.addedCount} ${plural(data.addedCount, 'появилась', 'появились', 'появилось')} в библиотеке`,
          en: `${ogNum(data.addedCount, locale)} added to library`,
        })
      : null,
  ].filter(Boolean)
  const games = pl(locale, data.addedCount, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })
  const from = dateLabel(data.from, { year: data.fromPrevYear, locale })
  const to = dateLabel(data.to, { year: data.closed, locale })

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
        {/* Без минут крупная строка — новые игры, а не «+0 мин в играх» */}
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: wide ? 18 : 30 }}>
          <div style={{ fontSize: wide ? 64 : 88, color: OG_EMBER }}>
            {data.minutes > 0
              ? `+${playedLine(data.minutes, locale)}`
              : tr(locale, { ru: `+${data.addedCount}`, en: `+${ogNum(data.addedCount, locale)}` })}
          </div>
          <div style={{ fontSize: wide ? 22 : 26, color: OG_DIM, marginLeft: 18 }}>
            {data.minutes > 0
              ? tr(locale, { ru: 'в играх', en: 'played' })
              : tr(locale, { ru: `${games} в библиотеке`, en: `${games} in the library` })}
          </div>
        </div>
        {data.top.map((g, i) => (
          <div key={i} style={{ fontSize: wide ? 22 : 28, color: OG_INK, marginBottom: 8 }}>
            {tr(locale, {
              ru: `${i + 1}. «${g.name.slice(0, 30)}» — +${playedLine(g.minutes)}`,
              en: `${i + 1}. ${quoted(g.name.slice(0, 30), 'en')} — +${playedLine(g.minutes, locale)}`,
            })}
          </div>
        ))}
        {counts.length > 0 && (
          <div style={{ fontSize: wide ? 20 : 24, color: OG_DIM, marginTop: wide ? 10 : 18 }}>
            {counts.join(' · ')}
          </div>
        )}
        <div style={{ fontSize: wide ? 18 : 20, color: OG_DIM, marginTop: wide ? 10 : 22 }}>
          {tr(locale, {
            ru: `По снимкам библиотеки: с ${from} по ${to}`,
            en: `Based on library snapshots from ${from} to ${to}`,
          })}
        </div>
      </div>
    </div>
  )
}
