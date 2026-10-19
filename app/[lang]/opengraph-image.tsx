import { ImageResponse } from 'next/og'
import { LOCALES, toLocale, tr, type Locale } from '@/lib/i18n'
import { ogFonts, ogGlow, OG_BG, OG_DIM, OG_EMBER, OG_INK, OG_PLATE } from '@/lib/og'

/*
 * Подпись картинки — одна на оба языка, и она русская: alt файловой карточки
 * Next читает как константу модуля, без params. Языковая подпись — только
 * через generateImageMetadata, а он меняет адрес картинки (…/opengraph-image/<id>)
 * и у русской главной. Подпись на языке страницы может поставить только тот,
 * кто переносит корневую карточку в метадату страницы (ownAddress в
 * lib/site.ts): у русской она равна SITE_TITLE, у английской — siteTitle('en').
 */
export const alt = 'imbored — во что поиграть'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Оба языка — на сборке, как было до [lang]: карточка статична и базу не
 * трогает. Файловая карточка — это route handler, а ему параметры
 * корневого layout не достаются (next/dist/build/segment-config/app,
 * collectAppRouteSegments) — без своего списка она рендерилась бы на каждый
 * заход краулера. Чужой язык — 404, а не картинка по мусорному адресу.
 */
export function generateStaticParams(): Array<{ lang: string }> {
  return LOCALES.map((lang) => ({ lang }))
}
export const dynamicParams = false

/**
 * Лицо продукта в чате.
 *
 * Карточки были у двух личных страниц — совместимости и портрета, — то есть
 * ровно у тех, которые кидают другому. А сам imbored.cc, который кидают чаще
 * всего, разворачивался голой ссылкой: заголовок, описание и пустое место
 * там, где у всех остальных ссылок картинка. Первое впечатление о продукте
 * случается в мессенджере, до всякого сайта, и до этой правки оно было
 * впечатлением о недоделанном.
 *
 * Файловая метадата приоритетнее объекта metadata и наследуется вниз по
 * дереву маршрутов, поэтому одна эта карточка закрывает разом всё, у чего
 * своей нет: главную, квиз, выдачу, игру дня, библиотеку, пати, комнату по
 * коду, «Что нового», поддержку и приватность.
 *
 * Рисуется БЕЗ обращения к базе. Соблазн показать здесь живые обложки был, но
 * эту картинку тянет краулер мессенджера в момент вставки ссылки — если база
 * не ответит, человек увидит не «карточку без обложек», а сломанное превью
 * на самой первой ссылке, которую ему прислали. Статичная карточка не умеет
 * падать.
 *
 * Композиция — знак продукта в размер плаката. «bored» перечёркнуто: это и
 * есть всё обещание одним словом, и повторять его картинкой не нужно.
 */

/**
 * Зачёркивание считается от кегля — как и в вебе (см. components/Wordmark).
 *
 * 0.526 — не подобранное на глаз число. Высота строчных у Onest ExtraBold
 * равна 93 при кегле 172, то есть линия обязана пройти в 47 пикселях над
 * базовой; отсюда и доля. Проверено попиксельно на отрендеренном PNG: чернила
 * слова занимают 196–327 (базовая ≈327), центр полосы встаёт на 280.
 *
 * Первая версия стояла на 0.585 и садилась почти на базовую линию — слово
 * читалось не перечёркнутым, а подчёркнутым.
 */
const WORD = 172
const STRIKE_TOP = Math.round(WORD * 0.526)
const STRIKE_H = Math.round(WORD * 0.07)

/**
 * Текст карточки — на языке адреса (/en/opengraph-image): тот, кто кинул
 * английскую ссылку, получает английскую карточку. Знак «imbored» общий.
 */
const COPY = {
  ru: {
    eyebrow: 'ВО ЧТО ПОИГРАТЬ',
    lede: 'Скажи, сколько у тебя времени и сил, — дадим одну игру и объясним, почему она',
  },
  en: {
    eyebrow: 'WHAT TO PLAY',
    lede: 'Tell us how much time and energy you have — we’ll pick one game and tell you why',
  },
} satisfies Record<Locale, { eyebrow: string; lede: string }>

export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const copy = tr(toLocale((await params).lang), COPY)
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: OG_BG,
          backgroundImage: ogGlow(),
          color: OG_INK,
          fontFamily: 'Manrope',
        }}
      >
        {/* знак и раздел */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <svg width="56" height="56" viewBox="0 0 64 64">
            {/* Знак монохромный, как LogoMark: плашка светлая, глиф цвета фона.
                Прежние INK и EMBER на белой плашке «Премьеры» пропадали. */}
            <rect width="64" height="64" rx="18" fill={OG_PLATE} />
            <circle cx="22" cy="24.5" r="6" fill={OG_BG} />
            <circle cx="22" cy="42" r="6" fill={OG_BG} />
            <line
              x1="36"
              y1="20"
              x2="46"
              y2="45"
              stroke={OG_BG}
              strokeWidth="9"
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              fontFamily: 'Manrope',
              fontSize: 20,
              letterSpacing: 6,
              color: OG_EMBER,
            }}
          >
            {copy.eyebrow}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/*
            Зачёркивание — отдельная полоса, а не text-decoration: satori красит
            подчёркивание цветом текста, а здесь нужен акцент поверх
            приглушённого слова. Координаты считаются от кегля и проверены
            попиксельно на отрендеренном PNG.
          */}
          <div style={{ display: 'flex', alignItems: 'flex-start', height: WORD, lineHeight: 1 }}>
            <div style={{ display: 'flex', fontSize: WORD, color: OG_INK }}>im</div>
            <div style={{ display: 'flex', position: 'relative' }}>
              <div style={{ display: 'flex', fontSize: WORD, color: OG_DIM }}>bored</div>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: STRIKE_TOP,
                  height: STRIKE_H,
                  background: OG_EMBER,
                  borderRadius: 2,
                }}
              />
            </div>
          </div>

          {/* Отступ сверху с запасом — см. lib/og: кириллические выносные «р», «у», «д» */}
          <div style={{ display: 'flex', marginTop: 34, fontSize: 34, color: OG_DIM, maxWidth: 900 }}>
            {copy.lede}
          </div>
        </div>

        <div
          style={{
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
