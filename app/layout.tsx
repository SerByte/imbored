import { Analytics } from '@vercel/analytics/next'
import type { Metadata } from 'next'
import { JetBrains_Mono, Onest } from 'next/font/google'
import Link from 'next/link'
import { Footer } from '@/components/Footer'
import { LogoMark } from '@/components/Logo'
import { MobileNav } from '@/components/MobileNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Wordmark } from '@/components/Wordmark'
import './globals.css'

const onest = Onest({
  variable: '--font-onest',
  subsets: ['latin', 'cyrillic'],
})

const jbMono = JetBrains_Mono({
  variable: '--font-jbmono',
  subsets: ['latin', 'cyrillic'],
})

export const metadata: Metadata = {
  title: 'imbored — во что поиграть',
  description:
    'Подключи Steam — подберём игру под твоё настроение прямо сейчас: из бэклога, заброшенного или нового.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ru" className={`${onest.variable} ${jbMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans overflow-x-hidden pb-[52px] md:pb-0">
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('imbored-theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}`,
          }}
        />
        <header
          className="fixed top-0 inset-x-0 z-50"
          style={{ background: 'linear-gradient(to bottom, var(--header-fade), transparent)' }}
        >
          <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between">
            <Link href="/" className="text-lg flex items-center gap-2.5">
              <LogoMark size={22} />
              <Wordmark />
            </Link>
            <nav className="flex items-center gap-5 text-sm text-dim">
              {/* на телефоне пункты уезжают в нижнюю панель — в шапке остаётся только тема */}
              <span className="hidden md:flex items-center gap-5">
                <Link href="/daily" className="hover:text-ink transition-colors">
                  Игра дня
                </Link>
                <Link href="/quiz" className="hover:text-ink transition-colors">
                  Подобрать игру
                </Link>
                <Link href="/rooms" className="hover:text-ink transition-colors">
                  Пати
                </Link>
                <Link href="/compat" className="hover:text-ink transition-colors">
                  Совместимость
                </Link>
                <Link href="/library" className="hover:text-ink transition-colors">
                  Библиотека
                </Link>
              </span>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
        <Footer />
        <MobileNav />
        <Analytics />
      </body>
    </html>
  )
}
