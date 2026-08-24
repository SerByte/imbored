'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useRef } from 'react'
import { Portal } from '@/components/Portal'
import type { RibbonGame } from '@/lib/ribbon'
import {
  RIBBON_REST,
  RIBBON_SCORE,
  resolveStops,
  sampleRibbon,
  type SceneRange,
} from '@/lib/ribbonlight'

gsap.registerPlugin(ScrollTrigger, useGSAP)

/**
 * ЛЕНТА ИГР ЗА ВСЕЙ ГЛАВНОЙ.
 *
 * Через портал — и это не удобство, а необходимость: слой обязан быть `fixed`,
 * а под плавной прокруткой `fixed` внутри содержимого цепляется к содержимому
 * (см. components/Portal.tsx и сторож lib/smoothfixed.test.ts). Заодно портал
 * решает вторую задачу: лента живёт ровно столько, сколько смонтирована
 * главная, и при уходе на другой маршрут исчезает сама.
 *
 * КОЛОНКИ СЧИТАЮТСЯ ОТ ШИРИНЫ ЭКРАНА. Это замер, а не вкус: при
 * `grid-template-columns: repeat(3, 1fr)` — так была устроена прежняя кино-
 * подложка — на мониторе в 2560 px одна обложка выходит больше тысячи
 * пикселей, и лента читается как две мутные картинки под скримом. Целевая
 * ширина колонки ~300 px, число колонок 4…12.
 *
 * Блок в колонке повторён дважды: тогда сдвиг ровно на половину высоты
 * замыкается без шва, и петля не требует вычислений на кадр.
 *
 * ЧТО ЭТОТ СЛОЙ НЕ МОЖЕТ СЕБЕ ПОЗВОЛИТЬ — ЗАМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО.
 *
 * Лента — слой во весь экран, который двигается НЕПРЕРЫВНО: колонки дрейфуют
 * всегда, даже когда страница стоит. Поэтому всё, что заставляет композитор
 * пересобирать этот слой покадрово, стоит здесь вдвое дороже, чем где-либо
 * ещё. Замер: медиана кадра на проезде от героя до второй сцены, 1280×800.
 *
 *   покой (как есть)                                    16.7 мс  — 60 fps
 *   + mix-blend-mode: screen на слое света              33.3 мс  — 30 fps
 *   + mix-blend-mode: overlay (зерно .grain)            33.3 мс  — 30 fps
 *   + box-shadow с радиусом размытия на обложках        33.3 мс  — 30 fps
 *   + box-shadow нулевого радиуса (волосок по кромке)   16.8 мс  — 60 fps
 *
 * Каждая из первых трёх строк роняет кадр САМА ПО СЕБЕ, не в сумме. Отсюда
 * правила слоя: никаких режимов наложения, никакого зерна, никаких теней с
 * радиусом. Свет рисуется обычными градиентами, кромка — тенью в ноль
 * пикселей. Размытие глубины живёт на колонке (их 4…12), а не на обложке
 * (их 80 при 1280×800 и под полторы сотни на широком мониторе).
 */

/** Целевая ширина колонки и зазор — из них считается число колонок. */
const COL_TARGET = 300
const GAP = 14

/** Сцены, чьи границы задают шкалу света. Совпадают с id секций на главной. */
const SCENE_KEYS = ['pain', 'engine', 'compat', 'more', 'money'] as const

export function GameRibbon({ games }: { games: RibbonGame[] }) {
  if (games.length === 0) return null
  return (
    <Portal>
      <RibbonLayer games={games} />
    </Portal>
  )
}

/**
 * Слой отдельным компонентом, а не телом портала.
 *
 * Портал отдаёт null до монтирования (document.body на сервере нет), и его
 * содержимое появляется на СЛЕДУЮЩЕМ рендере. Эффект, живущий снаружи,
 * отрабатывает раньше — ссылка на узел ещё пуста, лента строится в никуда и
 * больше не пересобирается. Проверено: колонок ноль, обложек ноль, коробка
 * на месте.
 *
 * Отдельный компонент внутри портала монтируется вместе с разметкой, и его
 * эффект видит узел.
 */
function RibbonLayer({ games }: { games: RibbonGame[] }) {
  const gridRef = useRef<HTMLDivElement>(null)
  const gradeRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const grid = gridRef.current
      const grade = gradeRef.current
      if (!grid) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // Покой: лента остаётся кадром, но неподвижным и тихим. Выключать её
        // целиком нельзя — тогда «уменьшить движение» отняло бы у человека не
        // движение, а половину замысла страницы.
        // 0.28, а не прежние 0.22: у колонок появилась своя прозрачность по
        // глубине (до 0.58 в центре), и старое число оставило бы дальний план
        // на 0.13 — то есть отняло бы у этого режима ровно ту половину
        // замысла, которую строка выше обещает сохранить.
        grid.style.opacity = '0.28'
        // Свет приглушается вместе с лентой: сюда paint() не доходит, а
        // тёплое ядро в полную силу над лентой в 22% читалось бы цветным
        // пятном без источника.
        if (grade) grade.style.opacity = '0.5'
        return
      }

      let drifts: gsap.core.Tween[] = []
      let lastOpacity = ''
      let lastSat = ''
      let lastGrade = ''

      /**
       * ГЛУБИНА КОЛОНКИ: 0 — ближний план, 1 — дальний.
       *
       * Дальний план в ЦЕНТРЕ, ближний по КРАЯМ, и это следствие скрима, а не
       * вкус. Скрим глухой посередине (0.9) и почти прозрачный по краям
       * (0.34): резкие яркие обложки в центре он всё равно раздавит, а мягкие
       * и тихие по краям покажет мутью. Поставив планы наоборот, мы отдаём
       * краям кадра то, что там и так видно, а центру — покой, на котором
       * стоит текст.
       */
      const depth = (c: number, cols: number): number => {
        const mid = (cols - 1) / 2
        return mid > 0 ? 1 - Math.abs(c - mid) / mid : 1
      }

      const build = () => {
        grid.textContent = ''
        const gw = grid.clientWidth || window.innerWidth
        const gh = grid.clientHeight || window.innerHeight
        const cols = Math.max(4, Math.min(12, Math.round(gw / COL_TARGET)))
        const cw = Math.floor((gw - GAP * (cols - 1)) / cols)
        const tile = (cw * 215) / 460 + GAP
        const per = Math.ceil(gh / tile) + 1

        for (let c = 0; c < cols; c++) {
          const col = document.createElement('div')
          col.className = 'ribbon-col'
          col.style.setProperty('--ribbon-col', `${cw}px`)
          /*
           * Размытие — на колонке, а не на каждой обложке: обложек восемь
           * десятков при 1280×800 и под полторы сотни на широком мониторе, а
           * колонок от четырёх до двенадцати.
           *
           * Ширину колонки глубина НЕ трогает: колонки уложены в ряд с
           * фиксированными ширинами, и любой масштаб развалил бы ряд щелями.
           *
           * Четвёртым каналом задумывалась сила тени под обложкой — и не
           * прошла по кадру. Замер в докблоке ленты выше: тень с радиусом
           * размытия на обложках роняет прокрутку с 60 fps до 30.
           * Осталась тень нулевого радиуса — волосок по кромке, он бесплатен.
           */
          const d = depth(c, cols)
          col.style.setProperty('--ribbon-blur', `${(0.6 + d * 2.4).toFixed(2)}px`)
          col.style.setProperty('--ribbon-fade', (1 - d * 0.42).toFixed(3))
          const block: RibbonGame[] = []
          for (let k = 0; k < per; k++) {
            block.push(games[(c * 5 + k * 3) % games.length])
          }
          // Дважды подряд — ради бесшовной петли, см. докблок.
          for (let pass = 0; pass < 2; pass++) {
            for (const g of block) {
              const img = document.createElement('img')
              img.src = g.src
              img.alt = ''
              img.loading = 'lazy'
              img.decoding = 'async'
              // Фон не имеет права опережать содержание ни при каких условиях.
              img.fetchPriority = 'low'
              col.appendChild(img)
            }
          }
          grid.appendChild(col)
        }
      }

      const drift = () => {
        for (const t of drifts) t.kill()
        drifts = []
        const cols = grid.querySelectorAll<HTMLElement>('.ribbon-col')
        cols.forEach((col, i) => {
          const half = col.scrollHeight / 2
          if (!half) return
          const down = i % 2 === 1
          gsap.set(col, { y: down ? -half : 0 })
          drifts.push(
            gsap.to(col, {
              y: down ? 0 : -half,
              /*
               * ЧЕТВЁРТЫЙ КАНАЛ ГЛУБИНЫ — СКОРОСТЬ. Была `34 + (i % 4) * 8`,
               * то есть разнобой ради разнобоя: соседние колонки получали
               * случайные скорости, никак не связанные с тем, насколько они
               * далеко. Теперь ближний план идёт быстрее дальнего ровно как в
               * настоящем проезде камеры — 30 с по краям, 66 в центре, — и
               * разница скоростей начинает читаться расстоянием, а не
               * дёрганьем.
               */
              duration: 30 + depth(i, cols.length) * 36,
              ease: 'none',
              repeat: -1,
            }),
          )
        })
      }

      /**
       * Границы сцен. Читаются у самих триггеров, а не измеряются заново:
       * сцена уже посчитала свою длину, и второй источник тех же чисел
       * разъехался бы с первым при любой правке.
       *
       * ОТБОР ПО ШИРИНЕ ДИАПАЗОНА, А НЕ ПО ЗАКРЕПЛЕНИЮ. Раньше здесь стояло
       * `if (!trigger.pin) continue` — способ выбрать главный триггер сцены,
       * когда их на одном элементе два (у сцены подбора есть второй, для
       * счёта тактов). Работал он ровно до тех пор, пока закрепление было у
       * всех сцен всегда.
       *
       * Теперь сцена, которая не помещается в экран, НЕ ЗАКРЕПЛЯЕТСЯ (см.
       * докблок в Stage.tsx) — то есть на телефоне закреплений нет вовсе. По
       * старому правилу шкала осталась бы пустой, все опорные точки выпали бы
       * и лента простояла бы всю страницу в покое: партитуру света отняло бы у
       * половины аудитории заодно с закреплением.
       *
       * Ширина диапазона выбирает тот же триггер, что и прежнее правило, но не
       * зависит от способа его работы.
       */
      const ranges = (): Record<string, SceneRange> => {
        const out: Record<string, SceneRange> = {}
        for (const trigger of ScrollTrigger.getAll()) {
          const el = trigger.trigger as HTMLElement | undefined
          const key = el?.id?.replace(/^scene-/, '')
          if (!key || !(SCENE_KEYS as readonly string[]).includes(key)) continue
          const prev = out[key]
          if (prev && prev.end - prev.start >= trigger.end - trigger.start) continue
          out[key] = { start: trigger.start, end: trigger.end }
        }
        return out
      }

      const paint = () => {
        const y = window.scrollY
        const state = sampleRibbon(y, resolveStops(RIBBON_SCORE, ranges()))
        for (const t of drifts) t.timeScale(state.speed)
        /*
         * Пишем в стиль только когда число реально изменилось.
         * `filter: saturate()` на трёх сотнях обложек — это полная
         * перерисовка слоя; делать её каждый кадр значит подарить телефону
         * сорок лишних перерисовок в секунду ради значения, которое не
         * поменялось.
         */
        const o = state.opacity.toFixed(3)
        const s = state.sat.toFixed(3)
        if (o !== lastOpacity) {
          grid.style.opacity = o
          lastOpacity = o
        }
        if (s !== lastSat) {
          grid.style.filter = `saturate(${s})`
          lastSat = s
        }
        /*
         * СВЕТ УМИРАЕТ ВМЕСТЕ С ЦВЕТОМ.
         *
         * Отдельного канала в партитуре под это не заведено намеренно: цвет и
         * свет — одно и то же событие кадра. В сцене боли лента седеет и
         * замирает, и если бы тёплый источник продолжал гореть, «ничего не
         * цепляет» было бы показано на освещённой сцене. Два числа вместо
         * одного разъехались бы на первой же правке партитуры.
         *
         * Делим на насыщенность покоя, чтобы у слоя была своя полная сила, а
         * не 0.92 от неё.
         */
        if (grade) {
          const g = (state.sat / RIBBON_REST.sat).toFixed(3)
          if (g !== lastGrade) {
            grade.style.opacity = g
            lastGrade = g
          }
        }
      }

      build()
      drift()
      paint()

      /*
       * ОТКРЫТИЕ КАДРА. Лента приходит крупнее, чем встанет, и садится на
       * место за первую секунду — так объектив наводится на резкость.
       *
       * gsap.from, а не CSS-класс: начальное состояние ставится только когда
       * твин уже пошёл. Сюда мы не доходим при «уменьшить движение» (выход
       * выше), и если движения нет вовсе, лента просто стоит на месте — то же
       * правило, что у героя и у сцен.
       *
       * ТОЛЬКО МАСШТАБ, БЕЗ РАЗМЫТИЯ, и это не скупость. filter у сетки уже
       * занят: paint() пишет туда saturate() на каждом изменении света. Два
       * источника одного свойства — ровно тот дефект, который уже стоил ленте
       * вспышки на стыке сцен, только здесь он мигал бы каждую секунду
       * загрузки. Масштаб живёт в transform, куда paint не пишет: он двигает
       * колонки, а не сетку.
       *
       * И НЕ НАЧИНАЕМ В СКРЫТОЙ ВКЛАДКЕ. gsap.from ставит начальное состояние
       * немедленно, а снимает его только когда твин пошёл; в фоне
       * requestAnimationFrame не идёт. Замерено здесь же: лента навсегда
       * оставалась на scale 1.24 вместо 1.16 — то есть увеличенной, пока
       * страницу не перезагрузят. Тот же закон, что у входа героя: движение
       * может добавить церемонию, но не может изменить состояние покоя.
       */
      if (document.visibilityState === 'visible') {
        gsap.from(grid, { scale: 1.24, duration: 1.2, ease: 'power3.out' })
      }

      gsap.ticker.add(paint)
      // И по событию прокрутки: тикер gsap спит, когда на странице нет активных
      // анимаций и когда вкладка в фоне, а положение ленты обязано быть верным
      // в первый же кадр после возвращения.
      window.addEventListener('scroll', paint, { passive: true })

      /*
       * Пересборка только на смене ШИРИНЫ. Высоту на телефоне меняет
       * прячущаяся адресная строка, и пересборка на каждый пиксель превратила
       * бы прокрутку в слайд-шоу.
       */
      let lastWidth = window.innerWidth
      let timer: ReturnType<typeof setTimeout> | null = null
      const onResize = () => {
        if (Math.abs(window.innerWidth - lastWidth) < 40) return
        lastWidth = window.innerWidth
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          build()
          drift()
          paint()
          ScrollTrigger.refresh()
        }, 180)
      }
      window.addEventListener('resize', onResize)

      return () => {
        gsap.ticker.remove(paint)
        window.removeEventListener('scroll', paint)
        window.removeEventListener('resize', onResize)
        if (timer) clearTimeout(timer)
        for (const t of drifts) t.kill()
      }
    },
    { dependencies: [games] },
  )

  return (
    <div aria-hidden className="ribbon">
      <div
        ref={gridRef}
        className="ribbon-grid"
        style={{ opacity: RIBBON_REST.opacity, filter: `saturate(${RIBBON_REST.sat})` }}
      />
      <div className="ribbon-scrim" />
      {/* Свет ПОСЛЕ скрима: до него он был бы им же и погашен. Прозрачность
          ведёт та же шкала, что яркость и цвет ленты, — см. paint(). */}
      <div ref={gradeRef} className="ribbon-grade" />
      <div className="ribbon-vignette" />
    </div>
  )
}
