import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  FEEDBACK_ACTIONS,
  FEEDBACK_COLUMNS,
  SKIP_REASON_KEYS,
  feedbackCheckStale,
  feedbackTableSql,
  isFeedbackAction,
  isSkipReason,
} from './feedbackkinds'

describe('feedbackkinds', () => {
  test('CHECK таблицы перечисляет ровно список действий', () => {
    const sql = feedbackTableSql('feedback')
    const check = sql.match(/CHECK \(action IN \(([^)]*)\)\)/)?.[1]
    expect(check?.split(',')).toEqual(FEEDBACK_ACTIONS.map((a) => `'${a}'`))
  })

  test('колонки CREATE и копии при пересборке — один список', () => {
    const sql = feedbackTableSql('feedback_new')
    const cols = [...sql.matchAll(/^ {2}(\w+) /gm)].map((m) => m[1])
    expect(cols).toEqual([...FEEDBACK_COLUMNS])
  })

  test('IF NOT EXISTS — только по просьбе: пересборке он не нужен', () => {
    expect(feedbackTableSql('feedback', { ifNotExists: true })).toMatch(
      /^CREATE TABLE IF NOT EXISTS feedback \(/,
    )
    expect(feedbackTableSql('feedback_new')).toMatch(/^CREATE TABLE feedback_new \(/)
  })

  test('пересборка нужна, если в CHECK нет любого из действий, а не только последнего', () => {
    expect(feedbackCheckStale(feedbackTableSql('feedback'))).toBe(false)
    for (const missing of FEEDBACK_ACTIONS) {
      const sql = feedbackTableSql('feedback').replace(`'${missing}',`, '').replace(`,'${missing}'`, '')
      expect(sql, missing).not.toContain(`'${missing}'`)
      expect(feedbackCheckStale(sql), missing).toBe(true)
    }
  })

  test('таблица без CHECK и отсутствующая таблица не пересобираются', () => {
    expect(feedbackCheckStale(undefined)).toBe(false)
    expect(feedbackCheckStale('CREATE TABLE feedback (id INTEGER, action TEXT)')).toBe(false)
  })

  test('охрана типов пускает только ключи из списков', () => {
    for (const a of FEEDBACK_ACTIONS) expect(isFeedbackAction(a)).toBe(true)
    for (const r of SKIP_REASON_KEYS) expect(isSkipReason(r)).toBe(true)
    for (const junk of ['hacked', '', 'LIKED', 7, null, undefined, {}]) {
      expect(isFeedbackAction(junk), String(junk)).toBe(false)
      expect(isSkipReason(junk), String(junk)).toBe(false)
    }
  })
})

/**
 * Сторож копий.
 *
 * Список действий жил в шести местах, и следующее действие обязательно
 * забыли бы в одном из них (см. шапку lib/feedbackkinds.ts). Здесь ловится
 * самый частый способ завести копию снова: выписать действия или причины
 * литералом — массивом или объединением типов — где-то кроме модуля-списка.
 *
 * Тесты не проверяются: старые схемы таблицы там выписаны нарочно, это
 * исторические образцы для проверок миграции.
 */
describe('сторож копий списка действий', () => {
  const ROOT = path.join(__dirname, '..')

  function sourceFiles(): [string, string][] {
    const out: [string, string][] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue
          walk(p)
        } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
          out.push([path.relative(ROOT, p).replace(/\\/g, '/'), fs.readFileSync(p, 'utf8')])
        }
      }
    }
    for (const dir of ['app', 'lib', 'components', 'scripts']) walk(path.join(ROOT, dir))
    return out
  }

  /**
   * Три соседних значения списка подряд — массивом, объединением или в SQL.
   * Три, а не два: пара бывает законной (кнопка с двумя причинами), а копия
   * списка — это уже перечисление.
   */
  const runs = (list: readonly string[]) =>
    list
      .slice(2)
      .map((c, i) => new RegExp(`'${list[i]}'\\s*[,|]\\s*'${list[i + 1]}'\\s*[,|]\\s*'${c}'`))

  /** Комментарии выкидываем: рассказ о списке — не копия списка */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')

  const HOME = 'lib/feedbackkinds.ts'

  test('сторож видит исходники и сам модуль-список', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(100)
    const home = files.find(([f]) => f === HOME)?.[1] ?? ''
    expect(runs(FEEDBACK_ACTIONS).some((re) => re.test(code(home)))).toBe(true)
    expect(runs(SKIP_REASON_KEYS).some((re) => re.test(code(home)))).toBe(true)
  })

  test('действия и причины выписаны только в lib/feedbackkinds.ts', () => {
    const patterns = [...runs(FEEDBACK_ACTIONS), ...runs(SKIP_REASON_KEYS)]
    const copies = sourceFiles()
      .filter(([f]) => f !== HOME)
      .filter(([, src]) => patterns.some((re) => re.test(code(src))))
      .map(([f]) => f)
    expect(
      copies,
      'список действий или причин фидбека выписан заново — бери FEEDBACK_ACTIONS и ' +
        'SKIP_REASON_KEYS из lib/feedbackkinds.ts (и CHECK таблицы строит оттуда же)',
    ).toEqual([])
  })
})
