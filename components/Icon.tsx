/**
 * Иконки «Премьеры» — один набор линий вместо россыпи глифов.
 *
 * До него состояние и действие показывали символы шрифта: ▾ ▴ ✓ ✕ ✖ 🚫 → ←.
 * Они разного веса, разной высоты и в каждом шрифте свои, а эмодзи ещё и
 * цветной — рядом с белой кнопкой он читался чужим. Здесь один штрих 2 px,
 * скругления и сетка 24×24; цвет — currentColor, размер — от кегля (1em).
 *
 * aria-hidden всегда: смысл несёт подпись кнопки или её aria-label, а не
 * картинка.
 */

const PATHS = {
  play: <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill="currentColor" stroke="none" />,
  next: (
    <>
      <path d="M5 5.5l6.5 6.5L5 18.5" />
      <path d="M12.5 5.5l6.5 6.5-6.5 6.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  hide: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.5 17.5l11-11" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  arrow: <path d="M5 12h13M13 6l6 6-6 6" />,
  back: <path d="M19 12H6M11 6l-6 6 6 6" />,
  down: <path d="M6 9.5l6 6 6-6" />,
  up: <path d="M6 14.5l6-6 6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
      <path d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.7 2 3 4.4" />
    </>
  ),
  spark: <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" />,
  heart: <path d="M12 19s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 2.4C19 14.6 12 19 12 19z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.8v.2" />
    </>
  ),
  refresh: (
    <>
      <path d="M19 12a7 7 0 1 1-2.1-5" />
      <path d="M19 4.5v4h-4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  home: <path d="M4.5 11l7.5-6.5 7.5 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-4V20H5.5a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  news: (
    <>
      <rect x="4" y="4.5" width="16" height="15" rx="2.5" />
      <path d="M8 9h8M8 12.5h8M8 16h5" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />,
  bolt: <path d="M13 3L5.5 13.5h5.5L10 21l7.5-10.5H12z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="8.75" cy="8.75" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="15.25" cy="15.25" r="1.35" fill="currentColor" stroke="none" />
    </>
  ),
  box: (
    <>
      <path d="M4 8l8-4 8 4v8.5L12 20.5 4 16.5z" />
      <path d="M4 8l8 4 8-4M12 12v8.5" />
    </>
  ),
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = '1em',
  className = '',
  strokeWidth = 2,
}: {
  name: IconName
  size?: number | string
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}
