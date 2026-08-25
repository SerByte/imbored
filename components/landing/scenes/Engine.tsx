'use client'

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useState, useSyncExternalStore } from 'react'
import { GameArt } from '@/components/GameArt'
import { Eyebrow } from '@/components/Labels'
import { Stage } from '@/components/landing/Stage'
import type { LandingDemo, MoodKey } from '@/lib/landing'
import { plural } from '@/lib/plural'

/**
 * СЦЕНА 3: КАК ЭТО РАБОТАЕТ. Главный аттракцион страницы.
 *
 * Такты по прокрутке: стена из демо-библиотеки собирается, появляются
 * переключатели, пятёрка загорается кольцом и вылетает карточками, дальше
 * прокрутка сама щёлкает «Напрячься» и «С друзьями». На последнем такте сцена
 * ОТПУСКАЕТ: переключатели становятся кликабельными, и продукт можно потрогать
 * до всякого входа.
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
 * ЧЕГО ЗДЕСЬ НЕТ. Причины у карточек: все её шаблоны обращаются на «ты» и
 * говорят про ТВОЮ библиотеку, а библиотека здесь чужая — это была бы прямая
 * неправда. Поля с причиной нет и в данных (см. докблок lib/landing.ts).
 */

/** Длина закрепления. Одно число на закрепление и на счёт состояния. */
const END = '+=240%'

/** Порядок тактов: прокрутка проходит по ним слева направо. */
const BEATS: readonly MoodKey[] = ['chill:solo', 'engaged:solo', 'engaged:friends']

/** Границы тактов в долях прогресса сцены. Замерено на прототипе. */
const BEAT_AT = [0, 0.45, 0.7]

/** С этой доли сцена отдаёт руки — до того, как начнётся уход кадра. */
const LIVE_AT = 0.82

const VIBES = [
  { value: 'chill', label: 'Расслабиться', hint: 'без стресса' },
  { value: 'engaged', label: 'Напрячься', hint: 'думать и потеть' },
] as const

const SOCIALS = [
  { value: 'solo', label: 'Один', hint: 'только я и игра' },
  { value: 'friends', label: 'С друзьями', hint: 'нужен кооп' },
] as const

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

export function Engine({ demo }: { demo: LandingDemo }) {
  const [key, setKey] = useState<MoodKey>('chill:solo')
  /** Прокрутка довела партитуру до конца — сцена отпустила сама. */
  const [past, setPast] = useState(false)
  /**
   * Клавиатурный фокус внутри переключателей — сцена отпускает досрочно.
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

  const pick = (next: MoodKey) => {
    if (!live) return
    setKey(next)
  }

  return (
    <Stage
      id="engine"
      label="Как это работает"
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
      build={(tl, root) => {
        const switches = root.querySelector('[data-switches]')
        const picks = root.querySelector('[data-picks]')
        const glow = root.querySelector('[data-engine-glow]')

        gsap.set(switches, { autoAlpha: 0, y: 18 })
        gsap.set(picks, { autoAlpha: 0, x: 40 })
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
          .to(glow, { opacity: 1, duration: 0.55, ease: 'power2.out' }, 0.3)
          // Хвост таймлайна — это время, за которое прокрутка проходит такты
          // переключения. Двигать в нём нечего: состояние меняет счёт ниже.
          .to({}, { duration: 1.9 })

        ScrollTrigger.create({
          trigger: root,
          start: 'top top',
          end: END,
          scrub: true,
          onUpdate: (self) => {
            let idx = 0
            for (let i = 0; i < BEAT_AT.length; i++) if (self.progress >= BEAT_AT[i]) idx = i
            setKey(BEATS[idx])
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
            setPast(self.progress >= LIVE_AT)
          },
        })
      }}
    >
      {/* Свет сцены: холодное над складом, тёплое над ответом. Лежит под
          содержимым — см. .scene-inner и isolation в globals.css. */}
      <div className="engine-glow" aria-hidden data-engine-glow />

      <p className="slate">
        <b>03</b>
        <span>Как это работает</span>
      </p>

      <div className="engine-grid" data-live={live ? '1' : '0'}>
        <div className="min-w-0">
          <Eyebrow tone="faint" className="mb-3">
            Из чего выбираем
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
          <p className="mt-3 max-w-md text-xs leading-relaxed text-faint" data-wall-note>
            Чужая библиотека: {demo.libraryCount}{' '}
            {plural(demo.libraryCount, 'игра', 'игры', 'игр')} демо-игрока,{' '}
            {demo.libraryHours.toLocaleString('ru-RU')}{' '}
            {plural(demo.libraryHours, 'час', 'часа', 'часов')}. Твоя будет другой, механика та
            же.
          </p>
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
              <Eyebrow tone="faint">Вайб</Eyebrow>
              <div className="switch-row">
                {VIBES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="chip"
                    aria-pressed={vibe === o.value}
                    onClick={() => pick(`${o.value}:${social}` as MoodKey)}
                  >
                    <b>{o.label}</b>
                    <i>{o.hint}</i>
                  </button>
                ))}
              </div>
            </div>
            <div className="switch">
              <Eyebrow tone="faint">Компания</Eyebrow>
              <div className="switch-row">
                {SOCIALS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="chip"
                    aria-pressed={social === o.value}
                    onClick={() => pick(`${vibe}:${o.value}` as MoodKey)}
                  >
                    <b>{o.label}</b>
                    <i>{o.hint}</i>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Eyebrow className="mb-3 mt-5">Что предложит</Eyebrow>
          <div className="picks" data-picks>
            {ALL_KEYS.map((k) => (
              <div key={k} className={`pickset${k === key ? ' is-on' : ''}`}>
                {demo.picks[k].map((c, i) => (
                  <div key={c.appid} className="pick">
                    {/*
                      Номер, а не маркер списка: порядок в пятёрке
                      содержательный (своё идёт первым, покупок не больше
                      двух), и он обязан читаться числом. aria-hidden —
                      скринридеру порядок уже сообщает сам список.
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
                  </div>
                ))}
              </div>
            ))}
          </div>

          <p className="mt-3 max-w-md text-xs leading-relaxed text-faint">
            Своё идёт первым, покупок в пятёрке не больше двух. Третий вопрос — сколько у тебя
            времени — задаём в самом подборе.
          </p>
        </div>
      </div>
    </Stage>
  )
}
