import { describe, expect, test, vi } from 'vitest'
import {
  CCU_FAIL_STREAK,
  parseReleaseYear,
  parseReviewTooltip,
  parseSearchRows,
  pollPlayerCounts,
} from './ingest'

/**
 * Настоящая разметка store.steampowered.com/search/results/?infinite=1,
 * снятая 13.08.2026. Две строки: с отзывами и без.
 */
const SEARCH_HTML = `
<!-- List Items -->
<a href="https://store.steampowered.com/app/730/CounterStrike_2/?snr=1_7_7_230_150_1"
   data-ds-appid="730" data-ds-itemkey="App_730" data-ds-tagids="[1663,1774,3859,3878,19,5711,5055]"
   class="search_result_row ds_collapse_flag ">
  <div class="search_capsule"><img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/942c04ef/capsule_231x87.jpg?t=1784564069" ></div>
  <div class="responsive_search_name_combined">
    <div class="search_name ellipsis"><span class="title">Counter-Strike 2</span></div>
    <div class="search_platforms"><span class="platform_img win"></span><span class="platform_img linux"></span></div>
    <div class="search_released responsive_secondrow">Aug 21, 2012</div>
    <div class="search_reviewscore responsive_secondrow">
      <span class="search_review_summary positive" data-tooltip-html="Very Positive&lt;br&gt;86% of the 2,593,032 user reviews for this game are positive.&lt;br&gt;&lt;br&gt;The review score..."></span>
    </div>
    <div class="search_price_discount_combined responsive_secondrow" data-price-final="1499"></div>
  </div>
</a>
<a href="https://store.steampowered.com/app/999999/Novinka/?snr=1_7_7_230_150_1"
   data-ds-appid="999999" data-ds-tagids="[492]" class="search_result_row ds_collapse_flag ">
  <div class="responsive_search_name_combined">
    <div class="search_name ellipsis"><span class="title">Новинка без отзывов</span></div>
    <div class="search_released responsive_secondrow">Coming soon</div>
    <div class="search_price_discount_combined responsive_secondrow" data-price-final="0"></div>
  </div>
</a>
`

describe('parseSearchRows', () => {
  test('вытаскивает игру со всеми сигналами', () => {
    const rows = parseSearchRows(SEARCH_HTML)
    const cs = rows.find((r) => r.appid === 730)
    expect(cs).toBeDefined()
    expect(cs?.name).toBe('Counter-Strike 2')
    expect(cs?.tagids).toEqual([1663, 1774, 3859, 3878, 19, 5711, 5055])
    expect(cs?.releaseYear).toBe(2012)
    expect(cs?.reviewsTotal).toBe(2_593_032)
    expect(cs?.reviewsPercent).toBe(86)
    expect(cs?.priceFinal).toBe(1499)
  })

  test('игра без отзывов и без даты не теряется', () => {
    const rows = parseSearchRows(SEARCH_HTML)
    const novelty = rows.find((r) => r.appid === 999999)
    expect(novelty?.name).toBe('Новинка без отзывов')
    expect(novelty?.tagids).toEqual([492])
    expect(novelty?.reviewsTotal).toBeUndefined()
    expect(novelty?.releaseYear).toBeUndefined()
  })

  test('находит все строки страницы', () => {
    expect(parseSearchRows(SEARCH_HTML)).toHaveLength(2)
  })

  test('мусор и пустая страница не роняют разбор', () => {
    expect(parseSearchRows('')).toEqual([])
    expect(parseSearchRows('<div>ничего</div>')).toEqual([])
    // строка без appid пропускается, а не превращается в NaN
    expect(parseSearchRows('<a data-ds-tagids="[1]"><span class="title">X</span></a>')).toEqual([])
  })

  test('экранированные символы в названии раскодируются', () => {
    const html = `<a data-ds-appid="1" data-ds-tagids="[]"><span class="title">Tom &amp; Jerry&#39;s</span></a>`
    expect(parseSearchRows(html)[0].name).toBe("Tom & Jerry's")
  })
})

describe('parseReviewTooltip', () => {
  test('разбирает процент и число отзывов', () => {
    expect(
      parseReviewTooltip('Very Positive<br>86% of the 2,593,032 user reviews for this game are positive.'),
    ).toEqual({ percent: 86, total: 2_593_032 })
  })

  test('отсутствие отзывов даёт null, а не нули', () => {
    expect(parseReviewTooltip('Need more user reviews to generate a score')).toBeNull()
    expect(parseReviewTooltip('')).toBeNull()
  })
})

describe('parseReleaseYear', () => {
  test('берёт год из любой локали', () => {
    expect(parseReleaseYear('Aug 21, 2012')).toBe(2012)
    expect(parseReleaseYear('18 апр. 2011 г.')).toBe(2011)
    expect(parseReleaseYear('2019')).toBe(2019)
  })

  test('строка без года не выдумывает значение', () => {
    // «скоро» и пустая дата — обычное дело у анонсов
    expect(parseReleaseYear('Coming soon')).toBeUndefined()
    expect(parseReleaseYear('')).toBeUndefined()
    expect(parseReleaseYear('Q4')).toBeUndefined()
  })
})

describe('pollPlayerCounts', () => {
  const ids = [10, 20, 30, 40, 50, 60, 70, 80]

  test('здоровый Steam: онлайн каждой игры, ответ без числа — не отказ', async () => {
    const { counts, stopped } = await pollPlayerCounts(ids, {
      // у игры 30 статистики нет: Steam отвечает, но без player_count
      fetchOne: async (appid) => (appid === 30 ? undefined : appid * 10),
    })
    expect(stopped).toBe(false)
    expect(counts.map((c) => c.appid).sort((a, b) => a - b)).toEqual(ids.filter((id) => id !== 30))
    expect(counts.find((c) => c.appid === 20)?.ccu).toBe(200)
  })

  test(`${CCU_FAIL_STREAK} отказа подряд — новые запросы не начинаются`, async () => {
    const asked: number[] = []
    const { counts, stopped } = await pollPlayerCounts(ids, {
      concurrency: 1,
      fetchOne: async (appid) => {
        asked.push(appid)
        throw new Error('HTTP 429')
      },
    })
    expect(stopped).toBe(true)
    expect(counts).toEqual([])
    // Раньше отказ глотался, и все восемь уходили в Steam, который просит перестать
    expect(asked).toEqual([10, 20])
  })

  test('отказ, за которым удача, серию обнуляет', async () => {
    const flaky = new Set([10, 30, 50])
    const { counts, stopped } = await pollPlayerCounts(ids, {
      concurrency: 1,
      fetchOne: async (appid) => {
        if (flaky.has(appid)) throw new Error('обрыв')
        return 1
      },
    })
    expect(stopped).toBe(false)
    expect(counts.length).toBe(ids.length - flaky.size)
  })

  test('зависший ответ не держит остальных: параллельные опросы идут дальше', async () => {
    let release: () => void = () => {}
    const hung = new Promise<number>((r) => {
      release = () => r(1)
    })
    const done: number[] = []
    const run = pollPlayerCounts(ids, {
      concurrency: 4,
      fetchOne: async (appid) => {
        if (appid === 10) return hung
        done.push(appid)
        return 2
      },
    })
    // Первый воркер висит на игре 10, три других разбирают всё остальное
    await vi.waitFor(() => expect(done.length).toBe(ids.length - 1))
    release()
    const { counts } = await run
    expect(counts.length).toBe(ids.length)
  })

  test('после срока новые запросы не начинаются', async () => {
    let clock = 0
    const asked: number[] = []
    const { stopped } = await pollPlayerCounts(ids, {
      concurrency: 1,
      deadlineAt: 3,
      now: () => clock,
      fetchOne: async (appid) => {
        asked.push(appid)
        clock++
        return 1
      },
    })
    expect(stopped).toBe(true)
    expect(asked).toEqual([10, 20, 30])
  })

  test('пустой список — ни одного запроса', async () => {
    const { counts, stopped } = await pollPlayerCounts([], {
      fetchOne: async () => {
        throw new Error('не должен вызываться')
      },
    })
    expect({ counts, stopped }).toEqual({ counts: [], stopped: false })
  })
})
