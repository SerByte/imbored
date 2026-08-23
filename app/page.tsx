import Link from 'next/link'
import { Suspense } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { CinemaCollage } from '@/components/CinemaCollage'
import { HeroArt } from '@/components/HeroArt'
import { ConnectCard } from '@/components/landing/ConnectCard'
import { ConnectFallback } from '@/components/landing/ConnectFallback'
import { HeroNotice } from '@/components/landing/HeroNotice'
import { Primer } from '@/components/landing/Primer'
import { Eyebrow, MetaLine, SectionLabel } from '@/components/Labels'
import { SplitHeading } from '@/components/SplitHeading'
import { landingDemo } from '@/lib/landing'
import { plural } from '@/lib/plural'
import { topCatalogGames } from '@/lib/db'
import { getDb, nowSec } from '@/lib/server'

/**
 * ГЛАВНАЯ: ДОСТУП СРАЗУ, РАССКАЗ — НИЖЕ.
 *
 * Здесь сошлись две главные, и каждая была права наполовину.
 *
 * Первая была одним экраном: логотип, одна фраза и форма входа в Steam.
 * Человек, пришедший впервые, отдавал доступ к библиотеке, не увидев ни одной
 * карточки, — решение он принимал вслепую. Внутри при этом восемь
 * проработанных экранов, которых он не видел.
 *
 * Вторая перевернула порядок: сначала работа продукта на настоящем конвейере
 * («Так это выглядит»), потом то, что он ещё умеет, и только в конце касса с
 * формой. Незнакомцу стало честно — а всем остальным стало дальше. Вошедшему,
 * приглашённому в пати и вернувшемуся из Steam с ?error= единственное
 * действие сайта отъехало на четыре секции вниз; строку ошибки под формой при
 * этом не было видно вовсе, потому что Steam возвращает человека на верх
 * страницы.
 *
 * Теперь оба порядка стоят одновременно, и спорить им не о чем: карточка
 * подключения лежит в самом герое (доступ с первого кадра, включая демо без
 * Steam), а рассказ о продукте — ниже по прокрутке, для тех, кто ещё не
 * решил. Кнопка героя ведёт вниз, к рассказу; кнопка внизу — обратно к
 * карточке якорем #connect, а не второй её копией.
 *
 * ПРОКРУТКА НИЧЕГО НЕ АНИМИРУЕТ. Ни одна секция ниже не появляется, не едет и
 * не масштабируется от положения скролла: страница — это документ, который
 * читают, а не аттракцион. Единственное, что вообще следит здесь за
 * прокруткой, — components/ChromeZone.tsx, и он не двигает контент, а красит
 * шапку, чтобы её было видно над светлым фоном.
 *
 * СТРАНИЦА СЕРВЕРНАЯ И СТАТИЧЕСКАЯ. Ни cookies(), ни currentSteamId(), ни
 * пропа searchParams: любое из трёх сделало бы её динамической и перечеркнуло
 * весь смысл lib/sessionhint.ts, который существует ровно затем, чтобы
 * узнавать вошедшего без чтения кук на сервере. Всё, что зависит от адреса и
 * сессии, живёт в двух островках за границами Suspense — и только там, потому
 * что на предрендеренном маршруте всё дерево до ближайшей границы уходит в
 * клиентский рендер. Заголовок, стена, пятёрка и таблица обязаны лежать в
 * статическом HTML, поэтому островков ровно два и оба маленькие.
 *
 * ISR на час: постер героя берётся из каталога, а он меняется медленно.
 */
export const revalidate = 3600

/**
 * Постер героя — настоящая игра из каталога.
 *
 * База может молчать: локально и в превью TURSO_DATABASE_URL не задан, и это
 * нормальное состояние, а не поломка (образец обработки — shelf() в
 * app/not-found.tsx). Тогда за героем стоит коллаж, а кредит кадра не
 * печатается вовсе: строка-заглушка «КАДР · —» хуже её отсутствия.
 *
 * Постер ИЛИ коллаж, никогда оба: коллаж грузит восемнадцать обложек, постер —
 * одну широкую. Два источника фона разом удвоили бы первый экран ради того,
 * что лежит под скримом.
 */
async function heroPoster() {
  try {
    const [game] = await topCatalogGames(await getDb(), 1)
    return game ?? null
  } catch {
    return null
  }
}

/** Что ещё умеет продукт — расписанием, а не плиткой «фич». */
const REPERTOIRE = [
  {
    href: '/rooms',
    name: 'Пати',
    line: 'Создай комнату, кинь ссылку своим, свайпайте вместе: колода из общих игр, совпадут все голоса — матч.',
  },
  {
    href: '/compat',
    name: 'Совместимость',
    line: 'Кинь ссылку любому — сравним ваши библиотеки и часы по-настоящему, а не по анкете.',
  },
  {
    href: '/daily',
    name: 'Игра дня',
    line: 'Одна игра на день — завтра здесь будет другая. Покупать ничего не нужно.',
  },
  {
    href: '/library',
    name: 'Библиотека',
    line: 'Твоя библиотека глазами сервиса: заброшенное, нераспакованное, «открыл и закрыл» — одной стеной.',
  },
  {
    href: '/portrait',
    name: 'Портрет игрока',
    line: 'Куда ушло время, диагноз и чистилище — страницей, которой можно поделиться.',
  },
  {
    href: '/whatsnew',
    name: 'Что нового',
    line: 'Только крупные патчи по твоим играм. Мелкие правки — на странице игры.',
  },
]

export default async function Home() {
  const demo = landingDemo(nowSec())
  const poster = await heroPoster()

  return (
    <>
      {/*
        Кино-зона, но НЕ media-full: ниже начинается обычный контент, и подвал
        под ним обязан слушаться темы. Раньше главная была одним тёмным
        экраном на всю страницу — отсюда и класс, и он теперь неверен.

        id стоит на секции, а не на карточке: якорь снизу должен возвращать
        человека к ПЕРВОМУ ЭКРАНУ целиком — с заголовком и обещанием, — а не
        подрезать его так, чтобы над карточкой торчал обрубок кадра.

        items-center, а не md:items-end: прижимать содержимое к низу было верно,
        пока в герое стояли две строки текста и кино дышало сверху. С карточкой
        в 357 px содержимое встало бы в подвал кадра и упёрлось в кредит.
      */}
      <section
        id="connect"
        className="media-dark relative flex min-h-[100svh] items-center overflow-hidden"
      >
        {poster ? (
          <HeroArt
            appid={poster.appid}
            name={poster.name}
            headerImage={poster.headerImage}
            art={poster.art}
          />
        ) : (
          <CinemaCollage />
        )}

        {/* Скрим: титр читается, арт дышит по краям */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, color-mix(in srgb, var(--bg) 72%, transparent), color-mix(in srgb, var(--bg) 40%, transparent) 45%, var(--bg) 100%)',
          }}
        />
        <BlurBand height="46vh" dir="up" />
        <div aria-hidden className="grain" />

        {/*
          Титр и карточка — рядом, а не одно под другим через четыре секции.
          На телефоне колонки складываются, и порядок в разметке становится
          порядком на экране: сначала «во что ты вообще попал», сразу за ним —
          поле и кнопка.

          Замерено на 375×667 — самом маленьком экране, который стоит считать:
          подводка, заголовок и абзац занимают 316 px, карточка начинается на
          460, поле — на 484, парадная кнопка кончается на 594. То есть главное
          действие помещается в первый экран целиком, но с запасом всего в
          73 px — поэтому отступ сверху на мобильном на 16 px меньше
          десктопного (pt-28 против pt-32), и поэтому же абзац под заголовком
          не должен расти: пятая строка съест почти половину запаса.
        */}
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-28 md:pb-24 md:pt-32">
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-14">
            {/*
              Две колонки с lg, а не с md, и это замер, а не вкус. На 768 px
              правая колонка забирает свои 26rem, гэп — ещё 56, и титру
              остаётся 256: строка-подводка ломается на три строки, а заголовок
              в 48 px переносится по слогам. До 1024 px колонки складываются, и
              экран читается сверху вниз — как на телефоне.
            */}
            <div className="min-w-0 max-w-2xl">
              <Suspense fallback={null}>
                <HeroNotice />
              </Suspense>

              <Eyebrow tone="faint" className="mb-4">
                imbored — подбор игр по твоей библиотеке Steam
              </Eyebrow>

              {/* Ударное слово — третье: на нём фраза и заканчивается */}
              <SplitHeading as="h1" className="font-display text-display-lg" stress={2}>
                Открыл Steam. Полистал. Закрыл.
              </SplitHeading>

              <p className="mt-5 max-w-md text-lg leading-relaxed text-dim">
                Знакомо. Игр много, а зайти не во что. imbored смотрит на твою библиотеку и
                называет пять игр — с причиной, почему именно эти.
              </p>

              {/*
                Тихая строка, а не вторая парадная кнопка. Парадная на экране
                ровно одна, и она в карточке справа: две кнопки одного веса
                рядом — это два разных обещания и лишняя развилка там, где
                человек уже может просто начать.
              */}
              <a
                href="#primer"
                className="tap mt-6 inline-block text-sm text-dim underline decoration-edge underline-offset-4 transition-colors hover:text-ink"
              >
                Сначала посмотреть, как это работает ↓
              </a>
            </div>

            {/*
              ОСТРОВОК ПЕРВЫЙ ИЗ ДВУХ. ConnectCard читает адрес через
              useSearchParams, а на предрендеренном маршруте всё дерево до
              ближайшей границы Suspense уходит в клиентский рендер: в
              статический HTML попадает фолбэк. Поэтому граница обнимает
              карточку и только её — заголовок, стена и пятёрка обязаны лежать
              в статической разметке.

              Фолбэк здесь — не заглушка, а рабочая дверь: см. докблок
              components/landing/ConnectFallback.tsx. Он же держит высоту
              коробки, чтобы подмена не двигала первый экран.
            */}
            {/*
              justify-self здесь стоять НЕ ДОЛЖЕН, и это стоило одного дефекта.
              С md:justify-self-end элемент сетки перестаёт растягиваться и
              берёт ширину по содержимому: фолбэк с абзацем сноски занимал все
              416 px колонки, а карточка вошедшего — «С возвращением» и две
              строки — схлопывалась до 252. То есть коробку, высоту которой
              мы так старательно удержали, вместо этого дёргало по ширине.
            */}
            <div className="min-w-0">
              <Suspense fallback={<ConnectFallback />}>
                <ConnectCard />
              </Suspense>
            </div>
          </div>
        </div>

        {poster && (
          <Link
            href={`/game/${poster.appid}`}
            className="tap tap-tight absolute bottom-4 right-5 z-10"
          >
            <MetaLine tone="faint">Кадр · {poster.name}</MetaLine>
          </Link>
        )}
      </section>

      <Primer
        picks={demo.picks}
        wall={demo.wall}
        libraryCount={demo.libraryCount}
        libraryHours={demo.libraryHours}
      />

      {/* СОВМЕСТИМОСТЬ: то же самое — числами, а не обещанием */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 md:pb-28">
        <Eyebrow className="mb-3">Совместимость и пати</Eyebrow>
        <h2 className="font-display text-display-md">
          Сравним библиотеки по-настоящему, а не по анкете
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-dim">
          Демо-игрок и демо-друг: {demo.compat.rows.length}{' '}
          {plural(demo.compat.rows.length, 'общая игра', 'общие игры', 'общих игр')},{' '}
          {demo.compat.hours.toLocaleString('ru-RU')}{' '}
          {plural(demo.compat.hours, 'час', 'часа', 'часов')} на двоих. Часы настоящие — с
          обеих сторон.
        </p>

        <ul className="mt-8 flex max-w-2xl flex-col gap-1.5">
          {demo.compat.rows.map((r) => (
            <li key={r.name} className="glass flex items-baseline gap-4 rounded-[14px] px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-ember-text">
                {r.a.toLocaleString('ru-RU')}
              </span>
              <span className="shrink-0 text-xs text-faint">/</span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-dim">
                {r.b.toLocaleString('ru-RU')}
              </span>
            </li>
          ))}
        </ul>

        {/*
          Отказ от процента — самое убедительное, что здесь можно сказать.
          Он считается по редкости тегов во всём каталоге, а у гостя каталога
          нет: посчитанный на демо, он был бы красивым и неправдивым.
        */}
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-dim">
          Процент совпадения вкусов мы тут не показываем. Он считается по редкости тегов во всём
          каталоге, а не по этой паре, — на демо он был бы красивым и неправдой. Появится, когда
          обе библиотеки настоящие.
        </p>
      </section>

      {/* РЕПЕРТУАР */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 md:pb-28">
        <SectionLabel as="h2" className="mb-6">
          Что здесь ещё есть
        </SectionLabel>
        <ul className="flex flex-col">
          {REPERTOIRE.map((item, i) => (
            <li key={item.href} className="border-t border-edge last:border-b">
              <Link
                href={item.href}
                className="group flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4 transition-colors hover:text-ink"
              >
                <MetaLine tone="faint" className="w-6 shrink-0 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </MetaLine>
                <span className="font-display text-display-xs">{item.name}</span>
                {/* max-w-md — мера набора: без потолка строка расписания
                    растягивалась на 135 символов при комфортных 45–75. */}
                <span className="min-w-0 max-w-md flex-1 text-sm leading-relaxed text-dim">
                  {item.line}
                </span>
                <span
                  aria-hidden
                  className="ml-auto shrink-0 text-dim transition-transform group-hover:translate-x-1"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* О ДЕНЬГАХ */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 md:pb-28">
        <Eyebrow className="mb-3">О деньгах</Eyebrow>
        <p className="max-w-2xl font-display text-display-sm">
          Мы никогда не продаём места в выдаче. Рекомендация — это доверие, а доверие не продаётся.
        </p>
        <ul className="mt-6 flex max-w-xl flex-col gap-2 text-sm text-dim">
          <li>Рекламы в подборе нет.</li>
          <li>imbored бесплатен. И останется таким.</li>
          <li>Скидка — наклон, а не сортировка: витрину скидок ты и сам откроешь.</li>
        </ul>
        <p className="mt-6 text-xs text-faint">
          imbored — независимый проект, не связанный с Valve Corporation. Steam и логотип Steam —
          товарные знаки Valve Corporation.
        </p>
      </section>

      {/*
        ВОЗВРАТ, А НЕ ВТОРАЯ КАССА.

        Здесь стоял второй экземпляр карточки — и это было верно, пока
        карточка была единственной и лежала внизу. Теперь она в герое, а
        копия сломала бы ровно то, что карточка обещает: два
        <input id="steam-profile"> в одном документе — это сломанный label
        for и неуникальный id, а две парадные кнопки «Подобрать игру» — два
        разных обещания на одной странице.

        Поэтому внизу якорь. Он же единственный способ не соврать
        приглашённому: адрес входа собирается из ?join / ?compat / ?next, и
        голая ссылка «Войти через Steam» тут увела бы человека из пати ABC123
        на общий подбор. Логика назначения живёт в одном месте — в карточке.
      */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-24">
        <div className="glass flex flex-col gap-6 rounded-[20px] p-8 md:flex-row md:items-center md:justify-between md:p-10">
          <div className="max-w-md">
            <h2 className="font-display text-display-md">Подключим твою?</h2>
            <p className="mt-3 text-sm leading-relaxed text-dim">
              Дальше — три вопроса и пять карточек. Библиотека нужна затем же, зачем она нужна
              была выше: без неё подбирать не из чего. Не хочешь отдавать свою — на первом экране
              есть демо без Steam.
            </p>
          </div>
          <a
            href="#connect"
            className="shrink-0 rounded-[14px] bg-ember px-6 py-3 text-center font-semibold text-on-ember transition hover:brightness-110"
          >
            Наверх, к подключению ↑
          </a>
        </div>
      </section>
    </>
  )
}
