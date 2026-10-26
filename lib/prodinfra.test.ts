import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { PREVIEW_OWN_DB_ENV } from './db'

/**
 * Сторож прод-инфраструктуры, которая записана в репозитории, а не в дашборде.
 *
 * Эти правки не видны ни одному тесту поведения: функция в Вашингтоне
 * отвечает так же, как в Дублине, только на сотни миллисекунд дольше, а
 * карточка игры под суточным кэшем в границе not-found выглядит так же, как
 * без него, и просто перегенерируется в семь раз чаще.
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

/** Код без комментариев: докблоки цитируют то, что здесь ищется */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('срок страниц', () => {
  /*
   * Граница not-found, layout и template корня рисуются вместе с КАЖДОЙ
   * страницей под app/[lang], и кэш данных с числом в revalidate в любом из
   * них опускает срок всех страниц до своего (unstable-cache.js в Next
   * берёт меньший). Ни один тест поведения этого не видит: страница
   * рисуется так же, просто перегенерируется чаще. Так полка 404 с кэшем на
   * сутки держала карточку игры с revalidate на неделю на суточном сроке, а
   * статические /privacy и /support — ISR на сутки. Поведенческий сторож
   * границы — lib/notfound.test.ts; здесь — текст этих трёх файлов.
   */
  test('в границе not-found, layout и template [lang] нет кэша данных', () => {
    for (const file of ['not-found.tsx', 'layout.tsx', 'template.tsx']) {
      const src = code(read('app', '[lang]', file))
      expect(src, `${file}: unstable_cache`).not.toMatch(/\bunstable_cache\b/)
      expect(src, `${file}: "use cache"`).not.toMatch(/['"]use cache/)
      expect(src, `${file}: fetch с revalidate`).not.toMatch(/\brevalidate\s*:/)
    }
  })

  /*
   * Час стоял зря: на главной меняется только лента верха каталога, а он
   * неделями на месте. Каждая перегенерация — ~370 КБ HTML и RSC через
   * origin, на обоих языках (докблок revalidate в app/[lang]/page.tsx).
   * Литералом: Next читает revalidate только так.
   */
  test('главная перегенерируется раз в сутки', () => {
    expect(read('app', '[lang]', 'page.tsx')).toMatch(/^export const revalidate = 86_400$/m)
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

const cron = read('.github', 'workflows', 'cron.yml')

// Текст job'а — после его ключа и до ключа следующего job'а (тот же отступ
// в два пробела) или до конца файла
const jobOf = (file: string, yml: string, name: string) => {
  const at = yml.search(new RegExp(`^  ${name}:\\s*$`, 'm'))
  expect(at, `job ${name} в ${file} не найден`).toBeGreaterThan(-1)
  const body = yml.slice(at + `  ${name}:`.length)
  const next = body.search(/^ {2}[\w-]+:\s*$/m)
  return next === -1 ? body : body.slice(0, next)
}
const job = (name: string) => jobOf('cron.yml', cron, name)

describe('CI', () => {
  test('аудит зависимостей — последним шагом и при любом исходе прошлых, кроме отмены', () => {
    // Advisory публикуют независимо от содержимого PR. Стоял аудит вторым
    // шагом — и новое advisory прятало всё остальное: PR с настоящей ошибкой
    // типов или упавшим тестом получал один красный «Аудит» и ни строчки от
    // tsc, тестов и смоука. Последним он красит прогон так же, а скрыть уже
    // ничего не может. !cancelled(), а не always(): прогон, отменённый
    // пушем поверх (cancel-in-progress), аудит доигрывать не должен
    const ci = read('.github', 'workflows', 'ci.yml')
    const steps = jobOf('ci.yml', ci, 'check').split(/^ {6}- /m).slice(1)
    const audit = steps.findIndex((st) => /npm audit\b/.test(st))
    expect(audit, 'шаг с npm audit в ci.yml не найден').toBeGreaterThan(-1)
    expect(audit, 'после аудита не должно быть шагов').toBe(steps.length - 1)
    expect(steps[audit]).toMatch(/^\s*if: \$\{\{ !cancelled\(\) \}\}\s*$/m)
    expect(steps[audit]).toContain('--audit-level=high')
  })
})

describe('часовой прогон кронов', () => {
  test('health — первым шагом, до пингов, а пинги идут при любом его ответе', () => {
    // Health обязан читать итоги ПРОШЛОГО часа. Позови его после пингов — и
    // он читал бы запуски, начатые секунды назад, и крон, падающий через раз,
    // проскальзывал бы зелёным. А без always() красный health останавливал бы
    // и сами очереди
    const steps = job('ping').split(/^ {6}- name: /m).slice(1)
    const names = steps.map((st) => st.slice(0, st.indexOf('\n')).trim())
    expect(names[0]).toBe('Здоровье кронов')
    expect(steps[0]).toContain('https://imbored.cc/api/cron/health')
    expect(names.slice(1)).toEqual(['Пнуть /api/cron/news', 'Пнуть /api/cron/digest'])
    for (const st of steps.slice(1)) expect(st).toMatch(/^\s*if: always\(\)\s*$/m)
  })
})

describe('сторож прокси Cloudflare', () => {
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
