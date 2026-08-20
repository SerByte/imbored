import { ImageResponse } from 'next/og'
import { ogFonts, ogGlow, OG_BG, OG_DIM, OG_EMBER, OG_INK, OG_PLATE } from '@/lib/og'

export const alt = 'imbored — во что поиграть'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

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

export default async function Image() {
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
          fontFamily: 'Onest',
        }}
      >
        {/* знак и раздел */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <svg width="56" height="56" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="16" fill={OG_PLATE} />
            <circle cx="22" cy="25" r="5.5" fill={OG_INK} />
            <circle cx="22" cy="42" r="5.5" fill={OG_INK} />
            <line
              x1="36"
              y1="22"
              x2="46"
              y2="45"
              stroke={OG_EMBER}
              strokeWidth="9"
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              fontFamily: 'JetBrains Mono',
              fontSize: 20,
              letterSpacing: 6,
              color: OG_EMBER,
            }}
          >
            ВО ЧТО ПОИГРАТЬ
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
            Скажи, сколько у тебя времени, — подберём, во что зайти прямо сейчас
          </div>
        </div>

        <div
          style={{
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
