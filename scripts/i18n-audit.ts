/**
 * npm run i18n:audit — английская версия глазами браузера, против уже
 * запущенного сервера (next dev или next start).
 *
 * Тесты проверяют функции: что tr() вернёт английскую строку, если его
 * позвали. Они не видят строку, до которой tr() никто не довёл, — а таких на
 * переводе сайта из двухсот файлов будет больше всего. Этот прогон открывает
 * страницы так, как их откроет человек, и ищет на /en то, что осталось
 * русским, вместе с тем, что перевод мог сломать: вылезшую за экран строку,
 * исключение, расхождение гидрации, ссылку с /en обратно на русский сайт.
 *
 *   npx tsx scripts/i18n-audit.ts --base http://localhost:3000 \
 *     --paths /en,/en/play,/en/game/730 --widths 360,768,1280 --demo \
 *     --shots D:/tmp/shots --json D:/tmp/audit.json
 *
 * --paths   адреса через запятую; русские адреса (без /en) тоже можно —
 *           для них ищется не кириллица, а то, что перевод сломал вёрстку
 * --demo    сначала войти в демо (POST /api/connect { demo: true }), чтобы
 *           открылись личные страницы: /library, /portrait, /compat
 * --shots   каталог для снимков <путь>@<ширина>.png — их читают глазами
 * --json    отчёт целиком, для того, кто будет разбирать его дальше
 *
 * Кириллица внутри элемента с lang="ru" (название игры, ник, русский текст
 * данных, честно помеченный textLangOn) отчитывается отдельно и прогон не
 * валит: это не забытый перевод, а чужой текст. Всё остальное на /en валит.
 *
 * Браузер — как у смоука: SMOKE_CHROME_PATH или установленный Chrome.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { LOCALIZED_SECTIONS } from '../lib/i18n'

type Finding = {
  path: string
  width: number
  kind: 'cyrillic' | 'cyrillic-marked' | 'overflow' | 'pageerror' | 'hydration' | 'console' | 'lang' | 'link' | 'status'
  detail: string
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : ''
}

const BASE = (arg('base') ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const PATHS = (arg('paths') ?? '/en')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => {
    // Git Bash (MSYS) переписывает аргумент «/en» в путь Windows «F:/Git/en»:
    // такой адрес не открыть, и прогон честно падает, а не проверяет не то
    if (/^[A-Za-z]:[\/]/.test(p)) {
      console.error(`«${p}» — это путь Windows, а не адрес: в Git Bash запускайте с MSYS_NO_PATHCONV=1 или пишите адреса без ведущего слэша (en/play)`)
      process.exit(2)
    }
    return p.startsWith('/') ? p : '/' + p
  })
const WIDTHS = (arg('widths') ?? '360,768,1280').split(',').map(Number).filter((n) => n > 0)
const DEMO = arg('demo') !== undefined
const SHOTS = arg('shots') || null
const JSON_OUT = arg('json') || null
const TIMEOUT = 60_000

const SECTIONS = new Set<string>(LOCALIZED_SECTIONS)
const isEn = (p: string) => p === '/en' || p.startsWith('/en/') || p.startsWith('/en?')

type Harvest = {
  found: { text: string; marked: boolean; where: string }[]
  overflowPage: boolean
  culprits: string[]
  links: string[]
  lang: string
}

/**
 * Всё, что человек видит или слышит от страницы, — в браузере, одним проходом.
 *
 * Код страницы лежит в scripts/i18n-audit.page.js и передаётся строкой: tsx (esbuild с keepNames)
 * оборачивает каждую именованную функцию в __name(...), а в браузере этого
 * помощника нет, и evaluate падал с ReferenceError на первой же странице.
 */
const HARVEST = fs.readFileSync(path.join(__dirname, 'i18n-audit.page.js'), 'utf8')

async function harvest(page: Page): Promise<Harvest> {
  return (await page.evaluate(HARVEST)) as Harvest
}

async function demoLogin(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage()
  await page.goto(BASE + '/en', { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demo: true }),
    })
    return res.status
  })
  await page.close()
  if (status !== 200) throw new Error(`демо-вход ответил ${status}`)
}

async function main(): Promise<void> {
  const executablePath = process.env.SMOKE_CHROME_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' })
  const findings: Finding[] = []
  try {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: width < 768 ? 800 : 900 },
        locale: 'en-US',
        timezoneId: 'UTC',
        reducedMotion: 'reduce',
      })
      if (DEMO) await demoLogin(ctx)
      for (const p of PATHS) {
        const page = await ctx.newPage()
        const add = (kind: Finding['kind'], detail: string) => findings.push({ path: p, width, kind, detail })
        page.on('pageerror', (e) => add('pageerror', e.message.slice(0, 200)))
        page.on('console', (m) => {
          const t = m.text()
          if (/hydrat/i.test(t)) add('hydration', t.slice(0, 240))
          else if (m.type() === 'error' && !/Failed to load resource|favicon|_vercel/i.test(t)) add('console', t.slice(0, 200))
        })
        try {
          const res = await page.goto(BASE + p, { waitUntil: 'load', timeout: TIMEOUT })
          if (!res || res.status() >= 400) add('status', `документ ${res?.status() ?? 'не пришёл'}`)
          // Острова и подгрузки: дать клиенту дорисовать то, что он дорисует
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
          await page.waitForTimeout(400)
          const h = await harvest(page)
          const en = isEn(new URL(page.url()).pathname)
          if (en && h.lang !== 'en') add('lang', `<html lang="${h.lang}">`)
          if (!en && h.lang !== 'ru') add('lang', `<html lang="${h.lang}">`)
          if (en) {
            for (const f of h.found) add(f.marked ? 'cyrillic-marked' : 'cyrillic', `${f.where}: ${f.text}`)
            // Ссылка с английской страницы на русский раздел — человек
            // молча переезжает на другой язык
            for (const href of new Set(h.links)) {
              if (!href.startsWith('/') || href.startsWith('//')) continue
              const first = href.split(/[/?#]/)[1] ?? ''
              const local = href === '/' || href.startsWith('/?') || href.startsWith('/#') || SECTIONS.has(first)
              if (local && first !== 'en') add('link', href)
            }
          }
          if (h.overflowPage) add('overflow', h.culprits.join(' | ') || 'scrollWidth больше окна')
          if (SHOTS) {
            fs.mkdirSync(SHOTS, { recursive: true })
            const name = `${p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}@${width}.png`
            await page.screenshot({ path: path.join(SHOTS, name), fullPage: true })
          }
        } catch (err) {
          add('status', err instanceof Error ? err.message.split('\n')[0] : String(err))
        } finally {
          await page.close()
        }
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
  }

  // Одна строка на находку, повторы по ширинам — одной строкой с перечнем
  const merged = new Map<string, { f: Finding; widths: number[] }>()
  for (const f of findings) {
    const key = `${f.path}|${f.kind}|${f.detail}`
    const m = merged.get(key)
    if (m) m.widths.push(f.width)
    else merged.set(key, { f, widths: [f.width] })
  }
  const rows = [...merged.values()]
  const fatal = rows.filter((r) => r.f.kind !== 'cyrillic-marked' && r.f.kind !== 'console')
  for (const r of rows) console.log(`${r.f.kind.padEnd(16)} ${r.f.path} @${r.widths.join(',')}  ${r.f.detail}`)
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows.map((r) => ({ ...r.f, widths: r.widths })), null, 1))
  console.log(`\n${PATHS.length} адресов × ${WIDTHS.length} ширины: ${fatal.length} находок, ${rows.length - fatal.length} справочных (помеченный lang="ru" чужой текст, ошибки консоли).`)
  if (fatal.length) process.exit(1)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(2)
})
