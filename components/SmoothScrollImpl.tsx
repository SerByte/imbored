'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { focusBand, HEADER_CLEARANCE, needsReveal, takeFocus } from '@/lib/skiplink'

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, useGSAP)

/**
 * ПЛАВНАЯ ПРОКРУТКА НА ВЕСЬ САЙТ — сам смузер.
 *
 * Клиентский и без разметки — как SessionKeeper и ChromeZone. Статически его
 * не импортирует никто: лэйаут держит лёгкий вход components/SmoothScroll.tsx,
 * а тот догружает этот файл отдельным чанком и только когда движение
 * разрешено. Почему — там же; сторож — lib/smoothlazy.test.ts.
 *
 * Обёртка `#smooth-wrapper > #smooth-content` живёт в app/layout.tsx и стоит
 * там ВСЕГДА: без смузера она безвредна, а условная разметка означала бы
 * разные деревья на сервере и клиенте.
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
 * прокручивается нативно, и всё остаётся на местах. Настройку спрашивает уже
 * лёгкий вход, до загрузки; проверка ниже — вторая, на случай если этот
 * компонент однажды смонтируют в обход него.
 *
 * ЯКОРЯ. Нативный переход по `#id` двигает окно, но не трансформ контента —
 * получается прыжок не туда. Поэтому клики по внутренним якорям
 * перехватываются и уводятся в `smoother.scrollTo`. Перехват стоит на
 * документе в фазе всплытия: разметку якорей это не трогает, и без JS они
 * работают ровно как работали — как и до того, как этот чанк приехал.
 *
 * ФОКУС. Перехваченный якорь переносит не только прокрутку, но и фокус —
 * иначе «К содержанию» оставляла следующий Tab в шапке. А элемент, получивший
 * фокус с клавиатуры, досматривается, если его закрывает шапка или нижняя
 * панель: своё правило смузера считает видимым всё, что задело экран хоть
 * пикселем. Решения живут в lib/skiplink.ts, сторож — lib/skiplink.test.ts.
 */
export function SmoothScrollImpl() {
  const pathname = usePathname()
  /*
   * Фокус переносит сам обработчик якоря, и досматривать его цель не нужно:
   * прокрутка к ней уже едет. Без флага onFocusIn успел бы поставить свою —
   * к центру, поверх 'top 80px', — или правило смузера рвануло бы страницу к
   * цели мгновенно, и плавный переход по якорю стал бы прыжком.
   */
  const steering = useRef(false)

  useGSAP(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    /*
     * onFocusIn: false — «сам разобрался, своё правило не применяй»; undefined —
     * пусть решает смузер (он прокручивает к центру то, что целиком за экраном).
     *
     * Досматриваем только то, что лежит в прокручиваемом содержимом: шапка,
     * нижняя панель и слои в портале (лайтбокс, плашки) стоят на экране, а не
     * на странице, и прокрутка к ним увела бы страницу в никуда.
     *
     * И только фокус с клавиатуры (:focus-visible). Клик мышью тоже даёт
     * focusin, и кнопка, чуть задевшая шапку, дёргала бы страницу к центру
     * прямо под курсором. Поле ввода :focus-visible и от клика — его и надо
     * показать, над ним откроется клавиатура.
     */
    const content = document.getElementById('smooth-content')
    let lastRevealed: EventTarget | null = null
    const onFocusIn = (self: ScrollSmoother, e: Event) => {
      const el = e.target
      if (steering.current) {
        lastRevealed = el
        return false
      }
      if (!(el instanceof HTMLElement) || !content?.contains(el)) return undefined
      // Вернулись в окно, и браузер вернул фокус тому же элементу — человек
      // его не переводил, и страницу, которую он с тех пор прокрутил, не трогаем.
      // То же правило у самого смузера (lastFocusElement).
      if (el === lastRevealed) return false
      lastRevealed = el
      if (!el.matches(':focus-visible')) return undefined
      const nav = document.querySelector('body > nav')?.getBoundingClientRect() ?? null
      if (!needsReveal(el.getBoundingClientRect(), focusBand(window.innerHeight, nav))) {
        return undefined
      }
      self.scrollTo(el, true, 'center center')
      return false
    }

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
        onFocusIn,
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
       * smoother.scrollTo — нет, и число приходится повторить здесь
       * (HEADER_CLEARANCE, сверяется с CSS сторожем lib/skiplink.test.ts).
       */
      smoother.scrollTo(target, true, `top ${HEADER_CLEARANCE}px`)
      history.replaceState(null, '', `#${id}`)
      /*
       * Фокус — вслед за прокруткой, как при нативном переходе по якорю.
       * Перехват клика отнимал у ссылки и эту половину: «К содержанию»
       * прокручивала к <main>, а следующий Tab уходил в шапку.
       */
      steering.current = true
      try {
        takeFocus(target)
      } finally {
        steering.current = false
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  return null
}
