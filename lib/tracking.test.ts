import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож разрядки.
 *
 * Это ВТОРОЙ заход на одну и ту же беду, и потому сторож, а не договорённость.
 *
 * Первый описан в докблоке components/Labels.tsx: у надзаголовков продукта
 * нашлось семь значений трекинга (0.12, 0.14, 0.18, 0.2, 0.28, 0.3, 0.42) и
 * два кегля. Роли свели к трём, форму закрепили в компоненте — и на этом
 * успокоились. Но закрепили её только в TSX, а кино-главная писала свои
 * подписи прямо в CSS, мимо компонента. Замерено на живой странице: пять
 * значений разрядки (0.06, 0.08, 0.16, 0.18, 0.3 em) при кеглях 10, 11 и 12.
 *
 * Заметить это глазом почти нельзя: надзаголовки стоят в разных сценах и рядом
 * не встречаются. Но именно из такого разнобоя складывается ощущение «собрано
 * из кусков».
 *
 * ПРАВИЛО: разрядка НАРУЖУ (положительная) берётся только из токенов
 * --track-eyebrow / --track-meta / --track-rail. Отрицательная — это поджатие
 * крупного кегля, совсем другое дело, и под правило не попадает.
 */

const ROOT = path.join(__dirname, '..')
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')

/**
 * Объявления letter-spacing вместе с номером строки — для внятной жалобы.
 *
 * Ищем по ВСЕМУ тексту, а не построчно с якорем в начало строки. Первая
 * версия сторожа была привязана к `^\s*letter-spacing:` и потому пропускала
 * однострочное правило `.x { letter-spacing: 0.22em }` — то есть ровно тот
 * вид, в котором нарушение и появляется, когда его дописывают наспех.
 * Проверено пробником: сторож молчал.
 */
function spacings(): { value: string; line: number }[] {
  const out: { value: string; line: number }[] = []
  for (const m of CSS.matchAll(/letter-spacing:\s*([^;}]+)/g)) {
    // Объявление токена (--track-…: 0.3em) — это не letter-spacing, оно сюда
    // не попадает: там другое имя свойства.
    out.push({ value: m[1].trim(), line: CSS.slice(0, m.index).split('\n').length })
  }
  return out
}

describe('разрядка', () => {
  test('три токена разрядки объявлены', () => {
    for (const token of ['--track-eyebrow', '--track-meta', '--track-rail']) {
      expect(CSS, `нет токена ${token}`).toMatch(new RegExp(`${token}:\\s*[\\d.]+em;`))
    }
    expect(CSS, 'нет токена кегля подписей --text-label').toMatch(/--text-label:\s*\d+px;/)
  })

  test('положительная разрядка берётся только из токенов', () => {
    const offenders = spacings().filter(({ value }) => {
      if (value.startsWith('var(--track-')) return false
      const n = parseFloat(value)
      // Поджатие крупного кегля и normal под правило не попадают.
      return Number.isFinite(n) && n > 0
    })
    expect(
      offenders.map((o) => `globals.css:${o.line} → ${o.value}`),
      'разрядка наружу задана литералом: заведи роль в токенах, а не шестое значение',
    ).toEqual([])
  })

  /**
   * Компонент подписей и стили обязаны ссылаться на ОДИН источник. Пока число
   * жило в двух файлах, оно разъехалось дважды.
   */
  test('Labels.tsx берёт кегль и разрядку из тех же токенов', () => {
    const src = fs.readFileSync(path.join(ROOT, 'components', 'Labels.tsx'), 'utf8')
    expect(src, 'надзаголовок обязан ссылаться на --track-eyebrow').toContain(
      'var(--track-eyebrow)',
    )
    expect(src, 'строка фактов обязана ссылаться на --track-meta').toContain('var(--track-meta)')
    expect(src, 'кегль подписей обязан ссылаться на --text-label').toContain('var(--text-label)')
    expect(
      /tracking-\[[\d.]+em\]/.test(src),
      'литеральный трекинг вернулся в Labels.tsx',
    ).toBe(false)
  })
})
