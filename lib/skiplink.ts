/**
 * Фокус под плавной прокруткой: куда он переезжает и когда его надо показать.
 *
 * Модуль без импортов и без DOM-глобалов: смузер (components/SmoothScrollImpl)
 * отдаёт сюда прямоугольники и элементы, а решения проверяются в node, без
 * браузера. gsap сюда не въезжает — lib/smoothlazy.test.ts стережёт это для
 * всего, до чего дотягивается лэйаут.
 */

/**
 * Сколько сверху занимает фиксированная шапка, с запасом под кольцо фокуса.
 *
 * То же число, что `scroll-padding-top: 5rem` у html в globals.css: нативная
 * прокрутка читает правило сама, смузер — нет, и повторять его приходится
 * здесь. Два места одного числа сверяет lib/skiplink.test.ts.
 */
export const HEADER_CLEARANCE = 80

/**
 * Зазор над нижней панелью. Кольцо фокуса — 2 px линии, 2 px отступа и 4 px
 * подложки (:focus-visible в globals.css), то есть 8 px вокруг элемента.
 */
export const NAV_GAP = 8

/** Полоса экрана, которую не закрывает ни шапка, ни нижняя панель. */
export type Band = { top: number; bottom: number }

type Rect = { top: number; bottom: number; height: number }

/**
 * Видимая полоса экрана.
 *
 * Панель берётся замером, а не константой: она есть только ниже md, её высота
 * зависит от safe-area, а на десктопе она скрыта через md:hidden и отдаёт
 * нулевой прямоугольник. Нулевая высота — значит панели нет, и низ полосы —
 * это низ окна.
 */
export function focusBand(innerHeight: number, nav: Rect | null): Band {
  const bottom = nav && nav.height > 0 ? nav.top - NAV_GAP : innerHeight
  return { top: HEADER_CLEARANCE, bottom }
}

/**
 * Надо ли досмотреть элемент в фокусе.
 *
 * ScrollSmoother решает это сам (node_modules/gsap/src/ScrollSmoother.js,
 * _onFocusIn), но по правилу «задел экран хоть пикселем — значит виден»:
 * ScrollTrigger.isInViewport без порога. Ссылка, стоящая целиком под нижней
 * панелью, этим правилом считается видимой — замер на /play при 390×844:
 * «Открыть в Steam» стояла на 826–846, в её центре elementFromPoint отдавал
 * саму панель, и прокрутки не было.
 *
 * Здесь правило строже: элемент обязан поместиться в полосу целиком. Но
 * только если он вообще в неё помещается — `<main>` или длинную секцию
 * целиком не показать никак, и центрирование уводило бы страницу туда, где
 * человек не просил. Для таких решает правило смузера.
 */
export function needsReveal(rect: Rect, band: Band): boolean {
  if (rect.height > band.bottom - band.top) return false
  return rect.top < band.top || rect.bottom > band.bottom
}

/** То, что нужно от элемента, чтобы перенести на него фокус. */
export type FocusTarget = {
  tabIndex: number
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: string): void
  focus(options?: { preventScroll?: boolean }): void
}

/**
 * Перенести фокус на цель якоря, не двигая страницу.
 *
 * Нативный переход по `#id` переносит и прокрутку, и точку, откуда пойдёт
 * следующий Tab. Смузер перехватывает клик по якорю (иначе окно прыгнуло бы
 * мимо трансформа), и точка обхода оставалась на ссылке: «К содержанию» вела
 * в шапку — логотип, шесть пунктов, тема. Замер: Tab → «К содержанию»,
 * Enter, следующий Tab — «imbored» в <header>.
 *
 * tabindex="-1" ставится, только если элемент не фокусируется сам: у ссылки
 * или кнопки tabIndex и без атрибута 0, и отрицательный вынул бы их из обхода.
 * Свой атрибут у цели тоже не трогается.
 *
 * preventScroll: прокрутку уже ведёт smoother.scrollTo, а нативная прокрутка к
 * фокусу внутри обёртки смузера двигала бы её scrollTop мимо трансформа.
 */
export function takeFocus(target: FocusTarget): void {
  if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}
