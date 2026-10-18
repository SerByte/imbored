import { ImageResponse } from 'next/og'
import { getGamePageRow } from '@/lib/db'
import { reviewFacts, type GamePageData } from '@/lib/gamepage'
import { ogFonts, ogGlow, ogNum, ogScrim, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { ogArt } from '@/lib/ogcard'
import { getDb } from '@/lib/server'
import { tagLabel } from '@/lib/tagsru'
import { isLocale, pl, tr } from '@/lib/i18n'

/**
 * Подпись картинки — без языка, одна на обе версии. Next читает alt
 * константой модуля, а не на запрос: «Стоит ли играть — imbored» стояло бы
 * og:image:alt и у английской карточки. Перевести её можно только через
 * generateImageMetadata, а он переносит картинку на адрес
 * …/opengraph-image/<id>: у русской страницы сменился бы сам og:image, а он
 * обязан остаться прежним. Имя продукта верно на любом языке, а всё, что
 * карточка говорит словами, — на ней самой, на языке страницы.
 */
export const alt = 'imbored'
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
 * АРТ — ЧЕРЕЗ ogArt, А НЕ АДРЕСОМ ДЛЯ SATORI. Здесь стоял первый адрес
 * artCandidates(…, 'hero'), отданный в <img> как есть. Только у Steam-игры
 * без резолвленного hero первым там всегда плоский library_hero.jpg, а он
 * живой лишь у игр до перехода Valve на хэшированные пути (lib/art). Замер на
 * деплое: у Five Nights at Freddy's (319510) он отвечает 404, и satori — у
 * него свой fetch без таймаута — запоминал неудачу пустым местом: в чат
 * уезжала тёмная карточка из одного текста на 47 КБ, на неделю кэша, хотя
 * capsule и header у игры есть. Запасной `?? artCandidates(…)[0]` не
 * срабатывал никогда: плоский путь не бывает undefined. ogArt — то же, что у
 * карточек патча, выбора и пати: таймаут на попытку, только JPEG/PNG и
 * следующий кандидат (hero → capsule → header), не больше трёх.
 *
 * Из базы — одна строка (getGamePageRow), а не loadGamePage: картинке нужны
 * мета и сводка отзывов, а не соседи, патчи и игры студии. Ошибка базы НЕ
 * ловится: при перегенерации ISR оставит прошлую карточку, а пойманная
 * заменила бы её нейтральной на всю неделю (тот же довод, что у loadHub в
 * app/games/page.tsx). Сторож — app/game/[appid]/og.test.ts.
 *
 * ВЕС, честно: такая карточка выходит около мегабайта против 128 КБ у прежнего
 * header_2x.jpg из Steam. Это свойство формата, а не недосмотр — ImageResponse
 * отдаёт ТОЛЬКО PNG (проверено по докам установленного Next: satori плюс resvg,
 * других выходов нет), а PNG без потерь на фотографии 1200×630 столько и
 * весит. Замерено на первой версии карточки с той же композицией, арт во весь
 * кадр; мелкий исходник там пробовал — header.jpg вместо header_2x давал 853
 * КБ, экономию в 16% ценой заметной мягкости на ширине 1200. Не размен.
 *
 * Платится это один раз: тянут карточку краулеры превью, а отдаёт её кэш — на
 * деплое второй заход отвечал X-Vercel-Cache HIT. Telegram, Twitter, Discord и
 * VK такой вес берут. Если жалобы придут (WhatsApp к размеру превью
 * придирчив) — уменьшать надо холст, а не качество исходника.
 *
 * Неделя жизни, как у самой страницы (GAME_PAGE_REVALIDATE_SEC в
 * lib/gamecache): картинка читает те же данные из базы, и расходиться им
 * незачем. Здесь неделя важнее, чем у страницы: мегабайт PNG — это около
 * ста двадцати блоков ISR Writes на каждую перегенерацию с новым выводом.
 * Точечный сброс кронов (revalidateGamePages) картинку не трогает, и так
 * задумано: ради чего кроны сбрасывают карточку — pros/cons, кадры, патчи, —
 * того в картинке нет, а сдвинувшееся число отзывов доедет за неделю.
 */
export const revalidate = 604_800

/**
 * Регистрирует сегмент в манифесте — без этого revalidate выше мёртв.
 *
 * То же правило, что у карточек совместимости, портрета и комнаты, и у самой
 * страницы игры рядом: без generateStaticParams динамический сегмент не
 * попадает в dynamicRoutes манифеста, маршрут остаётся ƒ и перерисовывает одну
 * и ту же картинку на каждый заход краулера. generateStaticParams у page.tsx
 * сюда не распространяется: картинка — отдельный маршрут, и регистрировать его
 * нужно отдельно.
 *
 * Пустой список намеренно, в отличие от страницы, которая предрендерит верх
 * каталога (PRERENDER_TOP в lib/gamecache). Здесь каждый элемент списка — это
 * отрисованный на сборке PNG с тянущимся по сети артом и мегабайт ISR Writes
 * на каждую сборку ради картинок, которые краулер и так прогреет при первой
 * пересылке. dynamicParams по умолчанию true, поэтому досоздание по
 * требованию работает, а неделя кэша та же.
 */
export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

export default async function Image({ params }: { params: Promise<{ lang: string; appid: string }> }) {
  const { lang, appid: raw } = await params
  // Язык не из LOCALES (/_x/…) — 404: notFound() корневого layout до обработчика не доходит
  if (!isLocale(lang)) return new Response('Not found', { status: 404 })
  // Дальше lang — язык страницы, чью карточку рисуем: подписи и числа на нём
  const locale = lang
  const appid = Number(raw)
  const row = Number.isInteger(appid) && appid !== 0 ? await getGamePageRow(await getDb(), appid) : null

  if (!row) {
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
            fontFamily: 'Manrope',
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

  const { meta } = row
  // Отзывы Steam есть только у Steam-игр — как в loadGamePage
  const reviewsSummary = appid < 0 ? null : (row.reviewsSummary as GamePageData['reviewsSummary'])
  // Data-URI или null: не дотянулся ни один кандидат — карточка со свечением
  const art = await ogArt({ appid: meta.appid, art: meta.art, headerImage: meta.headerImage }, 'hero')

  // Тот же запасной источник, что и на самой странице: без него карточка 278
  // игр из тысячи уезжала в чат вообще без оценки.
  const facts = reviewFacts(meta, reviewsSummary)
  // Подписи тегов на языке страницы — те же, что чипсами на самой странице
  const tags = Object.entries(meta.tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => tagLabel(t, locale))

  const reviews = facts
    ? pl(locale, facts.total, { ru: ['отзыва', 'отзывов', 'отзывов'], en: ['review', 'reviews'] })
    : ''
  const lines = [
    // «— за» в хвосте читалось как обрубленная фраза — та же правка, что на
    // самой странице игры. По-английски — фраза глоссария целиком («92% of
    // 48,213 reviews are positive»): она не длиннее русской на той же ширине
    facts
      ? tr(locale, {
          ru: `${facts.percent}% положительных из ${ogNum(facts.total, locale)} ${reviews}`,
          en: `${facts.percent}% of ${ogNum(facts.total, locale)} ${reviews} ${facts.total === 1 ? 'is' : 'are'} positive`,
        })
      : null,
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
          ...(art ? {} : { backgroundImage: ogGlow() }),
          color: OG_INK,
          fontFamily: 'Manrope',
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
              fontFamily: 'Manrope',
              fontSize: 20,
              letterSpacing: 6,
              color: OG_EMBER,
              marginBottom: 16,
            }}
          >
            {tr(locale, { ru: 'СТОИТ ЛИ ИГРАТЬ', en: 'WORTH PLAYING?' })}
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
            fontFamily: 'Manrope',
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
