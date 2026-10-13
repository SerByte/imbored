import { describe, expect, test } from 'vitest'
import { heroTitleClass, LONG_TITLE_CHARS } from './titlesize'

/**
 * Кегль h1 героя по длине названия (lib/titlesize). Порог выведен из замера
 * строк настоящего h1 на всех именах каталога — см. докблок там же; здесь его
 * граница и то, что обе ветки остаются ступенями шкалы, а не своими кеглями.
 * Подключение к страницам проверяют их собственные тесты:
 * app/game/[appid]/page.test.ts и app/pick/[id]/page.test.ts.
 */

const size = (name: string) => heroTitleClass(name).match(/\btext-display-(\w+)\b/)?.[1]

describe('кегль героя по длине названия', () => {
  test('обычное имя — кегль героя display-lg', () => {
    expect(size('Counter-Strike 2')).toBe('lg')
    // 47 знаков: при 1440 четыре строки display-lg — кнопки ещё на первом экране
    expect(size('a'.repeat(LONG_TITLE_CHARS - 1))).toBe('lg')
  })

  test('с порога — титул экрана display-md: пятая строка увела бы кнопки за край', () => {
    expect(size('a'.repeat(LONG_TITLE_CHARS))).toBe('md')
    // Имена с прода, ради которых правка: 8 и 6 строк при 1440×900
    expect(
      size(
        'BRAZILIAN DRUG DEALER 3: I OPENED A PORTAL TO HELL IN THE FAVELA TRYING TO REVIVE MIT AIA I NEED TO CLOSE IT',
      ),
    ).toBe('md')
    expect(size('YEAH! YOU WANT "THOSE GAMES," RIGHT? SO HERE YOU GO! NOW, LET\'S SEE YOU CLEAR THEM!')).toBe('md')
  })

  test('порог — там, где замер нашёл первую пятую строку (49 знаков), с запасом', () => {
    expect(LONG_TITLE_CHARS).toBeLessThanOrEqual(49)
    // и не настолько ниже, чтобы мельчить имена, которым хватает трёх-четырёх строк
    expect(LONG_TITLE_CHARS).toBeGreaterThanOrEqual(45)
  })

  test('длинное слово рвётся внутри при любой длине имени', () => {
    // «TROUBLESHOOTER:» короткое имя, а в display-lg на 360 шире колонки на 39 px
    expect(heroTitleClass('TROUBLESHOOTER')).toContain('[overflow-wrap:anywhere]')
    expect(heroTitleClass('a'.repeat(100))).toContain('[overflow-wrap:anywhere]')
  })

  test('гарнитура заголовка на месте в обеих ветках', () => {
    expect(heroTitleClass('Hades')).toMatch(/^font-display /)
    expect(heroTitleClass('a'.repeat(100))).toMatch(/^font-display /)
  })
})
