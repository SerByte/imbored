import Link from 'next/link'
import { LogoMark } from './Logo'
import { Wordmark } from './Wordmark'

export function Footer() {
  return (
    <footer className="relative mt-auto border-t border-edge/60">
      <div className="mx-auto max-w-6xl px-5 py-6 flex items-center justify-between gap-4 flex-wrap text-sm">
        <div className="flex items-center gap-2.5 text-faint">
          <LogoMark size={18} />
          <Wordmark className="text-sm" />
          <span className="text-xs">· imbored.cc</span>
        </div>
        <nav className="flex items-center flex-wrap gap-x-5 gap-y-2 text-xs text-dim">
          <Link href="/support" className="hover:text-ink transition-colors">
            Поддержать проект
          </Link>
          <Link href="/portrait" className="hover:text-ink transition-colors">
            Портрет игрока
          </Link>
          <Link href="/compat" className="hover:text-ink transition-colors">
            Совместимость
          </Link>
          <Link href="/privacy" className="hover:text-ink transition-colors">
            Конфиденциальность
          </Link>
        </nav>
      </div>
    </footer>
  )
}
