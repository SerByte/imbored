import { ImageResponse } from 'next/og'
import { clip } from '@/lib/clip'
import { ogFonts, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { ArtBackdrop, ogArt } from '@/lib/ogcard'
import { CANVAS_WIDE } from '@/lib/ogwall'
import { pickCopy, quoted } from '@/lib/sharedpick'
import { loadSharedPick } from './load'

export const alt = 'Выбор на вечер — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** Выбор не меняется; час — чтобы удаление по запросу догнало и картинку */
export const revalidate = 3600

/**
 * Регистрирует сегмент в манифесте — без этого revalidate выше мёртв (см.
 * такую же функцию у портрета). Пустой список: адреса персональные.
 */
export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

/**
 * Карточка выбора в чате: арт игры во весь холст, над ним — «imbored выбрал
 * мне на вечер», название и начало объяснения. Цены нет — ссылка живёт
 * месяц. Выбора нет (истёк, удалён) — приглашение без игры.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const got = await loadSharedPick(id)
  const copy = pickCopy(got ? { name: got.meta.name, reason: got.pick.reason, kind: got.pick.kind } : null)
  const art = got ? await ogArt(got.meta) : null

  return new ImageResponse(
    (
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
          <div style={{ fontSize: 20, letterSpacing: 6, color: OG_EMBER, marginBottom: 18 }}>{copy.eyebrow}</div>
          {/* Запас снизу — под хвосты кириллицы (см. карточку портрета) */}
          <div style={{ fontSize: 72, lineHeight: 1.12, marginBottom: 22 }}>
            {got ? got.meta.name.slice(0, 40) : 'Одна игра на вечер'}
          </div>
          {got && (
            <div style={{ fontSize: 26, lineHeight: 1.35, color: OG_INK, marginBottom: 22, maxWidth: 1000 }}>
              {quoted(clip(got.pick.reason, 140) ?? got.pick.reason.slice(0, 140))}
            </div>
          )}
          <div style={{ fontSize: 20, color: OG_DIM }}>{copy.foot}</div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
