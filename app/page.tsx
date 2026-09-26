import { GameRibbon } from '@/components/landing/GameRibbon'
import { SmoothScroll } from '@/components/SmoothScroll'
import { Compat } from '@/components/landing/scenes/Compat'
import { Engine } from '@/components/landing/scenes/Engine'
import { Hero } from '@/components/landing/scenes/Hero'
import { Money } from '@/components/landing/scenes/Money'
import { Pain } from '@/components/landing/scenes/Pain'
import { Repertoire } from '@/components/landing/scenes/Repertoire'
import { landingDemo } from '@/lib/landing'
import { ribbonGames, RIBBON_MAX, type RibbonSource } from '@/lib/ribbon'
import { topCatalogGames } from '@/lib/db'
import { ldScript, websiteJsonLd } from '@/lib/jsonld'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'
import { ownAddress } from '@/lib/site'

/**
 * ГЛАВНАЯ КАК ФИЛЬМ: ДОСТУП СРАЗУ, РАССКАЗ ПО ПРОКРУТКЕ.
 *
 * Здесь сошлись две главные, каждая из которых была права наполовину.
 *
 * Первая была одним полноэкранным кадром: логотип, одна фраза и форма входа.
 * Человек мог начать пользоваться продуктом с первой секунды — но не видел ни
 * одной карточки и решение отдавать библиотеку принимал вслепую.
 *
 * Вторая перевернула порядок: сначала показать работу конвейера, потом просить
 * доступ. Незнакомцу стало честно, а всем остальным — дальше: вошедшему,
 * приглашённому в пати и вернувшемуся из Steam с ?error= единственное действие
 * сайта отъехало на четыре секции вниз.
 *
 * Теперь оба порядка стоят одновременно. Первый экран — карточка подключения,
 * ниже шесть закреплённых сцен, которые прокрутка проигрывает одну за другой.
 * Спорить им не о чем: кто пришёл действовать, действует сразу; кто пришёл
 * разбираться, мотает вниз.
 *
 * СТРАНИЦА СЕРВЕРНАЯ И СТАТИЧЕСКАЯ. Ни cookies(), ни currentSteamId(), ни
 * пропа searchParams: любое из трёх сделало бы её динамической и перечеркнуло
 * весь смысл lib/sessionhint.ts, который существует ровно затем, чтобы узнавать
 * вошедшего без чтения кук на сервере. Всё, что зависит от адреса и сессии,
 * живёт за границами Suspense внутри героя.
 *
 * СЦЕНЫ — КЛИЕНТСКИЕ, И ЭТО НЕ ОТМЕНЯЕТ ПРЕДЫДУЩЕГО АБЗАЦА. Клиентский
 * компонент всё равно рендерится на сервере, и его текст уезжает в статическую
 * разметку; в клиентский рендер уходит только то, что стоит за границей
 * Suspense и читает адрес. Без JS страница остаётся обычным документом: шесть
 * секций подряд, работающая ссылка входа в Steam и весь текст на месте.
 *
 * ТЁМНАЯ ЦЕЛИКОМ. media-dark задаёт токены кино-зоны, media-full сообщает, что
 * зона — вся страница, и подвал красится вместе с ней (см. globals.css). Из
 * этого следует, что переключатель темы на главной визуально ничего не меняет,
 * и это ожидаемо: кинозал не бывает светлым.
 *
 * ISR на час: лента берёт обложки из каталога, а он меняется медленно.
 */
export const revalidate = 3600

/**
 * Canonical у главной — '/', без строки запроса.
 *
 * Сайт сам ссылается на варианты главной: bounceTo разворачивает гостя на
 * /?next=/library, совместимость зовёт на /?compat=<steamid>, комната — на
 * /?join=<код>. Страница статическая, запрос сервер не читает, содержимое у
 * всех вариантов одно — а без canonical каждый из них поисковик волен считать
 * отдельной страницей, в том числе адрес с чужим SteamID. Яндекс без
 * canonical склеивает такие дубли медленно.
 *
 * Заодно здесь живёт og:url главной: из корневого layout он ушёл, потому что
 * его наследовали все страницы подряд (см. ownAddress в lib/site.ts).
 * Статичности это не ломает: ownAddress читает только родительскую метадату.
 */
export const generateMetadata = ownAddress('/')

/**
 * Обложки для ленты.
 *
 * База может молчать: локально и в превью TURSO_DATABASE_URL не задан, и это
 * нормальное состояние, а не поломка (образец обработки — shelf() в
 * app/not-found.tsx). Пустая лента превратила бы кино-главную в чёрный экран,
 * поэтому отбор умеет добирать из зашитого списка — см. lib/ribbon.ts.
 */
async function ribbonForLanding() {
  let catalog: RibbonSource[] = []
  try {
    catalog = await topCatalogGames(await getDb(), RIBBON_MAX)
  } catch {
    catalog = []
  }
  return ribbonGames(catalog)
}

export default async function Home() {
  const demo = landingDemo(nowSec())
  const ribbon = await ribbonForLanding()

  return (
    <div className="media-dark media-full landing">
      {/*
        Сайт как сущность для поисковика: имя, адрес, язык. Статичности не
        мешает — appBaseUrl читает только окружение, как metadataBase корня.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ldScript(websiteJsonLd(appBaseUrl())) }}
      />
      {/*
        Лента уходит в портал у <body>: слой обязан быть fixed, а под плавной
        прокруткой fixed внутри содержимого цепляется к содержимому. Заодно
        она живёт ровно столько, сколько смонтирована главная.
      */}
      <GameRibbon games={ribbon} />

      <Hero />
      <Pain />
      <Engine demo={demo} />
      <Compat demo={demo} />
      <Repertoire />
      <Money />

      {/*
        Плавная прокрутка — ТОЛЬКО здесь. Закреплённые сцены (Stage) есть
        только у главной, а смузер на каждой странице стоил отдельного чанка
        в 129 КБ (gsap, ScrollTrigger, ScrollSmoother) и программной прокрутки
        на таче, где она спорила с системной инерцией. Уход с главной
        размонтирует компонент — смузер гасится, и дальше сайт едет нативно;
        заодно там снова работает position: sticky.
      */}
      <SmoothScroll />
    </div>
  )
}
