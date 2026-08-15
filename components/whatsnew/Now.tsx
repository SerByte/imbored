'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { nextFreshnessTickMs } from '@/lib/freshness'

const NowContext = createContext<number | null>(null)

/**
 * Живые часы ленты.
 *
 * nowSec страница считает на сервере один раз, и подпись свежести застывает
 * вместе с ним: вкладка, оставленная на ночь, к утру продолжает уверять, что
 * патч вышел «сегодня». Сети это не стоит ничего — меняется только надпись.
 *
 * Просыпаемся не по таймеру «раз в минуту», а ровно на ближайшей границе
 * суток по всей ленте (см. nextFreshnessTickMs): подпись меняется раз в сутки,
 * а перерисовка тридцати строк недёшева.
 *
 * Стартовое значение — серверное, и это обязательно: посчитай мы его из
 * Date.now() при инициализации, первый клиентский рендер разошёлся бы с
 * разметкой SSR на расхождении часов и React сообщил бы о гидратации. Смещение
 * снимаем один раз после монтирования, оно же прячет и кривые системные часы,
 * и задержку запрос→монтирование.
 */
export function NowProvider({
  nowSec,
  publishedAts,
  children,
}: {
  nowSec: number
  publishedAts: number[]
  children: React.ReactNode
}) {
  const [now, setNow] = useState(nowSec)

  useEffect(() => {
    const offset = nowSec - Math.floor(Date.now() / 1000)
    const read = () => Math.floor(Date.now() / 1000) + offset

    let timer = 0
    const arm = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        setNow(read())
        arm()
      }, nextFreshnessTickMs(publishedAts, read()))
    }

    // Из сна таймеры выходят непредсказуемо, поэтому при возвращении во
    // вкладку пересчитываем подпись сразу и переставляем будильник.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      setNow(read())
      arm()
    }

    arm()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [nowSec, publishedAts])

  return <NowContext.Provider value={now}>{children}</NowContext.Provider>
}

/** Тикающее «сейчас», а вне провайдера — серверное значение как есть. */
export function useNow(serverNowSec: number): number {
  return useContext(NowContext) ?? serverNowSec
}
