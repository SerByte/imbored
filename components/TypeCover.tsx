'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { OTHER_STORE_OF, otherStoreGenre } from '@/lib/storecover'
import { STORE_LABEL, STORE_TINT, STORE_TINT_DEFAULT } from '@/lib/stores'

/**
 * ТИПОГРАФСКАЯ ОБЛОЖКА — для игр не из Steam (lib/otherstores, appid < 0).
 *
 * Картинок у них нет вовсе: ни капсулы, ни постера, ни арта героя. Раньше на
 * их месте стояла серая заглушка с названием мелким шрифтом, и League of
 * Legends на полке выглядела сломанной карточкой. Теперь обложку собирает
 * само название — крупно, Manrope 800, — на свечении цвета магазина
 * (STORE_TINT), с меткой магазина и жанром: так выглядят титульные карточки
 * у стриминга, когда арта нет.
 *
 * variant="hero" — без текста: название героя и так стоит крупно поверх, а
 * под ним — размытый арт своей игры-ориентира (children), если он есть.
 *
 * Разметка без position: обложку зовут и с absolute (герой), и в потоке
 * (капсула, колода), а слои внутри складывает grid, а не абсолют.
 * aria-hidden — как alt="" у картинки: название рядом всегда написано текстом.
 *
 * Магазин и жанр — из lib/storecover, а не из пула lib/otherstores: обложка
 * едет в первую загрузку почти каждого маршрута, а пул — карточки целиком.
 * Жанр — на языке страницы (otherStoreGenre): подпись видна глазу, и на /en
 * «Королевская битва» поверх обложки была бы русским словом на английской
 * странице. Модуль клиентский ради useLocale — его и так зовут только
 * клиентские GameArt и герои /play и /daily.
 */
export function TypeCover({
  appid,
  name,
  variant = 'card',
  className = '',
  children,
}: {
  appid: number
  name: string
  variant?: 'card' | 'poster' | 'hero'
  className?: string
  /** Подложка под свечением — размытый арт игры-ориентира */
  children?: ReactNode
}) {
  const locale = useLocale()
  const store = OTHER_STORE_OF[appid]
  const tint = (store && STORE_TINT[store]) || STORE_TINT_DEFAULT
  const genre = otherStoreGenre(appid, locale)
  return (
    <div
      aria-hidden
      className={`type-cover type-cover-${variant} ${className}`}
      style={{ '--tc': tint } as CSSProperties}
    >
      {children}
      {variant !== 'hero' && (
        <span className="type-cover-text">
          {store && <span className="type-cover-store">{STORE_LABEL[store] ?? store}</span>}
          <span className="type-cover-title">
            <span className="type-cover-name">{name}</span>
            {genre && <span className="type-cover-genre">{genre}</span>}
          </span>
        </span>
      )}
    </div>
  )
}

/**
 * Постер игры не из Steam справа от текста героя /play и /daily.
 *
 * У игры Steam весь экран — её арт; у игры не из Steam фон — размытый
 * ориентир, и без постера на экране не было бы изображения самой игры.
 * Только с lg: уже текст героя занимает всю ширину. Позицию задаёт страница
 * (className) — по нижнему полю своей колонки текста.
 */
export function HeroPoster({ appid, name, className = '' }: { appid: number; name: string; className?: string }) {
  if (appid > 0) return null
  return (
    <div aria-hidden className={`hidden lg:block w-[clamp(200px,18vw,260px)] aspect-[2/3] ${className}`}>
      <TypeCover appid={appid} name={name} variant="poster" className="hero-poster h-full w-full" />
    </div>
  )
}
