import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { artSrcSet, brokenImageSrc, legacyArtUrl, nextArtTry, PORTRAIT_HERO_MEDIA, type ArtTry } from './art'

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

/*
 * Постер отказал — назад к полосе героя. В проде у строк ключей poster нет,
 * и <source> героя /pick — плоская пара library_600x900, а плоских путей нет
 * у игр, вышедших после перехода Valve на хэшированные. 404 на неё приходит
 * раньше гидрации, а React вешает onError только при ней и уже случившуюся
 * ошибку не повторяет: без проверки при монтировании друг видел тёмный фон
 * вместо игры.
 */
describe('GameArt: отказ постера и кандидатов', () => {
  const APPID = 3892270
  const posterSet = artSrcSet({ appid: APPID, art }, 'poster')
  const start: ArtTry = { appid: APPID, idx: 0, posterFailed: false }
  const failed = (url: string, t: ArtTry = start) =>
    nextArtTry(t, { appid: APPID, idx: t.idx, url, posterSet })

  test('отказал постер — назад к library_hero того же кандидата, а не к капсуле', () => {
    for (const url of [legacyArtUrl(APPID, 'poster'), legacyArtUrl(APPID, 'poster2x')]) {
      expect(failed(url)).toEqual({ appid: APPID, idx: 0, posterFailed: true })
    }
  })

  test('отказала сама полоса — следующий кандидат', () => {
    expect(failed(HERO2X)).toEqual({ appid: APPID, idx: 1, posterFailed: false })
  })

  test('один отказ, услышанный дважды (onError и проверка после гидрации), — один шаг', () => {
    const once = failed(HERO)
    expect(nextArtTry(once, { appid: APPID, idx: 0, url: HERO, posterSet })).toBe(once)
    const poster = failed(legacyArtUrl(APPID, 'poster2x'))
    expect(failed(legacyArtUrl(APPID, 'poster2x'), poster)).toBe(poster)
  })

  test('отказ картинки прежней игры новую не трогает', () => {
    const next: ArtTry = { appid: 105600, idx: 0, posterFailed: false }
    expect(nextArtTry(next, { appid: APPID, idx: 0, url: HERO, posterSet })).toBe(next)
  })

  test('brokenImageSrc: отказ — только законченный запрос без пикселей', () => {
    const poster = legacyArtUrl(APPID, 'poster2x')
    expect(brokenImageSrc({ complete: true, naturalWidth: 0, currentSrc: poster })).toBe(poster)
    // грузится или ждёт очереди (loading="lazy")
    expect(brokenImageSrc({ complete: false, naturalWidth: 0, currentSrc: poster })).toBeNull()
    // загрузилась
    expect(brokenImageSrc({ complete: true, naturalWidth: 600, currentSrc: poster })).toBeNull()
    // без адреса complete тоже true, но отказываться не от чего
    expect(brokenImageSrc({ complete: true, naturalWidth: 0, currentSrc: '' })).toBeNull()
    expect(brokenImageSrc(null)).toBeNull()
  })

  /*
   * DOM в тестах нет (environment: 'node', jsdom в зависимостях нет), и
   * гидрацию здесь не прогнать. Сторож по тексту: проверка при монтировании
   * есть, идёт через тот же разбор, что onError, и не зависит от того, какой
   * кандидат сейчас на экране, — иначе она переспрашивала бы свежий запрос.
   */
  test('GameArt проверяет отказ при монтировании — тем же разбором, что onError', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'GameArt.tsx'), 'utf8')
    expect(src).toMatch(/const fail = \(url: string\) => setTried\(\(t\) => nextArtTry\(t, \{/)
    expect(src).toMatch(/onError=\{\(e\) => fail\(e\.currentTarget\.currentSrc\)\}/)
    const mount = src.indexOf('const url = brokenImageSrc(imgRef.current)')
    expect(mount, 'проверки при монтировании нет').toBeGreaterThan(0)
    const effect = src.slice(mount, src.indexOf('}, [', mount) + 6)
    expect(effect).toMatch(/failedBeforeMount\(url\)/)
    expect(effect.endsWith('}, [])'), 'проверка должна идти один раз, при монтировании').toBe(true)
    expect(src).toMatch(/const failedBeforeMount = useEffectEvent\(\(url: string\) => fail\(url\)\)/)
  })
})
