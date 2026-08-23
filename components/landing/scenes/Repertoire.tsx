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
        // Строки выезжают, пока сцена поднимается: к моменту закрепления
        // расписание уже стоит, и закрепление просто даёт его прочитать.
        const rows = root.querySelectorAll('[data-rep-row]')
        gsap.set(rows, { opacity: 0, x: -40 })
        intro.to(rows, { opacity: 1, x: 0, stagger: 0.12, duration: 0.4, ease: 'power2.out' }, 0)
      }}
      build={(tl, root) => {
        // Стрелки приходят последними — на них взгляд и уходит к ссылке.
        const arrows = root.querySelectorAll('.rep-arrow')
        gsap.set(arrows, { opacity: 0, x: -8 })
        tl.to(arrows, { opacity: 1, x: 0, stagger: 0.08, duration: 0.25, ease: 'power2.out' }, 0).to(
          {},
          { duration: 0.5 },
        )
      }}
    >
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
