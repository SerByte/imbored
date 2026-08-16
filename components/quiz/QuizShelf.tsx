import { GameArt } from '@/components/GameArt'
import type { QuizCover } from '@/lib/quizart'

/**
 * Полка бэклога под панелями: киноплёнка из маленьких резких обложек
 * неразобранного.
 *
 * Отвечает на ощущение «за квизом мало игр» буквально — вот они, и лента
 * ПОДАЁТ: при полном комплекте полка еле заметно дрейфует (~11px/с — ниже
 * порога внимания; тот же словарь, что дыхание фона и дрейф коллажа главной).
 * Бесшовность — две копии ряда и сдвиг на -50%; зазор шва живёт внутри копии
 * (pr-2), а не на треке — gap на треке рвал бы петлю на ползазора. Вторая
 * копия — те же URL: ноль новых загрузок, всё из кэша.
 *
 * Декоративная и бескнопочная (aria-hidden): квиз не витрина, полка —
 * фактура, а не навигация. Подписи нет намеренно: число «в бэклоге» уже живёт
 * в правом якоре страницы, а гостю числа не приезжают вовсе — любая подпись
 * здесь либо дублировала бы, либо врала.
 *
 * Меньше четырёх обложек — молчим: «полка» из двух плиток читается как
 * остатки, а не как глубина. Меньше полного комплекта — стоим: короткой ленте
 * дрейфовать не из чего, и она остаётся честным статичным рядом.
 */
export function QuizShelf({ covers }: { covers: QuizCover[] }) {
  if (covers.length < 4) return null

  // Период одной копии обязан быть шире контейнера (10 × 104px = 1040 ≥ 1024),
  // иначе в окне видны обе копии одной обложки и петля читается как поломка
  const drift = covers.length >= 10

  return (
    <div aria-hidden className="quiz-shelf overflow-hidden">
      <div data-drift={drift ? '' : undefined} className="quiz-shelf-track flex w-max">
        {(drift ? [0, 1] : [0]).map((copy) => (
          <div key={copy} className="flex gap-2 pr-2">
            {covers.map((c) => (
              <span key={`${copy}-${c.appid}`} className="w-[84px] shrink-0 md:w-[96px]">
                <GameArt
                  appid={c.appid}
                  name={c.name}
                  headerImage={c.headerImage}
                  art={c.art}
                  fade
                  fallback={null}
                  sizes="96px"
                  className="aspect-[460/215] w-full rounded-[10px] border border-edge object-cover"
                />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
