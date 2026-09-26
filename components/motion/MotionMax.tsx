'use client'

import { LazyMotion } from 'framer-motion'

const loadDomMax = () => import('./domMax').then((mod) => mod.default)

/**
 * Полный набор motion — для поддеревьев с layout, layoutId и drag.
 *
 * Весь сайт живёт на LazyMotion с domAnimation (components/MotionProvider):
 * m.* без layout и drag весит в разы меньше motion.*. Но без domMax проп
 * layout молча ничего не делает, а drag не тянется — поэтому каждый
 * компонент, которому они нужны, оборачивает себя сюда. Стережёт
 * lib/lazymotion.test.ts.
 *
 * Фичи регистрируются глобально, так что вложенный LazyMotion лишь догружает
 * layout и drag поверх уже загруженного.
 */
export function MotionMax({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadDomMax} strict>
      {children}
    </LazyMotion>
  )
}
