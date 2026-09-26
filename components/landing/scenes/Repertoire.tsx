'use client'

import gsap from 'gsap'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { GameArt } from '@/components/GameArt'
import { Icon, type IconName } from '@/components/Icon'
import { Stage } from '@/components/landing/Stage'

/**
 * СЦЕНА 5: ЧТО ЗДЕСЬ ЕЩЁ ЕСТЬ.
 *
 * Полкой разделов, как «категории» у стриминга: шесть карточек, у каждой свой
 * веер постеров. Это единственная сцена, которая одновременно и рассказ, и
 * навигация — ссылки живые, и человек может уйти в раздел прямо отсюда.
 *
 * Раньше здесь было расписание: шесть строк текста между волосками. Раздел
 * читался названием, но не показывал, ЧТО в нём лежит, — а у этого сайта всё
 * про игры, и молчать о них в оглавлении было странно.
 *
 * ПОСТЕРЫ — ИЗ ЗАШИТОГО СПИСКА ЛЕНТЫ (lib/ribbon.ts, FALLBACK_RIBBON), и это
 * намеренно: у гостя без каталога лента уже скачала ровно эти файлы, и полка
 * достаётся из кэша даром. Страница статическая, поэтому номера игр зашиты,
 * а не приходят из базы. Подбор по смыслу раздела: кооп для пати, два
 * соревновательных хита для совместимости, одна игра для «игры дня».
 *
 * Строки короткие: в кино-сцене абзац на карточку не читается — его
 * проматывают.
 */

type Section = {
  href: string
  name: string
  line: string
  icon: IconName
  art: ReadonlyArray<{ appid: number; name: string }>
}

const REPERTOIRE: readonly Section[] = [
  {
    href: '/rooms',
    name: 'Пати',
    line: 'Комната, ссылка своим, свайпаете вместе.',
    icon: 'users',
    art: [
      { appid: 548430, name: 'Deep Rock Galactic' },
      { appid: 892970, name: 'Valheim' },
      { appid: 105600, name: 'Terraria' },
    ],
  },
  {
    href: '/compat',
    name: 'Совместимость',
    line: 'Сравним библиотеки и часы с кем угодно.',
    icon: 'heart',
    art: [
      { appid: 570, name: 'Dota 2' },
      { appid: 730, name: 'Counter-Strike 2' },
    ],
  },
  {
    href: '/daily',
    name: 'Игра дня',
    line: 'Одна игра на день. Завтра будет другая.',
    icon: 'calendar',
    art: [{ appid: 1145360, name: 'Hades' }],
  },
  {
    href: '/library',
    name: 'Библиотека',
    line: 'Заброшенное и нераспакованное — одной стеной.',
    icon: 'grid',
    art: [
      { appid: 413150, name: 'Stardew Valley' },
      { appid: 367520, name: 'Hollow Knight' },
      { appid: 504230, name: 'Celeste' },
    ],
  },
  {
    href: '/portrait',
    name: 'Портрет игрока',
    line: 'Куда ушло время — страницей, которой делятся.',
    icon: 'spark',
    art: [
      { appid: 632470, name: 'Disco Elysium' },
      { appid: 292030, name: 'The Witcher 3' },
    ],
  },
  {
    href: '/whatsnew',
    name: 'Что нового',
    line: 'Только крупные патчи по твоим играм.',
    icon: 'news',
    art: [
      { appid: 1091500, name: 'Cyberpunk 2077' },
      { appid: 1086940, name: "Baldur's Gate 3" },
    ],
  },
]

export function Repertoire() {
  return (
    <Stage
      id="more"
      label="Что здесь ещё есть"
      end="+=120%"
      enter={(intro, root) => {
        /*
         * ПОЛКА ВЫКЛАДЫВАЕТСЯ, А НЕ ВЫЕЗЖАЕТ ЦЕЛИКОМ.
         *
         * Карточки поднимаются по одной, и веер каждой приходит на такт позже
         * своей карточки — сначала витрина, потом то, что в ней лежит. Веер
         * едет ОБЁРТКОЙ (.rep-art): у самих постеров свой transform, им
         * управляет наведение, и твин на том же свойстве его бы перебил.
         */
        const cards = root.querySelectorAll('[data-rep-row]')
        const fans = root.querySelectorAll('.rep-art')
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
      <div className="rep-glow" aria-hidden />

      <p className="slate">
        <b>05</b>
        <span>Что здесь ещё есть</span>
      </p>

      <ul className="rep">
        {REPERTOIRE.map((item) => (
          <li key={item.href} data-rep-row>
            <Link href={item.href} className="rep-card">
              <span aria-hidden className="rep-art" style={{ '--n': item.art.length } as CSSProperties}>
                {item.art.map((g, i) => (
                  <span key={g.appid} className="rep-poster" style={{ '--i': i } as CSSProperties}>
                    <GameArt appid={g.appid} name={g.name} variant="poster" sizes="160px" />
                  </span>
                ))}
              </span>
              <span aria-hidden className="rep-icon">
                <Icon name={item.icon} size={18} />
              </span>
              <span className="rep-name">{item.name}</span>
              <span className="rep-line">{item.line}</span>
              <span aria-hidden className="rep-arrow">
                <Icon name="arrow" size={18} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Stage>
  )
}
