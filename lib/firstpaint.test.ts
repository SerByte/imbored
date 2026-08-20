import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож правила «анимация не прячет контент».
 *
 * Правило выписано в globals.css у .anim-page-in и звучит так: «анимация
 * может только добавить проявление, но не может спрятать контент». Там оно
 * применено к CSS — и не доехало до motion.
 *
 * А motion рендерит состояние initial ИНЛАЙНОМ УЖЕ НА СЕРВЕРЕ. Проверено на
 * живом сервере: в HTML квиза приезжало style="opacity:0;transform:
 * translateX(24px)" на вопросе и translateY(14px) на каждом ответе. То есть
 * разметка у человека уже была, а экран оставался пустым до конца гидратации
 * — а при сбое чанка или ошибке в соседнем компоненте пустым навсегда.
 *
 * initial={false} у AnimatePresence снимает это ровно для ПЕРВОГО показа:
 * первый шаг появляется сразу, переходы между шагами едут как ехали.
 */

const ROOT = path.join(__dirname, '..')

/** Экраны, чья первая отрисовка приходит с сервера и обязана быть видимой. */
const FIRST_PAINT = [
  { file: path.join('app', 'quiz', 'page.tsx'), what: 'шаг квиза' },
  { file: path.join('components', 'WarmupScreen.tsx'), what: 'подпись экрана прогрева' },
]

describe('первая отрисовка не спрятана анимацией', () => {
  for (const { file, what } of FIRST_PAINT) {
    test(`${what}: AnimatePresence не прячет первый показ`, () => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
      const tags = [...src.matchAll(/<AnimatePresence[^>]*>/g)].map((m) => m[0])
      expect(tags.length, `${file}: AnimatePresence не найден`).toBeGreaterThan(0)
      for (const tag of tags) {
        expect(tag, `${file}: без initial={false} состояние opacity:0 уедет в серверный HTML`).toContain(
          'initial={false}',
        )
      }
    })
  }

  /**
   * Само правило живёт в комментарии к .anim-page-in. Если его однажды сотрут
   * вместе с fill-mode, тесты выше останутся, а причина исчезнет — и первый же
   * рефакторинг вернёт `both` обратно.
   */
  test('правило по-прежнему записано там, откуда оно взято', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    expect(css).toMatch(/Намеренно БЕЗ fill-mode/)
    expect(css).toMatch(/не может спрятать контент/)
    // и сама анимация не должна обзавестись fill-mode
    const block = css.slice(css.indexOf('.anim-page-in'), css.indexOf('}', css.indexOf('.anim-page-in')))
    expect(block, '.anim-page-in с fill-mode снова спрячет страницу').not.toMatch(/\bboth\b|\bforwards\b/)
  })
})
