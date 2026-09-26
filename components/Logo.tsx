/**
 * Знак imbored — эмотикон «:\», набранный как текст.
 * happy — вторая фаза «:)» для состояний «игра найдена» (матч, зашло).
 *
 * Монохромный, как знаки стриминговых сервисов: плашка берёт цвет текста
 * (--ink), глиф — цвет фона (--bg). Поэтому он сам инвертируется в светлой
 * теме и внутри кино-зоны, не зная ни о той, ни о другой. Литералы после
 * запятой — запасной цвет для мест без токенов (картинки next/og, аварийный
 * экран); число подложки сверяет lib/palette.test.ts.
 */
export function LogoMark({
  size = 24,
  happy = false,
  className = '',
}: {
  size?: number
  happy?: boolean
  className?: string
}) {
  const glyph = 'var(--bg, #050505)'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="18" fill="var(--ink, #ffffff)" />
      <circle cx="22" cy="24.5" r="6" fill={glyph} />
      <circle cx="22" cy="42" r="6" fill={glyph} />
      {happy ? (
        <path d="M36 21 q13 12 0 24" fill="none" stroke={glyph} strokeWidth="9" strokeLinecap="round" />
      ) : (
        <line x1="36" y1="20" x2="46" y2="45" stroke={glyph} strokeWidth="9" strokeLinecap="round" />
      )}
    </svg>
  )
}
