import { describe, expect, test } from 'vitest'
import { DEMO_METAS } from './demo'
import { landingDemo, MOOD_KEYS, type MoodKey } from './landing'
import { REASON_MAX } from './llm'
import { topTags } from './recommend'
import { SOURCE_BADGE } from './sources'
import { tagRu } from './tagsru'

/**
 * Сторож демо-выдачи главной.
 *
 * На главной стоят два переключателя и обещание, что от них меняется выдача.
 * Обещание проверяемое — и без сторожа его может молча опровергнуть правка
 * TIME_TAGS, VIBE_TAGS, весов источников или самого DEMO_METAS: два состояния
 * схлопнутся в одно, и страница начнёт спорить сама с собой на глазах у
 * человека, который пришёл первый раз.
 *
 * Второе, что здесь закреплено, — обещания, которые страница печатает словами:
 * «своё идёт первым» и «покупок не больше двух». Оба обеспечиваются
 * конвейером (splitBySource → mixHeroPool → ownFirst), а не разметкой, и оба
 * ломаются тихо, если из конвейера выпадет шаг. Порядок держит ownFirst — тот
 * же, что у /api/recommend: демо-данные без скидок его не проверят (покупка
 * здесь своё не обгоняет), поэтому настоящая проверка порядка живёт у маршрута
 * (app/api/recommend/route.test.ts).
 */

const NOW = 1_780_000_000

describe('демо-выдача главной', () => {
  const demo = landingDemo(NOW)

  test('в каждом состоянии ровно пять карточек', () => {
    for (const key of MOOD_KEYS) {
      expect(demo.picks[key], key).toHaveLength(5)
    }
  })

  /*
   * Покупка узнаётся по подписи источника — той самой, что стоит на карточке.
   * Здесь стояла строка «Нет в твоей библиотеке», которой у источника new не
   * было никогда (подпись — SOURCE_BADGE.new): оба сторожа ниже сравнивали с
   * несуществующим и проходили вхолостую. Подпись — из того же словаря, а
   * проверка «покупки вообще находятся» не даёт сторожу снова ослепнуть.
   */
  const BOUGHT = SOURCE_BADGE.new

  test('сторож покупок видит покупки: в пятёрках они есть', () => {
    const all = MOOD_KEYS.flatMap((key) => demo.picks[key])
    expect(all.some((c) => c.badge === BOUGHT)).toBe(true)
  })

  /**
   * Первая карточка — всегда своя игра. Это позиция продукта: «своё идёт
   * первым», и на лендинге она напечатана словами.
   */
  test('первой стоит игра из библиотеки, а не покупка', () => {
    for (const key of MOOD_KEYS) {
      expect(demo.picks[key][0].badge, key).not.toBe(BOUGHT)
    }
  })

  /*
   * «Своё идёт первым» — про всю пятёрку, а не только про первую карточку.
   * Прежняя проверка одной первой проходила на демо-данных сама собой: скидок
   * в DEMO_METAS нет, и покупка здесь не обгоняла своё по скору никогда, — а
   * на проде героем трижды из трёх стояла покупка со скидкой. Теперь порядок
   * держит ownFirst (lib/recommend), общий с /api/recommend.
   */
  test('ни одна своя не стоит после покупки', () => {
    for (const key of MOOD_KEYS) {
      const firstBought = demo.picks[key].findIndex((c) => c.badge === BOUGHT)
      if (firstBought < 0) continue
      const after = demo.picks[key].slice(firstBought).filter((c) => c.badge !== BOUGHT)
      expect(after.map((c) => c.name), key).toEqual([])
    }
  })

  /** MAX_NEW_PICKS = 2, и обеспечивает его mixHeroPool, а не скоринг. */
  test('покупок в пятёрке не больше двух', () => {
    for (const key of MOOD_KEYS) {
      const bought = demo.picks[key].filter((c) => c.badge === BOUGHT)
      expect(bought.length, key).toBeLessThanOrEqual(2)
    }
  })

  /**
   * Главное утверждение секции: переключатели работают. Замерено на текущих
   * данных — максимум три общих карточки из пяти у самой близкой пары.
   */
  test('ни одна пара состояний не совпадает больше чем на три из пяти', () => {
    const worst: string[] = []
    for (let i = 0; i < MOOD_KEYS.length; i++) {
      for (let j = i + 1; j < MOOD_KEYS.length; j++) {
        const a = new Set(demo.picks[MOOD_KEYS[i]].map((c) => c.appid))
        const shared = demo.picks[MOOD_KEYS[j]].filter((c) => a.has(c.appid)).length
        if (shared > 3) worst.push(`${MOOD_KEYS[i]} × ${MOOD_KEYS[j]}: ${shared}/5`)
      }
    }
    expect(worst, 'переключатель перестал менять выдачу — страница обещает то, чего нет').toEqual([])
  })

  test('состояния не совпадают полностью ни с одним другим', () => {
    const seen = new Map<string, MoodKey>()
    for (const key of MOOD_KEYS) {
      const fingerprint = demo.picks[key].map((c) => c.appid).join(',')
      const twin = seen.get(fingerprint)
      expect(twin, `${key} выдаёт то же самое, что ${twin}`).toBeUndefined()
      seen.set(fingerprint, key)
    }
  })

  /**
   * Страница статическая с ISR: если выдача зависит от времени, между
   * ревалидациями она будет «дышать», а закреплённые здесь числа — врать.
   */
  test('выдача не зависит от времени', () => {
    for (const days of [1, 7, 30, 365]) {
      const later = landingDemo(NOW + days * 86_400)
      for (const key of MOOD_KEYS) {
        expect(later.picks[key].map((c) => c.appid), `${key} через ${days} д`).toEqual(
          demo.picks[key].map((c) => c.appid),
        )
      }
    }
  })

  test('у карточки есть подпись источника и теги', () => {
    for (const card of demo.picks['chill:solo']) {
      expect(card.badge.length).toBeGreaterThan(3)
      expect(card.tags.length).toBeGreaterThan(0)
    }
  })

  /*
   * Чипсы демо — те же, что показала бы настоящая выдача: topTags из
   * lib/recommend, а не своя копия отбора. Копия уже расходилась с ним —
   * предупреждения о контенте выдача отсеивает до среза, а она нет.
   */
  test('теги карточки — тот же отбор, что у чипсов выдачи', () => {
    const metas = new Map(DEMO_METAS.map((m) => [m.appid, m]))
    for (const key of MOOD_KEYS) {
      for (const card of demo.picks[key]) {
        expect(card.tags, `${key}: ${card.name}`).toEqual(topTags(metas.get(card.appid)).map(tagRu))
      }
    }
  })

  /**
   * Причины «на ты» на лендинге нет и быть не может: шаблоны продукта
   * обращаются к читателю и говорят про его библиотеку, а библиотека здесь
   * чужая. Правило держится формой данных — проверяем, что поле не завелось
   * обратно ни у одной карточки.
   */
  test('в карточке нет ни причины, ни цены', () => {
    for (const key of MOOD_KEYS) {
      for (const c of demo.picks[key] as Array<Record<string, unknown>>) {
        expect(c.reason, `${key}: ${c.name}`).toBeUndefined()
        expect(c.priceFinal).toBeUndefined()
        expect(c.discount).toBeUndefined()
      }
    }
  })

  /**
   * «Почему именно она» — то, что обещает первая строка главной, — у первой
   * карточки каждого состояния: та же причина, что дал бы продукт, но про
   * демо-игрока. Ни «ты», ни «твой», ни повелительного «вернись»: гость читает
   * про чужую библиотеку, и текст обязан это говорить.
   */
  test('у первой карточки — причина про демо-игрока, без «ты»; у остальных её нет', () => {
    const YOU =
      /(^|[^а-яё])(ты|тебя|тебе|тобой|твой|твоя|твоё|твое|твои|твоих|твоим|твоими|твоей|твоего|твоему|твою|вернись|проверь|садись|играй|дай)([^а-яё]|$)/i
    for (const key of MOOD_KEYS) {
      const [first, ...rest] = demo.picks[key]
      expect(first.why, key).toBeTruthy()
      expect(first.why!.length, key).toBeLessThanOrEqual(REASON_MAX)
      expect(first.why, key).toContain(`«${first.name}»`)
      expect(first.why, key).toMatch(/демо-игрок/)
      expect(first.why, `${key}: ${first.why}`).not.toMatch(YOU)
      for (const c of rest) expect(c.why, `${key}: ${c.name}`).toBeUndefined()
    }
  })

  test('стена — это вся демо-библиотека', () => {
    expect(demo.wall).toHaveLength(demo.libraryCount)
    expect(demo.libraryCount).toBe(22)
    expect(demo.libraryHours).toBe(4404)
  })

  /** Числа стоят на странице словами — значит обязаны сходиться. */
  test('совместимость демо-пары считается и сходится', () => {
    expect(demo.compat.rows).toHaveLength(8)
    expect(demo.compat.hours).toBe(4357)
    expect(demo.compat.countA).toBe(22)
    expect(demo.compat.countB).toBe(10)
    const sums = demo.compat.rows.map((r) => r.a + r.b)
    expect(sums, 'строки обязаны идти по убыванию суммы часов').toEqual([...sums].sort((x, y) => y - x))
  })
})
