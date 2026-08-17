/**
 * Дисциплина will-change.
 *
 * Зачем вообще. GSAP с force3D:'auto' бесплатно продвигает в слой TRANSFORM-твины,
 * но не делает ничего для OPACITY-твинов — а вся хореография перекраски и
 * финала построена именно на непрозрачности слоёв размером с экран. Без
 * подсказки каждый такой такт был бы полноэкранной перерисовкой в главном
 * потоке покадрово.
 *
 * Почему через data-атрибут, а не через инлайн-стиль. Тогда весь will-change
 * в проекте живёт в ОДНОМ месте стилей и его можно проверить тестом
 * (lib/quizgpu.test.ts: will-change встречается только в правилах [data-warm]).
 * Иначе он расползается по компонентам и остаётся там навсегда.
 *
 * ГЛАВНОЕ ПРАВИЛО: cool() обязан вызываться И в onComplete, И в очистке
 * useGSAP. tl.kill() не вызывает onComplete — это классическая утечка текстур:
 * человек ушёл с шага на середине такта, а слой остался продвинутым до
 * выгрузки страницы.
 *
 * Потолок: не больше двух «тёплых» элементов одновременно.
 */

type Warm = 'opacity' | 'transform' | 'filter' | 'opacity,transform'

export function warm(el: Element | null | undefined, v: Warm): void {
  if (el instanceof HTMLElement) el.dataset.warm = v
}

export function cool(el: Element | null | undefined): void {
  if (el instanceof HTMLElement) delete el.dataset.warm
}

/** Снять подсказку с нескольких элементов разом — для очисток таймлайнов. */
export function coolAll(els: Iterable<Element | null | undefined>): void {
  for (const el of els) cool(el)
}
