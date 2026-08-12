'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Нижняя панель навигации — только на телефоне; на десктопе меню в шапке */
const ITEMS = [
  { href: '/daily', label: 'Игра дня' },
  { href: '/quiz', label: 'Подбор' },
  { href: '/rooms', label: 'Пати' },
  { href: '/library', label: 'Библиотека' },
]

export function MobileNav() {
  const pathname = usePathname() ?? ''

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-edge backdrop-blur-xl"
      style={{
        background: 'var(--glass-bg)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`py-3.5 text-center text-[11px] transition-colors ${
                active ? 'text-ember font-semibold' : 'text-dim'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
