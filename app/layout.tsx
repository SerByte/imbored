import { Analytics } from '@vercel/analytics/next'
import type { Metadata } from 'next'
import { JetBrains_Mono, Onest } from 'next/font/google'
import Link from 'next/link'
import { Footer } from '@/components/Footer'
import { LogoMark } from '@/components/Logo'
import { MobileNav } from '@/components/MobileNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Wordmark } from '@/components/Wordmark'
import { appBaseUrl } from '@/lib/server'
import './globals.css'

const onest = Onest({
  variable: '--font-onest',
  subsets: ['latin', 'cyrillic'],
})

/**
 * Моноширинный нужен почти везде — но только для чисел: проценты, цены, коды
 * комнат, счётчики. Ни одного такого числа нет на первом экране, поэтому
 * preload выключен: файл догрузится к моменту, когда до цифр дойдёт дело, и не
 * будет соревноваться за полосу с основным шрифтом и обложками.
 */
const jbMono = JetBrains_Mono({
  variable: '--font-jbmono',
  subsets: ['latin', 'cyrillic'],
  preload: false,
})

export const metadata: Metadata = {
  // без metadataBase Next не может собрать абсолютные ссылки на og-картинки
  // и при динамическом рендере роняет их в относительные
  metadataBase: new URL(appBaseUrl()),
  // Шаблон, а не строка: без него страницы, у которых нет своего title,
  // молча наследовали этот — и пять разделов из восьми выглядели в выдаче
  // одной и той же страницей.
  title: {
    default: 'imbored — во что поиграть',
    template: '%s · imbored',
  },
  description:
    'Подключи Steam — подберём игру под твоё настроение прямо сейчас: из бэклога, заброшенного или нового.',
}

/**
 * suppressHydrationWarning на <html> — про атрибуты самого этого тега, и только
 * про них: флаг неглубокий и на детей не распространяется, так что настоящие
 * расхождения в разметке страниц он не спрячет.
 *
 * Источников расхождения ровно два, и оба правят <html> до того, как React
 * успевает гидратировать. Первый наш: скрипт темы ниже ставит data-theme ещё при
 * разборе документа, и у всех, кто сидит на светлой, сервер такого атрибута не
 * отдавал. Второй чужой: расширения вроде Dark Reader дописывают свои
 * data-darkreader-*.
 *
 * Ни то, ни другое React починить не может и не должен — атрибут выставлен
 * намеренно и раньше него.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="ru"
      suppressHydrationWarning
      className={`${onest.variable} ${jbMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          Весь игровой арт приложения лежит на CDN Steam, и первое же
          обращение к нему — это DNS, TLS и рукопожатие, которые начинались
          только после разбора разметки. Рукопожатие уезжает в самое начало
          загрузки, картинки приходят раньше на эту величину.
        */}
        <link rel="preconnect" href="https://shared.steamstatic.com" />
        <link rel="preconnect" href="https://shared.akamai.steamstatic.com" />
        <link rel="dns-prefetch" href="https://clan.fastly.steamstatic.com" />
      </head>
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
                <Link href="/whatsnew" className="hover:text-ink transition-colors">
                  Что нового
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
