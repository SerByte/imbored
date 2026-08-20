import { SectionLabel } from '@/components/Labels'

/**
 * Горизонтальный рельс с выносом за колонку.
 *
 * Обрезанный край — это и есть подсказка «тут листается», поэтому маски
 * справа нет: она бы приглушала последнюю карточку и когда рельс домотан
 * до конца, то есть врала бы про наличие продолжения.
 */
export function ScrollRail({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="relative flex flex-col gap-2.5">
      <SectionLabel as="h3">{label}</SectionLabel>
      <ul className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
        {/*
          Chrome срезает padding-right у последнего элемента в flex+overflow:
          без распорки последняя карточка упирается в край экрана ровно там,
          где человек досматривает рельс.
        */}
        <li aria-hidden className="shrink-0 w-px" />
      </ul>
    </section>
  )
}
