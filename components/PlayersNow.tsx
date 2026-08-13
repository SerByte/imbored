/**
 * «Сейчас играют N» — живой онлайн игры.
 *
 * Сервис отсеивает мёртвый мультиплеер молча, и это выглядит как произвол.
 * Показанное число делает решение проверяемым: видно, почему одну игру
 * предлагают на вечер с друзьями, а другую нет.
 */
export function PlayersNow({ ccu, className = '' }: { ccu: number | null; className?: string }) {
  if (ccu === null || ccu === undefined) return null

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-dim ${className}`}>
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-emerald-400 anim-pulse-dot"
      />
      <span className="font-mono">{ccu.toLocaleString('ru-RU')}</span> сейчас играют
    </span>
  )
}
