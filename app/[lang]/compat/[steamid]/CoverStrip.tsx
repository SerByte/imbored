import { GameArt } from '@/components/GameArt'
import type { ArtRef } from '@/lib/compatpage'

/**
 * Две ленты постеров навстречу друг другу — фон шапки совместимости.
 *
 * Страница про двоих и про то, где их вкусы сходятся, поэтому и фон — два
 * потока: верхний — то, что у пары уже общее, нижний — во что им зайти
 * дальше. Разметка та же, что у стены ожидания (.pwall в WarmupScreen), а
 * ход другой: ленты трогаются прежней скоростью и за 4.5 с встают (.cwall в
 * globals.css, AUTO_MOTION в lib/motion.ts). Петлёй, как там, им ехать
 * нельзя: стена ожидания живёт, пока идёт подбор, а эта — за готовым
 * результатом, пока открыта ссылка, и остановить её было бы нечем (WCAG
 * 2.2.2). Ряд задвоен ради ширины, а не петли: десяти постеров широкому
 * экрану не хватает на всю наклонную сетку. Двигается только transform; при
 * «уменьшить движение» ленты стоят с первого кадра.
 *
 * Раньше здесь была неподвижная полоса из пяти капсул 460×215 — фон, который
 * читался как таблица. Карточка для мессенджера (share-card) остаётся полосой:
 * там движения нет по определению.
 */
const ROW_MIN = 10

function fill(games: ArtRef[]): ArtRef[] {
  if (!games.length) return []
  return games.length >= ROW_MIN ? games : Array.from({ length: ROW_MIN }, (_, i) => games[i % games.length])
}

export function CoverWall({ rows }: { rows: ArtRef[][] }) {
  const filled = rows.map(fill).filter((r) => r.length)
  if (!filled.length) return null

  return (
    <div aria-hidden className="pwall cwall">
      <div className="pwall-grid">
        {filled.map((row, r) => (
          <div key={r} className="pwall-row">
            {[...row, ...row].map((g, i) => (
              <GameArt
                key={i}
                appid={g.appid}
                name={g.name}
                headerImage={g.headerImage}
                art={g.art}
                variant="poster"
                // Фон за скримом: 300-пиксельного постера хватает с запасом,
                // 600-пиксельный на телефоне с плотностью 3x весил вчетверо больше
                sizes="100px"
                eager={r === 0 && i < 6}
                className="cwall-poster"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
