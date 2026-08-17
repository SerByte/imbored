import type { Mood } from './types'

/**
 * Содержание квиза: три оси, их вопросы и ответы.
 *
 * Лежит в lib, а не в app/quiz/page.tsx, где жило раньше, по двум причинам.
 * Подписи ответов нужны не только квизу: экран ожидания /play собирает из них ту
 * же строку («Пара часов · Расслабиться · Один»), которой квиз закончился, — а
 * это и есть шов между двумя экранами. И вторая: страница квиза клиентская, а
 * здесь появилась логика, которую надо покрывать тестами.
 */

/** Ось настроения. Совпадает с ключами Mood — это не совпадение, а контракт. */
export type AxisKey = keyof Mood

/** Любой из семи возможных ответов, независимо от оси */
export type AnswerValue = Mood[AxisKey]

type StepFor<K extends AxisKey> = {
  key: K
  /**
   * Короткая подпись для рельса шагов. Отдельно от вопроса: «Сколько у тебя
   * времени?» в рельс не влезает, а «Время» не работает заголовком экрана.
   */
  axis: string
  question: string
  /**
   * Индекс ударного слова вопроса. Титульность делается контрастом веса внутри
   * одной строки, и решать, какое слово несёт вопрос, обязано СОДЕРЖАНИЕ, а не
   * стиль: «времени», «вайб», «один» — это и есть ось, всё остальное служебное.
   */
  stress: number
  options: Array<{ value: Mood[K]; label: string; hint: string }>
}

export type QuizStep = StepFor<'time'> | StepFor<'vibe'> | StepFor<'social'>

/**
 * Кортеж, а не массив: длина три зашита в тип, поэтому «1 / 3» в рельсе и
 * разбор ответов не могут разойтись с содержанием молча.
 */
export const STEPS: readonly [StepFor<'time'>, StepFor<'vibe'>, StepFor<'social'>] = [
  {
    key: 'time',
    axis: 'Время',
    question: 'Сколько у тебя времени?',
    stress: 3,
    options: [
      { value: 'short', label: 'Меньше часа', hint: 'быстрая катка и спать' },
      { value: 'medium', label: 'Пара часов', hint: 'нормально посидеть' },
      { value: 'long', label: 'Весь вечер', hint: 'можно и утонуть' },
    ],
  },
  {
    key: 'vibe',
    axis: 'Вайб',
    question: 'Какой вайб?',
    stress: 1,
    options: [
      { value: 'chill', label: 'Расслабиться', hint: 'без стресса и потных ладоней' },
      { value: 'engaged', label: 'Напрячься', hint: 'думать, потеть, побеждать' },
    ],
  },
  {
    key: 'social',
    axis: 'Компания',
    question: 'Один или с кем-то?',
    stress: 0,
    options: [
      { value: 'solo', label: 'Один', hint: 'только я и игра' },
      { value: 'friends', label: 'С друзьями', hint: 'нужен мультиплеер или кооп' },
    ],
  },
] as const

/** Все семь ответов одним списком — по ним подбираются обложки в lib/quizart.ts */
export const ANSWER_VALUES: readonly AnswerValue[] = STEPS.flatMap((s) =>
  s.options.map((o) => o.value as AnswerValue),
)

/**
 * Ключ набора ответов для карты чисел в lib/quizcount.ts: `short:chill:solo`.
 *
 * Живёт здесь, а не рядом со счётом, намеренно: этот модуль ничего не тянет за
 * собой, а quizcount тянет отбор кандидатов и классификацию библиотеки —
 * клиенту, которому нужен только ключ, всё это ни к чему.
 */
export function countKey(answers: Partial<Mood>): string {
  return [answers.time, answers.vibe, answers.social].filter(Boolean).join(':')
}

const LABELS = new Map<string, string>(
  STEPS.flatMap((s) => s.options.map((o) => [o.value as string, o.label] as const)),
)

/**
 * Подпись ответа или null, если значение неизвестно.
 *
 * Null, а не сам value: настроение приезжает на /play из адресной строки и
 * разбирается там приведением типа без проверки (`search.get('time') as …`).
 * На `?time=banana` подпись должна отсутствовать, а не показывать «banana».
 */
export function answerLabel(value: string): string | null {
  return LABELS.get(value) ?? null
}

/**
 * Настроение одной строкой: «Пара часов · Расслабиться · Один».
 *
 * Это последнее, что пишет квиз, и первое, что показывает экран ожидания.
 * Неизвестные значения выпадают, а не подставляются как есть; если не осталось
 * ничего — пустая строка, и подпись просто не рендерится.
 */
export function moodCaption(mood: Mood): string {
  return [mood.time, mood.vibe, mood.social]
    .map(answerLabel)
    .filter((l): l is string => l !== null)
    .join(' · ')
}
