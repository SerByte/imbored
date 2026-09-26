'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Portal } from '@/components/Portal'
import { steamLoginFor } from '@/lib/destination'
import { READONLY_NOTE_EVENT, takeReadOnlyNote } from '@/lib/readonlynote'

/**
 * Записка «это режим просмотра» — один раз после входа по ссылке
 * (lib/readonlynote.ts).
 *
 * Стоит в корневом лэйауте: вход ведёт куда угодно — в квиз, в выдачу, в
 * комнату. Без анимаций motion: корню провайдер не положен
 * (components/motion/MotionLazy.tsx), появление — CSS-классом.
 *
 * Не модальная и без фокуса: сообщает, а не требует. role="status", чтобы
 * скринридер прочёл её, не уводя человека с места.
 */
export function ReadOnlyNote() {
  const [shown, setShown] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const check = () => {
      if (takeReadOnlyNote()) setShown(true)
    }
    check()
    window.addEventListener(READONLY_NOTE_EVENT, check)
    return () => window.removeEventListener(READONLY_NOTE_EVENT, check)
  }, [])

  if (!shown) return null
  // Портал: на главной содержимое едет трансформом смузера, и fixed внутри
  // него поехал бы вместе с прокруткой (lib/smoothfixed.test.ts)
  return (
    <Portal>
      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-6 z-40 flex justify-center px-safe pointer-events-none">
        <section
          role="status"
          aria-label="Режим просмотра"
          className="panel-lift anim-rise p-4 w-full max-w-xl flex flex-col gap-3 pointer-events-auto"
        >
          <p className="text-sm leading-relaxed text-ink">
            Ты вошёл по ссылке на профиль — это режим просмотра. Подбор работает, а оценки,
            запуски и свои пати сохранятся после входа через Steam.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a href={steamLoginFor(pathname)} className="tap text-sm text-ember-text hover:underline">
              Войти через Steam
            </a>
            <button
              type="button"
              onClick={() => setShown(false)}
              className="tap text-sm text-dim transition-colors hover:text-ink"
            >
              Понятно
            </button>
          </div>
        </section>
      </div>
    </Portal>
  )
}
