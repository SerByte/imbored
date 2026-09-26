import type { CSSProperties } from 'react'

/**
 * Ячейка каркаса страницы.
 *
 * Серверный компонент, ноль JS: каркас показывается там, где страницы ещё
 * нет, — тащить туда гидратацию было бы прямым противоречием.
 *
 * Ни размера, ни формы по умолчанию: их задаёт место. Смысл каркаса ровно в
 * том, чтобы повторить геометрию настоящего содержимого, а универсальная
 * «серая полоска» этого не умеет — она даёт сдвиг вёрстки в тот момент, ради
 * которого каркас и ставили.
 *
 * delay — ступенька волны. Соседние ячейки дышат не в такт, и страница
 * собирается сверху вниз, а не мигает целиком (см. большой комментарий про
 * .skel в globals.css).
 */
export function Skel({
  className = '',
  delay = 0,
  style,
}: {
  className?: string
  delay?: number
  style?: CSSProperties
}) {
  return (
    <div
      aria-hidden
      className={`skel ${className}`}
      style={delay ? { animationDelay: `${delay}ms`, ...style } : style}
    />
  )
}

/**
 * Обёртка каркаса целой страницы.
 *
 * Она и объявляет загрузку для скринридера — один раз на экран. Сами ячейки
 * aria-hidden: сорок «изображений-заглушек» подряд — это не информация, а шум,
 * и озвучивать их вместо одного «Загрузка» хуже, чем молчать.
 */
export function SkelPage({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-label="Загрузка" className={className}>
      {children}
    </div>
  )
}

/**
 * Плитка игры: обложка 460×215 и подпись под ней.
 *
 * Отдельным компонентом, потому что это самый частый объект приложения —
 * библиотека, полка забытых, сетки открытий. Пропорция обложки взята из
 * разметки плитки один в один: именно она держит высоту ряда, и разойдись
 * она с настоящей — каркас начал бы врать ровно в том, ради чего он есть.
 */
export function SkelTile({ delay = 0, caption = 1 }: { delay?: number; caption?: 1 | 2 }) {
  return (
    <div>
      <Skel className="w-full aspect-[460/215] rounded-[var(--radius-card)]" delay={delay} />
      {/*
        Форма — капсулы GameCardBody, которую каркас подменяет: обложка без
        панели и подпись под ней (mt-3). Строка названия — 15 px с
        leading-tight, то есть 19 px; вторая строка — 13 px leading-snug, 18 px
        после mt-1. Разойдись числа — и каждый ряд стены поехал бы вниз в
        момент подмены каркаса содержимым.
      */}
      <div className="mt-3 px-0.5 flex flex-col">
        <Skel className="h-[19px] w-4/5 rounded-[4px]" delay={delay + 70} />
        {caption === 2 && <Skel className="mt-1 h-[18px] w-1/3 rounded-[4px]" delay={delay + 140} />}
      </div>
    </div>
  )
}
