'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { Portal } from '@/components/Portal'
import { steamLoginFor } from '@/lib/destination'
import { focusAdrift } from '@/lib/focushandoff'
import { tr } from '@/lib/i18n'
import { overlaps, takeFocus, withFocusRing } from '@/lib/skiplink'
import { writerStore } from '@/lib/writer'

/**
 * Что записка говорит скринридеру. Живая область — не здесь, а в оболочке
 * (components/ReadOnlyNote): она стоит в документе с первого кадра, а этот
 * модуль приезжает чанком, когда записку пора показать. Строка едет с ним,
 * чтобы кириллица не лежала в первой загрузке каждой страницы.
 */
export const READONLY_SAY = 'Режим просмотра: оценки, запуски и свои пати сохранятся после входа через Steam.'

/**
 * То же по-английски. Отдельной строкой, а не объектом по языку вместо
 * READONLY_SAY: оболочка выбирает язык сама (useLocale), а русская строка
 * остаётся той же, что ждут оболочка и её тесты.
 */
export const READONLY_SAY_EN = 'View-only mode: ratings, launches and your own parties will be saved once you sign in with Steam.'

/**
 * ПОКАЗЫВАТЬ ЛИ — РЕШАЕТ ПРИЗНАК ЗАПИСИ, а не один флажок (lib/writer).
 *
 * Флажок может пережить свой документ: тело записки не доехало, и он ждёт
 * следующей попытки (lib/readonlynote). А следующий документ этой вкладки
 * бывает возвратом из «Войти через Steam» — sessionStorage переживает и уход
 * на steamcommunity.com. Человек уже пишет, а записка сказала бы ему «это
 * режим просмотра», и живая область это зачитала бы.
 *
 * Поэтому оболочка (components/ReadOnlyNote) забирает флажок по вердикту:
 * then(true) — сессия только читает, записку пора показать; then(false) —
 * сессия пишет, записка — уже неправда. Пока признак не известен, вердикт
 * ждёт ответа продления (SessionKeeper, на главной — карточка входа) или
 * отказа needsteam. Обычный путь не ждёт ничего: карточка входа ставит
 * признак false рядом с флажком, раньше, чем тело успевает доехать.
 * Возвращает отписку.
 */
export function noteVerdict(then: (show: boolean) => void): () => void {
  const known = writerStore.get()
  if (known !== null) {
    then(!known)
    return () => {}
  }
  const off = writerStore.subscribe(() => {
    const writer = writerStore.get()
    if (writer === null) return
    off()
    then(!writer)
  })
  return off
}

/**
 * Сессия начала писать, пока записка на экране, — hide. Записка стоит в
 * лэйауте и переживает клиентские переходы, а права меняет вход через Steam в
 * соседней вкладке: кука у вкладок общая, и первый же ответ продления здесь
 * (карточка главной продлевает на каждом заходе) приносит writer: true —
 * «это режим просмотра» стало бы неправдой. Возвращает отписку.
 */
export function hideOnWriter(hide: () => void): () => void {
  return writerStore.subscribe(() => {
    if (writerStore.get() === true) hide()
  })
}

/**
 * Записка «это режим просмотра» — один раз после входа по ссылке
 * (lib/readonlynote.ts). Тело: видимая панель и её поведение. Когда её
 * показывать и что сказать скринридеру, решает оболочка в корневом лэйауте
 * (components/ReadOnlyNote) — там же, почему тело едет отдельным чанком.
 * Смонтирована — значит показана; onHide убирает её.
 *
 * Стоит в корневом лэйауте: вход ведёт куда угодно — в квиз, в выдачу, в
 * комнату. Без анимаций motion: корню провайдер не положен
 * (components/motion/MotionLazy.tsx), появление — CSS-классом.
 *
 * Не модальная и без фокуса: сообщает, а не требует. Сказанное ею
 * скринридер слышит из живой области оболочки, а не отсюда.
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
 * пропадает: текст уже прочитан живой областью оболочки.
 *
 * Уходит она только от фокуса с клавиатуры (:focus-visible): 2.4.11 — про
 * него, а фокус от клика или тапа прятал бы одноразовую записку у того, кто
 * её не закрывал. На /quiz ответ кликом переводит фокус на заголовок
 * следующего вопроса (stepHeadRef), и он стоит ровно под запиской; на
 * Android тап по широкой плитке, задевшей её краем, тоже даёт focusin.
 */
export function ReadOnlyNoteBox({ onHide }: { onHide: () => void }) {
  const pathname = usePathname()
  const locale = useLocale()
  const box = useRef<HTMLElement>(null)

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
    onHide()
  }, [onHide])

  // Вошёл через Steam в соседней вкладке — записка уходит, фокус из неё — в <main>
  useEffect(() => hideOnWriter(dismiss), [dismiss])

  useEffect(() => {
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
     *
     * Только фокус с клавиатуры — :focus-visible, как у смузера
     * (SmoothScrollImpl, onFocusIn). Программный фокус наследует это от
     * прошлого: после Enter заголовок вопроса :focus-visible, после клика —
     * нет. И с кольцом, а не голой рамкой: кнопка вплотную под запиской
     * прячет под неё верх своего кольца (withFocusRing).
     */
    let raf = 0
    const onFocus = (e: FocusEvent) => {
      const note = box.current
      if (!note || (e.target instanceof Node && note.contains(e.target))) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const at = document.activeElement
        if (!(at instanceof Element) || at === document.body || note.contains(at)) return
        if (!at.matches(':focus-visible')) return
        if (overlaps(withFocusRing(at.getBoundingClientRect()), note.getBoundingClientRect())) onHide()
      })
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      cancelAnimationFrame(raf)
    }
  }, [dismiss, onHide])

  // Портал: на главной содержимое едет трансформом смузера, и fixed внутри
  // него поехал бы вместе с прокруткой (lib/smoothfixed.test.ts)
  return (
    <Portal>
      <div className="fixed inset-x-0 top-20 z-40 flex justify-center px-safe pointer-events-none">
        <section
          ref={box}
          aria-label={tr(locale, { ru: 'Режим просмотра', en: 'View-only mode' })}
          className="panel-lift anim-rise p-4 w-full max-w-xl flex flex-col gap-3 pointer-events-auto"
        >
          <p className="text-sm leading-relaxed text-ink">
            {tr(locale, {
              ru: 'Ты вошёл по ссылке на профиль — это режим просмотра. Подбор работает, а оценки, запуски и свои пати сохранятся после входа через Steam.',
              en: 'You signed in with a profile link, so this is view-only mode. Picks work, but ratings, launches and your own parties are saved only after you sign in with Steam.',
            })}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {/* Путь с языком (usePathname на /en отдаёт /en/…): steamLoginFor
                сам везёт lang=en, и возврат из Steam — на английскую страницу */}
            <a href={steamLoginFor(pathname)} className="tap text-sm text-ember-text hover:underline">
              {tr(locale, { ru: 'Войти через Steam', en: 'Sign in with Steam' })}
            </a>
            <button
              type="button"
              onClick={dismiss}
              className="tap text-sm text-dim transition-colors hover:text-ink"
            >
              {tr(locale, { ru: 'Понятно', en: 'Got it' })}
            </button>
          </div>
        </section>
      </div>
    </Portal>
  )
}
