'use client'

import gsap from 'gsap'
import type { ReactNode } from 'react'
import { Stage } from '@/components/landing/Stage'

/**
 * Партитура сцены «О деньгах» — клиентская половина Money.tsx.
 *
 * Разметку и текст рисует сервер (Money.tsx) и отдаёт сюда детьми; здесь
 * только то, что через границу сервера не передать, — колбэки gsap. Они
 * находят позицию, строки и возврат по data-атрибутам, так что им всё равно,
 * кто нарисовал разметку, а оба языка текста не едут в клиентский чанк.
 */
export function MoneyStage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stage
      id="money"
      label={label}
      end="+=100%"
      /*
       * Единственная сцена без ухода кадра. Её последний блок — возврат к
       * форме; погасить призыв ровно в тот момент, когда человек дочитал,
       * значит отнять у страницы концовку.
       */
      exit={false}
      enter={(intro, root) => {
        // Кадр сцены: позиция продукта встаёт на подъёме, а не после него.
        const line = root.querySelector('[data-money-line]')
        gsap.set(line, { autoAlpha: 0, y: 30 })
        intro.to(line, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0)
      }}
      build={(tl, root) => {
        const items = root.querySelectorAll('[data-money-item]')
        const back = root.querySelector('[data-money-back]')

        gsap.set(items, { autoAlpha: 0, y: 16 })
        gsap.set(back, { autoAlpha: 0, y: 26 })

        tl.to(items, { autoAlpha: 1, y: 0, stagger: 0.1, duration: 0.3, ease: 'power2.out' }, 0.1)
          .to(back, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' }, 0.55)
          .to({}, { duration: 0.3 })
      }}
    >
      {children}
    </Stage>
  )
}
