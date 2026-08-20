'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Шапка узнаёт, над чем она стоит СЕЙЧАС.
 *
 * Правило «обвязка наследует зону» (см. --header-fade в globals.css) знало
 * только про разметку: если где-то на странице есть .media-dark, шапка
 * красится тёмной зоной — вся, всегда, на всю длину прокрутки. Для главной
 * и церемонии матча этого хватало: там кино-зона занимает весь экран и ниже
 * ничего нет.
 *
 * А на четырёх страницах — выдача, игра дня, совместимость, портрет — зона
 * стоит героем СВЕРХУ, и ниже начинается обычный контент. Прокрутил экран —
 * и фиксированная шапка со светлым текстом и тёмным затемнением едет по
 * молочному фону светлой темы. Замерено на /play: навигация в этот момент
 * даёт 1.81:1 при пороге 4.5, то есть её физически не видно. Сторож палитры
 * этого поймать не мог: он считает токены, а здесь дело в том, ЧТО именно
 * оказалось под шапкой после прокрутки, — а это известно только браузеру.
 *
 * Механизм — IntersectionObserver, а не слушатель прокрутки: наблюдается сама
 * кино-зона, а корень наблюдателя обрезан сверху ровно на высоту шапки. Пока
 * зона пересекается с этим обрезанным окном, под шапкой ещё кино. Перестала —
 * зона целиком уехала выше шапки, и под ней контент страницы. Ноль
 * обработчиков прокрутки, ноль вычислений на кадр, пересчёт размеров зоны
 * браузер делает сам.
 *
 * Наблюдается именно зона, а не маячок у её низа: зона бывает выше экрана,
 * и её нижний край тогда просто не виден — маячок в этом случае честно
 * сообщал бы «не пересекаюсь» уже на первом экране, то есть ровно там, где
 * шапка стоит над кино.
 *
 * Страницы без кино-зоны получают маячок высотой в шапку от верха документа:
 * там же граница «ещё видно шапку страницы» / «уже прокрутили».
 *
 * Атрибут ставится ТОЛЬКО в состоянии «уехали с зоны». Без JS его нет вовсе,
 * и поведение остаётся ровно прежним: правило в CSS написано через
 * :not([data-chrome='page']), поэтому скрипт может только улучшить картинку,
 * но не может её сломать.
 */
export function ChromeZone() {
  const pathname = usePathname()

  useEffect(() => {
    const root = document.documentElement
    const header = document.querySelector('body > header')
    if (!header) return

    let io: IntersectionObserver | null = null
    let mark: HTMLElement | null = null
    let watched: Element | null = null

    const drop = () => {
      io?.disconnect()
      io = null
      mark?.remove()
      mark = null
      watched = null
    }

    const attach = () => {
      // Зона может появиться позже разметки: /play и /quiz клиентские, герой
      // приезжает после ответа сервера. Поэтому цель ищется заново на каждом
      // изменении дерева, а не один раз на монтировании.
      const zone = document.querySelector('.media-dark')
      const host = zone ?? document.body
      if (host === watched) return
      drop()
      watched = host

      const h = Math.round(header.getBoundingClientRect().height) || 64
      let target: Element
      if (zone) {
        target = zone
      } else {
        // Своего края у обычной страницы нет — рисуем его: полоса высотой в
        // шапку от верха документа. Пока она видна, страница не прокручена.
        mark = document.createElement('div')
        mark.setAttribute('aria-hidden', 'true')
        mark.style.cssText = `position:absolute;top:0;left:0;width:1px;height:${h + 8}px;pointer-events:none;`
        host.appendChild(mark)
        target = mark
      }

      io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) delete root.dataset.chrome
          else root.dataset.chrome = 'page'
        },
        { rootMargin: `-${h}px 0px 0px 0px`, threshold: 0 },
      )
      io.observe(target)
    }

    attach()
    // Маячок — наш собственный узел, и его появление снова дёрнуло бы
    // наблюдателя. attach() выходит сразу, если цель не сменилась, поэтому
    // цикла не возникает.
    const mo = new MutationObserver(attach)
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      mo.disconnect()
      drop()
      delete root.dataset.chrome
    }
  }, [pathname])

  return null
}
