'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { dayStartSec } from '@/lib/daily'
import { tr, type Locale } from '@/lib/i18n'

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

/** Единицы — по глоссарию: «ч / мин» и «h / min»; число без разрядов — часов меньше суток */
function left(sec: number, locale: Locale): string {
  if (sec < 60) return tr(locale, { ru: 'меньше минуты', en: 'under a minute' })
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return tr(locale, {
    ru: h > 0 ? `${h} ч ${m} мин` : `${m} мин`,
    en: h > 0 ? `${h} h ${m} min` : `${m} min`,
  })
}

/**
 * Сама строка — отдельно от часов, чтобы её можно было проверить без таймеров.
 * Язык — из контекста страницы (useLocale): без провайдера — русский.
 */
export function CountdownLine({ rest, className = '' }: { rest: number; className?: string }) {
  const locale = useLocale()
  if (rest <= 0) {
    return (
      <span className={className}>
        {tr(locale, { ru: 'Игра дня сменилась', en: 'New game of the day' })} ·{' '}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="tap cursor-pointer font-bold text-ink underline underline-offset-2"
        >
          {tr(locale, { ru: 'Показать', en: 'Show' })}
        </button>
      </span>
    )
  }
  return (
    <span className={className}>
      {tr(locale, { ru: 'Следующая через', en: 'Next one in' })}{' '}
      <span className="font-bold tabular-nums text-ink">{left(rest, locale)}</span>
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
