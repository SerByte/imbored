'use client'

import { LazyMotion } from 'framer-motion'

const loadDomAnimation = () => import('./domAnimation').then((mod) => mod.default)

/**
 * Анимации и жесты для m.* — только там, где они есть.
 *
 * Компоненты сайта — m.*, а не motion.*: сам m почти ничего не весит, фичи
 * (animate, exit, whileHover/Tap/InView) приходят отсюда отдельным чанком
 * после гидрации. Без провайдера m.* рисуется статично — без ошибки, просто
 * мёртвый, — поэтому покрытие стережёт lib/lazymotion.test.ts.
 *
 * ПОЧЕМУ НЕ В КОРНЕВОМ ЛЭЙАУТЕ. Так было бы проще, и так было сначала. Но
 * Turbopack кладёт motion-dom из ленивого чанка в общий чанк того, кто его
 * импортирует: из корня это +35 КБ (+10 КБ br) в первой загрузке КАЖДОЙ
 * страницы, включая /privacy и /support, где не анимируется ничего (замерено
 * по HTML). Поэтому провайдер стоит в лэйаутах разделов с анимацией, а
 * одиночные компоненты оборачивают себя сами.
 *
 * ПОЧЕМУ framer-motion, А НЕ motion/react. motion/react в 13.x — обёртка:
 * `import * as fm from 'framer-motion'` и `const motion = fm.motion` на
 * верхнем уровне. Одно это обращение тащит motion.* со всеми фичами (drag,
 * layout, проекция) в любой бандл, где импортирован хоть AnimatePresence, —
 * и LazyMotion ничего не экономил. Прямой импорт из framer-motion
 * тришейкается: −86…−91 КБ (−26…−28 КБ br) на каждой странице с анимацией.
 *
 * Layout и drag — в MotionMax, он же служит провайдером для своего поддерева.
 */
export function MotionLazy({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadDomAnimation} strict>
      {children}
    </LazyMotion>
  )
}
