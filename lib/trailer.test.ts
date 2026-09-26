import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { shotUrl } from './shots'
import {
  parseStoreScreenshots,
  parseStoreTrailer,
  readTrailer,
  STORE_SHOTS_MAX,
  VIDEO_BASE,
  type StoreScreenshots,
  type StoreTrailers,
} from './trailer'

/**
 * Настоящий ответ GetItems с include_trailers и include_screenshots, урезанный
 * до трёх кадров и трёх трейлеров: CS2 (обычный случай), HELLDIVERS 2 (первые
 * трейлеры за возрастным порогом), Left 4 Dead 2 (трейлеры только в
 * other_trailers), Half-Life (трейлеров нет, часть кадров за порогом), Team
 * Fortress 2, Terraria (у трейлера нет полного кадра).
 */
type FixtureItem = {
  appid: number
  screenshots?: StoreScreenshots & { mature_content_screenshots?: Array<{ filename: string }> }
  trailers?: StoreTrailers
}
const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__', 'getitems-media.json'), 'utf8'),
) as { response: { store_items: FixtureItem[] } }
const item = (appid: number) => {
  const it = FIXTURE.response.store_items.find((x) => x.appid === appid)
  if (!it) throw new Error(`в фикстуре нет ${appid}`)
  return it
}

describe('parseStoreTrailer', () => {
  test('микротрейлер, постер и HLS первого трейлера — на хостах Steam', () => {
    const t = parseStoreTrailer(item(730).trailers)
    expect(t).toEqual({
      mp4: `${VIDEO_BASE}730/612468/aa5a28c78f12232e6b6839034550c28b162fad3e/1748810724/microtrailer.mp4`,
      webm: `${VIDEO_BASE}730/612468/aa5a28c78f12232e6b6839034550c28b162fad3e/1748810724/microtrailer.webm`,
      poster:
        'https://shared.steamstatic.com/store_item_assets/steam/apps/256972298/movie_full.jpg?t=1696005467',
      hls: `${VIDEO_BASE}730/612468/aa5a28c78f12232e6b6839034550c28b162fad3e/1748810724/hls_264_master.m3u8`,
    })
  })

  test('трейлер за возрастным порогом пропускается — берётся первый для всех', () => {
    const hl = item(553850).trailers?.highlights ?? []
    expect(hl.map((h) => h.all_ages)).toEqual([false, false, true])
    const t = parseStoreTrailer(item(553850).trailers)
    const third = (hl[2].microtrailer ?? []).find((m) => m.type === 'video/mp4')
    expect(t?.mp4).toBe(VIDEO_BASE + String(third?.filename))
  })

  test('без highlights трейлер ищется среди остальных', () => {
    expect(item(550).trailers?.highlights).toBeUndefined()
    expect(parseStoreTrailer(item(550).trailers)?.mp4).toMatch(/^https:\/\/video\.akamai\.steamstatic\.com\/store_trailers\/550\//)
  })

  test('нет полного кадра — постер из среднего', () => {
    // так у старого трейлера Terraria в other_trailers
    const old = (item(105600).trailers?.other_trailers ?? []).find((t) => !t.screenshot_full)
    expect(old).toBeDefined()
    const t = parseStoreTrailer({ highlights: [old!] })
    expect(t?.poster).toMatch(/\/81300\/movie\.293x165\.jpg\?t=\d+$/)
  })

  test('нет трейлеров — null', () => {
    expect(parseStoreTrailer(item(70).trailers)).toBeNull()
    expect(parseStoreTrailer(undefined)).toBeNull()
    expect(parseStoreTrailer({})).toBeNull()
  })

  test('мусор и чужие пути не превращаются в ссылку', () => {
    const base = {
      trailer_url_format: 'steam/apps/${FILENAME}?t=1',
      screenshot_full: '1/movie_full.jpg',
      all_ages: true,
    }
    const bad = (filename: unknown) =>
      parseStoreTrailer({ highlights: [{ ...base, microtrailer: [{ filename, type: 'video/mp4' }] }] })
    expect(bad('https://evil.example/x.mp4')).toBeNull()
    expect(bad('../../evil/x.mp4')).toBeNull()
    expect(bad('/abs/x.mp4')).toBeNull()
    expect(bad(42)).toBeNull()
    // без mp4 трейлер не пишется: webm играет не каждый телефон
    expect(
      parseStoreTrailer({
        highlights: [{ ...base, microtrailer: [{ filename: '1/2/m.webm', type: 'video/webm' }] }],
      }),
    ).toBeNull()
    // all_ages должен быть именно true, а не «не false»
    expect(
      parseStoreTrailer({
        highlights: [{ ...base, all_ages: undefined, microtrailer: [{ filename: '1/m.mp4', type: 'video/mp4' }] }],
      }),
    ).toBeNull()
  })
})

describe('parseStoreScreenshots', () => {
  test('кадры получают размер в имени — как path_full у appdetails', () => {
    const shots = parseStoreScreenshots(item(730).screenshots)
    expect(shots).toHaveLength(3)
    expect(shots[0]).toBe(
      'https://shared.steamstatic.com/store_item_assets/steam/apps/730/9c8b8fd6ebb2c84a1c38541369e6c05db7f1fbe0/ss_9c8b8fd6ebb2c84a1c38541369e6c05db7f1fbe0.1920x1080.jpg?t=1789251637',
    )
    // ради этого размер и вписан: слайдер может взять лёгкий кадр
    expect(shotUrl(shots[0], 'small')).toContain('.600x338.jpg?t=')
  })

  test('старые числовые имена тоже — так лежат дальние кадры Team Fortress 2', () => {
    const shots = parseStoreScreenshots({
      all_ages_screenshots: [{ filename: 'steam/apps/440/0000002574.jpg?t=1757348372', ordinal: 4 }],
    })
    expect(shots).toEqual([
      'https://shared.steamstatic.com/store_item_assets/steam/apps/440/0000002574.1920x1080.jpg?t=1757348372',
    ])
  })

  test('кадры за возрастным порогом не берутся', () => {
    const it = item(70)
    const mature = it.screenshots?.mature_content_screenshots?.[0]?.filename ?? ''
    expect(mature).not.toBe('')
    const shots = parseStoreScreenshots(it.screenshots)
    expect(shots.some((s) => s.includes(mature.replace(/\.jpg.*$/, '')))).toBe(false)
  })

  test('порядок по ordinal, не больше STORE_SHOTS_MAX, размер не удваивается', () => {
    const list = Array.from({ length: 12 }, (_, i) => ({
      filename: `steam/apps/1/ss_${i}.jpg?t=5`,
      ordinal: 12 - i,
    }))
    list.push({ filename: 'steam/apps/1/ss_x.600x338.jpg', ordinal: 0 })
    const shots = parseStoreScreenshots({ all_ages_screenshots: list })
    expect(shots).toHaveLength(STORE_SHOTS_MAX)
    expect(shots[0]).toMatch(/ss_x\.600x338\.jpg$/)
    expect(shots[1]).toMatch(/ss_11\.1920x1080\.jpg\?t=5$/)
  })

  test('мусор — пустой список', () => {
    expect(parseStoreScreenshots(undefined)).toEqual([])
    expect(
      parseStoreScreenshots({
        all_ages_screenshots: [{ filename: '../x.jpg' }, { filename: 'steam/apps/1/video.mp4' }, {}],
      }),
    ).toEqual([])
  })
})

describe('readTrailer', () => {
  test('записанное читается обратно', () => {
    const t = parseStoreTrailer(item(730).trailers)
    expect(readTrailer(JSON.stringify(t))).toEqual(t)
  })

  test('чужой хост, http и битая строка — трейлера нет', () => {
    const ok = `${VIDEO_BASE}1/m.mp4`
    expect(readTrailer(JSON.stringify({ mp4: 'https://evil.example/m.mp4' }))).toBeUndefined()
    expect(readTrailer(JSON.stringify({ mp4: 'https://steamstatic.com.evil.example/m.mp4' }))).toBeUndefined()
    expect(readTrailer(JSON.stringify({ mp4: ok.replace('https:', 'http:') }))).toBeUndefined()
    expect(readTrailer(JSON.stringify({ mp4: 'javascript:alert(1)' }))).toBeUndefined()
    expect(readTrailer('{не json')).toBeUndefined()
    expect(readTrailer('"строка"')).toBeUndefined()
    expect(readTrailer(null)).toBeUndefined()
    // чужой постер отбрасывается, а сам трейлер остаётся
    expect(readTrailer(JSON.stringify({ mp4: ok, poster: 'https://evil.example/p.jpg' }))).toEqual({
      mp4: ok,
    })
  })
})

/**
 * Сторож «ничего без нажатия».
 *
 * Ролик весит 2–3 МБ, а на /play пятёрку листают руками: один autoPlay или
 * preload="auto" — и каждая пролистанная карточка стоит мегабайты трафика, а
 * фон под заголовком начинает двигаться без спроса. Атрибут poster у <video>
 * тоже нельзя: он качается сразу, мимо ленивой загрузки. Поведение в браузере
 * тестом не проверить, поэтому здесь текст — как у остальных сторожей
 * разметки.
 *
 * Единственный ролик без нажатия — фон героя (components/HeroTrailer), и он
 * запускается скриптом, а не атрибутом: после паузы на одной игре, только на
 * широком экране, без экономии трафика и без «уменьшить движение». Эти
 * условия сторож держит отдельно.
 */
describe('видео на страницах', () => {
  const ROOT = path.join(__dirname, '..')
  const videos: Array<{ file: string; tag: string }> = []

  /** Открывающий тег целиком: `=>` внутри {…} его не обрывает */
  const tagAt = (src: string, i: number): string => {
    let depth = 0
    for (let j = i; j < src.length; j++) {
      const c = src[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) return src.slice(i, j + 1)
    }
    return src.slice(i)
  }

  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx')) {
        // без комментариев: в них «<video>» — слово, а не разметка
        const src = readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        for (const m of src.matchAll(/<video\b/g)) {
          videos.push({
            file: path.relative(ROOT, p).split(path.sep).join('/'),
            tag: tagAt(src, m.index),
          })
        }
      }
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))

  test('сторож видит ролик трейлера', () => {
    expect(videos.map((v) => v.file)).toContain('components/TrailerPreview.tsx')
  })

  test('фон героя ждёт паузу и уважает движение, трафик и ширину', () => {
    const src = readFileSync(path.join(ROOT, 'components/HeroTrailer.tsx'), 'utf8')
    const wait = Number(/const WAIT_MS = ([\d_]+)/.exec(src)?.[1].replace(/_/g, ''))
    expect(wait).toBeGreaterThanOrEqual(2000)
    expect(src).toContain("'(prefers-reduced-motion: reduce)'")
    expect(src).toContain('saveData')
    expect(src).toContain("'(min-width: 768px)'")
    expect(src).toContain('IntersectionObserver')
    // WCAG 2.2.2: зацикленное движение обязано останавливаться
    expect(src).toMatch(/aria-pressed=\{stopped\}/)
  })

  test('без автоплея, без предзагрузки и без постера-атрибута', () => {
    for (const v of videos) {
      expect(v.tag, v.file).toMatch(/\bpreload="none"/)
      expect(v.tag, v.file).not.toMatch(/\bautoPlay\b/)
      expect(v.tag, v.file).not.toMatch(/\bposter=/)
      expect(v.tag, v.file).toMatch(/\bmuted\b/)
      expect(v.tag, v.file).toMatch(/\bplaysInline\b/)
    }
  })
})
