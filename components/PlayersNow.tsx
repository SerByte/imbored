/**
 * «Сейчас играют N» — живой онлайн игры.
 *
 * Сервис отсеивает мёртвый мультиплеер молча, и это выглядит как произвол.
 * Показанное число делает решение проверяемым: видно, почему одну игру
 * предлагают на вечер с друзьями, а другую нет.
 *
 * Точка красится --ok, а не bg-emerald-400. Зелёный в этой палитре занят
 * ролью «живое, на месте» и у роли есть токен; сырой цвет Tailwind не знает
 * про светлую тему — а именно на ней emerald и проваливался (в globals.css
 * записано: emerald-300 давал 1.39:1). Признак «сейчас играют» обязан быть
 * виден в обеих темах, иначе он не признак.
 */
export function PlayersNow({ ccu, className = '' }: { ccu: number | null; className?: string }) {
  if (ccu === null || ccu === undefined) return null

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-dim ${className}`}>
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-ok anim-pulse-dot"
      />
      <span className="font-mono">{ccu.toLocaleString('ru-RU')}</span> сейчас играют
    </span>
  )
}
