import { ImageResponse } from 'next/og'
import { ogFonts, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { PosterWall, postersOf, WallShade, WALL_POSTERS } from '@/lib/ogcard'
import { CANVAS_WIDE, WALL_WIDE } from '@/lib/ogwall'
import { plural } from '@/lib/plural'
import { loadGenre } from './load'

export const alt = 'Жанр — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Карточка жанра для чатов и выдачи: стена постеров его верхних игр — тот же
 * жест, что у портрета и сравнения (lib/ogcard), — и название жанра. У
 * подборки (HUB_FACETS: «с другом», «бесплатные»…) — то же самое с её
 * заголовком: «во что поиграть с другом» пересылают чаще любого жанра.
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

export default async function Image({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params
  // null — незнакомый адрес: карточка без стены, с общим заголовком
  const genre = await loadGenre(tag)
  const games = genre?.games ?? []
  const byId = new Map(games.map((g) => [g.appid, g]))
  const posters = await postersOf(games.slice(0, WALL_POSTERS), (id) => byId.get(id))
  const n = games.length

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
          {/* Подборка (/games/coop…) — не жанр: и шапка, и подпись говорят,
              по чему отобрано, а не «жанр главный» */}
          <div style={{ fontSize: 20, letterSpacing: 6, color: OG_EMBER, marginBottom: 18 }}>
            {genre?.kind === 'facet' ? 'IMBORED.CC · ПОДБОРКИ' : 'IMBORED.CC · ИГРЫ ПО ЖАНРАМ'}
          </div>
          {/* Запас снизу — под хвосты кириллицы (см. карточку портрета) */}
          <div style={{ fontSize: 76, lineHeight: 1.12, marginBottom: 22 }}>
            {genre ? genre.title : 'Игры по жанрам'}
          </div>
          <div style={{ fontSize: 26, color: OG_DIM }}>
            {n > 0
              ? genre?.kind === 'facet'
                ? `${n} ${plural(n, 'игра', 'игры', 'игр')} — по отзывам игроков Steam`
                : `${n} ${plural(n, 'игра', 'игры', 'игр')}, для которых жанр главный, — по отзывам игроков`
              : 'Тридцать жанров — по отзывам игроков Steam'}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
