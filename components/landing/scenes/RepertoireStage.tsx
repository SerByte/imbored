'use client'

import gsap from 'gsap'
import type { ReactNode } from 'react'
import { Stage } from '@/components/landing/Stage'

/**
 * Партитура сцены «Что здесь ещё есть» — клиентская половина Repertoire.tsx.
 *
 * Полку разделов рисует сервер (Repertoire.tsx) и отдаёт сюда детьми, вместе
 * с таблицей разделов на обоих языках, — в клиентский чанк главной она не
 * едет. Здесь только колбэки gsap: функцию через границу сервера не передать.
 * Карточки, веера и стрелки они находят по data-rep-row, .fan и .rep-arrow.
 */
export function RepertoireStage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stage
      id="more"
      label={label}
      end="+=120%"
      enter={(intro, root) => {
        /*
         * ПОЛКА ВЫКЛАДЫВАЕТСЯ, А НЕ ВЫЕЗЖАЕТ ЦЕЛИКОМ.
         *
         * Карточки поднимаются по одной, и веер каждой приходит на такт позже
         * своей карточки — сначала витрина, потом то, что в ней лежит. Веер
         * едет ОБЁРТКОЙ (.fan): у самих постеров свой transform, им
         * управляет наведение, и твин на том же свойстве его бы перебил.
         */
        const cards = root.querySelectorAll('[data-rep-row]')
        const fans = root.querySelectorAll('.fan')
        gsap.set(cards, { autoAlpha: 0, y: 36 })
        gsap.set(fans, { yPercent: 28 })
        intro
          .to(cards, { autoAlpha: 1, y: 0, stagger: 0.08, duration: 0.5, ease: 'power3.out' }, 0)
          .to(fans, { yPercent: 0, stagger: 0.08, duration: 0.7, ease: 'power3.out' }, 0.12)
      }}
      build={(tl, root) => {
        // Стрелки приходят последними — на них взгляд и уходит к ссылке.
        const arrows = root.querySelectorAll('.rep-arrow')
        gsap.set(arrows, { autoAlpha: 0, x: -8 })
        tl.to(arrows, { autoAlpha: 1, x: 0, stagger: 0.06, duration: 0.25, ease: 'power2.out' }, 0).to(
          {},
          { duration: 0.5 },
        )
      }}
    >
      {children}
    </Stage>
  )
}
