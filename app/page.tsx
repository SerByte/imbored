import { GameRibbon } from '@/components/landing/GameRibbon'
import { Compat } from '@/components/landing/scenes/Compat'
import { Engine } from '@/components/landing/scenes/Engine'
import { Hero } from '@/components/landing/scenes/Hero'
import { Money } from '@/components/landing/scenes/Money'
import { Pain } from '@/components/landing/scenes/Pain'
import { Repertoire } from '@/components/landing/scenes/Repertoire'
import { landingDemo } from '@/lib/landing'
import { ribbonGames, RIBBON_MAX, type RibbonSource } from '@/lib/ribbon'
import { topCatalogGames } from '@/lib/db'
import { getDb, nowSec } from '@/lib/server'

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
    </div>
  )
}
