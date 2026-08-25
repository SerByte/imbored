'use client'

import gsap from 'gsap'
import Link from 'next/link'
import { Stage } from '@/components/landing/Stage'

/**
 * СЦЕНА 5: ЧТО ЗДЕСЬ ЕЩЁ ЕСТЬ.
 *
 * Расписанием, а не плиткой «фич»: шесть строк выезжают по одной. Это
 * единственная сцена, которая одновременно и рассказ, и навигация — ссылки
 * живые, и человек может уйти в раздел прямо отсюда.
 *
 * Строки короче прежних. Длинные описания стояли здесь, пока страница была
 * документом; в кино-сцене абзац на строку не читается — его проматывают.
 */

const REPERTOIRE = [
  { href: '/rooms', name: 'Пати', line: 'Комната, ссылка своим, свайпаете вместе.' },
  { href: '/compat', name: 'Совместимость', line: 'Сравним библиотеки и часы с кем угодно.' },
  { href: '/daily', name: 'Игра дня', line: 'Одна игра на день. Завтра будет другая.' },
  { href: '/library', name: 'Библиотека', line: 'Заброшенное и нераспакованное — одной стеной.' },
  { href: '/portrait', name: 'Портрет игрока', line: 'Куда ушло время — страницей, которой делятся.' },
  { href: '/whatsnew', name: 'Что нового', line: 'Только крупные патчи по твоим играм.' },
]

export function Repertoire() {
  return (
    <Stage
      id="more"
      label="Что здесь ещё есть"
      end="+=120%"
      enter={(intro, root) => {
        /*
         * РАСПИСАНИЕ ПЕЧАТАЕТСЯ, А НЕ ВЫЕЗЖАЕТ ЦЕЛИКОМ.
         *
         * Строки по-прежнему приходят слева, пока сцена поднимается, — но
         * теперь у каждой сначала ПРОЧЕРЧИВАЕТСЯ ведущая линия, и только следом
         * подтягивается её текст. Раньше шесть одинаковых строк выезжали одним
         * шагом, и сцена читалась списком, который подвинули; линия, идущая
         * впереди текста, читается строкой, которую печатают.
         *
         * Линия и строка — разные элементы, у каждого один твин.
         */
        const rows = root.querySelectorAll('[data-rep-row]')
        const leads = root.querySelectorAll('.rep-lead')
        gsap.set(rows, { autoAlpha: 0, x: -40 })
        gsap.set(leads, { scaleX: 0 })
        intro
          .to(leads, { scaleX: 1, stagger: 0.12, duration: 0.45, ease: 'power2.out' }, 0)
          .to(rows, { autoAlpha: 1, x: 0, stagger: 0.12, duration: 0.4, ease: 'power2.out' }, 0.08)
      }}
      build={(tl, root) => {
        // Стрелки приходят последними — на них взгляд и уходит к ссылке.
        const arrows = root.querySelectorAll('.rep-arrow')
        gsap.set(arrows, { autoAlpha: 0, x: -8 })
        tl.to(arrows, { autoAlpha: 1, x: 0, stagger: 0.08, duration: 0.25, ease: 'power2.out' }, 0).to(
          {},
          { duration: 0.5 },
        )
      }}
    >
      <div className="rep-glow" aria-hidden />

      <p className="slate">
        <b>05</b>
        <span>Что здесь ещё есть</span>
      </p>

      <ul className="rep">
        {REPERTOIRE.map((item, i) => (
          <li key={item.href} data-rep-row>
            <Link href={item.href}>
              <span className="rep-no">{String(i + 1).padStart(2, '0')}</span>
              <span className="rep-name">{item.name}</span>
              <span className="rep-line">{item.line}</span>
              {/* Ведущая линия: она занимает пустоту между описанием и
                  стрелкой и связывает их — как пунктир в оглавлении. */}
              <span aria-hidden className="rep-lead" />
              <span aria-hidden className="rep-arrow">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Stage>
  )
}
