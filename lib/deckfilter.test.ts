import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Страховка от колоды, собранной мимо фильтра актуальности.
 *
 * buildGroupDeck собирает карточки из БИБЛИОТЕК участников, а библиотеки не
 * проходят офлайн-курацию каталога: там нет ни alive, ни superseded_by. Всё,
 * чем фильтрует сама колода, — «это мультиплеер?». Поэтому в пати всплывали
 * мёртвые сетевые игры и старые версии вроде Counter-Strike: Condition Zero
 * при живой CS2: она есть у обоих, помечена сетевой, а сортировка ставит
 * «есть у всех» впереди всего каталога безусловно.
 *
 * Лечится одним вызовом filterActual(..., 'party') после сборки. Забыть его в
 * новой поверхности — ошибка, которую не поймает ни типизация, ни линтер:
 * код собирается, тесты зелёные, просто в выдаче тихо лежит труп. Ровно так
 * этот вызов и отсутствовал в совместимости, пока он был в комнате.
 */

const ROOT = path.join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  const full = path.join(ROOT, dir)
  if (!fs.existsSync(full)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(p)
  }
  return out
}

/**
 * Ищем ИМПОРТЁРОВ, а не вхождения имени: сам lib/group.ts содержит
 * «buildGroupDeck(» в объявлении и filterActual, разумеется, не зовёт —
 * поиск по подстроке записал бы его в нарушители.
 */
const IMPORTS_DECK = /import\s*\{[^}]*\bbuildGroupDeck\b[^}]*\}/

const BUILDERS = ['app', 'lib']
  .flatMap(sourceFiles)
  .filter((f) => IMPORTS_DECK.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))

describe('колода пати всегда проходит фильтр актуальности', () => {
  /**
   * Скан, который ничего не нашёл, всегда зелёный. Поверхностей с колодой две —
   * комната и совместимость; если однажды станет меньше, проверка обязана
   * упасть, а не молча перестать что-либо значить.
   */
  test('поверхности с колодой на месте', () => {
    expect(BUILDERS.length).toBeGreaterThanOrEqual(2)
  })

  test('везде, где собирается колода, вызывается filterActual', () => {
    const offenders = BUILDERS.filter(
      (f) => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes('filterActual('),
    )
    expect(offenders).toEqual([])
  })
})
