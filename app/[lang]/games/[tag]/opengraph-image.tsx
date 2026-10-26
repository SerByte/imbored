import { ogFonts, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { PosterWall, postersOf, WallShade, WALL_POSTERS } from '@/lib/ogcard'
import { isrImage } from '@/lib/ogresponse'
import { CANVAS_WIDE, WALL_WIDE } from '@/lib/ogwall'
import { loadGenre } from './load'
import { isLocale, pl, tr } from '@/lib/i18n'

/**
 * Подпись картинки — русская: Next читает alt константой модуля, а не на
 * запрос. generateImageMetadata перенёс бы картинку на адрес
 * …/opengraph-image/<id>, и у русской страницы сменился бы сам og:image.
 * Английскую подпись на /en ставит страница своим openGraph.images с этой же
 * карточкой (EN_CARD в page.tsx; почему так можно — у карточки игры,
 * app/[lang]/game/[appid]).
 *
 * Одна на сегмент — и для жанра, и для подборки (/games/coop…): «Жанр» у
 * карточки «Кооперативных игр» говорил бы скринридеру неправду.
 */
export const alt = 'Подборка игр — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Карточка жанра для чатов и выдачи: стена постеров его верхних игр — тот же
 * жест, что у портрета и сравнения (lib/ogcard), — и название жанра. У
 * подборки (HUB_FACETS: «с другом», «бесплатные»…) — то же самое с её
 * заголовком: «во что поиграть с другом» пересылают чаще любого жанра.
 *
 * Без срока (revalidate = false): нарисованная карточка живёт в кэше до
 * следующего деплоя — он сбрасывает кэш ISR, и первая же пересылка рисует её
 * по свежему каталогу. Стояли сутки, как у страницы, но картинке они ничего
 * не давали: на стене двенадцать верхних постеров жанра и его название, а
 * верх жанра по отзывам стоит неделями, — зато каждая перерисовка стоила
 * ~785 КБ PNG (около ста блоков ISR Writes по 8 КБ), ~1,4 с CPU и двенадцать
 * походов за артом. Деплоев в месяц и так несколько, а точечный сброс
 * кронов (revalidateGamePages) жанров не касается вовсе.
 *
 * Пустой generateStaticParams регистрирует сегмент: без него маршрут
 * остаётся ƒ и рисует картинку на каждый заход краулера, а revalidate не
 * значит ничего (см. app/room/[id]/opengraph-image.tsx). Пустой —
 * намеренно: на сборке это 68 PNG (жанры и подборки на двух языках) — ~6,7
 * тысячи блоков на каждую сборку ради картинок, которые краулер прогреет и
 * сам при первой пересылке; да и базы на сборке может не быть.
 *
 * Ошибка базы НЕ ловится. Стоял try/catch с карточкой без стены: одна осечка
 * Turso при отрисовке — и вместо постеров роглайков висела бы общая «Игры по
 * жанрам», без срока — до следующего деплоя. Брошенная ошибка не кэшируется:
 * пятисотка достаётся тому краулеру, который первым просит ещё не
 * закэшированную карточку во время сбоя, и следующий запрос рисует заново
 * (docs: incremental-static-regeneration, «Handling uncaught exceptions»).
 * Сторож — og.test.ts рядом.
 */
export const revalidate = false

export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

export default async function Image({ params }: { params: Promise<{ lang: string; tag: string }> }) {
  const { lang, tag } = await params
  // Язык не из LOCALES (/_x/…) — 404: notFound() корневого layout до обработчика не доходит
  if (!isLocale(lang)) return new Response('Not found', { status: 404 })
  // Дальше lang — язык страницы: заголовок (hubTitle жанра или facetCopy
  // подборки) и подписи на нём
  const locale = lang
  // null — незнакомый адрес: карточка без стены, с общим заголовком
  const genre = await loadGenre(tag, locale)
  const games = genre?.games ?? []
  const byId = new Map(games.map((g) => [g.appid, g]))
  const posters = await postersOf(games.slice(0, WALL_POSTERS), (id) => byId.get(id))
  const n = games.length
  const gamesWord = pl(locale, n, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })

  return isrImage(
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
            {genre?.kind === 'facet'
              ? tr(locale, { ru: 'IMBORED.CC · ПОДБОРКИ', en: 'IMBORED.CC · COLLECTIONS' })
              : tr(locale, { ru: 'IMBORED.CC · ИГРЫ ПО ЖАНРАМ', en: 'IMBORED.CC · GAMES BY GENRE' })}
          </div>
          {/* Запас снизу — под хвосты кириллицы (см. карточку портрета) */}
          <div style={{ fontSize: 76, lineHeight: 1.12, marginBottom: 22 }}>
            {genre ? genre.title : tr(locale, { ru: 'Игры по жанрам', en: 'Games by genre' })}
          </div>
          {/* Пустой список — сборка без базы или подборка, которой ещё нечем
              ответить («на 20 минут» ждёт уверенной семантики). Подборке —
              своя строка: «Тридцать жанров» под «Играми на 20 минут» звали бы
              её жанром и обещали бы то, чего на странице нет.

              По-английски порядок — по числу отзывов, как на странице, а не
              по их доле: «ranked by reviews» читалось бы рейтингом. «this» —
              жанр из заголовка над строкой. Не шире русской (замер Manrope
              800, 26 px: 693 против 751 px у «40 игр…»), в строку на 1072 px;
              строки подборки короче жанровой на обоих языках */}
          <div style={{ fontSize: 26, color: OG_DIM }}>
            {genre?.kind === 'facet'
              ? n > 0
                ? tr(locale, {
                    ru: `${n} ${gamesWord} — по отзывам игроков Steam`,
                    en: `${n} ${gamesWord}, most-reviewed on Steam first`,
                  })
                : tr(locale, {
                    ru: 'Подборка собирается — по отзывам игроков Steam',
                    en: 'Collection in the works, based on Steam player reviews',
                  })
              : n > 0
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
