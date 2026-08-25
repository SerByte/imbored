import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож тесной карточки на низком экране.
 *
 * На 375×667 в состоянии отскока содержимое первого экрана выше экрана, и
 * кнопка «Попробовать демо» ложилась на 615–643 при полосе нижней панели с
 * 622: часть кнопки видна, центр под панелью. Замерено попаданием — нажатие
 * уводило в «Пати».
 *
 * Сдвигать содержимое целиком уже пробовали: ловушка переезжает на соседнюю
 * кнопку, это тоже замерено. Здесь убирается лишнее место ВНУТРИ карточки —
 * 24 → 16 по краю и 12 → 8 между строками. Результат по шести адресам
 * назначения и пяти размерам телефона: ловушек 5 → 1 → 0.
 *
 * ВЫСОТА КАРТОЧКИ ПРИ ЭТОМ НЕ МЕНЯЕТСЯ, и это не побочность. Карточка стоит на
 * min-h-[392px] — том самом потолке, который держит фолбэк и настоящую
 * карточку неотличимыми до гидратации. Замерено после правки: 392 и на 667, и
 * на 812. Поэтому второй тест сторожит константу: уменьшить отступы и заодно
 * снять потолок значило бы вернуть моргание на первом экране.
 */

const ROOT = path.join(__dirname, '..')
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')

describe('карточка на низком экране', () => {
  test('на низком экране отступы карточки ужимаются', () => {
    const blocks: string[] = []
    for (const m of CSS.matchAll(/@media \(max-height: \d+px\)\s*\{/g)) {
      let depth = 1
      let i = m.index! + m[0].length
      while (i < CSS.length && depth > 0) {
        if (CSS[i] === '{') depth++
        else if (CSS[i] === '}') depth--
        i++
      }
      blocks.push(CSS.slice(m.index!, i))
    }
    const card = blocks.filter((b) => /\.connect-card\s*\{/.test(b))
    expect(card.length, 'правила для .connect-card на низком экране нет').toBeGreaterThan(0)
    expect(
      card.some((b) => /padding:/.test(b) && /gap:/.test(b)),
      'ужимаются и край, и промежутки: одного из двух не хватало, чтобы кнопка вышла из полосы',
    ).toBe(true)
  })

  test('потолок высоты карточки на месте — иначе фолбэк начнёт моргать', () => {
    const fb = fs.readFileSync(
      path.join(ROOT, 'components', 'landing', 'ConnectFallback.tsx'),
      'utf8',
    )
    expect(fb, 'константа высоты карточки исчезла').toMatch(/CONNECT_CARD_MIN_H = 'min-h-\[\d+px\]'/)
  })
})
