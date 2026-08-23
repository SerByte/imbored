'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Portal } from '@/components/Portal'
import { NowProvider } from './Now'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Живая обложка: цвет страницы достаётся тому, что читаешь.
 *
 * В приложении уже есть закон «вся насыщенность — от арта», и .library-tile
 * превращает его во взаимодействие: обложки обесцвечены, цвет возвращается той,
 * на которую смотрят. Здесь то же правило, но привязанное к скроллу, а не к
 * курсору — и это чинит оговорку из докблока .library-tile: на телефоне не было
 * hover, а значит и способа вернуть цвет. Скролл есть везде.
 *
 * Наблюдатель ОДИН на всю ленту, а не по одному на строку: тридцать
 * наблюдателей и тридцать размытых копий арта уронили бы телефон. Активной
 * считается строка, пересекающая полосу по центру экрана — отсюда узкие
 * rootMargin вместо подсчёта видимой площади.
 *
 * Обложка обязана лежать ВНУТРИ Stage, а не перед ним: слои здесь держатся на
 * порядке разметки (правило проекта, z-index не используем), и fixed-заливка,
 * объявленная после обложки, накрыла бы её собственным затемнением.
 */
export function Stage({
  children,
  initialWash,
  rowsKey,
  nowSec,
  publishedAts,
}: {
  children: React.ReactNode
  /** Арт обложки: заливка начинается с него, иначе первый экран пустой */
  initialWash?: string
  /**
   * Отпечаток набора строк. Наблюдатель собирается ОДИН раз на набор, а
   * router.refresh() приносит новые строки, не перемонтируя Stage — без этой
   * зависимости они не наблюдались бы никогда.
   */
  rowsKey?: string
  /**
   * Часы ленты. Живут здесь, а не отдельным островком, потому что Stage и так
   * единственный клиентский корень вокруг всей ленты — новой границы подписки
   * не появляется.
   */
  nowSec?: number
  publishedAts?: number[]
}) {
  const scope = useRef<HTMLDivElement>(null)
  const [wash, setWash] = useState<string | null>(initialWash ?? null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const root = scope.current
    if (!root) return

    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-wash]'))
    if (!rows.length) return

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement
          if (e.isIntersecting) {
            el.dataset.live = '1'
            const src = el.dataset.wash
            if (src) setWash(src)
          } else {
            delete el.dataset.live
          }
        }
      },
      // полоса высотой ~10% экрана по центру: в неё попадает ровно то,
      // что человек сейчас читает
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )

    for (const row of rows) io.observe(row)
    return () => {
      io.disconnect()
      // data-live ставится мимо React, значит и снимать его приходится руками:
      // без этого после пересборки наблюдателя две строки кадр держатся
      // «живыми» одновременно, пока не отработает первый колбэк.
      for (const row of rows) delete row.dataset.live
    }
  }, [rowsKey])

  return (
    <div ref={scope} className="relative">
      {/* Заливка кадра — в портал: под плавной прокруткой fixed внутри
          содержимого цепляется к содержимому, и фон уезжал бы вместе с
          лентой. См. components/Portal.tsx. */}
      <Portal>
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <AnimatePresence initial={false}>
          {wash ? (
            <motion.img
              key={wash}
              src={wash}
              alt=""
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.34 }}
              exit={{ opacity: 0 }}
              // 600 мс намеренно: быстрее это мигание, а не перетекание
              transition={{ duration: reduced ? 0 : 0.6, ease: EASE }}
              className="absolute inset-0 h-full w-full scale-125 object-cover blur-3xl"
            />
          ) : null}
        </AnimatePresence>
        {/* заливка не должна съедать читаемость текста поверх неё */}
        <div className="absolute inset-0 bg-bg/55" />
        <div className="grain" />
      </div>
      </Portal>

      <div className="relative">
        {nowSec != null && publishedAts ? (
          <NowProvider nowSec={nowSec} publishedAts={publishedAts}>
            {children}
          </NowProvider>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
