'use client'

import { useEffect, useState } from 'react'
import { dayStartSec } from '@/lib/daily'

/**
 * «Следующая через 5 ч 12 мин» — обратный отсчёт до смены игры дня.
 *
 * Строка «завтра здесь будет другая» обещала смену, но не говорила когда, а
 * «завтра» у игры дня — полночь по Москве (DAILY_TZ), не по часам человека.
 * В Новосибирске это четыре утра, в Калининграде — одиннадцать вечера.
 *
 * Считаем от часов СЕРВЕРА: nowSec приходит в ответе /api/daily, и разница с
 * часами устройства снимается один раз при монтировании. Иначе телефон,
 * у которого время ушло на пару минут, показывал бы «меньше минуты» при уже
 * сменившейся игре — или наоборот.
 *
 * Тикает раз в 30 секунд: минутная точность, и дёргать React чаще незачем.
 */
const TICK_MS = 30_000

function left(sec: number): string {
  if (sec < 60) return 'меньше минуты'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

export function DailyCountdown({ nowSec, className = '' }: { nowSec: number; className?: string }) {
  const [clock, setClock] = useState({ base: nowSec, now: nowSec })
  // Пришёл новый ответ сервера — отсчёт начинается от него
  if (clock.base !== nowSec) setClock({ base: nowSec, now: nowSec })

  useEffect(() => {
    const skew = nowSec - Date.now() / 1000
    const t = window.setInterval(() => setClock({ base: nowSec, now: Date.now() / 1000 + skew }), TICK_MS)
    return () => window.clearInterval(t)
  }, [nowSec])

  if (nowSec <= 0) return null
  const rest = Math.max(0, dayStartSec(nowSec) + 86_400 - clock.now)
  return (
    <span className={className}>
      Следующая через <span className="font-bold tabular-nums text-ink">{left(rest)}</span>
    </span>
  )
}
