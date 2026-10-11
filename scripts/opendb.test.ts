import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/*
 * Ни одной настоящей базы: клиент и createDb подменены, тест смотрит только
 * на то, КАКОЙ дорогой открывается облако. Настоящий createClient к адресу
 * прода из теста не нужен и опасен.
 */
const { createClient, createDb } = vi.hoisted(() => ({
  createClient: vi.fn((cfg: { url: string }) => ({ bare: cfg.url })),
  createDb: vi.fn(async (url: string) => ({ migrated: url })),
}))
vi.mock('@libsql/client', () => ({ createClient }))
vi.mock('../lib/db', () => ({ createDb }))

import { openCloud } from './opendb'

beforeEach(() => {
  createClient.mockClear()
  createDb.mockClear()
})

describe('облако из скрипта', () => {
  test('путь, который только смотрит, открывает облако без миграций', async () => {
    // Иначе --dry-run из ветки довёл бы прод до схемы ветки до ревью и до
    // бэкапа: ALTER, индексы, пересборка feedback и отметка версии
    for (const url of ['libsql://imbored.turso.io', 'https://imbored.turso.io']) {
      expect(await openCloud(url, 'токен', { readOnly: true })).toEqual({ bare: url })
      expect(createClient).toHaveBeenLastCalledWith({ url, authToken: 'токен' })
    }
    expect(createDb).not.toHaveBeenCalled()
  })

  test('путь, который пишет, мигрирует облако, как и задумано', async () => {
    // Заливке нужны колонки ветки (price_cc, store_hidden), иначе INSERT упадёт
    expect(await openCloud('libsql://imbored.turso.io', 'токен')).toEqual({
      migrated: 'libsql://imbored.turso.io',
    })
    expect(createDb).toHaveBeenCalledWith('libsql://imbored.turso.io', 'токен')
    expect(createClient).not.toHaveBeenCalled()
  })

  test('локальный файл мигрирует и на чтение: свежий файл без схемы пуст', async () => {
    // TURSO_DATABASE_URL=file:… — дев-база (так запускают и user:forget).
    // Миграция своего файла безвредна, а без неё отчёт упал бы на «no such table»
    await openCloud('file:data/imbored.db', undefined, { readOnly: true })
    expect(createDb).toHaveBeenCalledWith('file:data/imbored.db', undefined)
    expect(createClient).not.toHaveBeenCalled()
  })
})

/*
 * Сами скрипты зовут main() при загрузке и ходят в сеть, поэтому порядок их
 * шагов сверяется по тексту — как и «проверка до подключения» у заливки в
 * publishsql.test.ts. Сторожится одно: --dry-run и отчёты обещают ничего не
 * писать, и это обещание держится до первой записи, а не после неё.
 */
describe('скрипты: «посмотреть» не пишет и не мигрирует облако', () => {
  const src = (f: string) => readFileSync(`scripts/${f}`, 'utf8')
  const main = (f: string) => {
    const s = src(f)
    return s.slice(s.indexOf('async function main'))
  }

  test('каждый --dry-run открывает облако на чтение', () => {
    // Облако открывается в одном месте скрипта, и туда передан сам флаг
    expect(main('publish-catalog.ts')).toContain('openRemote({ readOnly: dryRun })')
    for (const f of ['seed-catalog.ts', 'enrich-pages.ts', 'sync-news.ts']) {
      expect(main(f), f).toContain('openDb({ readOnly: dryRun })')
      expect(src(f), f).toMatch(/openCloud\(remote, process\.env\.TURSO_AUTH_TOKEN, \{ readOnly \}\)/)
      expect(src(f), `${f}: облако мимо openCloud`).not.toMatch(/createDb\(remote/)
    }
    expect(src('publish-catalog.ts')).not.toMatch(/migrateDb\(/)
  })

  test('отчёт по каталогу облако не мигрирует никогда', () => {
    const s = src('catalog-report.ts')
    expect(s).toMatch(/openCloud\(remote, process\.env\.TURSO_AUTH_TOKEN, \{ readOnly: true \}\)/)
    expect(s).not.toMatch(/createDb\(remote/)
  })

  test('news:sync --dry-run уходит до постановки в очередь', () => {
    // Постановка пишет до двухсот строк news_poll с next_at = now — тот самый
    // ком в одну секунду, который разгребает news:spread
    const m = main('sync-news.ts')
    const dry = m.indexOf('if (dryRun)')
    expect(dry, 'ветка --dry-run в main не найдена').toBeGreaterThan(-1)
    expect(dry).toBeLessThan(m.indexOf('enrollNewsPoll('))
    // Число новых считается чтением, тем же отбором, что у постановки
    expect(m.slice(dry, m.indexOf('enrollNewsPoll('))).toContain('countNewsPollMissing(')
  })

  test('news:sync --digest-only --dry-run не берёт аренду и не пересказывает', () => {
    // Пересказ — это запись и деньги модели; облако под --dry-run к тому же
    // открыто без миграций
    const m = main('sync-news.ts')
    const digest = m.slice(m.indexOf('if (digestOnly)'))
    const dry = digest.indexOf('if (dryRun)')
    expect(dry, 'ветка --dry-run в --digest-only не найдена').toBeGreaterThan(-1)
    expect(dry).toBeLessThan(digest.indexOf('acquireLease('))
    expect(dry).toBeLessThan(digest.indexOf('runNewsSlice('))
  })

  test('seed:catalog --restart --dry-run курсор не сбрасывает', () => {
    const m = main('seed-catalog.ts')
    const reset = m.indexOf("setCatalogMeta(db, CURSOR_KEY, '0')")
    expect(reset, 'сброс курсора по --restart не найден').toBeGreaterThan(-1)
    const line = m.slice(m.lastIndexOf('\n', reset), reset)
    expect(line).toContain('!dryRun')
  })
})
