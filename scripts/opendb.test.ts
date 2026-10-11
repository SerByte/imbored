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

  test('catalog:publish --dry-run показывает всё, что сделает миграция, а не одну версию', () => {
    // Разовые шаги под своими флагами (починка JSON-колонок переписывает
    // games) и новые индексы версию схемы не поднимают — сверка одной версии
    // о них молчала (см. pendingMigrations в lib/db.ts)
    const m = main('publish-catalog.ts')
    const dry = m.indexOf('if (dryRun)')
    expect(dry, 'ветка --dry-run в main не найдена').toBeGreaterThan(-1)
    expect(m.slice(dry)).toContain('pendingMigrations(remote)')
    expect(src('publish-catalog.ts')).not.toMatch(/CURRENT_SCHEMA_V/)
  })

  test('отчёт по каталогу облако не мигрирует никогда', () => {
    const s = src('catalog-report.ts')
    expect(s).toMatch(/openCloud\(remote, process\.env\.TURSO_AUTH_TOKEN, \{ readOnly: true \}\)/)
    expect(s).not.toMatch(/createDb\(remote/)
  })

  test('news:sync --dry-run уходит до постановки в очередь', () => {
    // Постановка пишет до двухсот строк news_poll с next_at = now — тот самый
    // ком в одну секунду, который разгребает news:spread.
    //
    // Искать с отбора топа, а не с начала main: выше стоит своя ветка
    // --dry-run у --digest-only, и первый же 'if (dryRun)' нашёлся бы там —
    // проверка не упала бы, даже вернись настоящая ветка под постановку
    const m = main('sync-news.ts')
    const from = m.indexOf('topCatalogAppids(')
    expect(from, 'отбор топа в main не найден').toBeGreaterThan(-1)
    const dry = m.indexOf('if (dryRun)', from)
    const enroll = m.indexOf('enrollNewsPoll(', from)
    expect(dry, 'ветка --dry-run после отбора топа не найдена').toBeGreaterThan(-1)
    expect(enroll, 'постановка после отбора топа не найдена').toBeGreaterThan(-1)
    expect(dry).toBeLessThan(enroll)
    // Число новых считается чтением, тем же отбором, что у постановки, — и
    // внутри самой ветки, а не где-то между топом и постановкой
    expect(m.slice(dry, enroll)).toContain('countNewsPollMissing(')
    expect(m.slice(from, dry)).not.toContain('countNewsPollMissing(')
  })

  test('news:sync склоняет игры: «1 игру», «3 игры», а не «1 игр»', () => {
    // Число и застывшее «игр» за ним — это «встали бы в очередь 1 игр».
    // Фраза о постановке у прогона и у --dry-run одна (enrolled) и склоняет
    const s = src('sync-news.ts')
    expect(s).not.toMatch(/\}\s*игр[^уыа]/)
    expect(s).toContain("plural(fresh, 'игру', 'игры', 'игр')")
    const m = main('sync-news.ts')
    expect(m).toContain('поставили бы в очередь ${enrolled(fresh, top.length)}')
    expect(m).toContain('поставили в очередь ${enrolled(fresh, top.length)}')
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
