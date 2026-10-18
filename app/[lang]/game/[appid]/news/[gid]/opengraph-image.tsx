import { ImageResponse } from 'next/og'
import { clip } from '@/lib/clip'
import { dateLabel } from '@/lib/freshness'
import { newsHeading, newsTitleOn } from '@/lib/newspage'
import { ogFonts, ogGlow, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { ArtBackdrop, ogArt } from '@/lib/ogcard'
import { CANVAS_WIDE } from '@/lib/ogwall'
import { loadPatch } from './load'
import { isLocale, tr } from '@/lib/i18n'

/*
 * alt — статический экспорт: Next читает его у модуля один раз на все языки
 * (next-metadata-image-loader), и по языку его не развести. generateImageMetadata
 * дал бы свой alt каждому языку, но ценой адреса: /opengraph-image/<id> вместо
 * /opengraph-image, то есть другой og:image у русской страницы и мёртвые
 * старые превью. А свой openGraph.images на странице запрещает сторож
 * lib/social.test.ts. Поэтому на /en og:image:alt пока русский: решение одно
 * на все карточки сайта, а не на эту.
 */
export const alt = 'Что изменилось в патче — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Своя карточка патча.
 *
 * До неё ссылка на патч разворачивалась карточкой игры — «СТОИТ ЛИ ИГРАТЬ»
 * и доля отзывов, — то есть по превью нельзя было понять, что прислали
 * новость, а не игру. Здесь то, ради чего у патча есть адрес: заголовок и
 * пересказ, на арте игры. На языке адреса: loadPatch с языком отдаёт пересказ
 * своего языка (на /en — английский или никакого), заголовок — newsTitleOn.
 *
 * Сутки кэша, как у страницы. Пустой generateStaticParams регистрирует
 * сегмент (без него revalidate мёртв, см. app/room/[id]/opengraph-image.tsx):
 * постов тысячи, карточка рисуется по первому запросу. Поста нет —
 * нейтральная карточка, а не ошибка у краулера.
 *
 * А вот ошибка базы НЕ ловится, и это не то же самое, что «поста нет».
 * Стоял try/catch, и одна осечка Turso при перегенерации заменяла заголовок
 * с пересказом нейтральной карточкой на сутки. Брошенная ошибка оставляет в
 * кэше прошлую (docs: incremental-static-regeneration, «Handling uncaught
 * exceptions»); пятисотку увидит лишь краулер, первым попросивший ещё не
 * закэшированную карточку во время сбоя, — и она не кэшируется. Сторож —
 * og.test.ts рядом.
 */
export const revalidate = 86_400

export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

export default async function Image({ params }: { params: Promise<{ lang: string; appid: string; gid: string }> }) {
  const { lang, appid, gid } = await params
  // Язык не из LOCALES (/_x/…) — 404: notFound() корневого layout до обработчика не доходит
  if (!isLocale(lang)) return new Response('Not found', { status: 404 })
  const locale = lang
  const page = await loadPatch(appid, gid, locale)
  const item = page?.item ?? null
  const game = page?.game ?? null
  // Арт не дотянулся (чужой CDN, таймаут) — тёмная карточка со свечением
  const art = item && game ? await ogArt({ appid: item.appid, art: game.art, headerImage: game.headerImage }) : null

  const heading = item
    ? newsHeading(newsTitleOn(item, game?.name, locale), game?.name)
    : tr(locale, { ru: 'Что изменилось в играх', en: 'What changed in games' })
  const tldr = item?.tldr?.trim() ? (clip(item.tldr.trim(), 150) ?? item.tldr.trim().slice(0, 150)) : null
  const eyebrowWord = tr(locale, { ru: 'ЧТО ИЗМЕНИЛОСЬ', en: 'WHAT CHANGED' })
  const eyebrow = game ? `${eyebrowWord} · ${game.name.toUpperCase().slice(0, 36)}` : eyebrowWord
  // Дата — dateLabel, то есть UTC: карточка и страница печатают один день
  const kind =
    item?.scale === 'hotfix' ? tr(locale, { ru: 'Хотфикс', en: 'Hotfix' }) : tr(locale, { ru: 'Патч', en: 'Patch' })
  const foot = item
    ? `${kind} · ${dateLabel(item.publishedAt, { year: true, locale })}`
    : tr(locale, { ru: 'Пересказы патчей по-русски', en: 'Patch notes, in short' })

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
