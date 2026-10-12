'use client'

import { useEffect, useRef } from 'react'

/**
 * Возвращает к началу полки, когда её сменили из глубины стены.
 *
 * Чипсы /library — ссылки с scroll={false}: без него Next уносил к верху
 * страницы, над героем, а новая полка оставалась за нижним краем. Но полоса
 * чипсов липкая (.lib-filters, top 72px), и нажать чипс можно и из середины
 * стены. Тогда scroll={false} оставлял прокрутку как есть, а порция
 * сбрасывалась на первую: человек оказывался посреди новой полки — или у
 * подвала, если она короче прежней, — а не в её начале.
 *
 * Поэтому после смены полки, и только когда полоса прилипла (её место в
 * потоке уже выше того, где она стоит), страница докручивается ровно на
 * разницу: полоса встаёт на своё место в потоке, не сдвинувшись на экране, и
 * под ней сразу первый ряд новой полки. Не прилипла — прокрутка не
 * трогается: это обычный случай, ради которого scroll={false} и стоит.
 *
 * Место в потоке меряется снятием sticky на один синхронный замер: прилипший
 * элемент отдаёт и в getBoundingClientRect, и в offsetTop уже сдвинутое
 * положение, а scrollIntoView по нему сдвигает страницу на величину
 * scroll-padding-top, а не к полке (замер на 768: на 59 px). Кадр между
 * снятием и возвратом не рисуется.
 *
 * Первый рендер — не смена: заход по адресу, обновление и якорь #wall с полки
 * «запечатанного» оставляют прокрутку браузеру. Сравнение с прежней полкой, а
 * не флаг «смонтирован»: StrictMode в разработке гоняет эффект дважды, и флаг
 * принял бы второй прогон за смену. Остров переживает смену полки — это та
 * же страница, и React держит его на месте (как и RailToCurrent рядом).
 */
export function ShelfToStart({ barId, shelf }: { barId: string; shelf: string }) {
  const shown = useRef(shelf)
  useEffect(() => {
    if (shown.current === shelf) return
    shown.current = shelf
    const bar = document.getElementById(barId)
    if (!bar) return
    const stuck = bar.getBoundingClientRect().top
    bar.style.position = 'static'
    const flow = bar.getBoundingClientRect().top
    bar.style.position = ''
    if (flow < stuck - 0.5) window.scrollBy(0, flow - stuck)
  }, [barId, shelf])
  return null
}
