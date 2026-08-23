import { describe, expect, test } from 'vitest'
import { landingDemo, MOOD_KEYS, type MoodKey } from './landing'

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
 * конвейером (splitBySource → mixHeroPool), а не разметкой, и оба ломаются
 * тихо, если из конвейера выпадет шаг.
 */

const NOW = 1_780_000_000

describe('демо-выдача главной', () => {
  const demo = landingDemo(NOW)

  test('в каждом состоянии ровно пять карточек', () => {
    for (const key of MOOD_KEYS) {
      expect(demo.picks[key], key).toHaveLength(5)
    }
  })

  /**
   * Первая карточка — всегда своя игра. Это позиция продукта: «своё идёт
   * первым», и на лендинге она напечатана словами.
   */
  test('первой стоит игра из библиотеки, а не покупка', () => {
    for (const key of MOOD_KEYS) {
      expect(demo.picks[key][0].badge, key).not.toBe('Нет в твоей библиотеке')
    }
  })

  /** MAX_NEW_PICKS = 2, и обеспечивает его mixHeroPool, а не скоринг. */
  test('покупок в пятёрке не больше двух', () => {
    for (const key of MOOD_KEYS) {
      const bought = demo.picks[key].filter((c) => c.badge === 'Нет в твоей библиотеке')
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

  /**
   * Причины на лендинге нет и быть не может: все шаблоны обращаются на «ты» и
   * говорят про библиотеку читателя, а библиотека здесь чужая. Правило
   * держится формой данных — проверяем, что поле не завелось обратно.
   */
  test('в карточке нет ни причины, ни цены', () => {
    const card = demo.picks['chill:solo'][0] as Record<string, unknown>
    expect(card.reason).toBeUndefined()
    expect(card.priceFinal).toBeUndefined()
    expect(card.discount).toBeUndefined()
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
