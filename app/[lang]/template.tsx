import { ViewTransition } from 'react'

/**
 * Переход между роутами. Раньше страницы стыковались встык: единственной
 * связностью было то, что каждая сама себя проявляла через .anim-rise.
 *
 * template.tsx (а не layout.tsx) — потому что он перемонтируется на каждой
 * навигации, а layout переиспользуется.
 *
 * НАПРАВЛЕНИЕ — ЧЕРЕЗ VIEW TRANSITIONS. Старое дерево Next не держит, но
 * снимок старой страницы держит браузер, поэтому выход анимировать можно.
 * Сдвиг есть только у переходов с типом: ссылки «вглубь» (капсула → страница
 * игры) помечены nav-forward, «назад к игре» — nav-back. Прочие навигации,
 * кнопка «Назад» браузера и router.refresh() типа не несут и идут как раньше
 * (default: 'none'). Браузер без View Transitions не анимирует ничего.
 * Сами сдвиги — в globals.css (::view-transition-old/new(.nav-forward)).
 *
 * Намеренно на CSS, а не на motion. Этот враппер оборачивает КАЖДУЮ страницу,
 * и если анимацией управляет JS, то любой сбой гидратации или задушенный rAF
 * оставляет сайт с opacity: 0 — то есть пустым. CSS-анимация отработает даже
 * при выключенном JS, не может застрять и стоит ноль килобайт.
 */
const DIRECTED = { 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={DIRECTED} exit={DIRECTED} default="none">
      <div className="flex-1 flex flex-col anim-page-in">{children}</div>
    </ViewTransition>
  )
}
