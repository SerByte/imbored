import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Onest } from 'next/font/google'
import Link from 'next/link'
import { Footer } from '@/components/Footer'
import { LogoMark } from '@/components/Logo'
import { MobileNav } from '@/components/MobileNav'
import { MotionProvider } from '@/components/MotionProvider'
import { SessionKeeper } from '@/components/SessionKeeper'
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

/**
 * viewportFit: 'cover' — без него env(safe-area-inset-bottom) на iOS всегда
 * равен нулю. То есть отступ под нижнюю панель, который в layout уже был
 * посчитан «с запасом на безопасную зону», по факту не срабатывал ни разу, и
 * на телефонах с домашней полоской панель уезжала под неё.
 *
 * themeColor двумя строками, а не одной: браузерная обвязка (адресная строка
 * в Chrome, статус-бар в PWA) должна совпадать с фоном страницы, а он у нас
 * зависит от темы. Одно значение красило бы шов при светлой теме тёмным.
 */
export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0c10' },
    { media: '(prefers-color-scheme: light)', color: '#f5f4f1' },
  ],
}

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
  /*
   * Общая карточка ссылки. Картинку подставляет app/opengraph-image.tsx и
   * наследуют все маршруты, у которых нет своей.
   *
   * До этого блока og-теги были ровно у трёх маршрутов, а у главной, /daily,
   * /whatsnew, /rooms и /quiz не было ни одного: ссылка на imbored.cc
   * разворачивалась в мессенджере голым адресом. Для сервиса, который
   * распространяется пересылкой ссылок, это было заметнее всего.
   *
   * title тут строкой, а не шаблоном: шаблон '%s · imbored' применяется к
   * title.default сам, а в openGraph Next подставит его же — дублировать
   * незачем.
   */
  openGraph: {
    type: 'website',
    siteName: 'imbored',
    locale: 'ru_RU',
    url: '/',
  },
  twitter: { card: 'summary_large_image' },
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
      <body className="min-h-full flex flex-col font-sans overflow-x-hidden pb-[calc(52px+env(safe-area-inset-bottom))] md:pb-0">
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('imbored-theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}`,
          }}
        />
        {/*
          Первое, что получает фокус на любой странице. Шапка — шесть ссылок
          подряд, и без этого до содержания страницы с клавиатуры нужно было
          протабать их все, на каждой странице заново.

          Видна только в фокусе: sr-only снимается на focus-visible.
          scroll-padding-top в globals.css нужен здесь же — иначе якорь
          уводит цель под фиксированную шапку.
        */}
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-[60] focus-visible:rounded-[14px] focus-visible:bg-ember focus-visible:px-4 focus-visible:py-2 focus-visible:text-on-ember focus-visible:font-semibold"
        >
          К содержанию
        </a>
        <header className="fixed top-0 inset-x-0 z-50">
          {/*
            Затемнение — отдельным слоем под содержимым, а не фоном самой шапки.

            Фоном оно и было, и потому наезжало: градиент гас к низу коробки, а
            логотип с навигацией стоят по её центру — там, где он уже
            наполовину растворился. Под ними проезжали заголовки строк, и на
            телефоне логотип ложился прямо на название игры.

            Слой выше коробки (h-[150%]) и гасится маской, поэтому граница не
            читается полосой, а размытие снимает остатки контраста, не пряча
            зону под собой: правило «шапка наследует то, над чем стоит»
            (см. --header-fade в globals.css) остаётся в силе — цвет по-прежнему
            берётся от зоны, а не назначается здесь.

            pointer-events-none обязателен: слой свисает ниже шапки и иначе
            перехватывал бы клики по строкам ленты.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[150%] backdrop-blur-[6px]"
            style={{
              background: 'linear-gradient(to bottom, var(--header-fade), transparent)',
              maskImage: 'linear-gradient(to bottom, #000 55%, transparent)',
              WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent)',
            }}
          />
          <div className="relative mx-auto max-w-6xl px-5 py-4 flex items-center justify-between">
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
        <main id="main" className="flex-1 flex flex-col">
          <MotionProvider>{children}</MotionProvider>
        </main>
        <Footer />
        <MobileNav />
        {/* Продлевает вход. Клиентский и без разметки: лэйаут кук не читает,
            иначе весь сайт стал бы динамическим и ISR у /game/[appid] умер. */}
        <SessionKeeper />
        <Analytics />
        {/* Полевые Web Vitals. На сайте, где LCP — это всегда чужая обложка со
            steamstatic, синтетика меряет не то: реальный разброс дают чужой CDN
            и чужая сеть, а не наш рендер. */}
        <SpeedInsights />
      </body>
    </html>
  )
}
