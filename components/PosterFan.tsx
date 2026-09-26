import type { CSSProperties } from 'react'
import { GameArt } from '@/components/GameArt'

/**
 * ВЕЕР ПОСТЕРОВ — картинка раздела или ответа, собранная из самих игр.
 *
 * Постеры лежат стопкой в обёртке размером с один постер и расходятся от
 * центра: --c — номер постера относительно середины веера (−1, 0, 1 для трёх;
 * ±0.5 для двух; 0 для одного). Сдвиг, наклон и провисание считаются от него
 * в CSS (.fan-poster), поэтому одно правило держит любой размер веера.
 *
 * Где стоит обёртка и какой она высоты — решает хозяин (.rep-card .fan,
 * .quiz-tile .fan): у полки разделов веер справа, у плиток квиза — сверху.
 * Хозяин с классом .fan-host раскрывает веер шире под курсором.
 *
 * Постеры декоративные: смысл несёт подпись рядом, поэтому обёртка
 * aria-hidden, а картинки без alt.
 */
export type FanGame = { appid: number; name: string }

export function PosterFan({ games, className = '' }: { games: readonly FanGame[]; className?: string }) {
  return (
    <span aria-hidden className={`fan ${className}`} style={{ '--n': games.length } as CSSProperties}>
      {games.map((g, i) => (
        <span key={g.appid} className="fan-poster" style={{ '--i': i } as CSSProperties}>
          {/* Постер в веере — около 90 px (замерено на 390 и 1280): при
              «160px» телефон с плотностью 3x тянул 600-пиксельный файл
              вместо 300-пиксельного, вдвое тяжелее */}
          <GameArt appid={g.appid} name={g.name} variant="poster" sizes="96px" />
        </span>
      ))}
    </span>
  )
}
