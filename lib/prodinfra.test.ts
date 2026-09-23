import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { PREVIEW_OWN_DB_ENV } from './db'

/**
 * Сторож прод-инфраструктуры, которая записана в репозитории, а не в дашборде.
 *
 * Эти правки не видны ни одному тесту поведения: функция в Вашингтоне
 * отвечает так же, как в Дублине, только на сотни миллисекунд дольше, а 404
 * без кэша выглядит так же, как с кэшем, и просто платит запросом к базе.
 * Такое расходится молча, и найти это можно только замером на проде.
 */

const ROOT = path.join(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

describe('регион функций', () => {
  test('регион один и совпадает с тем, что описано в DEPLOY.md', () => {
    const cfg = JSON.parse(read('vercel.json')) as { regions?: unknown }
    // Без regions Vercel ставит функции в iad1, через Атлантику от базы.
    // Больше одного региона на Hobby не пускает сама платформа: сборка падает.
    expect(Array.isArray(cfg.regions) && cfg.regions.length, 'regions в vercel.json').toBe(1)
    const [region] = cfg.regions as string[]
    expect(
      read('DEPLOY.md'),
      'поменял регион — поправь раздел «Регион функций»: по нему владелец проверяет x-vercel-id',
    ).toContain(`"regions": ["${region}"]`)
  })
})

describe('404', () => {
  test('полка читает базу только через кэш на сутки', () => {
    const src = read('app', 'not-found.tsx')
    const cacheAt = src.indexOf('unstable_cache(')
    expect(cacheAt, 'unstable_cache в app/not-found.tsx не найден').toBeGreaterThan(-1)
    const cacheEnd = src.indexOf('revalidate:', cacheAt)
    expect(cacheEnd, 'у кэша полки нет revalidate').toBeGreaterThan(cacheAt)

    // Второй вызов мимо кэша вернул бы запрос к Turso на каждый рендер 404
    const reads = [...src.matchAll(/topCatalogGames\(/g)].map((m) => m.index ?? -1)
    expect(reads).toHaveLength(1)
    expect(reads[0]).toBeGreaterThan(cacheAt)
    expect(reads[0]).toBeLessThan(cacheEnd)
  })
})

describe('превью', () => {
  test('флаг своей базы у превью назван в DEPLOY.md так же, как в коде', () => {
    // Владелец берёт имя переменной из DEPLOY.md. Разойдись оно с кодом, превью
    // со своей базой молча не пересобирало бы таблицы, а версия схемы там не
    // записывалась бы никогда
    expect(read('DEPLOY.md')).toContain(`${PREVIEW_OWN_DB_ENV}=1`)
  })
})
