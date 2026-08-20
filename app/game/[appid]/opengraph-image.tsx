import { ImageResponse } from 'next/og'
import { artCandidates } from '@/lib/art'
import { loadGamePage, reviewFacts } from '@/lib/gamepage'
import { ogFonts, ogNum, ogScrim, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'

export const alt = 'Стоит ли играть — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Своя карточка у страницы игры — и не только ради красоты.
 *
 * Файловая метадата приоритетнее объекта metadata и НАСЛЕДУЕТСЯ вниз по
 * дереву. Как только у корня появилась app/opengraph-image.tsx, она накрыла
 * бы собой и страницу игры: вместо арта конкретной игры в чате разворачивался
 * бы общий знак продукта. То есть этот файл здесь обязателен, чтобы не
 * потерять то, что уже работало.
 *
 * Заодно карточка перестала быть сырым баннером из Steam. Раньше в openGraph
 * подставлялся сам header-файл 920×430: чужая пропорция (мессенджеры режут её
 * по краям), ни названия поверх, ни следов imbored. Теперь это кадр из того
 * же кино, что и страница: арт во всю карточку, скрим снизу, текст на нём —
 * ровно та композиция, которую человек увидит, перейдя по ссылке.
 *
 * Сутки жизни как у самой страницы: карточка читает те же данные из базы, и
 * расходиться им незачем.
 */
export const revalidate = 86_400

export default async function Image({ params }: { params: Promise<{ appid: string }> }) {
  const { appid: raw } = await params
  const appid = Number(raw)
  const data = Number.isInteger(appid) && appid !== 0 ? await loadGamePage(appid) : null

  if (!data) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: OG_BG,
            color: OG_EMBER,
            fontFamily: 'JetBrains Mono',
            fontSize: 40,
            letterSpacing: 6,
          }}
        >
          IMBORED.CC
        </div>
      ),
      { ...size, fonts: await ogFonts },
    )
  }

  const { meta, reviewsSummary } = data
  const art =
    artCandidates({ appid: meta.appid, art: meta.art, headerImage: meta.headerImage }, 'hero')[0] ??
    artCandidates({ appid: meta.appid, art: meta.art, headerImage: meta.headerImage })[0] ??
    null

  // Тот же запасной источник, что и на самой странице: без него карточка 278
  // игр из тысячи уезжала в чат вообще без оценки.
  const facts = reviewFacts(meta, reviewsSummary)
  const tags = Object.entries(meta.tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t)

  const lines = [
    facts ? `${facts.percent}% из ${ogNum(facts.total)} отзывов — за` : null,
    tags.length ? tags.join(' · ') : null,
  ].filter(Boolean) as string[]

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
          fontFamily: 'Onest',
        }}
      >
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={art}
            width={1200}
            height={630}
            style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, objectFit: 'cover' }}
            alt=""
          />
        ) : null}

        {/* Скрим снизу — тот же жест, что у кино-героя страницы */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 1200,
            height: 630,
            backgroundImage: ogScrim(),
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 72,
            right: 72,
            bottom: 56,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontFamily: 'JetBrains Mono',
              fontSize: 20,
              letterSpacing: 6,
              color: OG_EMBER,
              marginBottom: 16,
            }}
          >
            СТОИТ ЛИ ИГРАТЬ
          </div>

          {/* Отступ снизу большой намеренно — см. lib/og про кириллические выносные */}
          <div style={{ display: 'flex', fontSize: 76, lineHeight: 1.15, marginBottom: lines.length ? 26 : 0 }}>
            {meta.name.slice(0, 42)}
          </div>

          {lines.length > 0 && (
            <div style={{ display: 'flex', fontSize: 28, color: OG_DIM }}>{lines.join('  ·  ')}</div>
          )}
        </div>

        <div
          style={{
            position: 'absolute',
            right: 72,
            top: 56,
            display: 'flex',
            fontFamily: 'JetBrains Mono',
            fontSize: 20,
            letterSpacing: 3,
            color: OG_EMBER,
          }}
        >
          IMBORED.CC
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
