'use client'

import { useCallback, useSyncExternalStore, type ReactNode } from 'react'

/**
 * setTimeout держит не больше 2^31−1 мс, около 24.8 суток: дальше браузер
 * срабатывает сразу. Срок дальше этого за жизнь вкладки не наступит — такой
 * не взводим вовсе.
 */
const MAX_DELAY_MS = 2_147_483_647

/**
 * Кусок серверной разметки со сроком годности: после untilSec (unix-секунды)
 * по часам читателя он исчезает.
 *
 * Нужен странице из долгого кэша. Карточка игры живёт в ISR неделю, а скидка
 * — дни: страница, собранная в последний день распродажи, иначе показывала бы
 * «−70%» и акционную цену ещё шесть суток после её конца. Это ровно та
 * «неправда про скидку», от которой бережёт lib/discount. Перегенерировать
 * страницу в момент конца акции некому — крона на это нет, и заводить его
 * ради одной строки дороже, чем спросить часы у браузера.
 *
 * Сервер и гидратация видят содержимое всегда (getServerSnapshot — false):
 * разметка та же, что пришла из кэша, расхождения гидратации нет. Истёкший
 * срок снимает содержимое сразу после неё, живой — ровно в свой момент, если
 * вкладка открыта дольше.
 *
 * Поисковик без JavaScript увидит собранное — и микроразметку тоже; у скидки
 * с названным сроком там стоит priceValidUntil (lib/jsonld), так что срок
 * известен и ему.
 */
export function ShownUntil({ untilSec, children }: { untilSec: number; children: ReactNode }) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const left = untilSec * 1000 - Date.now()
      if (left <= 0 || left > MAX_DELAY_MS) return () => {}
      const timer = window.setTimeout(onChange, left)
      return () => window.clearTimeout(timer)
    },
    [untilSec],
  )
  const expired = useSyncExternalStore(
    subscribe,
    () => Date.now() >= untilSec * 1000,
    () => false,
  )
  return expired ? null : <>{children}</>
}
