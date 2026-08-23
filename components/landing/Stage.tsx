'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useRef } from 'react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

/**
 * ЗАКРЕПЛЁННАЯ СЦЕНА.
 *
 * Секция прилипает к экрану, и прокрутка проигрывает внутри неё таймлайн.
 * Одна обёртка на все пять сцен: длина закрепления и партитура у каждой свои,
 * а механика одна, и второй её экземпляр разъехался бы с первым при первой же
 * правке.
 *
 * ГЛАВНОЕ ПРАВИЛО, КОТОРОЕ ЭТА ОБЁРТКА ОБЕСПЕЧИВАЕТ:
 * начальные состояния прячутся ТОЛЬКО внутри `build`, никогда в CSS.
 *
 * Отсюда следует всё остальное. При «уменьшить движение» `build` не
 * вызывается вовсе — и сцена остаётся обычной секцией, где всё видно сразу.
 * Если бы `opacity: 0` стоял в стилях, тот же человек получил бы пустой экран,
 * и заметили бы это только у него. Правило проекта звучит так: анимация может
 * добавить появление, но не может спрятать контент (см. .anim-page-in в
 * globals.css и сторож lib/firstpaint.test.ts).
 *
 * id секции — `scene-<key>`: по нему лента находит границы закрепления и
 * строит по ним шкалу света (см. lib/ribbonlight.ts). Второго источника этих
 * чисел в проекте нет намеренно.
 */

export type SceneBuild = (tl: gsap.core.Timeline, root: HTMLElement) => void

export function Stage({
  id,
  label,
  end = '+=110%',
  className = '',
  children,
  enter,
  build,
}: {
  /** Ключ сцены: `pain`, `engine`, `compat`, `more`, `money`. */
  id: string
  /** Человеческое имя — им подписывается сцена для отладки и для ленты. */
  label: string
  /** Длина закрепления в долях экрана. */
  end?: string
  className?: string
  children: React.ReactNode
  /** Въезд: что показать, пока сцена ещё поднимается в кадр. */
  enter?: SceneBuild
  build?: SceneBuild
}) {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const root = ref.current
      if (!root || (!build && !enter)) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      /*
       * ДВЕ ФАЗЫ, А НЕ ОДНА. Это лечит системную дыру.
       *
       * Между концом закрепления предыдущей сцены и началом своего у каждой
       * сцены есть ЦЕЛЫЙ ЭКРАН прокрутки: она уже поднялась в кадр, но
       * закрепление ещё не началось, а всё её содержимое спрятано внутри
       * build. Замерено на живой странице — сцена «Как это работает»
       * показывала в этот момент только номер и два надзаголовка, то есть
       * выглядела сломанной.
       *
       * Теперь фаза въезда (start: top bottom → top top) ставит КАДР: то, что
       * делает сцену узнаваемой, пока она поднимается. Закрепление играет
       * сцену. Правило прежнее: прятать можно только внутри этих двух
       * колбэков, и при «уменьшить движение» не вызывается ни один.
       */
      if (enter) {
        const intro = gsap.timeline({
          scrollTrigger: { trigger: root, start: 'top bottom', end: 'top top', scrub: 0.6 },
        })
        enter(intro, root)
      }

      if (!build) return

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end,
          pin: true,
          scrub: 0.6,
          // Без anticipatePin закрепление на быстрой прокрутке успевает
          // мигнуть незакреплённым кадром.
          anticipatePin: 1,
        },
      })
      build(tl, root)
    },
    { scope: ref },
  )

  return (
    <section
      ref={ref}
      id={`scene-${id}`}
      data-scene={label}
      className={`scene ${className}`.trim()}
    >
      <div className="scene-inner">{children}</div>
    </section>
  )
}
