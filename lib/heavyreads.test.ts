import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож тяжёлых публичных чтений.
 *
 * /portrait/[steamid] открывает кто угодно по адресу с чужим steamid, без
 * сессии и без потолка на заходы, а сборка портрета читает метаданные ВСЕЙ
 * библиотеки. Защита держится на порядке строк: чтение метаданных — только
 * внутри кэша модели и только после потолка на холодную сборку. Строка,
 * переехавшая на пару экранов выше, не ломает ни одного теста поведения —
 * страница рисуется так же, просто каждый заход снова платит тысячами строк
 * Turso. Поэтому здесь не поведение, а текст.
 */

const ROOT = path.join(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

/*
 * Две публичные страницы по чужому steamid: портрет и его итоги года. У
 * каждой своё замыкание кэша и свой ключ, но правило одно.
 */
const PAGES = [
  {
    title: 'публичный портрет',
    file: ['app', 'portrait', '[steamid]', 'page.tsx'],
    key: /\['portrait-model:v\d+', steamid, String\(snapshot\.takenAt\)\]/,
    heavy: ['bannedAppids', 'loadTagStats', 'getLibraryBaselines'],
  },
  {
    title: 'итоги года',
    file: ['app', 'portrait', '[steamid]', 'year', 'page.tsx'],
    key: /\['portrait-year:v\d+', steamid, String\(snapshot\.takenAt\)\]/,
    heavy: ['getLibraryBaselines'],
  },
]

for (const page of PAGES) {
  describe(page.title, () => {
    const src = read(...page.file)

    test('метаданные библиотеки читаются только внутри кэша модели и после потолка', () => {
      const cacheAt = src.indexOf('unstable_cache(')
      expect(cacheAt, 'unstable_cache в странице не найден').toBeGreaterThan(-1)
      const cacheEnd = src.indexOf('revalidate:', cacheAt)
      expect(cacheEnd, 'у кэша модели нет revalidate').toBeGreaterThan(cacheAt)

      const reads = [...src.matchAll(/getGamesMeta(Lite)?\(/g)].map((m) => m.index ?? -1)
      expect(reads, 'второе чтение мимо кэша вернуло бы тысячи строк на каждый заход').toHaveLength(1)
      expect(reads[0]).toBeGreaterThan(cacheAt)
      expect(reads[0]).toBeLessThan(cacheEnd)

      const gate = src.indexOf("bucket: 'portrait-build-ip'", cacheAt)
      expect(gate, 'потолок на холодную сборку должен стоять внутри кэша').toBeGreaterThan(cacheAt)
      expect(gate, 'потолок — до чтения, иначе он ничего не бережёт').toBeLessThan(reads[0])
    })

    /*
     * Баны владельца — вся его история фидбека, карта тегов — вся таблица
     * tags, отметка года — блоб всей библиотеки. На каждый просмотр чужой
     * ссылки это те же тысячи строк, от которых бережёт кэш модели.
     */
    for (const fn of page.heavy) {
      test(`${fn} — тоже только внутри кэша модели и после потолка`, () => {
        const cacheAt = src.indexOf('unstable_cache(')
        const cacheEnd = src.indexOf('revalidate:', cacheAt)
        const gate = src.indexOf("bucket: 'portrait-build-ip'", cacheAt)
        const reads = [...src.matchAll(new RegExp(`${fn}\\(`, 'g'))].map((m) => m.index ?? -1)
        expect(reads, `${fn}: одно место`).toHaveLength(1)
        expect(reads[0]).toBeGreaterThan(gate)
        expect(reads[0]).toBeLessThan(cacheEnd)
      })
    }

    test('ключ кэша — снапшот: новый снапшот не отдаёт старую модель', () => {
      expect(src).toMatch(page.key)
    })

    test('снапшот и ник читаются один раз на запрос, общие для метаданных и страницы', () => {
      for (const fn of ['getLatestSnapshot', 'getPersonaName']) {
        const calls = [...src.matchAll(new RegExp(`${fn}\\(`, 'g'))]
        expect(calls, `${fn}: одно место, внутри cache()`).toHaveLength(1)
        const line = src.slice(src.lastIndexOf('\n', calls[0].index), calls[0].index)
        expect(line, `${fn} должен жить в cache(...)`).toContain('cache(')
      }
    })
  })
}
