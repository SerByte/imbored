/**
 * Страница под модальным окном: фон выпадает из обхода и не прокручивается.
 *
 * Лайтбокс объявлен как role="dialog" aria-modal="true", то есть обещает
 * скринридеру, что остальной страницы сейчас нет. Обещание держалось на
 * одной ловушке Tab — и не держалось. Замер на /game/730, 1280×800:
 *
 *   • фон оставался доступен: ни inert, ни aria-hidden на нём не стояло, и
 *     виртуальный курсор скринридера — он ходит не по Tab — читал страницу
 *     под затемнением;
 *   • шесть событий колеса над открытым кадром сдвинули страницу со scrollY 0
 *     на 363 при body.overflow = hidden. normalizeScroll смузера прокручивает
 *     программно, и overflow он не читает.
 *
 * Отсюда две половины. Фон — все прямые потомки <body>, кроме того, в ком
 * живёт окно: обёртка смузера, шапка, нижняя панель, «К содержанию» и чужие
 * порталы (плашки, лента). Им ставится inert, и снимается ровно с тех, кому
 * поставили, — уже инертный узел чужой, его не трогаем. Прокрутка — пауза
 * смузера.
 *
 * ПАУЗА ЧЕРЕЗ РЕГИСТРАЦИЮ, А НЕ ИМПОРТ. Лайтбокс живёт на странице игры, а
 * gsap намеренно едет отдельным чанком и только когда движение разрешено
 * (components/SmoothScroll.tsx, сторож lib/smoothlazy.test.ts). Импорт
 * ScrollSmoother отсюда вернул бы gsap в начальный набор страницы игры. Поэтому
 * смузер сам приносит сюда свою паузу, когда заводится, а модуль просто
 * помнит, сколько окон сейчас держат страницу. Приехал смузер при уже
 * открытом окне — встаёт на паузу сразу.
 *
 * Модуль без импортов и DOM-глобалов: узлы передаются снаружи, решения
 * проверяются в node — lib/pagelock.test.ts.
 */

type Pauser = (paused: boolean) => void

let pauser: Pauser | null = null
let holds = 0

/**
 * Смузер приносит свою паузу. Возвращает отписку: после kill() звать его
 * нельзя, и у нового смузера (другой маршрут, горячая замена) — своя.
 */
export function registerScrollPauser(fn: Pauser): () => void {
  pauser = fn
  if (holds > 0) fn(true)
  return () => {
    if (pauser === fn) pauser = null
  }
}

/**
 * Удержать прокрутку страницы. Пауза ставится на первом удержании и снимается
 * на последнем отпускании; повторный вызов отпускания ничего не делает —
 * очистка эффекта в строгом режиме React и размонтирование посреди анимации
 * не должны снять чужое удержание.
 */
export function holdScroll(): () => void {
  holds += 1
  if (holds === 1) pauser?.(true)
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    if (holds === 0) pauser?.(false)
  }
}

/** Прямой потомок <body> — ровно то, что от него нужно. */
export type BackdropNode<D> = {
  inert: boolean
  tagName: string
  contains(other: D): boolean
}

/** Узлы без содержимого: инертность им ничего не даёт, трогать их незачем. */
const NOT_CONTENT = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT'])

/**
 * Фон окна: всё, что лежит в <body> рядом с ним. Уже инертные узлы не
 * берутся — их инертность чужая, и снимать её при закрытии нельзя.
 */
export function backdropOf<D, T extends BackdropNode<D>>(children: Iterable<T>, dialog: D): T[] {
  return Array.from(children).filter(
    (node) => !NOT_CONTENT.has(node.tagName) && !node.inert && !node.contains(dialog),
  )
}

/**
 * Сделать узлы инертными; вернуть снятие. Снятие одноразовое и снимает
 * только с этих узлов.
 */
export function makeInert<T extends { inert: boolean }>(nodes: readonly T[]): () => void {
  for (const node of nodes) node.inert = true
  let released = false
  return () => {
    if (released) return
    released = true
    for (const node of nodes) node.inert = false
  }
}

/** Только для тестов: удержания и пауза живут на модуле и иначе текут между случаями */
export function resetPageLock(): void {
  pauser = null
  holds = 0
}
