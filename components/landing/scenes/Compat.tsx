'use client'

import gsap from 'gsap'
import { GameArt } from '@/components/GameArt'
import { Eyebrow } from '@/components/Labels'
import { Stage } from '@/components/landing/Stage'
import type { LandingDemo } from '@/lib/landing'

/**
 * СЦЕНА 4: СОВМЕСТИМОСТЬ И ПАТИ.
 *
 * Две стопки библиотек съезжаются к центру, общее остаётся строками с двумя
 * числами, числа набегают. Смысл сцены — «по-настоящему, а не по анкете», и
 * доказывают его именно часы с обеих сторон, а не проценты.
 *
 * ПРОЦЕНТА СОВПАДЕНИЯ ЗДЕСЬ НЕТ, И ЭТО САМОЕ УБЕДИТЕЛЬНОЕ, ЧТО МОЖНО СКАЗАТЬ.
 * Он считается по редкости тегов во всём каталоге, а у гостя каталога нет:
 * посчитанный на демо, он был бы красивым и неправдивым. Отказ напечатан
 * словами — мелким кеглем, но напечатан.
 *
 * Счётчики крутятся твином по объекту, а не компонентом CountNumber: сцена
 * скрублена, и число обязано ехать назад ровно так же, как вперёд.
 */
export function Compat({ demo }: { demo: LandingDemo }) {
  const compat = demo.compat
  const shared = compat.rows.length
  // Стопки — настоящие обложки демо-библиотеки: две половины одного набора
  // читаются как две библиотеки, съезжающиеся к общему.
  const left = demo.wall.slice(0, 6)
  const right = demo.wall.slice(6, 12)

  return (
    <Stage
      id="compat"
      label="Совместимость и пати"
      end="+=110%"
      enter={(intro, root) => {
        // Кадр сцены ставится на подъёме: две библиотеки съезжаются к центру
        // ещё до закрепления, иначе целый экран прокрутки показывает пустоту.
        const a = root.querySelector('[data-stack="a"]')
        const b = root.querySelector('[data-stack="b"]')
        gsap.set(a, { x: -60, opacity: 0 })
        gsap.set(b, { x: 60, opacity: 0 })
        intro.to([a, b], { x: 0, opacity: 1, duration: 0.6, ease: 'power2.out' }, 0)
      }}
      build={(tl, root) => {
        const rows = root.querySelectorAll('[data-compat-row]')
        const counters = root.querySelectorAll<HTMLElement>('[data-count]')

        gsap.set(rows, { opacity: 0, y: 18 })

        tl.to(rows, { opacity: 1, y: 0, stagger: 0.06, duration: 0.3, ease: 'power2.out' }, 0.1)

        counters.forEach((node) => {
          const target = Number(node.dataset.count ?? 0)
          const box = { v: 0 }
          tl.to(
            box,
            {
              v: target,
              duration: 0.6,
              ease: 'power1.out',
              onUpdate: () => {
                node.textContent = Math.round(box.v).toLocaleString('ru-RU')
              },
            },
            0.25,
          )
        })
      }}
    >
      <p className="slate">
        <b>04</b>
        <span>Совместимость и пати</span>
      </p>

      <div className="compat-grid">
        <div className="min-w-0">
          <h2 className="font-display text-display-md" style={{ maxWidth: '21ch' }}>
            Сравним библиотеки по-настоящему, а не по анкете
          </h2>

          <div className="stacks">
            <div className="stack" data-stack="a">
              {left.map((g) => (
                <GameArt
                  key={`a-${g.appid}`}
                  appid={g.appid}
                  name={g.name}
                  headerImage={g.headerImage}
                  art={g.art}
                  sizes="120px"
                />
              ))}
            </div>
            <div className="stack" data-stack="b">
              {right.map((g) => (
                <GameArt
                  key={`b-${g.appid}`}
                  appid={g.appid}
                  name={g.name}
                  headerImage={g.headerImage}
                  art={g.art}
                  sizes="120px"
                />
              ))}
            </div>
          </div>

          <div className="tally">
            <div>
              <div className="tally-n" data-count={shared}>
                0
              </div>
              <div className="tally-l">общих игр</div>
            </div>
            <div>
              <div className="tally-n" data-count={compat.hours}>
                0
              </div>
              <div className="tally-l">часов на двоих</div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <Eyebrow tone="faint" className="mb-3">
            Что нашлось у обоих
          </Eyebrow>
          <ul className="compat-rows">
            {compat.rows.map((r) => (
              <li key={r.name} className="compat-row" data-compat-row>
                <span className="compat-name">{r.name}</span>
                <span className="compat-a">{r.a.toLocaleString('ru-RU')}</span>
                <span className="compat-slash">/</span>
                <span className="compat-b">{r.b.toLocaleString('ru-RU')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-md text-xs leading-relaxed text-faint">
            Процент совпадения вкусов мы тут не показываем: он считается по редкости тегов во всём
            каталоге, а не по этой паре, — на демо он был бы красивым и неправдой.
          </p>
        </div>
      </div>
    </Stage>
  )
}
