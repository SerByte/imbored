'use client'

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useState, useSyncExternalStore } from 'react'
import { GameArt } from '@/components/GameArt'
import { Eyebrow } from '@/components/Labels'
import { Stage } from '@/components/landing/Stage'
import { fmtNumber, pl, tr, type Locale } from '@/lib/i18n'
import type { LandingDemo, MoodKey } from '@/lib/landing'

/**
 * СЦЕНА 3: КАК ЭТО РАБОТАЕТ. Главный аттракцион страницы.
 *
 * Такты по прокрутке: стена из демо-библиотеки собирается, появляются
 * переключатели, пятёрка загорается кольцом и вылетает карточками, дальше
 * прокрутка сама щёлкает «Напрячься» и «С друзьями». На последнем такте сцена
 * ОТПУСКАЕТ: переключатели становятся кликабельными, и продукт можно потрогать
 * до всякого входа.
 *
 * Всё это — про закреплённую сцену. Там, где она в экран не помещается
 * (телефон, короткое окно — см. Stage), закрепления нет, партитуру доиграть
 * негде, и сцена отпускает сразу: переключатели — единственное, что меняет
 * пятёрку, а прокрутка её не трогает (почему — у buildEngine).
 *
 * СОСТОЯНИЕ СЧИТАЕТСЯ ИЗ ПРОГРЕССА, А НЕ ПО СОБЫТИЯМ. Иначе движение назад
 * отыгрывается не так, как вперёд: события «сцена дошла до трети» при
 * прокрутке вверх не случается, и человек, вернувшийся на полсцены, видит
 * переключатели в одном состоянии, а выдачу — в другом.
 *
 * ПОДМЕНА ПЯТЁРКИ — НА CSS-ПЕРЕХОДАХ, А НЕ НА GSAP, и это вывод из дефекта
 * прототипа: `fromTo` с задержкой, убитый следующим переключением, оставлял
 * карточки на opacity 0 навсегда, и колонка «Что предложит» стояла пустой.
 * Переход прервать на полпути нельзя — он просто едет к новому значению.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Причины «на ты» у карточек: шаблоны продукта обращаются к
 * читателю и говорят про ТВОЮ библиотеку, а библиотека здесь чужая — это была
 * бы прямая неправда. Поля с такой причиной нет и в данных (см. докблок
 * lib/landing.ts). Есть другое: у первой карточки — та же причина про
 * демо-игрока («Почему первая», под стеной), потому что первая строка главной
 * обещает «И почему именно она», и показать это до входа — смысл сцены.
 */

/** Длина закрепления. Одно число на закрепление и на счёт состояния. */
const END = '+=240%'

/** Порядок тактов: прокрутка проходит по ним слева направо. */
const BEATS: readonly MoodKey[] = ['chill:solo', 'engaged:solo', 'engaged:friends']

/** Границы тактов в долях прогресса сцены. Замерено на прототипе. */
const BEAT_AT = [0, 0.45, 0.7]

/** С этой доли сцена отдаёт руки — до того, как начнётся уход кадра. */
const LIVE_AT = 0.82

/*
 * Подписи чипов — те же, что у квиза (lib/quiz, глоссарий: Unwind / Lock in /
 * Solo / With friends): сцена показывает его вопросы до входа, и слова
 * обязаны совпасть с теми, что человек нажмёт потом. Подсказки — короче
 * квизовых: чип узкий.
 */
/** Чип переключателя: значение настроения и подписи на обоих языках */
type Chip = { value: string; label: Record<Locale, string>; hint: Record<Locale, string> }

const VIBES = [
  { value: 'chill', label: { ru: 'Расслабиться', en: 'Unwind' }, hint: { ru: 'без стресса', en: 'no stress' } },
  { value: 'engaged', label: { ru: 'Напрячься', en: 'Lock in' }, hint: { ru: 'думать и потеть', en: 'think and sweat' } },
] as const satisfies readonly Chip[]

const SOCIALS = [
  { value: 'solo', label: { ru: 'Один', en: 'Solo' }, hint: { ru: 'только я и игра', en: 'just me and the game' } },
  { value: 'friends', label: { ru: 'С друзьями', en: 'With friends' }, hint: { ru: 'нужен кооп', en: 'needs co-op' } },
] as const satisfies readonly Chip[]

const ALL_KEYS: readonly MoodKey[] = [
  'chill:solo',
  'chill:friends',
  'engaged:solo',
  'engaged:friends',
]

/**
 * «УМЕНЬШИТЬ ДВИЖЕНИЕ» — ЧЕРЕЗ useSyncExternalStore, И ОБА ОТКАЗА ОТ АЛЬТЕРНАТИВ
 * СТОИЛИ ПО ОШИБКЕ.
 *
 * Хук useReducedMotion из motion отдаёт настоящее значение уже на первом
 * клиентском рендере. Подставленный прямо в выражение, он разошёлся с
 * разметкой сервера: сервер печатал `data-live="0"`, клиент хотел `"1"`.
 * Атрибуты React при гидратации не чинит — так и говорит в консоли, «this
 * won't be patched up», — и в DOM оставался ноль при живой сцене, то есть
 * курсор и отклик из стилей не включались. Поймано в логе dev-сервера.
 *
 * Перенос в useEffect расхождение снимает, но упирается в правило проекта:
 * синхронный setState внутри эффекта — ошибка линтера, а не предупреждение.
 *
 * useSyncExternalStore — ровно тот примитив, который React для этого и завёл.
 * При гидратации берётся серверный снимок (движение не уменьшено, как и в
 * разметке), сразу после — настоящий, и перерисовка проходит штатно.
 */
const REDUCED = '(prefers-reduced-motion: reduce)'
const subscribeReduced = (onChange: () => void) => {
  const mq = window.matchMedia(REDUCED)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const readReduced = () => window.matchMedia(REDUCED).matches
/** На сервере медиазапроса нет — и разметка обязана совпасть с этим. */
const readReducedOnServer = () => false

/**
 * Язык — пропом от главной, тем же, на каком собрана демо-выдача (причина
 * первой, бейджи и теги уже на нём, lib/landing): так сцену можно вызвать и
 * прямо функцией, без провайдера (lib/enginescene.test.ts). Без пропа —
 * русский.
 */
export function Engine({ demo, locale = 'ru' }: { demo: LandingDemo; locale?: Locale }) {
  const [key, setKey] = useState<MoodKey>('chill:solo')
  /**
   * Прокрутка довела партитуру до конца — сцена отпустила сама. У
   * незакреплённой сцены партитуры нет, и это true с самого начала.
   */
  const [past, setPast] = useState(false)
  /**
   * Клавиатурный фокус внутри переключателей — закреплённая сцена отпускает
   * досрочно (незакреплённая отпущена и так, см. buildEngine).
   *
   * Причина замерена, а не придумана. В закреплённой сцене положение элемента
   * на странице соответствует НАЧАЛУ закрепления, то есть прогрессу около
   * нуля. Значит браузер, доводящий сфокусированный элемент до кадра, всегда
   * приводит сцену туда, где партитура ещё не сыграна, — и до состояния
   * «отпущено» табуляцией не доехать в принципе. Замерено: прокрутка стоит на
   * одном и том же числе на всех четырёх чипах.
   *
   * Для мыши отказ до конца партитуры честен: курсор приезжает вместе с
   * прокруткой, и она же его дождётся. Для клавиатуры «пока рано» означало бы
   * «никогда» — четыре видимые кнопки с кольцом фокуса, не делающие ничего.
   * Ровно то обещание отклика без отклика, которое запрещено в стилях
   * (см. [data-live='1'] .chip:active в globals.css).
   *
   * НАЖАТИЕ БЕЗ УКАЗАТЕЛЯ — ТОЖЕ НЕ «РАНО», и одного held для него мало.
   * Экранный диктор нажимает кнопку, не проводя к ней клавиатурный фокус:
   * VoiceOver (VO+Пробел), NVDA в режиме обзора (Enter), Switch Control —
   * :focus-visible при этом может не загореться, held не встаёт, а прокрутка
   * к чипу ставит закреплённую сцену туда же, около нуля. Такой click
   * узнаётся по detail: это счёт нажатий указателя, и у click, рождённого
   * клавиатурой или действием диктора, он 0, а у щелчка мыши и касания — 1 и
   * больше. Поэтому pick пропускает нажатие с detail 0 при любом прогрессе
   * (см. onClick у чипов), а правило «для мыши отказ честен» остаётся каким
   * было.
   */
  const [held, setHeld] = useState(false)
  /**
   * «УМЕНЬШИТЬ ДВИЖЕНИЕ» ОТПУСКАЕТ СЦЕНУ СРАЗУ.
   *
   * `past` считается внутри `build`, а `build` в этом режиме не вызывается
   * вовсе — значит без этой строки он оставался бы `false` навсегда.
   * Замерено: переключатели видны, читаются, отвечают на наведение и НЕ
   * работают ни от мыши, ни от клавиатуры. Дефект давний, обнаружен по
   * дороге: партитуры в этом режиме нет, ждать ей нечего, и «сцена ещё не
   * доехала» здесь не значит ничего.
   *
   * Как режим читается и почему именно так — в докблоке над subscribeReduced.
   */
  const reduced = useSyncExternalStore(subscribeReduced, readReduced, readReducedOnServer)
  const live = past || held || reduced

  const [vibe, social] = key.split(':') as ['chill' | 'engaged', 'solo' | 'friends']
  const chosen = new Set(demo.picks[key].map((c) => c.appid))
  /*
   * Блоки «Почему первая» — по РАЗНЫМ причинам, а не по ключам состояния.
   * Почему — в разметке ниже, у data-whys.
   */
  const whys = [...new Set(ALL_KEYS.flatMap((k) => demo.picks[k][0]?.why ?? []))]
  const whyNow = demo.picks[key][0]?.why

  /** nonPointer — click без указателя (detail 0): см. докблок held. */
  const pick = (next: MoodKey, nonPointer = false) => {
    if (!live && !nonPointer) return
    setKey(next)
  }

  return (
    <Stage
      id="engine"
      label={tr(locale, { ru: 'Как это работает', en: 'How it works' })}
      end={END}
      enter={(intro, root) => {
        /*
         * КАДР СЦЕНЫ СТАВИТСЯ НА ПОДЪЁМЕ. Стена слетается, пока сцена ещё
         * поднимается в экран, — и это лечит настоящую дыру: между концом
         * закрепления предыдущей сцены и началом своего есть целый экран
         * прокрутки, на котором сцена уже видна. Замерено: там были видны
         * только номер и два надзаголовка, то есть страница выглядела
         * сломанной.
         */
        const wall = root.querySelectorAll('[data-wall] li')
        const note = root.querySelector('[data-wall-note]')
        gsap.set(wall, { autoAlpha: 0, scale: 0.72, y: 26 })
        gsap.set(note, { autoAlpha: 0 })
        intro
          .to(
            wall,
            {
              autoAlpha: 1,
              scale: 1,
              y: 0,
              stagger: { amount: 0.5, from: 'random' },
              duration: 0.6,
              ease: 'back.out(1.4)',
            },
            0,
          )
          .to(note, { autoAlpha: 1, duration: 0.2 }, 0.5)
      }}
      build={(tl, root, pinned) => buildEngine(tl, root, pinned, { key: setKey, past: setPast })}
    >
      {/* Свет сцены: холодное над складом, тёплое над ответом. Лежит под
          содержимым — см. .scene-inner и isolation в globals.css. */}
      <div className="engine-glow" aria-hidden data-engine-glow />

      <p className="slate">
        <b>03</b>
        <span>{tr(locale, { ru: 'Как это работает', en: 'How it works' })}</span>
      </p>

      <div className="engine-grid" data-live={live ? '1' : '0'}>
        <div className="min-w-0">
          <Eyebrow tone="faint" className="mb-3">
            {tr(locale, { ru: 'Из чего выбираем', en: 'What we pick from' })}
          </Eyebrow>
          <ul className="wall" data-wall>
            {demo.wall.map((g) => (
              <li key={g.appid} className={chosen.has(g.appid) ? 'is-on' : undefined}>
                <GameArt
                  appid={g.appid}
                  name={g.name}
                  headerImage={g.headerImage}
                  art={g.art}
                  /* Замерено: плитка стены — 37 px на телефоне и около 114 на
                     десктопе. Прежние «120px» завышали запрос втрое, и на
                     экране с двойной плотностью браузер брал 460 там, где
                     хватало витрины в 231. */
                  sizes="(max-width: 899px) 44px, 120px"
                />
              </li>
            ))}
          </ul>
          {/*
            Рамка честности стоит рядом со стеной и обычным цветом. Ужать её в
            подпись значило бы спрятать единственное, что отличает
            демонстрацию от вранья.
          */}
          {locale === 'en' ? (
            <p className="mt-3 max-w-md text-xs leading-relaxed text-faint" data-wall-note>
              Someone else’s library: the demo player’s {demo.libraryCount}{' '}
              {pl(locale, demo.libraryCount, GAMES)}, {fmtNumber(locale, demo.libraryHours)}{' '}
              {pl(locale, demo.libraryHours, HOURS)}. Yours will be different; the mechanics are the same.
            </p>
          ) : (
            <p className="mt-3 max-w-md text-xs leading-relaxed text-faint" data-wall-note>
              Чужая библиотека: {demo.libraryCount}{' '}
              {pl(locale, demo.libraryCount, GAMES)} демо-игрока,{' '}
              {fmtNumber(locale, demo.libraryHours)}{' '}
              {pl(locale, demo.libraryHours, HOURS)}. Твоя будет другой, механика та
              же.
            </p>
          )}

          {/*
            «ПОЧЕМУ ПЕРВАЯ» — обещание первой строки главной («И почему
            именно она»), показанное до входа: причина продукта, но про
            демо-игрока (LandingCard.why, lib/landing.ts).

            Под стеной, а не в карточке, и это замер, а не вкус. Сцена
            закрепляется, только пока помещается в экран (Stage), а высоту
            ей задаёт правая колонка. Причина внутри первой карточки
            прибавляла ей 64 px на любой ширине: 813 → 877 на 1440×900,
            880 → 944 на 1920×1080, — и сцена переставала закрепляться на
            обычных окнах ноутбука и монитора с панелью закладок. Под стеной
            на десктопе пусто на ~160 px, и причина встаёт туда даром. На
            телефоне колонки идут одна под другой, и причина оказывается
            прямо над переключателями: сменил вайб — и видно, как она
            сменилась.

            Блоки лежат в одной ячейке сетки, как пятёрки: колонка держит
            высоту самого длинного, и подмена не двигает ничего.

            БЛОК НА КАЖДУЮ РАЗНУЮ ПРИЧИНУ, А НЕ НА КАЖДОЕ СОСТОЯНИЕ, и это
            тоже замер. Первая игра от компании почти не зависит: в демо-выдаче
            «Один» и «С друзьями» дают одну и ту же первую (Terraria при
            «Расслабиться», Factorio при «Напрячься») и одну и ту же причину.
            Пока блоков было четыре по ключам, нажатие «Один ↔ С друзьями»
            перекрещивало два одинаковых абзаца: старый гаснет 1 → 0, новый
            загорается 0 → 1 за те же 0.28 с, и на середине суммарная
            непрозрачность проседала до ~0.75. Причина и её надзаголовок
            мигали, хотя не поменялось ничего, — а прямо над переключателями
            мигание читается как смена, которой не было. С ключом по тексту
            одинаковая причина — один и тот же элемент, и переходить ему
            некуда.
          */}
          <div className="engine-whys" data-whys>
            {whys.map((w) => (
              <div key={w} className={`engine-why${w === whyNow ? ' is-on' : ''}`}>
                <Eyebrow tone="ember" className="mb-1.5">
                  {tr(locale, { ru: 'Почему первая', en: 'Why this one first' })}
                </Eyebrow>
                <p className="text-sm leading-relaxed text-ink/90">{w}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <div
            className="switches"
            data-switches
            /*
             * :focus-visible, а не просто :focus, — тот же разделитель, что у
             * кольца в globals.css. Клик мышью по кнопке ему не отвечает, и
             * поведение сцены под курсором остаётся ровно прежним: до конца
             * партитуры чип не обещает нажатия ни курсором, ни ходом.
             */
            onFocus={(e) => {
              if (e.target instanceof HTMLElement && e.target.matches(':focus-visible')) setHeld(true)
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false)
            }}
          >
            <div className="switch">
              <Eyebrow tone="faint">{tr(locale, { ru: 'Вайб', en: 'Vibe' })}</Eyebrow>
              <div className="switch-row">
                {VIBES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="chip"
                    aria-pressed={vibe === o.value}
                    onClick={(e) => pick(`${o.value}:${social}` as MoodKey, e.detail === 0)}
                  >
                    <b>{o.label[locale]}</b>
                    <i>{o.hint[locale]}</i>
                  </button>
                ))}
              </div>
            </div>
            <div className="switch">
              <Eyebrow tone="faint">{tr(locale, { ru: 'Компания', en: 'Company' })}</Eyebrow>
              <div className="switch-row">
                {SOCIALS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="chip"
                    aria-pressed={social === o.value}
                    onClick={(e) => pick(`${vibe}:${o.value}` as MoodKey, e.detail === 0)}
                  >
                    <b>{o.label[locale]}</b>
                    <i>{o.hint[locale]}</i>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Eyebrow className="mb-3 mt-5">{tr(locale, { ru: 'Что предложит', en: 'What you’d get' })}</Eyebrow>
          <div className="picks" data-picks>
            {ALL_KEYS.map((k) => (
              /*
                Пятёрка — нумерованный список, а не пять блоков подряд:
                скринридер называет «список, 5 элементов» и место каждой
                карточки, а порядок здесь и есть содержание («своё идёт
                первым»). Пока это были div, комментарий ниже ссылался на
                список, которого не было, и ранг не доходил до ридера никак.

                role="list" — не повтор: стили сбрасывают list-style, и
                Safari с VoiceOver у такого <ol> семантику списка снимает.
                Скрытые наборы (visibility: hidden) в дерево доступности не
                попадают — слышен только тот, что на экране.
              */
              <ol key={k} role="list" className={`pickset${k === key ? ' is-on' : ''}`}>
                {demo.picks[k].map((c, i) => (
                  <li key={c.appid} className="pick">
                    {/*
                      Номер, а не маркер списка: порядок в пятёрке
                      содержательный (своё идёт первым, покупок не больше
                      двух), и он обязан читаться числом. aria-hidden —
                      место в списке ридер называет сам, и «ноль один»
                      прозвучал бы вторым разом.
                    */}
                    <span aria-hidden className="pick-rank">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <GameArt
                      appid={c.appid}
                      name={c.name}
                      headerImage={c.headerImage}
                      art={c.art}
                      sizes="160px"
                    />
                    <div className="min-w-0 flex-1">
                      <Eyebrow>{c.badge}</Eyebrow>
                      <div className="pick-name">{c.name}</div>
                      <div className="pick-tags">{c.tags.join(' · ')}</div>
                    </div>
                  </li>
                ))}
              </ol>
            ))}
          </div>

          <p className="mt-3 max-w-md text-xs leading-relaxed text-faint">
            {tr(locale, {
              ru: 'Своё идёт первым, покупок в пятёрке не больше двух. Третий вопрос — сколько у тебя времени — задаём в самом подборе.',
              en: 'Your own games come first, and no more than two in the five are purchases. The third question — how much time you have — comes in the pick itself.',
            })}
          </p>
        </div>
      </div>
    </Stage>
  )
}

/** Формы слов подписи под стеной — для pl() */
const GAMES: Parameters<typeof pl>[2] = { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] }
const HOURS: Parameters<typeof pl>[2] = { ru: ['час', 'часа', 'часов'], en: ['hour', 'hours'] }

/**
 * ПАРТИТУРА СЦЕНЫ — тело `build`, отдельной функцией, а не стрелкой в
 * разметке: так её поведение проверяется без DOM (lib/enginescene.test.ts).
 * Состояние компонента она меняет только через `set`.
 *
 * Стоит ПОСЛЕ компонента, и это не вкус. Сторож «сцены прячут содержимое
 * только внутри enter и build» (lib/landingdoor.test.ts) ищет gsap.set в
 * тексте модуля до первого колбэка сцены — то есть в том, что исполняется при
 * любом режиме. Эта функция исполняется только из build, которого при
 * «уменьшить движение» нет, и правило она соблюдает; выше компонента сторож
 * принял бы её за голый gsap.set.
 */
export function buildEngine(
  tl: gsap.core.Timeline,
  root: HTMLElement,
  pinned: boolean,
  set: { key: (key: MoodKey) => void; past: (past: boolean) => void },
): void {
  const switches = root.querySelector('[data-switches]')
  const picks = root.querySelector('[data-picks]')
  const whys = root.querySelector('[data-whys]')
  const glow = root.querySelector('[data-engine-glow]')

  gsap.set(switches, { autoAlpha: 0, y: 18 })
  gsap.set(picks, { autoAlpha: 0, x: 40 })
  // Причина первой — часть ответа: приходит с пятёркой, а не раньше неё
  gsap.set(whys, { autoAlpha: 0, y: 12 })
  /*
   * СВЕТ ОТВЕТА ЗАЖИГАЕТСЯ ВМЕСТЕ С ОТВЕТОМ.
   *
   * Пока справа пусто, греть там нечего: сцена начинается складом в
   * холодном, и тёплая половина приходит ровно с пятёркой. Это и есть
   * кульминация такта — до неё сцена собирается, на ней включается.
   *
   * Слой декоративный, поэтому прятать его можно: при «уменьшить
   * движение» build не вызывается вовсе, и свет остаётся на значении из
   * стилей, то есть в полную силу.
   */
  gsap.set(glow, { opacity: 0.3 })

  tl.to(switches, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 0.05)
    .to(picks, { autoAlpha: 1, x: 0, duration: 0.4, ease: 'power3.out' }, 0.25)
    .to(whys, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' }, 0.4)
    .to(glow, { opacity: 1, duration: 0.55, ease: 'power2.out' }, 0.3)
    // Хвост таймлайна — это время, за которое прокрутка проходит такты
    // переключения. Двигать в нём нечего: состояние меняет счёт ниже.
    .to({}, { duration: 1.9 })

  /*
   * НЕЗАКРЕПЛЁННАЯ СЦЕНА ОТПУСКАЕТ СРАЗУ И СЧЁТА НЕ ЗАВОДИТ.
   *
   * Окно счёта ниже — окно закрепления: 'top top' → END. Без закрепления
   * секция уходит из кадра примерно через свою высоту, прогресс такого окна
   * к этому моменту около половины, и 0.82 наступало через полэкрана ПОСЛЕ
   * того, как сцена уехала. На телефоне сцена не закрепляется никогда, и
   * чипы там не отвечали на касание ни разу, пока были видны.
   *
   * Окно Stage для незакреплённой сцены ('top 80%' → 'bottom 60%') сюда не
   * годится тоже: такты щёлкали бы на каждом тике прокрутки и перебивали бы
   * выбор, только что сделанный касанием, — и пятёрка менялась бы прямо под
   * глазами у того, кто её читает. Без закрепления прокрутка просто листает
   * сцену, а пятёрку меняют только чипы.
   *
   * past ставится ДО создания триггера: create может сразу позвать onUpdate.
   * И ставится в обе стороны: пересборка на повороте телефона (см. Stage)
   * из незакреплённой в закреплённую иначе оставила бы чипы живыми до того,
   * как партитура сыграна.
   */
  set.past(!pinned)
  if (!pinned) return

  ScrollTrigger.create({
    trigger: root,
    start: 'top top',
    end: END,
    scrub: true,
    onUpdate: (self) => {
      let idx = 0
      for (let i = 0; i < BEAT_AT.length; i++) if (self.progress >= BEAT_AT[i]) idx = i
      set.key(BEATS[idx])
      /*
       * ОТПУСКАЕМ ДО КОНЦА ЗАКРЕПЛЕНИЯ, А НЕ ПО onLeave.
       *
       * Раньше здесь стоял onLeave — то есть руки отдавались ровно в тот
       * момент, когда сцена уже кончилась. С уходом кадра (см. Stage) это
       * стало прямым дефектом: последние проценты закрепления содержимое
       * гаснет, и переключатели становились бы кликабельными невидимыми.
       *
       * 0.82 — до начала ухода. Заодно состояние теперь считается из
       * прогресса, как и такты: движение назад отыгрывается так же, как
       * вперёд, а событий «сцена дошла до 82%» при прокрутке вверх не
       * бывает вовсе.
       */
      set.past(self.progress >= LIVE_AT)
    },
  })
}
