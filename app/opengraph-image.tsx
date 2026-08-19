import { ImageResponse } from 'next/og'
import { ogFonts, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'

export const alt = 'imbored — во что поиграть'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Карточка ссылки для всего сайта.
 *
 * До неё og-картинка была ровно у трёх маршрутов — /game/[appid],
 * /compat/[steamid] и /portrait/[steamid]. У главной, /daily, /whatsnew,
 * /rooms и /quiz не было ни одного og-тега вовсе: ссылка на imbored.cc
 * разворачивалась в мессенджере голым адресом. Для сервиса, который живёт
 * пересылкой ссылок, это самая дешёвая из непочиненных вещей.
 *
 * Лежит в корне app/ и потому наследуется всеми маршрутами, у которых нет
 * своей картинки. Те три, у кого есть, перекрывают её своей — так и надо:
 * карточка конкретной игры всегда лучше общей.
 *
 * Начертание повторяет components/Wordmark: «im» цветом текста, «bored»
 * приглушённым и перечёркнутым. Зачёркивание здесь нарисовано полоской, а не
 * text-decoration, — satori его не поддерживает.
 */
export default async function Image() {
  const wordSize = 168

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
          background: OG_BG,
          fontFamily: 'Onest',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', position: 'relative' }}>
          <span style={{ color: OG_INK, fontSize: wordSize, letterSpacing: -6 }}>im</span>
          <div style={{ display: 'flex', position: 'relative' }}>
            <span style={{ color: OG_DIM, fontSize: wordSize, letterSpacing: -6 }}>bored</span>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                // Подобрано по отрендеренной картинке, а не выведено из метрик:
                // satori не даёт ни x-height, ни базовой линии, а line-through он
                // не поддерживает вовсе — полоску приходится ставить руками.
                top: wordSize * 0.7,
                height: 8,
                background: OG_EMBER,
                opacity: 0.7,
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', color: OG_DIM, fontSize: 38, textAlign: 'center' }}>
          Скажи, сколько у тебя времени, — подберём, во что зайти прямо сейчас
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 12,
            color: OG_EMBER,
            fontSize: 26,
            fontFamily: 'JetBrains Mono',
          }}
        >
          imbored.cc
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
