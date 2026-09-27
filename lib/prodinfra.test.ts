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

describe('сторож прокси Cloudflare', () => {
  const cron = read('.github', 'workflows', 'cron.yml')

  // Текст job'а — после его ключа и до ключа следующего job'а (тот же отступ
  // в два пробела) или до конца файла
  const job = (name: string) => {
    const at = cron.search(new RegExp(`^  ${name}:\\s*$`, 'm'))
    expect(at, `job ${name} в cron.yml не найден`).toBeGreaterThan(-1)
    const body = cron.slice(at + `  ${name}:`.length)
    const next = body.search(/^ {2}[\w-]+:\s*$/m)
    return next === -1 ? body : body.slice(0, next)
  }
  const skips = (name: string) => job(name).match(/^\s*if: github\.event\.schedule != '([^']+)'/m)?.[1]

  test('часовой прогон пропускает сторож, суточный — пинки, и строки те же, что в schedule', () => {
    // Job'ы делят прогоны буквальным сравнением со строкой cron. Забудь
    // поправить if после смены расписания или перепутай их местами — и сторож
    // молча пойдёт каждый час (лишние 720 минут в месяц из бесплатных 2000),
    // а очереди с health — раз в сутки
    const schedules = [...cron.matchAll(/^\s*- cron: '([^']+)'/gm)].map((m) => m[1])
    expect(schedules).toHaveLength(2)
    // Часовое — то, у которого поле часа '*'
    const hourly = schedules.filter((s) => s.split(/\s+/)[1] === '*')
    expect(hourly, 'ровно одно расписание в schedule должно быть часовым').toHaveLength(1)
    const daily = schedules.find((s) => s !== hourly[0])
    expect(skips('cloudflare'), 'сторож обязан пропускать часовой прогон').toBe(hourly[0])
    expect(skips('ping'), 'пинки обязаны пропускать суточный прогон сторожа').toBe(daily)
  })

  test('сторож смотрит обе записи и все признаки прокси, и DEPLOY.md называет его так же', () => {
    const guard = job('cloudflare')
    expect(guard).toContain('server: *cloudflare')
    expect(guard).toContain('cf-ray:')
    expect(guard).toContain('cf-cache-status:')
    // Облачко у A @ и CNAME www переключается отдельно, и оранжевый www при
    // сером apex снаружи не виден
    const hosts = guard.match(/for host in ([^;\n]+);/)?.[1].trim().split(/\s+/)
    expect(hosts?.sort()).toEqual(['imbored.cc', 'www.imbored.cc'])
    // Владелец узнаёт о стороже из §5: переименуй job — и после переключения
    // облачка он будет искать в Actions то, чего нет
    expect(read('DEPLOY.md')).toContain('`cloudflare` в `.github/workflows/cron.yml`')
  })
})
