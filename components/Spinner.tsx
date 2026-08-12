/**
 * Единственный загрузчик приложения.
 *
 * Раньше эта же разметка была скопирована в шести местах (/play, /daily, /rooms,
 * /room/new, /room/[id] ×2, /compat) и уже разъезжалась: где-то 10×10, где-то 8×8.
 * Серверный компонент — ноль JS.
 */
export function Spinner({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Загрузка"
      className={`spinner ${className}`}
      style={{ height: size, width: size }}
    />
  )
}
