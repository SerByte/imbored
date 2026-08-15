'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Продлевает вход, пока человек пользуется сайтом.
 *
 * Зачем вообще нужен: серверные страницы куку переставить не могут (HTTP не
 * разрешает Set-Cookie после начала стрима), поэтому продление живёт в роуте,
 * а позвать роут должен кто-то с клиента. Вот этот кто-то.
 *
 * Отметка «уже дёргали» держится В ПАМЯТИ модуля, а не в sessionStorage.
 * Разница не косметическая: sessionStorage переживает перезагрузки и умирает
 * только с вкладкой, а вкладка на телефоне не закрывается месяцами — флаг там
 * встал бы навсегда, и продление не случилось бы ни разу. Память модуля живёт
 * ровно столько, сколько документ, то есть именно то, что нужно.
 *
 * Плюс повтор по возвращении на вкладку: страница, открытая полгода назад и
 * ни разу не перезагруженная, иначе осталась бы с одним-единственным
 * продлением на старте.
 */
const AGAIN_AFTER_MS = 12 * 60 * 60 * 1000

let lastTouch = 0

/** Главная зовёт /api/session/touch сама (ей нужен ответ) — пусть не дублируется */
export function markSessionTouched(): void {
  lastTouch = Date.now()
}

export function SessionKeeper() {
  const pathname = usePathname()

  useEffect(() => {
    // На главной молчим: там свой вызов, и он же решает, что рисовать
    if (pathname === '/') return

    const touch = () => {
      if (Date.now() - lastTouch < AGAIN_AFTER_MS) return
      lastTouch = Date.now()
      // Ответ не нужен: продление — это Set-Cookie, а не тело. Ошибку глотаем
      // молча, но снимаем отметку, чтобы следующая попытка состоялась.
      fetch('/api/session/touch', { method: 'POST' }).catch(() => {
        lastTouch = 0
      })
    }

    touch()
    const onVisible = () => {
      if (document.visibilityState === 'visible') touch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [pathname])

  return null
}
