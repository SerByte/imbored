import { describe, expect, test } from 'vitest'
import { parseReleaseYear, parseReviewTooltip, parseSearchRows } from './ingest'

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
