import { ImageResponse } from 'next/og'
import { clip } from '@/lib/clip'
import { dateLabel } from '@/lib/freshness'
import { newsHeading } from '@/lib/newspage'
import { ogFonts, ogGlow, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { ArtBackdrop, ogArt } from '@/lib/ogcard'
import { CANVAS_WIDE } from '@/lib/ogwall'
import { loadPatch } from './load'

export const alt = 'Что изменилось в патче — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Своя карточка патча.
 *
 * До неё ссылка на патч разворачивалась карточкой игры — «СТОИТ ЛИ ИГРАТЬ»
 * и доля отзывов, — то есть по превью нельзя было понять, что прислали
 * новость, а не игру. Здесь то, ради чего у патча есть адрес: заголовок и
 * русский пересказ, на арте игры.
 *
 * Сутки кэша, как у страницы. Пустой generateStaticParams регистрирует
 * сегмент (без него revalidate мёртв, см. app/room/[id]/opengraph-image.tsx):
 * постов тысячи, карточка рисуется по первому запросу. Поста нет или база
 * молчит — нейтральная карточка, а не ошибка у краулера.
 */
export const revalidate = 86_400

export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

export default async function Image({ params }: { params: Promise<{ appid: string; gid: string }> }) {
  const { appid, gid } = await params
  let page: Awaited<ReturnType<typeof loadPatch>> = null
  try {
    page = await loadPatch(appid, gid)
  } catch {
    page = null
  }
  const item = page?.item ?? null
  const game = page?.game ?? null
  // Арт не дотянулся (чужой CDN, таймаут) — тёмная карточка со свечением
  const art = item && game ? await ogArt({ appid: item.appid, art: game.art, headerImage: game.headerImage }) : null

  const heading = item ? newsHeading(item.title, game?.name) : 'Что изменилось в играх'
  const tldr = item?.tldr?.trim() ? (clip(item.tldr.trim(), 150) ?? item.tldr.trim().slice(0, 150)) : null
  const eyebrow = game ? `ЧТО ИЗМЕНИЛОСЬ · ${game.name.toUpperCase().slice(0, 36)}` : 'ЧТО ИЗМЕНИЛОСЬ'
  const foot = item
    ? `${item.scale === 'hotfix' ? 'Хотфикс' : 'Патч'} · ${dateLabel(item.publishedAt, { year: true })}`
    : 'Пересказы патчей по-русски'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: OG_BG,
          ...(art ? {} : { backgroundImage: ogGlow() }),
          color: OG_INK,
          fontFamily: 'Manrope',
          overflow: 'hidden',
        }}
      >
        {art && <ArtBackdrop src={art} canvas={CANVAS_WIDE} />}
        <div
          style={{
            position: 'absolute',
            left: 64,
            right: 64,
            bottom: 48,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ fontSize: 20, letterSpacing: 6, color: OG_EMBER, marginBottom: 18 }}>{eyebrow}</div>
          {/* Запас снизу — под хвосты кириллицы (см. карточку портрета) */}
          <div style={{ fontSize: tldr ? 56 : 68, lineHeight: 1.14, marginBottom: 22, maxWidth: 1072 }}>
            {clip(heading, 90) ?? heading.slice(0, 90)}
          </div>
          {tldr && (
            <div style={{ fontSize: 26, lineHeight: 1.35, color: OG_INK, marginBottom: 22, maxWidth: 1000 }}>
              {tldr}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, color: OG_DIM }}>
            <div style={{ display: 'flex' }}>{foot}</div>
            <div style={{ display: 'flex', letterSpacing: 3, color: OG_EMBER }}>IMBORED.CC</div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
