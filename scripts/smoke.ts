/**
 * npm run smoke — главный путь сайта в настоящем браузере, против уже
 * запущенного `next start`.
 *
 * Тесты проверяют части, сборка — что всё собирается. Ни то ни другое не
 * видит, что собранный сайт на чистой базе без ключей вообще поднимается и
 * что по нему можно пройти: вход, квиз, выдача, страница игры. Этот прогон —
 * ровно это, в CI после сборки (.github/workflows/ci.yml, шаг «Смоук»).
 *
 * Без ключей Steam и модели: демо-вход сети не требует, выдача — эвристика.
 * Единственный поход наружу — цены Steam (lib/deals), и его отказ выдачу не
 * роняет. Картинки из CDN Steam могут не грузиться — это не провал.
 *
 * Провал — это: исключение на странице (pageerror), ответ 5xx от нашего
 * сервера, документ не 200, ожидаемый шаг не наступил за отведённое время.
 *
 * Браузер: в CI — Chrome раннера (channel 'chrome'); локально —
 * SMOKE_CHROME_PATH=/путь/к/chromium. Адрес — SMOKE_BASE_URL, по умолчанию
 * http://localhost:3000: кука сессии ставится с Secure, и браузер примет её
 * по http только от localhost.
 */
import { chromium, type Page, type Response } from 'playwright-core'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000'
const STEP_MS = 45_000

const problems: string[] = []

function watch(page: Page): void {
  page.on('pageerror', (err) => problems.push(`исключение на ${page.url()}: ${err.message.slice(0, 200)}`))
  page.on('response', (res: Response) => {
    const url = res.url()
    if (!url.startsWith(BASE)) return
    // Скрипты аналитики Vercel под next start отдают 404 — это не наше
    if (url.includes('/_vercel/')) return
    if (res.status() >= 500) problems.push(`${res.status()} ${url.slice(BASE.length)}`)
  })
}

async function open(page: Page, path: string): Promise<void> {
  const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: STEP_MS })
  if (res?.status() !== 200) problems.push(`${path}: документ ${res?.status() ?? 'не пришёл'}`)
}

async function step(name: string, run: () => Promise<void>): Promise<void> {
  const t = Date.now()
  try {
    await run()
    console.log(`✓ ${name} (${Date.now() - t} мс)`)
  } catch (err) {
    problems.push(`${name}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    console.log(`✗ ${name}`)
    throw err
  }
}

async function main(): Promise<void> {
  const executablePath = process.env.SMOKE_CHROME_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' })
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'ru-RU',
      timezoneId: 'UTC',
      // Меньше хореографии — меньше ожидания: переходы квиза и выдачи короче
      reducedMotion: 'reduce',
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(STEP_MS)
    watch(page)

    await step('политика открывается', async () => {
      await open(page, '/privacy')
      await page.getByRole('heading', { level: 1, name: 'Что мы о тебе знаем' }).waitFor()
    })

    await step('демо-вход с главной ведёт в квиз', async () => {
      await open(page, '/')
      await page.getByRole('button', { name: /Демо без Steam/ }).first().click()
      await page.waitForURL(/\/quiz/)
    })

    await step('квиз из трёх ответов ведёт на выдачу', async () => {
      for (const answer of [/Меньше часа/, /Расслабиться/, /Один/]) {
        await page.getByRole('button', { name: answer }).first().click()
      }
      await page.waitForURL(/\/play/)
    })

    let game = ''
    await step('выдача показывает игру', async () => {
      await page.getByRole('button', { name: /Не то — дальше/ }).waitFor()
      game = (await page.locator('a[title="Подробнее об игре"]').first().getAttribute('href')) ?? ''
      if (!/^\/game\/-?\d+$/.test(game)) throw new Error(`ссылка на игру странная: «${game}»`)
    })

    await step('страница игры открывается', async () => {
      await open(page, game)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
    })
  } finally {
    await browser.close()
  }
}

main()
  .catch((err: unknown) => {
    // Провал шага уже записан самим шагом. А вот браузер, который не
    // запустился, и контекст, который не создался, — нет: без этой строки
    // смоук рапортовал бы успех, не открыв ни одной страницы
    if (!problems.length) problems.push(`до первого шага: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
  })
  .finally(() => {
    if (problems.length) {
      console.error('\nСмоук не прошёл:\n' + problems.map((p) => `  • ${p}`).join('\n'))
      process.exit(1)
    }
    console.log('\nСмоук прошёл.')
  })
