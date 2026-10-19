import type { Locale } from './i18n'
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

/**
 * Те же шаги по-английски — тот же кортеж той же формы: оси, значения и
 * порядок общие, у языка — только слова. Ударное слово своё: «How much free
 * time?» несёт ось в «time?» (индекс 3), «What's the vibe?» — в «vibe?»
 * (2), «Solo or with someone?» — в «Solo» (0).
 *
 * Подписи — из глоссария: Unwind / Lock in (как чипсы движка на лендинге),
 * Solo / With friends; «катка» — round, не match.
 *
 * Ширина замерена на /en/quiz (360–430 px, Manrope 800): английский не шире
 * русского. «How much time do you have?» шире «Сколько у тебя времени?»
 * (530 против 477 px при 40 px) и на 414 и 430 рвался на две строки, где
 * русский в одну; «How much free time?» — 387 px, в одну строку на всех
 * пяти ширинах (русский на 360–390 — в две). «A couple of hours» в плитке на
 * 360–390 вставал в две строки, «Пара часов» — в одну; «A few hours» —
 * ровно ширина «Пара часов» (119 px при 22 px), в строку везде.
 */
const STEPS_EN: typeof STEPS = [
  {
    key: 'time',
    axis: 'Time',
    question: 'How much free time?',
    stress: 3,
    options: [
      { value: 'short', label: 'Under an hour', hint: 'a quick round, then bed' },
      { value: 'medium', label: 'A few hours', hint: 'a proper session' },
      { value: 'long', label: 'All evening', hint: 'time to get lost in it' },
    ],
  },
  {
    key: 'vibe',
    axis: 'Vibe',
    question: "What's the vibe?",
    stress: 2,
    options: [
      { value: 'chill', label: 'Unwind', hint: 'no stress, no sweaty palms' },
      { value: 'engaged', label: 'Lock in', hint: 'think, sweat, win' },
    ],
  },
  {
    key: 'social',
    axis: 'Company',
    question: 'Solo or with someone?',
    stress: 0,
    options: [
      { value: 'solo', label: 'Solo', hint: 'just me and the game' },
      { value: 'friends', label: 'With friends', hint: 'needs multiplayer or co-op' },
    ],
  },
]

/** Шаги квиза на каждом языке; STEPS — русские, как были */
export const STEPS_BY_LOCALE = { ru: STEPS, en: STEPS_EN } as const satisfies Record<Locale, typeof STEPS>

export function stepsFor(locale: Locale = 'ru'): typeof STEPS {
  return STEPS_BY_LOCALE[locale]
}

/**
 * Все семь ответов одним списком. Нужен сторожу в lib/quiz.test.ts: у каждого
 * ответа обязана быть подпись, иначе answerLabel молча вернёт пустоту.
 */
export const ANSWER_VALUES: readonly AnswerValue[] = STEPS.flatMap((s) =>
  s.options.map((o) => o.value as AnswerValue),
)

/** Карта «значение → подпись» одного языка — одна на язык, собранная заранее */
function labelsOf(steps: typeof STEPS): Map<string, string> {
  return new Map<string, string>(steps.flatMap((s) => s.options.map((o) => [o.value as string, o.label] as const)))
}

const LABELS = { ru: labelsOf(STEPS), en: labelsOf(STEPS_EN) } satisfies Record<Locale, Map<string, string>>

/**
 * Подпись ответа или null, если значение неизвестно.
 *
 * Null, а не сам value: настроение приезжает на /play из адресной строки и
 * разбирается там приведением типа без проверки (`search.get('time') as …`).
 * На `?time=banana` подпись должна отсутствовать, а не показывать «banana».
 */
export function answerLabel(value: string, locale: Locale = 'ru'): string | null {
  return LABELS[locale].get(value) ?? null
}

/**
 * Настроение одной строкой: «Пара часов · Расслабиться · Один».
 *
 * Это последнее, что пишет квиз, и первое, что показывает экран ожидания.
 * Неизвестные значения выпадают, а не подставляются как есть; если не осталось
 * ничего — пустая строка, и подпись просто не рендерится.
 */
export function moodCaption(mood: Mood, locale: Locale = 'ru'): string {
  return [mood.time, mood.vibe, mood.social]
    .map((v) => answerLabel(v, locale))
    .filter((l): l is string => l !== null)
    .join(' · ')
}
