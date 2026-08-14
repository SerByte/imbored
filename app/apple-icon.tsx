import { ImageResponse } from 'next/og'

/**
 * Иконка для «на домашний экран» в iOS.
 *
 * У сайта есть app/icon.svg, и браузеры им пользуются — но Safari для домашнего
 * экрана SVG не берёт, ему нужен PNG по этой конвенции. Без него iOS рисует
 * скриншот страницы, то есть в лучшем случае кусок тёмного фона.
 *
 * Рисуем тем же ImageResponse, что и карточку портрета, а не кладём готовый
 * бинарник: знак — это два кружка и наклонная черта, повторить их разметкой
 * дешевле, чем держать в репозитории картинку, которую потом забудут обновить.
 * Форма повторяет app/icon.svg один в один, только в масштабе 180/64.
 *
 * Скруглять углы не нужно и вредно: iOS обрезает иконку сама, а собственный
 * радиус дал бы двойную фаску.
 */
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

const SCALE = size.width / 64

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: '#16171d',
        }}
      >
        {/* глаза эмотикона «:\» */}
        {[25, 42].map((cy) => (
          <div
            key={cy}
            style={{
              position: 'absolute',
              left: (22 - 5.5) * SCALE,
              top: (cy - 5.5) * SCALE,
              width: 11 * SCALE,
              height: 11 * SCALE,
              borderRadius: '50%',
              background: '#f2f3f5',
            }}
          />
        ))}
        {/* черта: та же геометрия, что у <line> в icon.svg */}
        <div
          style={{
            position: 'absolute',
            left: 33 * SCALE,
            top: 20 * SCALE,
            width: 9 * SCALE,
            height: 29 * SCALE,
            borderRadius: 9 * SCALE,
            background: '#ff9e64',
            transform: 'rotate(-23deg)',
          }}
        />
      </div>
    ),
    size,
  )
}
