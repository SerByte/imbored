import { describe, expect, test } from 'vitest'
import {
  ASSET_BASE,
  artCandidates,
  buildAssetUrl,
  legacyHeaderUrl,
  parseStoreAssets,
} from './art'

/**
 * Живые ответы IStoreBrowseService/GetItems, снятые 12.08.2026.
 * PEAK — игра, у которой канонического header.jpg НЕ существует, только промо-вариант.
 */
const PEAK_ASSETS = {
  asset_url_format: 'steam/apps/3527290/${FILENAME}?t=1786470571',
  header: '89f65be18915d2dc5566de1de322379d62c1dcac/header_alt_assets_3.jpg',
  main_capsule: 'b233cb6e95308a74fb8dac2cfc1c1cfcf14a20d5/capsule_616x353_alt_assets_3.jpg',
  small_capsule: 'e8f91974f9a7469500fe1aed44a62c9467d328c9/capsule_231x87_alt_assets_3.jpg',
  library_capsule: '480bd879ac737921bfa2529a6fea15961267ad21/library_600x900.jpg',
}

const MECCHA_ASSETS = {
  asset_url_format: 'steam/apps/4704690/${FILENAME}?t=1785908480',
  header: '163e2a742e5fb8e1f5d1e3a890da98f04ab809d4/header.jpg',
  library_capsule: 'ac3c3c6d61e772101de5f95ac08b425e1b878ca8/library_capsule.jpg',
}

describe('buildAssetUrl', () => {
  test('подставляет имя файла в шаблон и добавляет канонический хост', () => {
    const url = buildAssetUrl(PEAK_ASSETS.asset_url_format, PEAK_ASSETS.header)
    expect(url).toBe(
      `${ASSET_BASE}steam/apps/3527290/89f65be18915d2dc5566de1de322379d62c1dcac/header_alt_assets_3.jpg?t=1786470571`,
    )
  })

  test('хэш у каждого ассета свой — капсула не переиспользует хэш заголовка', () => {
    const header = buildAssetUrl(PEAK_ASSETS.asset_url_format, PEAK_ASSETS.header)
    const capsule = buildAssetUrl(PEAK_ASSETS.asset_url_format, PEAK_ASSETS.main_capsule)
    expect(header).not.toBe(capsule)
    expect(capsule).toContain('b233cb6e95308a74fb8dac2cfc1c1cfcf14a20d5')
  })

  test('без шаблона или без имени файла ссылку не выдумывает', () => {
    expect(buildAssetUrl('', PEAK_ASSETS.header)).toBeNull()
    expect(buildAssetUrl(PEAK_ASSETS.asset_url_format, '')).toBeNull()
  })
})

describe('parseStoreAssets', () => {
  test('вытаскивает упорядоченные ссылки из ответа GetItems', () => {
    const urls = parseStoreAssets(PEAK_ASSETS)
    expect(urls[0]).toContain('header_alt_assets_3.jpg')
    expect(urls[1]).toContain('capsule_616x353')
    expect(urls).toHaveLength(4)
  })

  test('пропускает отсутствующие ассеты, сохраняя порядок деградации', () => {
    const urls = parseStoreAssets(MECCHA_ASSETS)
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('header.jpg')
    expect(urls[1]).toContain('library_capsule.jpg')
  })

  test('пустой или битый ответ даёт пустой список, а не мусорную ссылку', () => {
    expect(parseStoreAssets(undefined)).toEqual([])
    expect(parseStoreAssets({})).toEqual([])
    expect(parseStoreAssets({ header: 'x/header.jpg' })).toEqual([])
  })
})

describe('legacyHeaderUrl', () => {
  test('строит старый плоский путь для игр, у которых он ещё работает', () => {
    expect(legacyHeaderUrl(730)).toBe(
      'https://shared.steamstatic.com/store_item_assets/steam/apps/730/header.jpg',
    )
  })
})

describe('artCandidates', () => {
  test('сохранённая ссылка идёт первой — она уже резолвлена через API', () => {
    const urls = artCandidates({
      appid: 3527290,
      headerImage: `${ASSET_BASE}steam/apps/3527290/89f65be1/header_alt_assets_3.jpg`,
    })
    expect(urls[0]).toContain('header_alt_assets_3.jpg')
  })

  test('без сохранённой ссылки пробует легаси-шаблон — у старых игр он ещё жив', () => {
    // Порог по appid был бы хрупкой догадкой: граница у Valve плавающая.
    // Промах стоит одного запроса, а цепочка onError всё равно доводит до заглушки.
    expect(artCandidates({ appid: 730, headerImage: null })).toEqual([legacyHeaderUrl(730)])
    expect(artCandidates({ appid: 4704690, headerImage: null })).toEqual([
      legacyHeaderUrl(4704690),
    ])
  })

  test('не дублирует шаблон, если сохранённая ссылка это он и есть', () => {
    const urls = artCandidates({ appid: 730, headerImage: legacyHeaderUrl(730) })
    expect(urls).toEqual([legacyHeaderUrl(730)])
  })

  test('у не-Steam игры отрицательный appid — шаблон Steam не подставляется', () => {
    expect(artCandidates({ appid: -101, headerImage: null })).toEqual([])
    expect(artCandidates({ appid: -101, headerImage: 'https://cdn.example/fortnite.jpg' })).toEqual([
      'https://cdn.example/fortnite.jpg',
    ])
  })
})
