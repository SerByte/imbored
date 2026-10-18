import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { artSrcSet, legacyArtUrl, PORTRAIT_HERO_MEDIA } from './art'

/**
 * Герой с portrait: на стоячем экране — вертикальный постер, иначе полоса.
 *
 * library_hero — 1920×620, а герой /pick на телефоне — бокс 390×658:
 * object-cover вписывал полосу по высоте и показывал её пятую часть,
 * растянутую вдвое. Постер 2:3 в том же боксе виден почти целиком.
 * Правило живёт в разметке (<picture> и <source media>), без скрипта, —
 * его и проверяем; выбор файла делает браузер.
 */

const HERO = 'https://shared.steamstatic.com/store_item_assets/steam/apps/1145360/h/library_hero.jpg'
const HERO2X = 'https://shared.steamstatic.com/store_item_assets/steam/apps/1145360/h/library_hero_2x.jpg'
const art = { hero: HERO, hero2x: HERO2X, header: 'https://shared.steamstatic.com/h/header.jpg' }

const render = (props: Partial<Parameters<typeof GameArt>[0]>) =>
  renderToStaticMarkup(
    createElement(GameArt, {
      appid: 1145360,
      name: '',
      art,
      variant: 'hero',
      sizes: '100vw',
      eager: true,
      fetchPriority: 'high',
      ...props,
    }),
  )

describe('GameArt portrait', () => {
  test('стоячий экран берёт постер, остальные — полосу героя', () => {
    const html = render({ portrait: true })
    const posters = `${legacyArtUrl(1145360, 'poster')} 300w, ${legacyArtUrl(1145360, 'poster2x')} 600w`
    expect(html).toContain(
      `<picture class="contents"><source media="${PORTRAIT_HERO_MEDIA}" srcSet="${posters}" sizes="100vw"/>`,
    )
    // запасной <img> — прежний герой со своим srcSet и приоритетом
    expect(html).toMatch(new RegExp(`<img src="${HERO}" srcSet="${HERO} 1920w, ${HERO2X} 3840w" sizes="100vw"`))
    expect(html).toMatch(/fetchPriority="high"/)
  })

  test('без portrait — как раньше: одна картинка, без <picture>', () => {
    const html = render({})
    expect(html).not.toContain('<picture')
    expect(html).toMatch(/<img src=/)
  })

  test('не герой и не Steam — постера не просим', () => {
    expect(render({ portrait: true, variant: 'card', sizes: '200px' })).not.toContain('<picture')
    expect(render({ portrait: true, appid: -5, art: null, fallback: null })).not.toContain('<picture')
  })

  /*
   * В проде у строк каталога ключей poster в art_json нет — постер идёт
   * плоским путём library_600x900. Если artSrcSet перестанет его строить,
   * portrait молча выключится.
   */
  test('без постера в базе srcSet постера — плоская пара 300w/600w', () => {
    expect(artSrcSet({ appid: 2071280, art: { hero: HERO, hero2x: HERO2X } }, 'poster')).toBe(
      `${legacyArtUrl(2071280, 'poster')} 300w, ${legacyArtUrl(2071280, 'poster2x')} 600w`,
    )
  })
})
