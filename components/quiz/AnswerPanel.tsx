'use client'

import { GameArt } from '@/components/GameArt'
import { AnswerGlyph } from '@/components/quiz/AnswerGlyph'
import { SpotlightCard } from '@/components/SpotlightCard'
import type { AnswerValue } from '@/lib/quiz'
import type { QuizCover } from '@/lib/quizart'

/**
 * Форма одна на обе ветки — иначе сетка прыгала бы по мере приезда обложек.
 *
 * w-full обязателен: <button> по умолчанию сжимается по содержимому, а панель
 * обязана занять колонку целиком.
 *
 * На десктопе высота задаётся от вьюпорта, а не пропорцией. С пропорцией 3/4
 * панель в колонке шириной 330 px вырастала до 440, и весь квиз — рельс,
 * вопрос, три панели, ярус пресетов — переставал помещаться на экран. Экран,
 * который спрашивает «сколько у тебя времени», не должен требовать скролла,
 * чтобы увидеть варианты ответа.
 */
const SHAPE =
  'w-full rounded-[20px] text-left aspect-[5/2] md:aspect-auto md:h-[clamp(220px,38vh,420px)]'

/**
 * Ответ квиза — панель с обложкой из библиотеки.
 *
 * Две ветки, и это не дублирование, а два разных материала.
 *
 * С обложкой — кино-панель: арт размыт и обесцвечен, цвет возвращается тому
 * ответу, на который смотрят (правила в .quiz-panel, app/globals.css).
 * Подсветки-пятна здесь нет намеренно: докблок SpotlightCard прямо запрещает
 * её поверх игрового арта, и запрет верный — тёплое пятно на обложке читается
 * как засветка, а не как отклик.
 *
 * Без обложки — ровно сегодняшняя стеклянная карточка, тот же SpotlightCard.
 * Это не заглушка: у гостя без библиотеки, у непрогретой библиотеки и у игры
 * без арта экран обязан выглядеть законченным, а не сломанным.
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
  /** нажата: короткий такт подтверждения перед сменой шага */
  chosen?: boolean
  eager?: boolean
  index: number
  onSelect: () => void
  onPreview?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  buttonRef?: (el: HTMLButtonElement | null) => void
}) {
  const attrs = {
    'data-live': live ? '' : undefined,
    'data-chosen': chosen ? '' : undefined,
    // Цифра выбирает ответ с клавиатуры; она же — подсказка в подписи кнопки
    'aria-keyshortcuts': String(index + 1),
    'aria-label': `${label} — ${hint}`,
  }

  if (!cover) {
    return (
      <SpotlightCard
        onClick={onSelect}
        onKeyDown={onKeyDown}
        buttonRef={buttonRef}
        attrs={attrs}
        className={`quiz-panel flex flex-col justify-end p-5 ${SHAPE}`}
      >
        <Caption value={value} label={label} hint={hint} />
      </SpotlightCard>
    )
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onSelect}
      onPointerEnter={onPreview}
      onFocus={onPreview}
      onKeyDown={onKeyDown}
      {...attrs}
      className={`quiz-panel relative cursor-pointer overflow-hidden border border-edge ${SHAPE}`}
    >
      <GameArt
        appid={cover.appid}
        name={cover.name}
        headerImage={cover.headerImage}
        art={cover.art}
        eager={eager}
        sizes="(min-width: 768px) 33vw, 100vw"
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Скрим до фона страницы: подпись читается на любой обложке, включая
          снежную и белую — то же обязательство, что у .blur-band на герое. */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, var(--bg) 8%, transparent 65%)' }}
      />
      <span aria-hidden className="grain" />

      <span className="relative flex h-full flex-col justify-end p-5">
        <Caption value={value} label={label} hint={hint} />
      </span>

      {/* Волосок, а не заливка: тот же жест, что индикатор нижней панели и
          зачёркивание в логотипе. Поведение — в .quiz-edge, чтобы «уменьшить
          движение» гасило его там же, где и остальную анимацию панели. */}
      <span aria-hidden className="quiz-edge absolute inset-x-0 bottom-0 h-[2px] bg-ember" />
    </button>
  )
}

function Caption({ value, label, hint }: { value: AnswerValue; label: string; hint: string }) {
  return (
    <>
      <AnswerGlyph value={value} className="quiz-glyph mb-2.5" />
      <span className="block text-lg font-semibold md:text-2xl">{label}</span>
      <span className="mt-1 block text-sm text-dim">{hint}</span>
    </>
  )
}
