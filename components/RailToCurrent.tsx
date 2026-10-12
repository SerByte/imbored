'use client'

import { useEffect } from 'react'

/**
 * Докручивает ленту чипсов (.chip-rail) до выбранного пункта.
 *
 * На телефоне лента фильтров /library уходит за правый край: пять чипсов
 * занимают 758 px на экране в 390. При заходе прямо на /library?state=active —
 * обновление страницы, «Назад», присланная ссылка — выбранный чипс стоял на
 * 596–738 px, то есть за краем, и признака «какая полка открыта» на экране не
 * было вовсе. Нажатием такого не случается: лента хранит прокрутку, раз
 * чипсы — ссылки с scroll={false} на ту же страницу.
 *
 * Ничего не рисует. Пункт ищется по aria-current="page" — тот же признак, что
 * красит его в разметке. current в зависимостях — чтобы переход с другой
 * ссылки (полка «запечатанного» ведёт на ?state=untouched) тоже докручивал.
 * Без плавности: это не анимация, а исходное положение ленты.
 */
export function RailToCurrent({ railId, current }: { railId: string; current: string }) {
  useEffect(() => {
    const rail = document.getElementById(railId)
    const item = rail?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!rail || !item || rail.scrollWidth <= rail.clientWidth) return
    const r = rail.getBoundingClientRect()
    const i = item.getBoundingClientRect()
    if (i.left >= r.left && i.right <= r.right) return
    rail.scrollLeft += i.left - r.left - (r.width - i.width) / 2
  }, [railId, current])
  return null
}
