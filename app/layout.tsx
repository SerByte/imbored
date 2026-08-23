import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Onest, Sofia_Sans_Condensed } from 'next/font/google'
import Link from 'next/link'
import { ChromeZone } from '@/components/ChromeZone'
import { Footer } from '@/components/Footer'
import { LogoMark } from '@/components/Logo'
import { MobileNav } from '@/components/MobileNav'
import { MotionProvider } from '@/components/MotionProvider'
import { SessionKeeper } from '@/components/SessionKeeper'
import { SmoothScroll } from '@/components/SmoothScroll'
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
 * Дисплейный голос продукта.
 *
 * До этого его не было: заголовки набирались тем же Onest, что и текст, только
 * жирнее. Так набран черновик, а не продукт — у логотипа, титула экрана и
 * абзаца под ним был один и тот же голос, и разницу между ними приходилось
 * доказывать одним лишь весом.
 *
 * Почему именно узкий гротеск, а не второй широкий:
 *
 * 1. Функция, а не вкус. Интерфейс русский, а русская строка длиннее
 *    английской. Замерено в браузере на живых заголовках продукта
 *    («Сколько у тебя времени?», «Проверка совместимости», «Такой страницы
 *    нет»): при одном кегле Sofia Sans Condensed занимает 73% ширины Onest.
 *    Меньшая высота строчных компенсируется кеглем (x-height 45 против 53 при
 *    кегле 100), и даже с этой поправкой заголовок остаётся примерно на
 *    пятую часть уже. На телефоне это разница между двумя строками и тремя.
 *
 * 2. Пара, а не близнецы. Onest — широкий геометрический гротеск. Узкий рядом
 *    с ним читается как ДРУГОЙ голос с первого взгляда; ещё один широкий
 *    читался бы как сбой шрифта.
 *
 * 3. Кириллица здесь родная, а не досыпанная. Sofia Sans спроектирован
 *    lettersoup сразу под латиницу, греческий и кириллицу — это шрифт
 *    городской навигации Софии, отсюда узкие пропорции и большая высота
 *    строчных.
 *
 * preload включён (в отличие от моноширинного): начертание стоит в логотипе,
 * то есть в фиксированной шапке на КАЖДОЙ странице и всегда выше сгиба.
 * Раньше дисплейное начертание грузилось только в /whatsnew — см. историю
 * app/whatsnew/layout.tsx, откуда оно сюда и переехало.
 */
const sofia = Sofia_Sans_Condensed({
  variable: '--font-sofia',
  subsets: ['latin', 'cyrillic'],
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
   * Общая обвязка для мессенджеров и соцсетей. До неё её не было вовсе: две
   * личные страницы отдавали свой openGraph сами, а на всех остальных ссылках
   * — включая imbored.cc, который кидают чаще всего, — не было ни имени
   * сервиса, ни языка, ни типа. Telegram и Discord в таком случае показывают
   * голый домен вместо названия продукта.
   *
   * Картинку сюда НЕ пишем: её даёт app/opengraph-image.tsx, а файловая
   * метадата приоритетнее объекта metadata (см. docs/generate-metadata) — то
   * есть строка здесь была бы мёртвой и вводила бы в заблуждение при чтении.
   *
   * title/description намеренно не дублируются: Next подставляет в openGraph
   * те же значения, что и в обычные теги, когда они не заданы отдельно, — и
   * шаблон «%s · imbored» при этом работает и там.
   */
  openGraph: {
    type: 'website',
    siteName: 'imbored',
    locale: 'ru_RU',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
  },
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
      className={`${onest.variable} ${jbMono.variable} ${sofia.variable} h-full antialiased`}
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
      {/*
        Классы раскладки уехали с <body> на #smooth-content: между ними
        встала обёртка смузера, и без переноса подвал перестал прижиматься к
        низу — flex-контейнером остался бы <body>, а его прямым потомком
        стала обёртка, а не main.

        На <body> остаётся только то, что обязано быть на самом внешнем
        элементе: отступ под нижнюю панель и запрет горизонтальной прокрутки.
      */}
      <body className="min-h-full font-sans overflow-x-hidden pb-[calc(52px+env(safe-area-inset-bottom))] md:pb-0">
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

            Слоя два, и они кроссфейдятся. Растворяющийся градиент верен ровно
            там, где под шапкой стоит герой: он не режет кадр полосой. Но
            стоит уехать с героя на контент — и растворяться уже не над чем,
            а шов между фиксированной шапкой и текстом под ней нужен. Второй
            слой и есть этот шов: настоящая полка со стеклом и волоском.
            Переключением заведует components/ChromeZone.tsx.

            Стили классами, а не инлайном: инлайн нельзя перебить состоянием
            из CSS, а именно это здесь и требуется.
          */}
          <div aria-hidden className="site-chrome">
            <span className="site-chrome-fade" />
            <span className="site-chrome-bar" />
          </div>
          <div className="relative mx-auto max-w-6xl px-5 py-4 flex items-center justify-between">
            <Link href="/" className="text-xl flex items-center gap-2.5">
              <LogoMark size={24} />
              <Wordmark />
            </Link>
            <nav className="flex items-center gap-5 text-sm text-dim">
              {/* на телефоне пункты уезжают в нижнюю панель — в шапке остаётся только тема */}
              <span className="hidden md:flex items-center gap-5">
                <Link href="/daily" className="tap hover:text-ink transition-colors">
                  Игра дня
                </Link>
                <Link href="/quiz" className="tap hover:text-ink transition-colors">
                  Подобрать игру
                </Link>
                <Link href="/rooms" className="tap hover:text-ink transition-colors">
                  Пати
                </Link>
                <Link href="/whatsnew" className="tap hover:text-ink transition-colors">
                  Что нового
                </Link>
                <Link href="/compat" className="tap hover:text-ink transition-colors">
                  Совместимость
                </Link>
                <Link href="/library" className="tap hover:text-ink transition-colors">
                  Библиотека
                </Link>
              </span>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        {/*
          ОБЁРТКА ПЛАВНОЙ ПРОКРУТКИ. Стоит всегда, даже когда смузер не
          создаётся: условная разметка означала бы разные деревья на сервере и
          клиенте, а без смузера пара вложенных div ничего не делает.

          Шапка, нижняя панель и ссылка «к содержанию» остаются СНАРУЖИ и это
          не стилистика: смузер двигает содержимое трансформом, а трансформ
          создаёт новый containing block — position: fixed внутри него
          цепляется к содержимому вместо экрана. Правило сторожит
          lib/smoothfixed.test.ts.
        */}
        <div id="smooth-wrapper">
          <div id="smooth-content" className="min-h-full flex flex-col">
            <main id="main" className="flex-1 flex flex-col">
              <MotionProvider>{children}</MotionProvider>
            </main>
            <Footer />
          </div>
        </div>
        <MobileNav />
        {/* Продлевает вход. Клиентский и без разметки: лэйаут кук не читает,
            иначе весь сайт стал бы динамическим и ISR у /game/[appid] умер. */}
        {/* Ставит data-chrome на <html>, когда шапка уезжает с кино-зоны на
            контент. Клиентский и без разметки — как SessionKeeper. */}
        <ChromeZone />
        {/* Плавная прокрутка на весь сайт. Клиентский и без разметки. */}
        <SmoothScroll />
        <SessionKeeper />
        <Analytics />
      </body>
    </html>
  )
}
