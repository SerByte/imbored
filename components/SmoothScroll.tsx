'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, useGSAP)

/**
 * ПЛАВНАЯ ПРОКРУТКА НА ВЕСЬ САЙТ.
 *
 * Клиентский и без разметки — как SessionKeeper и ChromeZone. Обёртка
 * `#smooth-wrapper > #smooth-content` живёт в app/layout.tsx и стоит там
 * ВСЕГДА: без смузера она безвредна, а условная разметка означала бы разные
 * деревья на сервере и клиенте.
 *
 * ЧЕГО ЭТО СТОИЛО. ScrollSmoother двигает содержимое трансформом, а трансформ
 * создаёт новый containing block. Любой `position: fixed` внутри контента
 * перестаёт цепляться к экрану — четыре слоя продукта пришлось увести в портал
 * (см. components/Portal.tsx), и правило закреплено сторожем
 * lib/smoothfixed.test.ts, чтобы пятый такой слой не завёлся молча.
 *
 * ПОКОЙ. При системном «уменьшить движение» смузер не создаётся вовсе. Это не
 * послабление, а то же правило, что и во всём проекте: движение может только
 * добавить, но не может стать условием работы. Без смузера страница
 * прокручивается нативно, и всё остаётся на местах.
 *
 * ЯКОРЯ. Нативный переход по `#id` двигает окно, но не трансформ контента —
 * получается прыжок не туда. Поэтому клики по внутренним якорям
 * перехватываются и уводятся в `smoother.scrollTo`. Перехват стоит на
 * документе в фазе всплытия: разметку якорей это не трогает, и без JS они
 * работают ровно как работали.
 */
export function SmoothScroll() {
  const pathname = usePathname()

  useGSAP(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    /*
     * smoothTouch включён намеренно. Обычно его выключают, потому что у тача
     * есть своя инерция, но продукт выбрал полную хореографию и на телефоне:
     * без сглаживания закреплённые сцены на таче дёргаются между кадрами
     * инерции системы.
     *
     * normalizeScroll переводит прокрутку в поток JS — без него на мобильных
     * закрепление и прячущаяся адресная строка спорят за одну и ту же высоту.
     *
     * ignoreMobileResize: изменение высоты меньше четверти экрана — это
     * адресная строка, а не поворот устройства. Без флага она пересчитывала бы
     * все закрепления на каждый пиксель.
     */
    let smoother: ScrollSmoother | null = null
    try {
      smoother = ScrollSmoother.create({
        wrapper: '#smooth-wrapper',
        content: '#smooth-content',
        smooth: 1.1,
        smoothTouch: 0.12,
        normalizeScroll: true,
        ignoreMobileResize: true,
        effects: false,
      })
    } catch {
      // Смузер не завёлся — не повод ронять страницу. Прокрутка останется
      // нативной, закрепления сцен работают и без него.
      smoother = null
    }

    return () => {
      smoother?.kill()
    }
  }, [])

  /*
   * Пересчёт на смене маршрута. Высоты нового документа смузеру неизвестны, а
   * закрепления считаются от них: без обновления первая же прокрутка на новой
   * странице происходит по границам предыдущей.
   */
  useEffect(() => {
    ScrollTrigger.refresh()
  }, [pathname])

  /*
   * И на полной загрузке: обложки приезжают лениво и меняют высоту документа
   * уже после первого расчёта.
   */
  useEffect(() => {
    const onLoad = () => ScrollTrigger.refresh()
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return
      }
      const link = (e.target as HTMLElement | null)?.closest?.('a[href^="#"]')
      if (!(link instanceof HTMLAnchorElement)) return
      const id = link.getAttribute('href')?.slice(1)
      if (!id) return
      const target = document.getElementById(id)
      if (!target) return
      const smoother = ScrollSmoother.get()
      if (!smoother) return
      e.preventDefault()
      /*
       * 'top 80px', а не 'top top': в globals.css у документа стоит
       * scroll-padding-top: 5rem ровно затем, чтобы якорь не уводил цель под
       * фиксированную шапку. Нативная прокрутка это правило читает сама,
       * smoother.scrollTo — нет, и число приходится повторить здесь.
       */
      smoother.scrollTo(target, true, 'top 80px')
      history.replaceState(null, '', `#${id}`)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  return null
}
