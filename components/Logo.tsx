/**
 * Знак imbored — эмотикон «:\», набранный как текст.
 * happy — вторая фаза «:)» для состояний «игра найдена» (матч, зашло).
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
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#16171d" />
      <circle cx="22" cy="25" r="5.5" fill="#f2f3f5" />
      <circle cx="22" cy="42" r="5.5" fill="#f2f3f5" />
      {happy ? (
        <path
          d="M36 22 q12 11.5 0 23"
          fill="none"
          stroke="#ff9e64"
          strokeWidth="9"
          strokeLinecap="round"
        />
      ) : (
        <line x1="36" y1="22" x2="46" y2="45" stroke="#ff9e64" strokeWidth="9" strokeLinecap="round" />
      )}
    </svg>
  )
}
