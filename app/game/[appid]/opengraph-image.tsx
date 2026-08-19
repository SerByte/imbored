import { ImageResponse } from 'next/og'
import { loadGamePage } from '@/lib/gamepage'
import { ogFonts, ogNum, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { ratingOf, scoreRu } from '@/lib/rating'

export const alt = 'Стоит ли играть — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Сутки — как у самой страницы. Без него вместе с generateStaticParams ниже
 * маршрут остаётся динамическим и перерисовывает одну и ту же картинку на
 * каждый заход краулера.
 */
export const revalidate = 86_400

/**
 * Обязателен, и не ради предрендера. Без него динамический сегмент не попадает
 * в dynamicRoutes манифеста, revalidate выше не значит ничего, и маршрут
 * остаётся ƒ вместо ●. Это выяснено дважды — в самой странице игры и в
 * карточке комнаты, — и оба раза с замером.
 *
 * Пустой список намеренно, в отличие от страницы, которая предрендерит топ-500.
 * Здесь каждый элемент списка — это отрисованный на сборке PNG с тянущимся по
 * сети артом; пятьсот таких заняли бы сборку целиком ради картинок, которые
 * краулер и так прогреет при первой пересылке. dynamicParams по умолчанию true,
 * поэтому досоздание по требованию работает, а сутки кэша те же.
 */
export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

/** Длинное имя не должно ужиматься в нечитаемое — оно ужимается ступенями. */
function nameSize(name: string): number {
  if (name.length > 38) return 40
  if (name.length > 26) return 52
  return 68
}

/**
 * Карточка ссылки на страницу игры.
 *
 * До неё здесь стоял ГОЛЫЙ header из Steam — тот же файл, что у самого Steam.
 * Пересланная ссылка на imbored разворачивалась в мессенджере превью, которое
 * ничем не отличалось от ссылки на магазин: ни имени сервиса, ни единственного,
 * что сервис знает и чего в артe нет, — ответа на вопрос из заголовка страницы,
 * «стоит ли играть». Пять тысяч карточек делились чужим брендом.
 *
 * Докблок корневой картинки говорит «карточка конкретной игры всегда лучше
 * общей», и это верно — поэтому арт игры остаётся фоном, а не заменяется
 * фирменной плашкой. Добавлено ровно то, чего в нём нет.
 *
 * Композиция повторяет героя самой страницы: арт, скрим кверху, оценка ember-ом
 * над именем. Открывший ссылку видит тот же кадр, который только что был в
 * превью, — это и есть то, ради чего у карточки и страницы одна разметка.
 *
 * Скрим решает ту же задачу, что .hero-scrim в globals.css, — текст обязан
 * читаться на любом арте, включая снег и белое небо, — но стопы у него СВОИ, и
 * это не небрежность. На странице текст занимает нижние две трети героя, здесь
 * — нижние 36% из 630 пикселей. Скопировав стопы страницы, я задавил бы арт по
 * всей высоте ради текста, которого в верхней половине нет.
 *
 * Держим 0.63 и выше до 38% (по верхнюю кромку текста с запасом) — это тот же
 * порог, при котором #f2f3f5 берёт 4.5:1 против чисто белого фона, — а выше
 * отпускаем до 0.12. Верхние 60% карточки это почти нетронутый арт, и в чате
 * останавливает взгляд именно он.
 *
 * ВЕС, честно: карточка выходит около мегабайта против 128 КБ у прежнего
 * header_2x.jpg из Steam. Это свойство формата, а не недосмотр — ImageResponse
 * отдаёт ТОЛЬКО PNG (проверено по докам установленного Next: satori плюс resvg,
 * других выходов нет), а PNG без потерь на фотографии 1200×630 столько и
 * весит. Мелкий исходник пробовал: header.jpg вместо header_2x даёт 853 КБ, то
 * есть экономию в 16% ценой заметной мягкости на ширине 1200. Не размен.
 *
 * Платится это один раз: тянут карточку краулеры превью, и Vercel отдаёт её из
 * кэша — на деплое второй заход отвечает X-Vercel-Cache HIT. Telegram, Twitter,
 * Discord и VK такой вес берут. Если жалобы придут (WhatsApp к размеру превью
 * придирчив) — уменьшать надо холст, а не качество исходника.
 *
 * Поэтому же весь текст, включая логотип, лежит ВНИЗУ: наверху его нечем
 * защитить, а давать логотипу собственную подложку — это вторая тёмная фигура
 * в кадре ради шести букв.
 */
export default async function Image({ params }: { params: Promise<{ appid: string }> }) {
  const { appid: raw } = await params
  const appid = Number(raw)
  const data = Number.isInteger(appid) && appid > 0 ? await loadGamePage(appid) : null

  const meta = data?.meta ?? null
  const rating = meta ? ratingOf(meta, data?.reviewsSummary ?? null) : null
  const art = meta?.art?.header2x ?? meta?.art?.header ?? meta?.headerImage ?? null
  const tags = meta
    ? Object.entries(meta.tags)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t)
    : []

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: OG_BG,
          fontFamily: 'Onest',
        }}
      >
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={art}
            alt=""
            width={size.width}
            height={size.height}
            // top/left, а не inset: сокращённое свойство satori не разбирает,
            // и слой встаёт в поток вместо того, чтобы лечь на арт
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}

        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            background:
              'linear-gradient(to top, #0b0c10 3%, rgba(11,12,16,0.9) 18%, rgba(11,12,16,0.66) 38%, rgba(11,12,16,0.25) 62%, rgba(11,12,16,0.12) 100%)',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 64,
            right: 64,
            bottom: 56,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {rating ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
              <span style={{ color: OG_EMBER, fontSize: 54, fontFamily: 'JetBrains Mono' }}>
                {rating.percent}%
              </span>
              <span style={{ color: OG_INK, fontSize: 32 }}>
                {scoreRu(rating.label) ?? 'положительных отзывов'}
              </span>
              <span style={{ color: OG_DIM, fontSize: 26, fontFamily: 'JetBrains Mono' }}>
                {ogNum(rating.total)}
              </span>
            </div>
          ) : null}

          <div
            style={{
              display: 'flex',
              color: OG_INK,
              fontSize: nameSize(meta?.name ?? ''),
              letterSpacing: -2,
              lineHeight: 1.05,
            }}
          >
            {meta?.name ?? 'Во что поиграть'}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24 }}>
            <span style={{ color: OG_DIM, fontSize: 26 }}>
              {tags.length ? tags.join(' · ') : 'отзывы, теги и патчноуты на русском'}
            </span>
            {/* Начертание то же, что в components/Wordmark и в корневой карточке:
                «im» цветом текста, «bored» приглушённым и перечёркнутым полоской —
                line-through satori не поддерживает. Домен рядом не ставим:
                мессенджер и так печатает его отдельной строкой под картинкой. */}
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <span style={{ color: OG_INK, fontSize: 34, letterSpacing: -1.2 }}>im</span>
              <div style={{ display: 'flex', position: 'relative' }}>
                <span style={{ color: OG_DIM, fontSize: 34, letterSpacing: -1.2 }}>bored</span>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 24,
                    height: 3,
                    background: OG_EMBER,
                    opacity: 0.7,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
