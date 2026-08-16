import { GameArt } from '@/components/GameArt'
import type { QuizCover } from '@/lib/quizart'

/**
 * Полка бэклога под панелями: ряд маленьких резких обложек из неразобранного.
 *
 * Отвечает на ощущение «за квизом мало игр» буквально — вот они. Декоративная
 * и бескнопочная (aria-hidden): квиз не витрина, полка — фактура, а не
 * навигация. Подписи нет намеренно: число «в бэклоге» уже живёт в правом
 * якоре страницы, а гостю числа не приезжают вовсе — любая подпись здесь либо
 * дублировала бы, либо врала.
 *
 * НЕ скроллится: обрезанный последней плиткой край честен — продолжение
 * реально есть, в библиотеке. Скролл сделал бы полку интерактивной и потянул
 * бы за собой все вопросы доступности прокручиваемого региона ради жеста,
 * которому здесь нечего показать.
 *
 * Меньше четырёх обложек — молчим: «полка» из двух плиток читается как
 * остатки, а не как глубина.
 */
export function QuizShelf({ covers }: { covers: QuizCover[] }) {
  if (covers.length < 4) return null

  return (
    <div aria-hidden className="quiz-shelf flex gap-2 overflow-hidden">
      {covers.map((c) => (
        <span key={c.appid} className="w-[84px] shrink-0 md:w-[96px]">
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
  )
}
