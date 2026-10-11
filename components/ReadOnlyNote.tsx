'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Portal } from '@/components/Portal'
import { steamLoginFor } from '@/lib/destination'
import { focusAdrift } from '@/lib/focushandoff'
import { READONLY_NOTE_EVENT, takeReadOnlyNote } from '@/lib/readonlynote'
import { overlaps, takeFocus } from '@/lib/skiplink'

/**
 * Записка «это режим просмотра» — один раз после входа по ссылке
 * (lib/readonlynote.ts).
 *
 * Стоит в корневом лэйауте: вход ведёт куда угодно — в квиз, в выдачу, в
 * комнату. Без анимаций motion: корню провайдер не положен
 * (components/motion/MotionLazy.tsx), появление — CSS-классом.
 *
 * Не модальная и без фокуса: сообщает, а не требует. Для скринридера — своя
 * живая область, которая стоит в документе с первого кадра, а текст в неё
 * приходит потом: область, вставленная вместе с текстом, зачитывается не
 * каждой парой браузера и скринридера (тот же приём, что у StopAsk и
 * OutcomeAsk).
 *
 * Сверху, под шапкой, а не снизу: нижний угол занят плашками /play —
 * прогревом (WarmStrip), «как тебе?» и вопросом после запуска, — и записка
 * легла бы на них. Сверху так же стоит FeedWatch на /whatsnew.
 *
 * НО ВЕРХ — ЭТО И ЛИНИЯ ФОКУСА (WCAG 2.4.11). top: 80px — ровно
 * scroll-padding-top у html, куда браузер ставит элемент, прокрученный к
 * фокусу. Shift+Tab вверх по кнопкам /play прятал каждый новый фокус целиком
 * под запиской, а «Понятно» в портале в конце body — последняя остановка Tab,
 * после всего подвала. Поэтому записка уходит сама, как только фокус встал
 * под неё, закрывается Escape, не двигая фокус, а «Понятно» отдаёт фокус
 * <main>: иначе размонтированная кнопка роняла его в body. Сказанное ею не
 * пропадает: текст уже прочитан живой областью выше.
 */
export function ReadOnlyNote() {
  const [shown, setShown] = useState(false)
  const pathname = usePathname()
  const box = useRef<HTMLElement>(null)

  useEffect(() => {
    const check = () => {
      if (takeReadOnlyNote()) setShown(true)
    }
    check()
    window.addEventListener(READONLY_NOTE_EVENT, check)
    return () => window.removeEventListener(READONLY_NOTE_EVENT, check)
  }, [])

  /**
   * Убрать записку руками. Фокус переезжает, только если он был в ней или
   * уже нигде (focusAdrift): кто закрыл её Escape, стоя на кнопке страницы,
   * там и остаётся. Перенос — до размонтирования, чтобы фокус ни на кадр не
   * упал в body.
   */
  const dismiss = useCallback(() => {
    if (focusAdrift(document, box.current)) {
      const main = document.getElementById('main')
      if (main) takeFocus(main)
    }
    setShown(false)
  }, [])

  useEffect(() => {
    if (!shown) return
    // Под открытым лайтбоксом записка инертна, и Escape принадлежит ему
    const live = () => !box.current?.closest('[inert]')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && live()) dismiss()
    }
    /*
     * Фокус встал под записку — она уходит, а фокус остаётся, где его
     * поставили. Замер — кадром позже: focusin приходит раньше, чем браузер
     * докрутит элемент к линии scroll-padding, и прямоугольник в самом
     * событии ещё старый.
     */
    let raf = 0
    const onFocus = (e: FocusEvent) => {
      const note = box.current
      if (!note || (e.target instanceof Node && note.contains(e.target))) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const at = document.activeElement
        if (!(at instanceof Element) || at === document.body || note.contains(at)) return
        if (overlaps(at.getBoundingClientRect(), note.getBoundingClientRect())) setShown(false)
      })
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      cancelAnimationFrame(raf)
    }
  }, [shown, dismiss])

  // Портал: на главной содержимое едет трансформом смузера, и fixed внутри
  // него поехал бы вместе с прокруткой (lib/smoothfixed.test.ts)
  return (
    <Portal>
      <p role="status" className="sr-only">
        {shown ? 'Режим просмотра: оценки, запуски и свои пати сохранятся после входа через Steam.' : ''}
      </p>
      {shown && (
        <div className="fixed inset-x-0 top-20 z-40 flex justify-center px-safe pointer-events-none">
          <section
            ref={box}
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
                onClick={dismiss}
                className="tap text-sm text-dim transition-colors hover:text-ink"
              >
                Понятно
              </button>
            </div>
          </section>
        </div>
      )}
    </Portal>
  )
}
