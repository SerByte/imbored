import { Ambient } from '@/components/Ambient'
import { Eyebrow } from '@/components/Labels'
import type { ArtRef } from '@/lib/compatpage'
import { CoverWall } from './CoverStrip'

/**
 * Общая шапка для всех экранов без результата.
 *
 * Раньше стеклянную карточку получал только экран «войди через Steam», а
 * «это твоя ссылка», «игрок не подключал библиотеку» и «не получилось
 * посчитать» рисовались голым абзацем посреди пустоты — в том же файле, на
 * десять строк ниже. Одна оболочка на все состояния делает такое расхождение
 * невозможным, а не просто исправляет его один раз.
 *
 * Открытая кино-шапка того же языка, что у приглашения (InviteHero), а не
 * стеклянная коробка по центру: коробку сняли и с 404, и с экрана ошибки,
 * и центрированная карточка читалась бы заглушкой. Если есть что показать
 * (свои игры на «это твоя ссылка»), фон — две ленты постеров; нет — мягкое
 * пятно Ambient.
 *
 * Серверный компонент: своей интерактивности у него нет, а кнопки приезжают
 * через children — в том числе клиентские.
 */
export function CompatNotice({
  title,
  body,
  games,
  children,
}: {
  title: string
  body: string
  /** обложки для фона; нет — пятно Ambient */
  games?: ArtRef[]
  children?: React.ReactNode
}) {
  const wall = games && games.length > 0
  return (
    <section className="media-dark anim-reveal relative flex min-h-[70svh] flex-1 flex-col justify-end overflow-hidden">
      {wall ? (
        <>
          <CoverWall rows={[games, [...games].reverse()]} />
          <div aria-hidden className="cwall-scrim" />
        </>
      ) : (
        <Ambient />
      )}
      <div aria-hidden className="grain" />
      <div className="relative mx-auto w-full max-w-6xl px-safe pb-16 pt-32">
        <Eyebrow className="mb-3">Совместимость</Eyebrow>
        <h1 className="max-w-2xl font-display text-display-md">{title}</h1>
        <p className="mt-4 max-w-xl leading-relaxed text-dim">{body}</p>
        {children && <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">{children}</div>}
      </div>
    </section>
  )
}
