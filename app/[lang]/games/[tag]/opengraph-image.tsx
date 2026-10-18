import { ImageResponse } from 'next/og'
import { ogFonts, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { PosterWall, postersOf, WallShade, WALL_POSTERS } from '@/lib/ogcard'
import { CANVAS_WIDE, WALL_WIDE } from '@/lib/ogwall'
import { loadGenre } from './load'
import { isLocale, pl, tr } from '@/lib/i18n'

/**
 * Подпись картинки — русская, как была: Next читает alt константой модуля, а
 * не на запрос. generateImageMetadata перенёс бы картинку на адрес
 * …/opengraph-image/<id>, и у русской страницы сменился бы сам og:image.
 * Английскую подпись на /en ставит страница своим openGraph.images с этой же
 * карточкой (EN_CARD в page.tsx; почему так можно — у карточки игры,
 * app/[lang]/game/[appid]).
 */
export const alt = 'Жанр — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Карточка жанра для чатов и выдачи: стена постеров его верхних игр — тот же
 * жест, что у портрета и сравнения (lib/ogcard), — и название жанра.
 *
 * Сутки кэша, как у страницы: список меняется не чаще. Пустой
 * generateStaticParams регистрирует сегмент — без него revalidate не значит
 * ничего (см. app/room/[id]/opengraph-image.tsx); карточки рисуются по
 * первому запросу, а не на сборке, где базы может не быть.
 *
 * Ошибка базы НЕ ловится. Стоял try/catch с карточкой без стены: одна осечка
 * Turso при перегенерации — и вместо постеров роглайков сутки висела общая
 * «Игры по жанрам». Брошенная ошибка оставляет в кэше прошлую карточку
 * (docs: incremental-static-regeneration, «Handling uncaught exceptions»).
 * Цена — пятисотка тому краулеру, который первым просит ещё не
 * закэшированную карточку во время сбоя; она не кэшируется, и следующий
 * запрос рисует заново. Сторож — og.test.ts рядом.
 */
export const revalidate = 86_400

export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

export default async function Image({ params }: { params: Promise<{ lang: string; tag: string }> }) {
  const { lang, tag } = await params
  // Язык не из LOCALES (/_x/…) — 404: notFound() корневого layout до обработчика не доходит
  if (!isLocale(lang)) return new Response('Not found', { status: 404 })
  // Дальше lang — язык страницы жанра: заголовок (hubTitle) и подписи на нём
  const locale = lang
  // null — незнакомый адрес: карточка без стены, с общим заголовком
  const genre = await loadGenre(tag, locale)
  const games = genre?.games ?? []
  const byId = new Map(games.map((g) => [g.appid, g]))
  const posters = await postersOf(games.slice(0, WALL_POSTERS), (id) => byId.get(id))
  const n = games.length
  const gamesWord = pl(locale, n, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })

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
        <PosterWall posters={posters} spec={WALL_WIDE} />
        <WallShade canvas={CANVAS_WIDE} />
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
          <div style={{ fontSize: 20, letterSpacing: 6, color: OG_EMBER, marginBottom: 18 }}>
            {tr(locale, { ru: 'IMBORED.CC · ИГРЫ ПО ЖАНРАМ', en: 'IMBORED.CC · GAMES BY GENRE' })}
          </div>
          {/* Запас снизу — под хвосты кириллицы (см. карточку портрета) */}
          <div style={{ fontSize: 76, lineHeight: 1.12, marginBottom: 22 }}>
            {genre ? genre.title : tr(locale, { ru: 'Игры по жанрам', en: 'Games by genre' })}
          </div>
          {/* Порядок — по числу отзывов, как на странице, а не по их доле:
              «ranked by reviews» читалось бы рейтингом. «this» — жанр из
              заголовка над строкой. Не шире русской (замер Manrope 800,
              26 px: 693 против 751 px у «40 игр…»), в строку на 1072 px */}
          <div style={{ fontSize: 26, color: OG_DIM }}>
            {n > 0
              ? tr(locale, {
                  ru: `${n} ${gamesWord}, для которых жанр главный, — по отзывам игроков`,
                  en: `${n} ${gamesWord} where this is a main tag, most-reviewed first`,
                })
              : tr(locale, {
                  ru: 'Тридцать жанров — по отзывам игроков Steam',
                  en: 'Thirty genres, most-reviewed games first',
                })}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
