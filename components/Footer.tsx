import Link from 'next/link'
import { navPrefetch } from '@/lib/nav'
import { LogoMark } from './Logo'
import { Wordmark } from './Wordmark'

export function Footer() {
  return (
    <footer className="relative mt-auto border-t border-edge/60">
      <div className="mx-auto max-w-6xl px-safe py-6 flex items-center justify-between gap-4 flex-wrap text-sm">
        <div className="flex items-center gap-2.5 text-faint">
          <LogoMark size={18} />
          <Wordmark className="text-base" />
          <span className="text-xs">· imbored.cc</span>
        </div>
        {/* Имя — чтобы в списке ориентиров это не было третьей безымянной
            «навигацией» рядом с меню разделов */}
        <nav aria-label="Служебные ссылки" className="flex items-center flex-wrap gap-x-5 gap-y-2 text-xs text-dim">
          {/* Хаб жанров — единственная ссылка отсюда, открытая гостю и
              краулеру: остальные разделы шапки и панели живут за входом.
              Страница на ISR, префетч с края ей ничего не стоит. */}
          <Link href="/games" className="tap tap-tight hover:text-ink transition-colors">
            Игры по жанрам
          </Link>
          <Link href="/support" className="tap tap-tight hover:text-ink transition-colors">
            Поддержать проект
          </Link>
          {/* Портрет и совместимость собираются на каждый запрос: префетч из
              подвала будил бы функцию на каждом просмотре любой страницы
              (подробно — lib/nav, DYNAMIC_SECTIONS) */}
          <Link
            href="/portrait"
            prefetch={navPrefetch('/portrait')}
            className="tap tap-tight hover:text-ink transition-colors"
          >
            Портрет игрока
          </Link>
          <Link
            href="/compat"
            prefetch={navPrefetch('/compat')}
            className="tap tap-tight hover:text-ink transition-colors"
          >
            Совместимость
          </Link>
          <Link href="/privacy" className="tap tap-tight hover:text-ink transition-colors">
            Конфиденциальность
          </Link>
        </nav>
      </div>
    </footer>
  )
}
