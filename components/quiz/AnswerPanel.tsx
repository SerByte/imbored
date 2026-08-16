'use client'

import { GameArt } from '@/components/GameArt'
import { AnswerGlyph } from '@/components/quiz/AnswerGlyph'
import { plural } from '@/lib/plural'
import type { AnswerValue } from '@/lib/quiz'
import type { QuizCover } from '@/lib/quizart'

/**
 * Форма одна на обе фактуры — иначе сетка прыгала бы по мере приезда обложек.
 *
 * w-full обязателен: <button> по умолчанию сжимается по содержимому, а панель
 * обязана занять колонку целиком.
 *
 * На десктопе высота задаётся от вьюпорта, а не пропорцией. С пропорцией 3/4
 * панель в колонке шириной 330 px вырастала до 440, и весь квиз — рельс,
 * вопрос, три панели, ярус пресетов — переставал помещаться на экран. Экран,
 * который спрашивает «сколько у тебя времени», не должен требовать скролла,
 * чтобы увидеть варианты ответа.
 *
 * На телефоне 2/1, а не 5/2: при 375 px панель в 134 px не вмещала глиф,
 * подпись и подсказку без давки — подпись теперь собрана в строку (глиф рядом
 * с ответом), а панели дан воздух.
 */
const SHAPE =
  'w-full rounded-[var(--radius-panel)] text-left aspect-[2/1] md:aspect-auto md:h-[clamp(220px,40vh,440px)]'

/**
 * Скрим читаемости. Именно он, а не глобальное затемнение арта, отвечает за
 * контраст подписи: у базовой линии подсказки фон уже ≥92% --bg, и text-dim
 * держит AA на любой обложке, включая снежную и белую. Это освобождает сам
 * арт от обязанности быть тёмным — см. грамматику материала в .quiz-art
 * (app/globals.css).
 */
const SCRIM =
  'linear-gradient(to top, var(--bg) 10%, color-mix(in srgb, var(--bg) 92%, transparent) 24%, color-mix(in srgb, var(--bg) 55%, transparent) 48%, transparent 78%)'

/**
 * Классы плиток набора: задняя/передняя в веере из двух, одиночная — своя.
 *
 * Ширины и левые — в ПРОЦЕНТАХ карточки: с фикс-пикселями веер вылезал за
 * карточку шириной 232px (три колонки на 768px) и наезжал на цифру шортката,
 * а на мобильном лендскейпе замерзал почтовой маркой на панели в полэкрана.
 * Топы — в px:
 * высота карточки задана от вьюпорта, и веер обязан якориться к верхней
 * кромке, а не плавать с ростом окна.
 *
 * Три варианта на индекс панели: наклоны и посадка гуляют в полосе
 * ±1.5°/±2%/±4px — три карточки читаются разложенными руками, а не
 * проштампованными. Детерминизм: чистая функция от index, без Math.random.
 */
const FAN_BACK = [
  'left-[5.5%] top-3 w-[32%] -rotate-[4deg] md:top-[22px] md:w-[40%] md:-rotate-[5deg]',
  'left-[5.5%] top-3 w-[32%] -rotate-[2.5deg] md:top-[20px] md:w-[40%] md:-rotate-[3.5deg]',
  'left-[5.5%] top-3 w-[32%] -rotate-[5deg] md:top-[24px] md:w-[40%] md:-rotate-[6.5deg]',
]
const FAN_FRONT = [
  'hidden md:block md:left-[29%] md:top-[58px] md:w-[45%] md:rotate-[3deg]',
  'hidden md:block md:left-[31%] md:top-[54px] md:w-[45%] md:rotate-[4.5deg]',
  'hidden md:block md:left-[27.5%] md:top-[62px] md:w-[45%] md:rotate-[2deg]',
]
const FAN_SOLO = [
  'left-[5.5%] top-3 w-[33%] -rotate-[3deg] md:left-[8%] md:top-[30px] md:w-[45%] md:-rotate-[3deg]',
  'left-[5.5%] top-3 w-[33%] -rotate-[2deg] md:left-[8%] md:top-[30px] md:w-[45%] md:-rotate-[2deg]',
  'left-[5.5%] top-3 w-[33%] -rotate-[4.5deg] md:left-[8%] md:top-[30px] md:w-[45%] md:-rotate-[4.5deg]',
]

const TILE_IMG =
  'w-full aspect-[460/215] rounded-[14px] border border-edge object-cover shadow-[0_12px_28px_rgba(0,0,0,0.45)]'

/**
 * Ответ квиза — панель со стопкой обложек из библиотеки.
 *
 * «Атмосфера сзади, набор спереди». Примари (covers[0]) — прежний размытый
 * фон-атмосфера с рывком резкости на выборе; поверх, в верхней зоне, плавают
 * одна-две РЕЗКИЕ маленькие плитки (идиома LikesStrips: 460/215, rounded-14,
 * border-edge). Ответ читается как НАБОР игр, а не как одна.
 *
 * Анонимность у слоёв разная и у каждой своя механика: примари анонимен
 * размытием, плитки — размером и полутонами. Набор маленьких обложек
 * вполголоса ничего не утверждает — утверждал бы одиночный крупный кадр
 * (ровно поэтому прецедент резких обложек, CinemaCollage на главной,
 * законен). Названий нет нигде.
 *
 * Одна фактура на все случаи: без обложек панель — .quiz-veil («экран до
 * фильма»), и мёртвый арт деградирует туда же, а не в третье состояние.
 *
 * Порядок слоёв задаётся разметкой, без z-index: арт → мелт → скрим → набор →
 * зерно → текст. Набор стоит НАД скримом намеренно: под ним плитки мутнели бы
 * в ту самую кашу, которую набор и лечит; в зону подписи он не заходит
 * геометрией, а зерно сверху сшивает материал.
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
  /** стопка примари-первым; пустая — панель-вейл */
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
  /** курсор ушёл: без этого data-live залипал на последней панели и карточка
      выглядела подсвеченной без наведения — то есть как рекомендация */
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
      className={`quiz-panel relative cursor-pointer overflow-hidden border border-edge ${SHAPE}`}
    >
      {primary ? (
        <>
          <GameArt
            {...art(primary)}
            eager={eager}
            fade
            fallback={<span aria-hidden className="quiz-veil" />}
            className="quiz-art absolute inset-0 h-full w-full object-cover"
          />
          {/* Вторая копия того же URL — одна сетевая загрузка на обе */}
          <GameArt
            {...art(primary)}
            eager={eager}
            fade
            fallback={null}
            className="quiz-melt absolute inset-0 h-full w-full object-cover"
          />
        </>
      ) : (
        <span aria-hidden className="quiz-veil" />
      )}

      <span aria-hidden className="absolute inset-0" style={{ background: SCRIM }} />

      {tiles.length > 0 && (
        <span aria-hidden className="quiz-stack pointer-events-none absolute inset-0">
          {/* Обёртка владеет позицией/поворотом/фильтром, img — радиусом и
              фейдом: img[data-art-fade] задаёт transition на opacity и перебил
              бы транзишен фильтра, объяви мы их на одном элементе. */}
          <span
            className={`quiz-stack-tile absolute ${
              tiles.length === 1 ? FAN_SOLO[index % 3] : FAN_BACK[index % 3]
            }`}
          >
            <GameArt
              {...art(tiles[0])}
              eager={eager}
              fade
              fallback={null}
              sizes="(min-width: 768px) 148px, 32vw"
              className={TILE_IMG}
            />
          </span>
          {tiles[1] && (
            <span className={`quiz-stack-tile absolute ${FAN_FRONT[index % 3]}`}>
              {/* Не eager даже на первом шаге: на телефоне плитка скрыта
                  (hidden md:block), а eager качал бы её вхолостую; на десктопе
                  ленивая картинка в вьюпорте грузится сразу, и опоздание на
                  полтакта — часть постановки входа, а не дефект. */}
              <GameArt
                {...art(tiles[1])}
                fade
                fallback={null}
                sizes="148px"
                className={TILE_IMG}
              />
            </span>
          )}
        </span>
      )}

      <span aria-hidden className="grain" />

      <span
        aria-hidden
        className="quiz-key absolute right-4 top-4 font-mono text-[11px] text-faint"
      >
        {index + 1}
      </span>

      <span className="relative flex h-full flex-col justify-end p-4 md:p-5">
        <span className="flex items-center gap-2 md:block">
          <AnswerGlyph value={value} className="quiz-glyph shrink-0 md:mb-2.5" />
          <span className="block text-lg font-semibold md:text-2xl">{label}</span>
        </span>
        {/*
          Число игр — на базовой линии подсказки, у правого края (система
          живёт справа, как якорь страницы). Статичное, не CountNumber:
          сужение якоря — звезда страницы, три соревнующихся одометра
          превратили бы жест в механизм. Отсутствует — узел не рендерится,
          рефлоу нет; ноль — честный и произносится шёпотом.
        */}
        <span className="mt-1 flex items-baseline justify-between gap-3">
          <span className="block text-[13px] text-dim md:text-sm">{hint}</span>
          {count !== undefined && (
            <span
              className={`shrink-0 whitespace-nowrap text-[13px] md:text-sm ${
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
          движение» гасило его там же, где и остальную анимацию панели. */}
      <span aria-hidden className="quiz-edge absolute inset-x-0 bottom-0 h-[2px] bg-ember" />
    </button>
  )
}
