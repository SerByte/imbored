'use client'

import { GameArt } from '@/components/GameArt'
import { AnswerGlyph } from '@/components/quiz/AnswerGlyph'
import { plural } from '@/lib/plural'
import type { AnswerValue } from '@/lib/quiz'
import type { QuizCover } from '@/lib/quizart'

/**
 * СТВОРКА, А НЕ КАРТОЧКА.
 *
 * Ответ занимает створку от потолка до пола. Ни скругления, ни поля, ни зазора:
 * соседние створки стоят вплотную, а между ними идёт световой шов. Прежняя
 * форма — карточка высотой clamp(220px,40vh,440px) внутри колонки с полями —
 * существовала ради того, чтобы весь квиз помещался на экран без скролла. Экран
 * теперь ровно один и скролла нет по построению, так что то ограничение
 * выполнено сильнее прежнего, а не нарушено.
 *
 * w-full/h-full обязательны: <button> по умолчанию сжимается по содержимому.
 */
const SHAPE = 'h-full w-full rounded-none text-left'

/**
 * Скрим читаемости — КОНТРАКТ КОНТРАСТА, а не украшение. Именно он, а не
 * затемнение арта, держит подпись: у базовой линии подсказки фон уже ≥92% --bg,
 * и text-dim берёт AA на любой обложке, включая снежную и белую.
 *
 * Стопы переехали с ПРОЦЕНТОВ на rem, и это вынужденно. В процентах «92% --bg
 * на 24%» означало ~72px читаемой полосы на карточке в 300px — и превратилось
 * бы в 216px на створке в 900px, то есть скрим съел бы четверть кадра. От пола
 * в rem полоса остаётся одной и той же независимо от высоты экрана.
 *
 * Ни один тест этого не проверяет: потерять можно молча.
 */
const SCRIM =
  'linear-gradient(to top, var(--bg) 0, color-mix(in srgb, var(--bg) 92%, transparent) 9rem, color-mix(in srgb, var(--bg) 55%, transparent) 15rem, transparent 24rem)'

/**
 * Стопка обложек. На створке она читается ВЕРТИКАЛЬНЫМ прогоном, на телефоне —
 * прежним веером: там створка поворачивается в горизонтальную полосу.
 *
 * Посадка по вертикали снова в ПРОЦЕНТАХ, и прежний довод («топы в px, потому
 * что высота карточки задана от вьюпорта и веер обязан якориться к верхней
 * кромке») здесь перевернулся: высота створки И ЕСТЬ высота экрана, поэтому
 * фиксированные px оставили бы на высоком мониторе полкадра пустоты под
 * стопкой. Ширины как были — в процентах створки.
 *
 * Три варианта на индекс: наклоны и посадка гуляют в узкой полосе, чтобы три
 * створки читались разложенными руками, а не проштампованными. Детерминизм —
 * чистая функция от index, без Math.random: страница перерисовывается на каждое
 * наведение.
 */
const TILE_A = [
  'left-[6%] top-3 w-[30%] -rotate-[4deg] md:left-[9%] md:top-[21%] md:w-[64%] md:-rotate-[3.5deg]',
  'left-[6%] top-3 w-[30%] -rotate-[2.5deg] md:left-[11%] md:top-[19%] md:w-[64%] md:-rotate-[2deg]',
  'left-[6%] top-3 w-[30%] -rotate-[5deg] md:left-[7%] md:top-[23%] md:w-[64%] md:-rotate-[5deg]',
]
const TILE_B = [
  'left-[31%] top-8 w-[30%] rotate-[3deg] md:left-[25%] md:top-[37%] md:w-[60%] md:rotate-[2.5deg]',
  'left-[33%] top-7 w-[30%] rotate-[4.5deg] md:left-[27%] md:top-[35%] md:w-[60%] md:rotate-[4deg]',
  'left-[29%] top-9 w-[30%] rotate-[2deg] md:left-[23%] md:top-[39%] md:w-[60%] md:rotate-[1.5deg]',
]
/**
 * Плиток ДВЕ, а не три, и это предел данных, а не вкуса: стопка ответа несёт
 * ровно STACK_SIZE = 3 обложки, из которых первая ушла в атмосферу.
 *
 * Третью можно было бы взять с полки — но полка утверждает БЭКЛОГ
 * (unplayed|comeback), а стопка ответа намеренно включает и наигранные сотни
 * часов. Смешать их на одной поверхности значило бы стереть различие, ради
 * которого эти две выборки и существуют раздельно.
 */
const TILE_IMG =
  'w-full aspect-[460/215] rounded-[10px] border border-edge object-cover shadow-[0_16px_40px_rgba(0,0,0,0.5)]'

/**
 * «Атмосфера сзади, набор спереди».
 *
 * Примари (covers[0]) — размытый фон-атмосфера с рывком резкости на выборе;
 * поверх плавают до трёх РЕЗКИХ маленьких плиток. Ответ читается как НАБОР игр,
 * а не как одна.
 *
 * Анонимность у слоёв разная и у каждой своя механика: примари анонимен
 * размытием, плитки — размером и полутонами. Набор маленьких обложек вполголоса
 * ничего не утверждает — утверждал бы ОДИНОЧНЫЙ КРУПНЫЙ КАДР. Это закон, а не
 * вкус, и створка во весь экран его не отменяет: соблазн показать одну большую
 * резкую обложку здесь максимальный, и поддаться ему нельзя. Названий нет нигде.
 *
 * Одна фактура на все случаи: без обложек створка — .quiz-veil («экран до
 * фильма»), и мёртвый арт деградирует туда же, а не в третье состояние.
 *
 * Порядок слоёв задаётся разметкой, без z-index: арт → мелт → блум → гель →
 * скрим → набор → зерно → цифра → текст → волосок. Набор стоит НАД скримом
 * намеренно: под ним плитки мутнели бы в ту самую кашу, которую набор и лечит.
 */
export function AnswerPanel({
  value,
  label,
  hint,
  covers,
  count,
  live,
  chosen,
  eager,
  index,
  onSelect,
  onPreview,
  onLeave,
  onKeyDown,
  buttonRef,
}: {
  value: AnswerValue
  label: string
  hint: string
  /** стопка примари-первым; пустая — створка-вейл */
  covers: QuizCover[]
  /** игр в бэклоге под этот ответ; undefined — не рисовать (гость), 0 — честно рисуется */
  count?: number
  /** активна без курсора — на тач-устройствах наведения не существует */
  live?: boolean
  /** нажата: такт подтверждения и весь финальный такт до ухода с экрана */
  chosen?: boolean
  eager?: boolean
  index: number
  onSelect: () => void
  onPreview?: () => void
  /** курсор ушёл: без этого data-live залипал и створка выглядела рекомендацией */
  onLeave?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  buttonRef?: (el: HTMLButtonElement | null) => void
}) {
  const primary = covers[0] ?? null
  const tiles = covers.slice(1, 3)

  const art = (c: QuizCover) => ({
    appid: c.appid,
    name: c.name,
    headerImage: c.headerImage,
    art: c.art,
  })

  const v = index % 3

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onSelect}
      onPointerEnter={onPreview}
      onPointerLeave={onLeave}
      onFocus={onPreview}
      onKeyDown={onKeyDown}
      data-live={live ? '' : undefined}
      data-chosen={chosen ? '' : undefined}
      // Цифра выбирает ответ с клавиатуры; видимая половина — .quiz-key ниже
      aria-keyshortcuts={String(index + 1)}
      aria-label={`${label} — ${hint}${
        count !== undefined ? `, ${count} ${plural(count, 'игра', 'игры', 'игр')}` : ''
      }`}
      className={`quiz-panel relative cursor-pointer overflow-hidden ${SHAPE}`}
    >
      {primary ? (
        <>
          <GameArt
            {...art(primary)}
            eager={eager}
            fade
            sizes="(min-width: 768px) 40vw, 100vw"
            fallback={<span aria-hidden className="quiz-veil" />}
            className="quiz-art absolute inset-0 h-full w-full object-cover"
          />
          {/* Вторая копия того же URL — одна сетевая загрузка на обе */}
          <GameArt
            {...art(primary)}
            eager={eager}
            fade
            sizes="(min-width: 768px) 40vw, 100vw"
            fallback={null}
            className="quiz-melt absolute inset-0 h-full w-full object-cover"
          />
        </>
      ) : (
        <span aria-hidden className="quiz-veil" />
      )}

      {/*
        Блум и гель — ПОД скримом. Гель физически не может тронуть контраст
        подписи, поэтому обещание скрима остаётся истинным по построению, а не
        по проверке на каждой новой обложке.
      */}
      <span aria-hidden className="quiz-bloom" />
      <span aria-hidden className="quiz-gel" />

      <span aria-hidden className="absolute inset-0" style={{ background: SCRIM }} />

      {tiles.length > 0 && (
        <span aria-hidden className="quiz-stack pointer-events-none absolute inset-0">
          {/* Обёртка владеет позицией/поворотом/фильтром, img — радиусом и
              фейдом: img[data-art-fade] задаёт transition на opacity и перебил
              бы транзишен фильтра, объяви мы их на одном элементе. */}
          <span className={`quiz-stack-tile absolute ${TILE_A[v]}`}>
            <GameArt
              {...art(tiles[0])}
              eager={eager}
              fade
              fallback={null}
              sizes="(min-width: 768px) 300px, 32vw"
              className={TILE_IMG}
            />
          </span>
          {tiles[1] && (
            <span className={`quiz-stack-tile absolute ${TILE_B[v]}`}>
              <GameArt
                {...art(tiles[1])}
                fade
                fallback={null}
                sizes="(min-width: 768px) 280px, 32vw"
                className={TILE_IMG}
              />
            </span>
          )}
        </span>
      )}

      <span aria-hidden className="grain" />

      <span
        aria-hidden
        className="quiz-key absolute right-5 top-5 font-mono text-[11px] text-faint"
      >
        {index + 1}
      </span>

      {/*
        Подпись у пола створки. pb клиренсом под ленту полки: она идёт по
        нижнему краю кадра поверх створок, и подпись не имеет права под неё
        уехать.
      */}
      <span className="relative flex h-full flex-col justify-end p-5 pb-16 md:p-8 md:pb-20">
        <span className="flex items-center gap-3 md:block">
          <AnswerGlyph value={value} className="quiz-glyph shrink-0 md:mb-4" />
          <span className="block text-2xl font-semibold leading-[1.05] md:text-4xl">{label}</span>
        </span>
        <span className="mt-2 flex items-baseline justify-between gap-3 md:mt-3">
          <span className="block text-sm text-dim md:text-base">{hint}</span>
          {/*
            Число игр — на базовой линии подсказки, у правого края (система
            живёт справа, как якорь страницы). Статичное, не CountNumber:
            сужение якоря — звезда страницы, три соревнующихся одометра
            превратили бы жест в механизм. Отсутствует — узел не рендерится,
            рефлоу нет; ноль — честный и произносится шёпотом.
          */}
          {count !== undefined && (
            <span
              className={`shrink-0 whitespace-nowrap text-sm md:text-base ${
                count === 0 ? 'text-faint' : 'text-dim'
              }`}
            >
              <span
                className={`font-mono font-semibold tabular-nums ${count === 0 ? '' : 'text-ink'}`}
              >
                {count}
              </span>{' '}
              {plural(count, 'игра', 'игры', 'игр')}
            </span>
          )}
        </span>
      </span>

      {/* Волосок, а не заливка: тот же жест, что индикатор нижней панели и
          зачёркивание в логотипе. Поведение — в .quiz-edge, чтобы «уменьшить
          движение» гасило его там же, где и остальную анимацию створки. */}
      <span aria-hidden className="quiz-edge absolute inset-x-0 bottom-0 h-[2px] bg-ember" />
    </button>
  )
}
