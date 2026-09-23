'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { ClickSpark } from '@/components/ClickSpark'
import { SoundToggle } from '@/components/SoundToggle'
import { SpotlightCard } from '@/components/SpotlightCard'
import { useSearch } from '@/components/useSearch'
import { freshLastMood, lastMoodStore } from '@/lib/lastmood'
import { CONFIRM_MS, DUR, EASE, EASE_IN, OUTRO } from '@/lib/motion'
import { NEUTRAL_MOOD, type Lean } from '@/lib/mood'
import { playHref, VIBE_PRESETS } from '@/lib/presets'
import { STEPS } from '@/lib/quiz'
import { isSoundOn } from '@/lib/quizsound'
import type { Focus } from '@/lib/recommend'
import type { Mood } from '@/lib/types'

/**
 * Направление задаёт «Назад»: шаг возвращается оттуда, куда ушёл.
 *
 * Кривые взяты из lib/motion.ts, а не выписаны на месте: голая строка 'easeIn'
 * была единственной кривой приложения без токена, и докблок --ease-in прямо
 * говорит, что она существует ей на замену.
 *
 * staggerChildren — вся разница между «блок приехал» и «ответы разложили».
 * beforeChildren: заголовок встаёт на место раньше, чем начнут появляться
 * карточки, иначе они обгоняют вопрос, на который отвечают.
 */
const STEP_VARIANTS = {
  enter: (back: boolean) => ({ opacity: 0, x: back ? -24 : 24 }),
  center: {
    opacity: 1,
    x: 0,
    transition: {
      duration: DUR.base,
      ease: EASE,
      when: 'beforeChildren' as const,
      staggerChildren: 0.06,
    },
  },
  exit: (back: boolean) => ({
    opacity: 0,
    x: back ? 24 : -24,
    transition: { duration: DUR.fast, ease: EASE_IN },
  }),
}

/** Заголовок и карточки приходят по одной — шаг раскладывается, а не падает. */
const ITEM_VARIANTS = {
  enter: { opacity: 0, y: 14 },
  center: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: EASE_IN } },
}

/*
 * Вопросы приезжают из lib/quiz.ts, а не лежат здесь копией.
 *
 * Копия была, и слово в слово совпадала с оригиналом — ровно до первой правки
 * одного из двух мест. Разойтись они могли молча: тип у местной версии был
 * шире (key: string, value: string), поэтому переименованный ответ не сломал бы
 * ни сборку, ни тест, а просто перестал бы совпадать с тем, что читает разбор
 * настроения. Канон один, и он же кортеж из трёх — по его длине рисуется
 * рельса точек внизу экрана.
 */

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function Quiz() {
  const router = useRouter()
  const search = useSearch()
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [back, setBack] = useState(false)
  /** Ответ, который сейчас подтверждается; в финале он же победитель. */
  const [chosen, setChosen] = useState<string | null>(null)
  /**
   * Перенос фокуса между шагами.
   *
   * AnimatePresence mode="wait" размонтирует кнопку, в которой был фокус, и
   * он падает в body: клавиатурного человека молча выкидывает в начало
   * документа посреди анкеты. Задача та же, что решена в
   * components/room/RoomWaiting при уходе колоды.
   *
   * Но эффектом на stepIndex это не чинится, и проверено, что не чинится:
   * mode="wait" монтирует новый шаг ТОЛЬКО после того, как доиграет уход
   * старого, а эффект срабатывает сразу — узла ещё нет, фокусировать нечего.
   * Поэтому фокус забирает ref-колбэк, то есть сам момент появления узла, а
   * флаг отличает смену шага от первого захода: воровать фокус у человека,
   * который только открыл страницу, не за чем.
   */
  const wantStepFocus = useRef(false)
  const stepHeadRef = useCallback((el: HTMLHeadingElement | null) => {
    if (!el || !wantStepFocus.current) return
    wantStepFocus.current = false
    el.focus()
  }, [])
  const [outro, setOutro] = useState(false)

  const step = STEPS[stepIndex]
  const last = stepIndex === STEPS.length - 1
  // Приходит с /library («Выбрать одну →») и живёт до самого /play. Не настроение,
  // а отдельная ось — как roulette у «Мне повезёт».
  //
  // Читается через useSearch, а не useSearchParams: второй ронял весь
  // маршрут в клиентский рендер, и /quiz отдавал пустую разметку — шапку и
  // подвал. Подпись над пресетами меняется кадром позже, а в адрес выдачи
  // фокус попадает только по нажатию, то есть заведомо после гидратации.
  const focus: Focus | null = useMemo(
    () => (new URLSearchParams(search).get('from') === 'untouched' ? 'untouched' : null),
    [search],
  )

  /** Заведён ли аудиоконтекст. Общий на оба пути — иначе снос пропускает тот,
   *  что подняли не тем путём, и контекст переживает уход на выдачу. */
  const audioLive = useRef(false)

  const voice = useCallback((v: 'select' | 'outro') => {
    if (!isSoundOn()) return
    audioLive.current = true
    /*
     * armAudio перед каждым голосом, хотя есть и общий прогрев ниже.
     * Он идемпотентен, а порядок событий — нет: слушатель окна ловит click в
     * фазе всплытия, то есть ПОСЛЕ обработчика React. Нажатие по ответу
     * успевало позвать play раньше, чем появлялся контекст, и первый ответ
     * уходил молча. Здесь мы внутри жеста, поэтому контекст заводится сразу
     * в состоянии running.
     */
    void import('@/lib/quizaudio')
      .then((m) => {
        m.armAudio()
        m.play(v)
      })
      .catch(() => {})
  }, [])

  /*
   * Контекст звука заводится на ПЕРВОМ жесте и только если звук уже разрешён:
   * политика автозапуска не даёт создать AudioContext иначе. Слушаем и click —
   * он приходит уже ПОСЛЕ обработчика тумблера, поэтому включение звука заводит
   * контекст тем же нажатием, а не следующим.
   *
   * Здесь же снос: контекст переживает уход со страницы, а квиз уезжает на
   * /play сразу после финального такта.
   */
  useEffect(() => {
    const arm = () => {
      if (audioLive.current || !isSoundOn()) return
      audioLive.current = true
      void import('@/lib/quizaudio')
        .then((m) => m.armAudio())
        .catch(() => {})
    }
    window.addEventListener('pointerdown', arm)
    window.addEventListener('click', arm)
    window.addEventListener('keydown', arm)
    return () => {
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('click', arm)
      window.removeEventListener('keydown', arm)
      if (audioLive.current) void import('@/lib/quizaudio').then((m) => m.disposeAudio())
    }
  }, [])

  // Адрес собирает playHref (lib/presets.ts), а не строка здесь: копий было
  // три, и ось lean добавилась бы в одну из них
  const go = useCallback(
    (mood: Mood, opts: { roulette?: boolean; focus?: Focus; lean?: Lean } = {}) => {
      router.push(
        playHref(mood, { roulette: opts.roulette, focus: opts.focus ?? focus, lean: opts.lean }),
      )
    },
    [focus, router],
  )

  function pick(value: string) {
    // Второе нажатие во время такта игнорируем: иначе два таймера начинают
    // спорить, и человек уезжает на выдачу с чужим ответом.
    if (chosen) return
    const next = { ...answers, [step.key]: value }
    setChosen(value)

    if (!last) {
      voice('select')
      /*
       * Такт подтверждения. Раньше шаг менялся в тот же кадр, и нажатие ничем
       * не подтверждалось — карточка просто исчезала. CONFIRM_MS равен
       * --dur-fast, ровно столько же длится уход шага.
       */
      window.setTimeout(() => {
        setAnswers(next)
        setBack(false)
        setChosen(null)
        wantStepFocus.current = true
        setStepIndex((i) => i + 1)
      }, CONFIRM_MS)
      return
    }

    voice('outro')
    setAnswers(next)
    setOutro(true)
    const delay = prefersReducedMotion() ? OUTRO.reducedNavMs : OUTRO.navMs
    window.setTimeout(() => go(next as unknown as Mood), delay)
  }

  /** Нажатие подтверждается всегда; расходятся ответы только в финале. */
  const cardState = (value: string) => {
    if (!outro) return chosen === value ? 'press' : 'idle'
    return chosen === value ? 'won' : 'lost'
  }

  const grid = (
    <div
      className={`grid w-full gap-4 ${step.options.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
    >
      {step.options.map((o) => (
        <motion.div key={o.value} variants={ITEM_VARIANTS} className="h-full">
          {/* Состояние живёт на CSS, а не в motion: transform обёртки уже занят
              вариантами входа, и два источника одного свойства дрались бы за
              него на каждом кадре. */}
          <div data-answer={cardState(o.value)} className="quiz-answer h-full">
            <SpotlightCard
              onClick={() => pick(o.value)}
              className="panel-lift h-full px-6 py-8 text-left"
            >
              <div className="text-xl font-semibold">{o.label}</div>
              <div className="text-sm text-dim mt-1.5">{o.hint}</div>
            </SpotlightCard>
          </div>
        </motion.div>
      ))}
    </div>
  )

  return (
    <div className="relative flex-1 flex flex-col items-center justify-center px-5 py-24 overflow-hidden">
      {/* Фон дышит — тот же приём, что на экране ожидания и «Игре дня» */}
      <Ambient className="anim-breathe" />

      {/* Тумблер вне центральной колонки: композиция экрана не меняется, а
          звук всё равно нужно чем-то включать. */}
      <div className="absolute right-5 top-20 md:top-24">
        <SoundToggle />
      </div>

      <div className="relative w-full max-w-2xl flex flex-col items-center gap-10">
        {stepIndex === 0 && (
          <div className="w-full flex flex-col items-center gap-3 anim-rise">
            <span className="text-xs text-faint">
              {focus ? 'Только нераспакованное — одним тапом:' : 'Одним тапом:'}
            </span>
            {/*
              На телефоне пилюли едут одной лентой, а не переносятся.

              Замер на 375×812: семь пилюль вставали в ШЕСТЬ рядов, из них
              пять — по одной штуке, потому что «🕳️ Залипнуть на выходные»
              шире половины экрана. Облако занимало 262px, то есть треть
              экрана, и уводило вопрос «Сколько у тебя времени?» на y=478, а
              первую карточку ответа — на y=590. До того, ради чего страница
              существует, нужно было доскроллить.

              chip-rail уже лежал в globals.css и не использовался никем: он
              пережил откат кино-квиза, вместе с которым ушло 1409 строк
              соседних стилей. Написан он ровно под этот случай — правый фейд
              вместо стрелок, спрятанный скроллбар в обоих движках и снятый
              backdrop-filter у стеклянных чипов, без которого Chromium не
              рисует их внутри маски ВООБЩЕ.

              justify-start, а не center: в ленте с переполнением центрирование
              прячет первый элемент за левым краем без возможности доскроллить.
              На десктопе оба возвращаются — там перенос строками и уместен,
              и маска сама гаснет на 768px.

              py-1, а не только снизу: лента прокручивается, а прокручиваемый
              контейнер режет всё, что выходит за его край, — в том числе
              кольцо фокуса (4px наружу) и подъём glass-hover сверху.
            */}
            <div className="chip-rail self-stretch flex flex-nowrap md:flex-wrap justify-start md:justify-center gap-2 -mx-5 px-5 md:mx-0 md:px-0 py-1">
              {VIBE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => go(p.mood, { lean: p.lean })}
                  /* py-3, а не py-2: замерено на 375 px — пилюля выходила 38 px
                     при стандарте продукта в 44 (докблок .tap). Утилитой .tap
                     это не чинится: её зона вылезает на 6 px вбок, а пилюли
                     стоят с зазором 8, и соседи начали бы воровать нажатия —
                     ровно тот дефект, что уже описан у .chip. Растёт сама
                     кнопка, зазор остаётся настоящим. */
                  className="glass glass-hover shrink-0 rounded-full px-4 py-3 text-sm cursor-pointer"
                >
                  {p.emoji} {p.label}
                </button>
              ))}
              <button
                onClick={() => {
                  // Время — из прошлого настроения, если оно свежее: сколько у
                  // человека есть минут, — не то, что стоит отдавать на волю
                  // случая. Бросок — во всём остальном.
                  const last = freshLastMood(lastMoodStore.get(), Math.floor(Date.now() / 1000))
                  go(
                    {
                      time:
                        last?.mood.time ??
                        (['short', 'medium', 'long'] as const)[Math.floor(Math.random() * 3)],
                      vibe: (['chill', 'engaged'] as const)[Math.floor(Math.random() * 2)],
                      social: 'solo',
                    },
                    { roulette: true },
                  )
                }}
                className="shrink-0 rounded-full bg-ember/15 text-ember-text px-4 py-3 text-sm hover:bg-ember/25 transition cursor-pointer"
              >
                Мне повезёт
              </button>
              {/*
                Кнопки нет, когда фокус УЖЕ включён — то есть когда сюда
                пришли с /library по «Все нераспакованные →». Там она не
                просто лишняя: подпись рядом в этот момент просит выбрать
                настроение, а кнопка ставит NEUTRAL_MOOD и уезжает, то есть
                отменяет ровно то, о чём её сосед только что попросил.
              */}
              {!focus && (
                <button
                  onClick={() => go(NEUTRAL_MOOD, { focus: 'untouched' })}
                  className="shrink-0 rounded-full bg-ember/15 text-ember-text px-4 py-3 text-sm hover:bg-ember/25 transition cursor-pointer"
                >
                  Ни разу не запускал
                </button>
              )}
            </div>
          </div>
        )}

        {/*
          Подпись стоит ПЕРЕД тем, что объясняет, и это единственная правка
          порядка на экране.

          Раньше она была одна на оба пути и стояла ПОСЛЕ чипсов: «одним
          тапом — или ответь на три вопроса:». Человек встречал семь
          неподписанных кнопок и только под ними узнавал, что это ярлыки, —
          а двоеточие в конце той же строки указывало вперёд, на вопросы.
          Одна строка тянула в две стороны сразу и не помогала ни одной.

          Теперь половин две, и каждая стоит над своим: «Одним тапом:» над
          рядом ярлыков, «Или ответь на три вопроса:» — в одной группе с
          точками шага, а не в одной с чипсами. Слова те же, переехало
          только место.
        */}
        <div className="flex flex-col items-center gap-3">
          {stepIndex === 0 && (
            <span className="text-xs text-faint anim-rise">Или ответь на три вопроса:</span>
          )}
          <div className="flex gap-2.5">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              // Текущая точка чуть крупнее: цвет говорит «пройдено», размер —
              // «ты здесь». Раньше оба состояния передавал один цвет.
              //
              // В transition именно scale, а не transform: Tailwind v4 пишет
              // scale-125 в отдельное свойство scale, и переход по transform
              // его не касался — точка прыгала вместо роста.
              className={`h-2 w-2 rounded-full transition-[background-color,scale] duration-[320ms] ease-[cubic-bezier(.22,1,.36,1)] ${
                i <= stepIndex ? 'bg-ember' : 'bg-track'
              } ${i === stepIndex ? 'scale-125' : ''}`}
              />
            ))}
          </div>
        </div>

        {/* Шаги едут в сторону движения: вперёд — влево, «Назад» — вправо.
            Раньше шаг просто перемонтировался и появлялся на том же месте.

            initial={false} — то же самое правило, что у .anim-page-in в globals.css:
            «анимация может только добавить проявление, но не может спрятать контент».
            Там оно было выписано для CSS и не доехало до motion. А здесь состояние
            enter — это opacity: 0, и motion рендерит его ИНЛАЙНОМ УЖЕ НА СЕРВЕРЕ:
            проверено, в HTML приезжало style="opacity:0;transform:translateX(24px)"
            на вопросе и translateY(14px) на каждом ответе. То есть разметка уже у
            человека, а экран пуст до конца гидратации — а если она не случится
            вовсе (сбой чанка, ошибка в соседнем компоненте), то навсегда.

            Хореография при этом не теряется: мгновенно появляется только ПЕРВЫЙ
            шаг, а переходы между шагами — то, ради чего всё и сделано, — едут как ехали. */}
        <AnimatePresence mode="wait" custom={back} initial={false}>
          <motion.div
            key={step.key}
            custom={back}
            variants={STEP_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            className="w-full flex flex-col items-center gap-10"
          >
            {/*
              tabIndex={-1} — чтобы заголовок мог принять фокус программно, не
              появляясь при этом в обходе по Tab. role="status" на нём же
              лишний: заголовок и так объявляется при получении фокуса, а
              «какой это вопрос из скольких» несёт подпись ниже.
            */}
            <motion.h1
              ref={stepHeadRef}
              tabIndex={-1}
              variants={ITEM_VARIANTS}
              className="font-display text-display-md text-center outline-none"
            >
              {step.question}
            </motion.h1>
            {/* Точки прогресса выше — голые span, для скринридера их нет.
                Одна строка вместо них, и меняется она раз в шаг, а не в кадр. */}
            <p role="status" className="sr-only">
              Вопрос {stepIndex + 1} из {STEPS.length}
            </p>

            {/* Залп искр ровно один раз за прохождение — в финале и программно,
                на sparkAt из партитуры, а не по клику. lib/motion.test.ts
                сторожит, что искры успевают дожить до навигации. */}
            {outro ? (
              <ClickSpark className="block w-full" fireOnMount fireDelay={OUTRO.sparkAt}>
                {grid}
              </ClickSpark>
            ) : (
              grid
            )}
          </motion.div>
        </AnimatePresence>

        {stepIndex > 0 && !outro && (
          <button
            onClick={() => {
              setBack(true)
              wantStepFocus.current = true
              setStepIndex(stepIndex - 1)
            }}
            className="tap text-sm text-dim hover:text-ink transition-colors cursor-pointer"
          >
            ← Назад
          </button>
        )}
      </div>
    </div>
  )
}

/*
 * Границы Suspense здесь больше нет: она стояла ради useSearchParams, а
 * вместе с пустым фолбэком означала пустую разметку маршрута. См.
 * components/useSearch.
 */
export default function QuizPage() {
  return <Quiz />
}
