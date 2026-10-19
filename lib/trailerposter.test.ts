import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { SMALL_POSTER_MEDIA, TrailerPreview } from '@/components/TrailerPreview'
import { pickShotSize } from './shots'

/**
 * Постер трейлера на телефоне — кадр 600×338, а не movie_full.
 *
 * movie_full — 1920×1080 на 110–453 КБ, а бокс на телефоне ~370 CSS px. Блок
 * «В движении» стоит сразу под героем карточки игры, внутри дистанции
 * ленивой загрузки, и постер качался со стартом страницы рядом с её
 * LCP-картинкой: на проде 426 КБ на /game/1086940. Откатить правку легко и
 * незаметно — постер рисуется так же, просто тяжелее, — поэтому здесь
 * разметка и порог.
 */

const FULL = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/movie_full.jpg'
const SMALL = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_a.600x338.jpg'
const trailer = { mp4: 'https://video.akamai.steamstatic.com/store_trailers/1/m.mp4', poster: FULL }

const render = (smallPoster?: string) =>
  renderToStaticMarkup(createElement(TrailerPreview, { trailer, name: 'Игра', smallPoster }))

describe('постер трейлера', () => {
  test('телефону — маленький кадр через <source media>, остальным — полный', () => {
    const html = render(SMALL)
    expect(html).toContain(`<source media="${SMALL_POSTER_MEDIA}" srcSet="${SMALL}"/>`)
    // запасной <img> — полный кадр ролика: его берут планшет и десктоп
    expect(html).toMatch(new RegExp(`<img src="${FULL}"[^>]*loading="lazy"`))
    // не srcSet по ширине: телефон с DPR 2.6 по дескрипторам выбрал бы 1920
    expect(html).not.toMatch(/<img[^>]*srcSet=/)
  })

  test('без скриншотов — полный кадр, как раньше', () => {
    const html = render()
    expect(html).not.toContain('<source media=')
    expect(html).toContain(`src="${FULL}"`)
  })

  /*
   * Порог — тот же, что у слайдера скриншотов: маленький кадр, пока бокс
   * × DPR (до двух) не больше 900. Бокс — окно минус поля px-5 (40 px).
   */
  test('порог медиа-условия совпадает с выбором размера кадра в lib/shots', () => {
    const px = Number(SMALL_POSTER_MEDIA.match(/max-width:\s*(\d+)px/)?.[1])
    expect(pickShotSize(px - 40, 2)).toBe('small')
    expect(pickShotSize(px + 1 - 40, 2)).toBe('full')
  })

  test('карточка игры отдаёт телефону маленький первый скриншот', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'app', '[lang]', 'game', '[appid]', 'page.tsx'), 'utf8')
    expect(page).toMatch(/smallPoster=\{meta\.screenshots\?\.\[0\] \? shotUrl\(meta\.screenshots\[0\], 'small'\) : undefined\}/)
  })
})
