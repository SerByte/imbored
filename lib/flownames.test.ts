import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Названия игр на /daily и /explore — данные, и на /en русское название
 * обязано стоять своим lang="ru" (WCAG 3.1.2, docs/i18n.md: withForeignRuns),
 * иначе английский голос скринридера читает его по буквам. На русской
 * странице разметка прежняя до байта: withForeignRuns на ru отдаёт ту же
 * строку одним текстовым узлом (lib/textlang.test.ts).
 *
 * Герой дня, колода и полка рисуются после ответа API, и серверный рендер их
 * не видит — сторож по исходнику, как у героя /play в lib/playnames.test.ts.
 */

const ROOT = path.join(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// includes и test, а не toContain: при провале toContain печатал бы весь файл страницы
const has = (src: string, re: RegExp) => re.test(src)

describe('/daily: названия в тексте героя и живой строке помечены', () => {
  const src = read('app/[lang]/daily/page.tsx')

  test('причина героя — через withForeignRuns с героем и якорем «ближе всего к…»', () => {
    expect(src.includes('withForeignRuns(locale, hero.reason, [hero.name, hero.via?.name])')).toBe(true)
    expect(has(src, /\{hero\.reason\}/)).toBe(false)
  })

  test('«Another game for today» и «Game of the day» — через withForeignRuns', () => {
    expect(
      has(src, /setSaid\(\s*withForeignRuns\(\s*locale,\s*tr\(locale, \{ ru: `Другая игра на сегодня: \$\{name\}`[^)]*\),\s*\[name\],/),
    ).toBe(true)
    expect(
      has(src, /setSaid\(\s*withForeignRuns\(\s*locale,\s*tr\(locale, \{ ru: `Игра дня: \$\{next\.name\}`[^)]*\),\s*\[next\.name\],/),
    ).toBe(true)
    // Голой строки в живую область героя не уходит
    expect(has(src, /setSaid\(\s*tr\(/)).toBe(false)
    expect(src.includes('useState<ReactNode>(\'\')')).toBe(true)
  })
})

describe('/explore: названия в колоде и на полке помечены', () => {
  const src = read('app/[lang]/explore/page.tsx')

  test('«Bring back “X”» — через withForeignRuns', () => {
    expect(
      has(src, /withForeignRuns\(\s*locale,\s*tr\(locale, \{ ru: `Вернуть «\$\{lastSkip\.name\}»`[^)]*\),\s*\[lastSkip\.name\],/),
    ).toBe(true)
  })

  test('«“X” is back in the deck» и отказ «Убрать» — через withForeignRuns', () => {
    expect(
      has(src, /setSaid\(\s*withForeignRuns\(\s*locale,\s*tr\(locale, \{ ru: `«\$\{card\.name\}» снова в колоде`[^)]*\),\s*\[card\.name\],/),
    ).toBe(true)
    expect(
      has(src, /withForeignRuns\(\s*locale,\s*tr\(locale, \{\s*ru: `Не вышло — «\$\{unlikeMissName\}» осталась на полке[^)]*\),\s*\[unlikeMissName\],/),
    ).toBe(true)
    expect(has(src, /setSaid\(\s*tr\(/)).toBe(false)
    expect(src.includes('useState<ReactNode>(\'\')')).toBe(true)
  })

  /*
   * В атрибуте кусок своим lang не пометить: на /en имя кнопки «Убрать» —
   * видимое слово и sr-only хвост с названием в <span lang>, а aria-label
   * остаётся только русской странице, как был.
   */
  test('«Remove “X” from the shelf» на /en — содержимым с lang, а не aria-label', () => {
    expect(src.includes("aria-label={locale === 'ru' ? `Убрать «${c.name}» с полки` : undefined}")).toBe(true)
    expect(src.includes('“<span lang={langOn(locale, c.name)}>{c.name}</span>” from the shelf')).toBe(true)
    // Видимое слово — первым (WCAG 2.5.3): имя начинается с того, что видно
    expect(has(src, /en: \(\s*<>\s*Remove\s*<span className="sr-only">/)).toBe(true)
    expect(src.includes('`Remove “${c.name}” from the shelf`')).toBe(false)
  })
})
