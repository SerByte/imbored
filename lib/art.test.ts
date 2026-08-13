import { describe, expect, test } from 'vitest'
import {
  ASSET_BASE,
  artCandidates,
  artSrcSet,
  buildAssetUrl,
  legacyArtUrl,
  parseStoreAssets,
} from './art'

/**
 * Живые ответы IStoreBrowseService/GetItems, снятые 12.08.2026.
 * PEAK — игра, у которой канонического header.jpg НЕ существует, только промо-вариант,
 * зато есть полный набор крупных ассетов.
 */
const PEAK_ASSETS = {
  asset_url_format: 'steam/apps/3527290/${FILENAME}?t=1786470571',
  header: '89f65be1/header_alt_assets_3.jpg',
  header_2x: '89f65be1/header_alt_assets_3_2x.jpg',
  main_capsule: 'b233cb6e/capsule_616x353_alt_assets_3.jpg',
  library_hero: 'd7518425/library_hero.jpg',
  library_hero_2x: 'd7518425/library_hero_2x.jpg',
}

/** Metro Exodus — старая игра: плоские пути и без 2x-вариантов. */
const METRO_ASSETS = {
  asset_url_format: 'steam/apps/412020/${FILENAME}?t=1750772804',
  header: 'header.jpg',
  main_capsule: 'capsule_616x353.jpg',
  library_hero: 'library_hero.jpg',
}

describe('buildAssetUrl', () => {
  test('подставляет имя файла в шаблон и добавляет канонический хост', () => {
    expect(buildAssetUrl(PEAK_ASSETS.asset_url_format, PEAK_ASSETS.header)).toBe(
      `${ASSET_BASE}steam/apps/3527290/89f65be1/header_alt_assets_3.jpg?t=1786470571`,
    )
  })

  test('без шаблона или без имени файла ссылку не выдумывает', () => {
    expect(buildAssetUrl('', PEAK_ASSETS.header)).toBeNull()
    expect(buildAssetUrl(PEAK_ASSETS.asset_url_format, '')).toBeNull()
  })
})

describe('parseStoreAssets', () => {
  test('собирает все размеры, а не только header', () => {
    const art = parseStoreAssets(PEAK_ASSETS)
    expect(art.header).toContain('header_alt_assets_3.jpg')
    expect(art.header2x).toContain('header_alt_assets_3_2x.jpg')
    expect(art.capsule).toContain('capsule_616x353')
    expect(art.hero).toContain('library_hero.jpg')
    expect(art.hero2x).toContain('library_hero_2x.jpg')
  })

  test('у каждого ассета свой хэш — они не переиспользуются', () => {
    const art = parseStoreAssets(PEAK_ASSETS)
    expect(art.hero).toContain('d7518425')
    expect(art.header).toContain('89f65be1')
  })

  test('отсутствующие размеры не выдумываются', () => {
    const art = parseStoreAssets(METRO_ASSETS)
    expect(art.hero).toContain('library_hero.jpg')
    expect(art.header2x).toBeUndefined()
    expect(art.hero2x).toBeUndefined()
  })

  test('пустой или битый ответ даёт пустую запись', () => {
    expect(parseStoreAssets(undefined)).toEqual({})
    expect(parseStoreAssets({})).toEqual({})
    expect(parseStoreAssets({ header: 'x/header.jpg' })).toEqual({})
  })
})

describe('legacyArtUrl', () => {
  test('строит плоский путь для игр, у которых он ещё работает', () => {
    expect(legacyArtUrl(730, 'header')).toBe(`${ASSET_BASE}steam/apps/730/header.jpg`)
    expect(legacyArtUrl(730, 'hero')).toBe(`${ASSET_BASE}steam/apps/730/library_hero.jpg`)
  })
})

describe('artCandidates', () => {
  const peak = { appid: 3527290, art: parseStoreAssets(PEAK_ASSETS) }

  test('герой берёт широкий library_hero, а не узкий header', () => {
    // Ровно тот баг, из-за которого экран «Игра дня» выглядел мылом:
    // 460×215 растягивалось на всю ширину экрана
    const [first] = artCandidates(peak, 'hero')
    expect(first).toContain('library_hero.jpg')
    expect(first).not.toContain('header')
  })

  test('карточка берёт header — тянуть 1920px в плитку незачем', () => {
    const [first] = artCandidates(peak, 'card')
    expect(first).toContain('header_alt_assets_3.jpg')
  })

  test('без резолва герой уходит на шаблон library_hero, а не на header', () => {
    const urls = artCandidates({ appid: 412020 }, 'hero')
    expect(urls[0]).toBe(legacyArtUrl(412020, 'hero'))
    expect(urls).toContain(legacyArtUrl(412020, 'header'))
  })

  test('деградация героя доходит до карточных размеров', () => {
    const onlyHeader = { appid: 1, art: { header: 'https://cdn.example/h.jpg' } }
    expect(artCandidates(onlyHeader, 'hero')).toContain('https://cdn.example/h.jpg')
  })

  test('сохранённый header_image используется, когда записи ассетов ещё нет', () => {
    const urls = artCandidates({ appid: 730, headerImage: 'https://cdn.example/old.jpg' }, 'card')
    expect(urls[0]).toBe('https://cdn.example/old.jpg')
  })

  test('у не-Steam игры отрицательный appid — шаблоны Steam не подставляются', () => {
    expect(artCandidates({ appid: -101 }, 'hero')).toEqual([])
    expect(artCandidates({ appid: -101, headerImage: 'https://cdn.example/f.jpg' }, 'card')).toEqual(
      ['https://cdn.example/f.jpg'],
    )
  })

  test('дубликатов в цепочке нет', () => {
    const urls = artCandidates({ appid: 730, headerImage: legacyArtUrl(730, 'header') }, 'card')
    expect(urls).toEqual([...new Set(urls)])
  })
})

describe('artSrcSet', () => {
  const peak = { appid: 3527290, art: parseStoreAssets(PEAK_ASSETS) }

  test('герой описывается шириной, чтобы браузер сам выбрал по экрану', () => {
    const set = artSrcSet(peak, 'hero')
    expect(set).toContain('1920w')
    expect(set).toContain('3840w')
  })

  test('карточка предлагает retina-вариант', () => {
    const set = artSrcSet(peak, 'card')
    expect(set).toContain('460w')
    expect(set).toContain('920w')
  })

  test('когда второго размера нет, srcSet не строится', () => {
    const metro = { appid: 412020, art: parseStoreAssets(METRO_ASSETS) }
    expect(artSrcSet(metro, 'hero')).toBeUndefined()
    expect(artSrcSet(metro, 'card')).toBeUndefined()
    expect(artSrcSet({ appid: 1 }, 'hero')).toBeUndefined()
  })
})
