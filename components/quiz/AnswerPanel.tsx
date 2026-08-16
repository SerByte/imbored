'use client'

import { GameArt } from '@/components/GameArt'
import { AnswerGlyph } from '@/components/quiz/AnswerGlyph'
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
  'w-full rounded-[var(--radius-panel)] text-left aspect-[2/1] md:aspect-auto md:h-[clamp(220px,38vh,420px)]'

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
 * Ответ квиза — панель с обложкой из библиотеки.
 *
 * Один материал на все случаи. Раньше веток было две — кино-панель для
 * обложки и стеклянный SpotlightCard без неё, — и в одном ряду встречались
 * два разных материала с разной физикой наведения. Теперь панель всегда одна
 * и та же; меняется только подложка: арт или .quiz-veil («экран до фильма»).
 *
 * Арт лежит двумя копиями одной картинки: .quiz-art почти в фокусе на весь
 * слот и .quiz-melt, примаскированная к низу, где текст. Резкость — свойство
 * места, цвет — свойство внимания; правила в app/globals.css.
 *
 * Вейл вместо ArtPlaceholder и в fallback тоже: заглушка печатала НАЗВАНИЕ
 * игры поверх намеренно анонимной панели, и мёртвый URL ломал контракт
 * «обложка ничего не утверждает». Теперь смерть арта деградирует в законное
 * состояние без обложки, а не в третье, сломанное.
 *
 * Порядок слоёв задаётся разметкой, без z-index: арт, скрим, зерно, текст.
 */
export function AnswerPanel({
  value,
  label,
  hint,
  cover,
  live,
  chosen,
  eager,
  index,
  onSelect,
  onPreview,
  onKeyDown,
  buttonRef,
}: {
  value: AnswerValue
  label: string
  hint: string
  cover: QuizCover | null
  /** активна без курсора — на тач-устройствах наведения не существует */
  live?: boolean
  /** нажата: такт подтверждения и весь финальный такт до ухода с экрана */
  chosen?: boolean
  eager?: boolean
  index: number
  onSelect: () => void
  onPreview?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  buttonRef?: (el: HTMLButtonElement | null) => void
}) {
  const art = {
    appid: cover?.appid ?? 0,
    name: cover?.name ?? '',
    headerImage: cover?.headerImage,
    art: cover?.art,
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onSelect}
      onPointerEnter={onPreview}
      onFocus={onPreview}
      onKeyDown={onKeyDown}
      data-live={live ? '' : undefined}
      data-chosen={chosen ? '' : undefined}
      // Цифра выбирает ответ с клавиатуры; видимая половина — .quiz-key ниже
      aria-keyshortcuts={String(index + 1)}
      aria-label={`${label} — ${hint}`}
      className={`quiz-panel relative cursor-pointer overflow-hidden border border-edge ${SHAPE}`}
    >
      {cover ? (
        <>
          <GameArt
            {...art}
            eager={eager}
            fade
            fallback={<span aria-hidden className="quiz-veil" />}
            className="quiz-art absolute inset-0 h-full w-full object-cover"
          />
          {/* Вторая копия того же URL — одна сетевая загрузка на обе */}
          <GameArt
            {...art}
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
        <span className="mt-1 block text-[13px] text-dim md:text-sm">{hint}</span>
      </span>

      {/* Волосок, а не заливка: тот же жест, что индикатор нижней панели и
          зачёркивание в логотипе. Поведение — в .quiz-edge, чтобы «уменьшить
          движение» гасило его там же, где и остальную анимацию панели. */}
      <span aria-hidden className="quiz-edge absolute inset-x-0 bottom-0 h-[2px] bg-ember" />
    </button>
  )
}
