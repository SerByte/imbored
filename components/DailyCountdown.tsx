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
 *
 * ПОЛНОЧЬ С ОТКРЫТОЙ ВКЛАДКОЙ. nowSec — из ответа /api/daily, и сам он не
 * меняется: страница читает игру дня один раз, при монтировании. Раньше
 * отсчёт упирался в ноль и навсегда застывал на «Следующая через меньше
 * минуты», а герой, дата в пилюле и «Вчера была» оставались вчерашними,
 * хотя сервер уже сменил день. Теперь на нуле строка говорит, что игра дня
 * сменилась, и даёт кнопку её показать.
 *
 * Кнопка перезагружает страницу, а не перезапрашивает игру сама, и это
 * намеренно. Сама — значит в 00:00 по Москве разом из каждой забытой в фоне
 * вкладки: /api/daily и прогрев для того, кто не смотрит, плюс потолок
 * частоты /api/daily (десять в час), потраченный впустую, и экран прогрева,
 * подменивший страницу под чужим фокусом. Перезагрузка же проходит ровно тем
 * путём, что первый заход (запись дня → прогрев → отбор), и его тесты
 * покрывают всё, что меняется с днём. router.refresh() не годится: состояние
 * клиентской страницы он сохраняет, и её эффект монтирования не повторится.
 */
const TICK_MS = 30_000

/** Сколько секунд до смены игры дня по часам сервера; 0 — уже сменилась */
export function untilNextDaily(nowSec: number, clockNow: number): number {
  return Math.max(0, dayStartSec(nowSec) + 86_400 - clockNow)
}

function left(sec: number): string {
  if (sec < 60) return 'меньше минуты'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

/** Сама строка — отдельно от часов, чтобы её можно было проверить без таймеров */
export function CountdownLine({ rest, className = '' }: { rest: number; className?: string }) {
  if (rest <= 0) {
    return (
      <span className={className}>
        Игра дня сменилась ·{' '}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="tap cursor-pointer font-bold text-ink underline underline-offset-2"
        >
          Показать
        </button>
      </span>
    )
  }
  return (
    <span className={className}>
      Следующая через <span className="font-bold tabular-nums text-ink">{left(rest)}</span>
    </span>
  )
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
  return <CountdownLine rest={untilNextDaily(nowSec, clock.now)} className={className} />
}
