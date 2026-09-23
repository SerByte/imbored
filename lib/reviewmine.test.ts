import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  LANES,
  mineReviews,
  normalizeReviewText,
  parseReviewsRaw,
  type Lane,
  type RawReview,
} from './reviewmine'
import { parseReviews } from './reviews'

function review(text: string, over: Partial<RawReview> = {}): RawReview {
  return {
    id: text,
    text,
    lang: /[а-яё]/i.test(text) ? 'ru' : 'en',
    votedUp: true,
    votesUp: 0,
    playtimeAtReview: 600,
    playtimeForever: 600,
    ...over,
  }
}

/** Какие полосы зажёг один отзыв */
function lanesOf(text: string): Lane[] {
  const m = mineReviews([review(text)])
  return LANES.filter((lane) => m.lanes[lane].count > 0)
}

describe('parseReviewsRaw', () => {
  const RESPONSE = {
    success: 1,
    reviews: [
      {
        recommendationid: 'r1',
        language: 'english',
        review: 'Great',
        voted_up: true,
        votes_up: 5,
        author: { playtime_at_review: 600, playtime_forever: 900 },
      },
      {
        recommendationid: 'r2',
        language: 'russian',
        review: 'наиграл 10 минут, зря',
        voted_up: false,
        votes_up: 3,
        author: { playtime_at_review: 10, playtime_forever: 10 },
      },
      { recommendationid: 'r2', language: 'russian', review: 'дубль' },
      { recommendationid: 'r3', language: 'german', review: 'Sehr gut', voted_up: true },
      { recommendationid: 'r4', review: 'Без поля языка, но по-русски' },
      { recommendationid: 'r5', review: 'No language field, plain English' },
      { review: 'без id не берём' },
    ],
  }

  test('берёт все отзывы, включая короткие негативы, которые parseReviews отбрасывает', () => {
    const raw = parseReviewsRaw(RESPONSE)!
    expect(raw.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
    expect(raw[1]).toMatchObject({ votedUp: false, votesUp: 3, playtimeAtReview: 10, playtimeForever: 10 })
    // тот же ответ через фильтр pros/cons: негатив на 10 минутах пропал
    expect(parseReviews(RESPONSE)!.reviews.map((r) => r.id)).toEqual(['r1'])
  })

  test('язык — из поля Steam, а без него — по кириллице и латинице', () => {
    const raw = parseReviewsRaw(RESPONSE)!
    expect(raw.map((r) => r.lang)).toEqual(['en', 'ru', 'other', 'ru', 'en'])
  })

  test('success != 1 и мусор дают null, пустой список — пустой ответ', () => {
    expect(parseReviewsRaw({ success: 2 })).toBeNull()
    expect(parseReviewsRaw(null)).toBeNull()
    expect(parseReviewsRaw('oops')).toBeNull()
    expect(parseReviewsRaw({ success: 1 })).toEqual([])
    expect(parseReviewsRaw({ success: 1, reviews: 'nope' })).toEqual([])
  })

  test('нечисловые голоса и минуты становятся нулём, а не NaN', () => {
    const raw = parseReviewsRaw({
      success: 1,
      reviews: [
        { recommendationid: 'x', review: 'ok', votes_up: 'many', author: { playtime_at_review: null } },
      ],
    })!
    expect(raw[0]).toMatchObject({ votesUp: 0, playtimeAtReview: 0, playtimeForever: 0, votedUp: false })
  })
})

describe('normalizeReviewText', () => {
  test('снимает BBCode и ссылки, ё → е, апострофы прямые, перевод строки — конец фразы', () => {
    expect(
      normalizeReviewText('[h1]Ёлка[/h1] [url=https://x.y]сайт[/url] https://foo.bar/baz It’s\nNEW'),
    ).toBe('елка сайт it\'s. new')
  })
})

describe('полосы', () => {
  const CATCHES: Record<Lane, string[]> = {
    shortSession: [
      'perfect for quick sessions',
      'pick-up-and-play',
      'great for a coffee break',
      'пару каток вечером',
      'зашёл на полчаса',
      'короткие забеги',
    ],
    longSession: [
      'one more turn syndrome',
      'hours fly by',
      "I can't put it down",
      'не оторваться',
      'ещё один ход',
      'просидел всю ночь',
    ],
    slowStart: [
      'slow start but worth it',
      'takes a while to get into',
      'долго раскачивается',
      'затянутое обучение',
      'it gets good after 10 hours',
      'через 5 часов становится интересно',
    ],
    hard: ['very punishing', 'souls-like combat', 'insanely hard', 'очень сложная', 'хардкорная'],
    relaxing: ['so relaxing', 'cozy vibes', 'wholesome', 'уютная', 'расслабляющая', 'медитативная'],
    complex: ['steep learning curve', 'keep the wiki open', 'много механик', 'высокий порог входа'],
    grind: ['too grindy', 'repetitive', 'гринд', 'однообразная'],
    story: ['great story', 'the plot twist', 'сюжет', 'персонажи'],
    bugs: ['buggy mess', 'crashes constantly', 'лагает', 'вылетает', 'ужасная оптимизация'],
  }

  for (const lane of LANES) {
    test(`${lane} ловит свои фразы`, () => {
      for (const phrase of CATCHES[lane]) expect(lanesOf(phrase), phrase).toContain(lane)
    })
  }

  test('простое отрицание гасит фразу — по-английски и по-русски', () => {
    expect(lanesOf('not relaxing at all')).not.toContain('relaxing')
    expect(lanesOf("it isn't very hard")).not.toContain('hard')
    expect(lanesOf('не расслабляет')).not.toContain('relaxing')
    expect(lanesOf('совсем не сложная')).not.toContain('hard')
    expect(lanesOf('ни капли не сложная')).not.toContain('hard')
    expect(lanesOf('no bugs')).not.toContain('bugs')
    expect(lanesOf('without any bugs')).not.toContain('bugs')
    expect(lanesOf('без багов')).not.toContain('bugs')
    expect(lanesOf('багов нет')).not.toContain('bugs')
    expect(lanesOf('лагов не было')).not.toContain('bugs')
  })

  test('отрицание не перепрыгивает запятую и не трогает «not only»', () => {
    expect(lanesOf('not great, but relaxing')).toContain('relaxing')
    expect(lanesOf('not only relaxing but deep')).toContain('relaxing')
    expect(lanesOf('не только уютная, но и сложная')).toContain('relaxing')
  })

  test('отрицание дальше трёх слов уже не отрицание', () => {
    expect(lanesOf('I did not expect this game to be so relaxing')).toContain('relaxing')
  })

  test('границы слов юникодные: части слов и соседние значения не ловятся', () => {
    expect(lanesOf('несложная игра')).not.toContain('hard')
    expect(lanesOf('сложно сказать, стоит ли')).not.toContain('hard')
    expect(lanesOf('летний лагерь')).not.toContain('bugs')
    expect(lanesOf('bug-free experience')).not.toContain('bugs')
    expect(lanesOf('the difficulty options are nice')).not.toContain('hard')
    expect(lanesOf('it gave me chills')).not.toContain('relaxing')
  })

  test('слова пишутся узко там, где широкое слово врёт', () => {
    // hard drive — не сложность; хорошая оптимизация — не баг; «I'm writing» — не сюжет
    expect(lanesOf('needs a fast hard drive')).not.toContain('hard')
    expect(lanesOf('отличная оптимизация')).not.toContain('bugs')
    expect(lanesOf("I'm writing this review")).not.toContain('story')
  })
})

describe('время до веселья', () => {
  const ttf = (...texts: string[]) => mineReviews(texts.map((t, i) => review(t, { id: `t${i}` })))

  test('число рядом с глаголом перелома — по-английски и по-русски', () => {
    expect(ttf('it gets good after 10 hours').timeToFunHours).toBe(10)
    expect(ttf('after an hour it clicks').timeToFunHours).toBe(1)
    expect(ttf('after the first few hours it gets better').timeToFunHours).toBe(3)
    expect(ttf('the first 2 hours are slow').timeToFunHours).toBe(2)
    expect(ttf('через 5 часов становится интересно').timeToFunHours).toBe(5)
    expect(ttf('игра раскрывается только после 10 часов').timeToFunHours).toBe(10)
    expect(ttf('первые 3 часа скучные').timeToFunHours).toBe(3)
    expect(ttf('через полчаса затягивает').timeToFunHours).toBe(0.5)
    expect(ttf('через час затягивает').timeToFunHours).toBe(1)
    expect(ttf('clicks after 30 minutes').timeToFunHours).toBe(0.5)
  })

  test('диапазон берётся серединой, несколько отзывов — медианой', () => {
    expect(ttf('it gets good after 10-20 hours').timeToFunHours).toBe(15)
    const m = ttf(
      'it gets good after 2 hours',
      'через 10 часов становится интересно',
      'first 4 hours are boring',
    )
    expect(m.timeToFunHours).toBe(4)
    expect(m.timeToFunMentions).toBe(3)
  })

  test('время до скуки и похвальба наигранным — не время до веселья', () => {
    expect(ttf('gets boring after 10 hours').timeToFunHours).toBeNull()
    expect(ttf('after 10 hours it gets repetitive').timeToFunHours).toBeNull()
    expect(ttf('начинает надоедать через 10 часов').timeToFunHours).toBeNull()
    expect(ttf('через 10 часов становится скучно').timeToFunHours).toBeNull()
    expect(ttf('after 300 hours it still gets better').timeToFunHours).toBeNull()
    expect(ttf('after a huge update it got better').timeToFunHours).toBeNull()
    expect(ttf('after 10 hours of downloading').timeToFunHours).toBeNull()
  })

  test('названное число от часа — медленный старт, даже без слов из словаря', () => {
    expect(lanesOf('игра раскрывается только после 10 часов')).toContain('slowStart')
    expect(lanesOf('clicks after 30 minutes')).not.toContain('slowStart')
  })
})

describe('mineReviews', () => {
  test('пустой вход — нули и null, без NaN', () => {
    const m = mineReviews([])
    expect(m.n).toBe(0)
    expect(m.timeToFunHours).toBeNull()
    expect(m.playtime).toEqual({ total: 0, medianPosMin: null, medianNegMin: null, negShortShare: null })
    for (const lane of LANES) {
      expect(m.lanes[lane]).toEqual({ count: 0, weighted: 0, share: 0, sharePos: 0, shareNeg: 0 })
    }
  })

  test('доли — по весу 1 + log1p(голосов), отдельно у позитивных и негативных', () => {
    const m = mineReviews([
      review('very punishing', { id: 'a', votesUp: 100 }),
      review('nice art', { id: 'b', votesUp: 0 }),
      review('too hard, refunded', { id: 'c', votedUp: false, votesUp: 0 }),
      review('meh', { id: 'd', votedUp: false, votesUp: 0 }),
    ])
    const wa = 1 + Math.log1p(100)
    expect(m.n).toBe(4)
    expect(m.lanes.hard.count).toBe(2)
    expect(m.lanes.hard.weighted).toBeCloseTo(wa + 1)
    expect(m.lanes.hard.share).toBeCloseTo((wa + 1) / (wa + 3))
    expect(m.lanes.hard.sharePos).toBeCloseTo(wa / (wa + 1))
    expect(m.lanes.hard.shareNeg).toBeCloseTo(0.5)
  })

  test('отзывы на других языках и пустые в знаменатель не идут, в наигранное — идут', () => {
    const m = mineReviews([
      review('very punishing', { id: 'a' }),
      review('很难但是很好玩', { id: 'b', lang: 'other', playtimeAtReview: 60 }),
      review('', { id: 'c', lang: 'en', votedUp: false, playtimeAtReview: 30 }),
    ])
    expect(m.n).toBe(1)
    expect(m.lanes.hard.share).toBe(1)
    expect(m.playtime.total).toBe(3)
    expect(m.playtime.medianPosMin).toBe(330)
    expect(m.playtime.negShortShare).toBe(1)
  })

  test('статистика наигранного: медианы и доля коротких негативов', () => {
    const m = mineReviews([
      review('a', { id: '1', playtimeAtReview: 100 }),
      review('b', { id: '2', playtimeAtReview: 300 }),
      review('c', { id: '3', playtimeAtReview: 500 }),
      review('d', { id: '4', votedUp: false, playtimeAtReview: 30 }),
      review('e', { id: '5', votedUp: false, playtimeAtReview: 90 }),
      review('f', { id: '6', votedUp: false, playtimeAtReview: 400 }),
      review('g', { id: '7', votedUp: false, playtimeAtReview: 1000 }),
    ])
    expect(m.playtime.medianPosMin).toBe(300)
    expect(m.playtime.medianNegMin).toBe(245)
    expect(m.playtime.negShortShare).toBe(0.5)
  })

  test('детерминизм: тот же вход — тот же выход до бита', () => {
    const input = [
      review('very punishing, slow start', { id: 'a', votesUp: 7 }),
      review('уютная, пару каток', { id: 'b', votesUp: 2 }),
      review('it gets good after 10 hours', { id: 'c', votedUp: false }),
    ]
    expect(mineReviews(input)).toEqual(mineReviews(input.map((r) => ({ ...r }))))
  })
})

/*
 * Фикстуры — ответы appreviews целиком, в том виде, в каком их видит крон.
 * Настоящие скачивает владелец (npm run reviews:fixtures): в CI сети нет.
 * synthetic.json написан руками и держит проверки ниже живыми, пока настоящих
 * нет. Для настоящих проверяются только инварианты и одно сравнение, которое
 * обязано выполняться на любой выборке: Hollow Knight сложнее Stardew Valley,
 * а Stardew уютнее.
 */
const FIXTURES = path.join(__dirname, '__fixtures__', 'reviews')
const fixtureFiles = fs.existsSync(FIXTURES)
  ? fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()
  : []
const loadFixture = (file: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'))

describe('фикстуры appreviews', () => {
  test('synthetic.json на месте', () => {
    expect(fixtureFiles).toContain('synthetic.json')
  })

  for (const file of fixtureFiles) {
    test(`${file}: разбирается, доли в 0..1, выход детерминирован`, () => {
      const raw = parseReviewsRaw(loadFixture(file))
      expect(raw).not.toBeNull()
      const m = mineReviews(raw!)
      expect(m.n).toBeLessThanOrEqual(raw!.length)
      expect(m.nPos + m.nNeg).toBe(m.n)
      for (const lane of LANES) {
        const s = m.lanes[lane]
        expect(s.count).toBeLessThanOrEqual(m.n)
        for (const x of [s.share, s.sharePos, s.shareNeg]) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(1)
        }
      }
      expect(mineReviews(parseReviewsRaw(loadFixture(file))!)).toEqual(m)
    })
  }

  test('synthetic.json: полосы, время до веселья и наигранное', () => {
    const m = mineReviews(parseReviewsRaw(loadFixture('synthetic.json'))!)
    // 10 отзывов без дубля; китайский и пустой в знаменатель не идут
    expect(m.playtime.total).toBe(10)
    expect(m.n).toBe(8)
    expect(m.lanes.hard.count).toBe(2)
    expect(m.lanes.slowStart.count).toBe(3)
    expect(m.lanes.bugs.count).toBe(1)
    expect(m.timeToFunHours).toBe(5)
    expect(m.timeToFunMentions).toBe(3)
    expect(m.playtime.negShortShare).toBeCloseTo(2 / 3)
  })

  const hk = fixtureFiles.includes('367520.json')
  const sdv = fixtureFiles.includes('413150.json')
  test.skipIf(!hk || !sdv)('Hollow Knight сложнее Stardew Valley, Stardew уютнее', () => {
    const a = mineReviews(parseReviewsRaw(loadFixture('367520.json'))!)
    const b = mineReviews(parseReviewsRaw(loadFixture('413150.json'))!)
    expect(a.lanes.hard.share).toBeGreaterThan(b.lanes.hard.share)
    expect(b.lanes.relaxing.share).toBeGreaterThan(a.lanes.relaxing.share)
  })
})
