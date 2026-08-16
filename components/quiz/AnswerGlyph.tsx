import type { AnswerValue } from '@/lib/quiz'

/**
 * Знак ответа: смысл рисунком, до того как прочитаны слова.
 *
 * «Меньше часа» и «Весь вечер» — концы одной шкалы, но по надписям это узнаётся
 * только чтением. Шесть знаков ниже собраны из ОДНОГО примитива — штриха, —
 * поэтому это система, а не набор иконок:
 *
 *  • время — согнутый штрих: дуга заполняется на четверть, за половину, целиком.
 *    Тот же жест, которым приложение уже показывает величину в ProgressRing;
 *  • вайб — тот же штрих прямой: ровная волна против рваной, одна линия с
 *    разной амплитудой;
 *  • компания — короткие штрихи: один против трёх разной высоты.
 *
 * currentColor, а не токен: цветом управляет состояние панели (в покое --faint,
 * на активной загорается --ember-text) — правила в .quiz-panel, app/globals.css.
 * Серверный компонент: ни состояния, ни обработчиков здесь нет.
 */

const R = 7
const CIRC = 2 * Math.PI * R

/** Доля кольца, закрашенная ember, по длине сессии */
const RING: Record<'short' | 'medium' | 'long', number> = {
  short: 0.25,
  medium: 0.55,
  long: 1,
}

export function AnswerGlyph({ value, className = '' }: { value: AnswerValue; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={20}
      height={20}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {shape(value)}
    </svg>
  )
}

function shape(value: AnswerValue) {
  switch (value) {
    case 'short':
    case 'medium':
    case 'long':
      return (
        <>
          {/* дорожка отдельным цветом — как у кольца прогресса */}
          <circle cx={10} cy={10} r={R} stroke="var(--track)" />
          <circle
            cx={10}
            cy={10}
            r={R}
            // −90°, чтобы дуга начиналась с двенадцати часов, а не с трёх
            transform="rotate(-90 10 10)"
            strokeDasharray={`${CIRC * RING[value]} ${CIRC}`}
          />
        </>
      )
    case 'chill':
      return <path d="M2 10 Q6 6.5 10 10 T18 10" />
    case 'engaged':
      return <path d="M2 13 L6 5.5 L10 14 L14 5 L18 12" />
    case 'solo':
      return <path d="M10 4.5 V15.5" />
    case 'friends':
      return <path d="M4.5 7.5 V15.5 M10 4.5 V15.5 M15.5 8.5 V15.5" />
  }
}
