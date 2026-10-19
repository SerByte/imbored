'use client'

import gsap from 'gsap'
import type { ReactNode } from 'react'
import { Stage } from '@/components/landing/Stage'
import { fmtNumber, type Locale } from '@/lib/i18n'

/**
 * Партитура сцены «Совместимость и пати» — клиентская половина Compat.tsx.
 *
 * Стопки, итог и таблицу рисует сервер (Compat.tsx) и отдаёт сюда детьми;
 * здесь только колбэки gsap, которые через границу сервера не передать. Всё,
 * что им нужно от демо-выдачи, уже лежит в разметке: куда добежать счётчику —
 * в data-count, куда доехать шкале — в --k. Из замыкания партитуре нужен
 * один язык: счётчик на бегу печатает разряды так же, как число в разметке.
 */
export function CompatStage({
  label,
  locale,
  children,
}: {
  label: string
  locale: Locale
  children: ReactNode
}) {
  return (
    <Stage
      id="compat"
      label={label}
      end="+=110%"
      enter={(intro, root) => {
        /*
         * ПОДЪЁЗД К СТОЛКНОВЕНИЮ.
         *
         * Кадр сцены ставится на подъёме: две библиотеки съезжаются к центру
         * ещё до закрепления, иначе целый экран прокрутки показывает пустоту.
         *
         * Половины приезжают ИЗ-ЗА КРАЯ и доворачиваются: наклон тоже едет,
         * от почти плоского к встречному. Съезд без доворота читался тем, чем
         * и был, — двумя блоками, которые подвинули; с доворотом это две
         * стопки, которые кладут навстречу друг другу.
         *
         * Шов тушится здесь же: гореть ему пока не над чем, библиотеки ещё не
         * встретились. Зажигается он в build, на кульминации.
         */
        const a = root.querySelector('[data-stack="a"]')
        const b = root.querySelector('[data-stack="b"]')
        const seam = root.querySelector('[data-compat-seam]')
        gsap.set(a, { xPercent: -46, autoAlpha: 0, rotate: -1 })
        gsap.set(b, { xPercent: 46, autoAlpha: 0, rotate: 1 })
        gsap.set(seam, { autoAlpha: 0, scaleY: 0.55 })
        intro
          .to(a, { xPercent: 0, autoAlpha: 1, rotate: -7, duration: 0.7, ease: 'power3.out' }, 0)
          .to(b, { xPercent: 0, autoAlpha: 1, rotate: 7, duration: 0.7, ease: 'power3.out' }, 0.04)
      }}
      build={(tl, root) => {
        const rows = root.querySelectorAll('[data-compat-row]')
        const counters = root.querySelectorAll<HTMLElement>('[data-count]')
        const fills = root.querySelectorAll('.compat-fill')
        const seam = root.querySelector('[data-compat-seam]')
        const tally = root.querySelectorAll('[data-tally]')

        gsap.set(rows, { autoAlpha: 0, y: 18 })
        gsap.set(fills, { scaleX: 0 })
        gsap.set(tally, { autoAlpha: 0, y: 14 })

        /**
         * Куда доехать шкале — берётся у неё самой.
         *
         * Тянуть их все в scaleX: 1 нельзя, и это уже было сделано: доля живёт
         * в --k, а твин в единицу приводил ВСЕ шкалы к полной длине. Кадр
         * выглядел исправным — восемь строк, у каждой обе половины залиты, —
         * и врал: Dota с 2400 против 50 показывала две одинаковые полоски.
         * Ровно тот вид, ради опровержения которого таблицу и переделывали.
         */
        const goal = (_i: number, el: Element) =>
          Number((el as HTMLElement).style.getPropertyValue('--k')) || 0

        /*
         * ПАРТИТУРА С ОДНОЙ КУЛЬМИНАЦИЕЙ, А НЕ «ВСЁ ВЫЕХАЛО СНИЗУ».
         *
         * Такт 0 — вспышка шва: библиотеки сошлись, и первым появляется то, что
         * у них общего. Всё остальное — следствие этой вспышки и приходит
         * ПОСЛЕ неё: сначала итог (два числа под швом), потом строки, и только
         * потом весы разъезжаются по сторонам.
         *
         * Весы едут дольше всех и с волной: 0.05 с между соседними строками
         * даёт видимый прокат сверху вниз, а не одновременный щелчок восьми
         * шкал.
         *
         * scaleX/scaleY и opacity — композитор, ничего не пересобирает.
         */
        // Счётчики добавляются ПЕРВЫМИ, хотя играют не первыми: порядок
        // добавления в таймлайн больше ни на что не влияет (см. tl.duration()
        // в Stage.tsx), но читать партитуру проще, когда самая длинная волна
        // стоит в конце цепочки и последней же заканчивается.
        counters.forEach((node) => {
          const target = Number(node.dataset.count ?? 0)
          const box = { v: 0 }
          // Обнуление живёт ЗДЕСЬ, а не в разметке: в build не заходят при
          // «уменьшить движение», и там число остаётся настоящим.
          node.textContent = '0'
          tl.to(
            box,
            {
              v: target,
              duration: 0.6,
              ease: 'power1.out',
              onUpdate: () => {
                // Разряды — на языке страницы, как и число в разметке: «4 404» и «4,404»
                node.textContent = fmtNumber(locale, Math.round(box.v))
              },
            },
            0.16,
          )
        })

        tl.to(seam, { autoAlpha: 1, scaleY: 1, duration: 0.35, ease: 'power2.out' }, 0)
          .to(tally, { autoAlpha: 1, y: 0, stagger: 0.07, duration: 0.3, ease: 'power2.out' }, 0.12)
          .to(rows, { autoAlpha: 1, y: 0, stagger: 0.045, duration: 0.28, ease: 'power2.out' }, 0.2)
          .to(fills, { scaleX: goal, stagger: 0.035, duration: 0.5, ease: 'power2.out' }, 0.34)
      }}
    >
      {children}
    </Stage>
  )
}
