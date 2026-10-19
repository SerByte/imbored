/**
 * npm run smoke — главный путь сайта в настоящем браузере, против уже
 * запущенного `next start`.
 *
 * Тесты проверяют части, сборка — что всё собирается. Ни то ни другое не
 * видит, что собранный сайт на чистой базе без ключей вообще поднимается и
 * что по нему можно пройти: вход, квиз, выдача, страница игры. Этот прогон —
 * ровно это, в CI после сборки (.github/workflows/ci.yml, шаг «Смоук»).
 * Первым шагом пути — русский браузер на «/»: он остаётся на русской
 * главной, а английский с того же адреса уезжает на /en (lib/homelocale.ts).
 *
 * После русского пути — мусорный адрес и опечатка под разделом: noindex в
 * HTML на любом сервере (против прода с SMOKE_BASE_URL — проверка после
 * деплоя) и код 404 — строго только на localhost или с SMOKE_EXPECT_404=1.
 *
 * Следом — английский проход: /en и /en/quiz отвечают 200 с <html lang="en">,
 * английский браузер с «/» уезжает на /en, а /ru/quiz снаружи — постоянный
 * редирект на /quiz (docs/i18n.md, «Адреса»).
 *
 * Без ключей Steam и модели: демо-вход сети не требует, выдача — эвристика.
 * Единственный поход наружу — цены Steam (lib/deals), и его отказ выдачу не
 * роняет. Картинки из CDN Steam могут не грузиться — это не провал.
 *
 * Провал — это: исключение на странице (pageerror), ответ 5xx от нашего
 * сервера, документ не 200, мусорный адрес без noindex (или не 404 там, где
 * код проверяется строго), ожидаемый шаг не наступил за отведённое время.
 *
 * Браузер: в CI — Chrome раннера (channel 'chrome'); локально —
 * SMOKE_CHROME_PATH=/путь/к/chromium. Адрес — SMOKE_BASE_URL, по умолчанию
 * http://localhost:3000: кука сессии ставится с Secure, и браузер примет её
 * по http только от localhost.
 */
import { chromium, type Page, type Response } from 'playwright-core'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000'
const STEP_MS = 45_000

/**
 * Код 404 у мусорного адреса — провал только там, где его отдаёт сервер
 * Next: next start на этой машине (CI) или явный SMOKE_EXPECT_404=1.
 *
 * Vercel отдаёт тот же пререндер /_not-found кодом 200 (app/global-not-found.tsx),
 * и это правка маршрутизации, которой ещё нет. Строгая проверка против прода
 * гарантированно краснела бы тремя строками на каждом прогоне после деплоя, и
 * за ними терялась бы настоящая поломка. Там код — предупреждением, а noindex
 * проверяется строго везде: его и чинили. Когда маршрутизация будет готова —
 * прогон против прода с SMOKE_EXPECT_404=1 её и проверит.
 */
const STRICT_404 =
  process.env.SMOKE_EXPECT_404 === '1' || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname)

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

    await step('русский браузер на «/» остаётся на русской главной', async () => {
      await open(page, '/')
      if (new URL(page.url()).pathname !== '/') throw new Error(`«/» привёл на ${page.url()}`)
      const lang = await page.locator('html').getAttribute('lang')
      if (lang !== 'ru') throw new Error(`<html lang="${lang}"> на /`)
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

    /*
     * Мусорный адрес и опечатка под русским разделом — 404 с noindex.
     *
     * Правило afterFiles уводит их в пререндер /_not-found
     * (garbageRewrites в lib/i18nroutes.ts). Под next start сервер Next
     * отдаёт его кодом 404, а Vercel — кодом 200, как обычную статическую
     * страницу: замер прода 19.10.2026 — /games/nonexistent-genre, /quiz/xyz,
     * /xyz отвечали «200 OK» без единого <meta name="robots">, мягким 404 с
     * заголовком главной. noindex теперь в метаданных самой 404
     * (app/global-not-found.tsx) и проверяется здесь на любом сервере —
     * против прода (SMOKE_BASE_URL) этот шаг и есть проверка после деплоя.
     * Код — строго только под STRICT_404: CI на next start видит 404 всегда,
     * а прод до правки маршрутизации — 200, и там это предупреждение.
     *
     * fetch, а не браузер: ответ 404 браузер покажет как есть, а смотреть
     * нужно код и сырой HTML, без скрипта.
     */
    await step('мусорный адрес и опечатка под разделом — 404 с noindex', async () => {
      for (const path of ['/xyz-smoke', '/quiz/xyz', '/games/no-such-genre']) {
        const res = await fetch(BASE + path, { redirect: 'manual' })
        const html = await res.text()
        if (res.status !== 404) {
          const what = `${path}: код ${res.status}, а не 404 — мягкий 404`
          if (STRICT_404) problems.push(what)
          else console.warn(`  ! ${what} (ждём правку маршрутизации на Vercel; строго — SMOKE_EXPECT_404=1)`)
        }
        if (!/<meta name="robots" content="noindex/.test(html)) problems.push(`${path}: нет <meta name="robots" content="noindex…">`)
      }
    })

    /*
     * Английская версия — отдельным контекстом с английским браузером: ни
     * кук, ни Accept-Language русского прохода, как у человека, который
     * пришёл впервые (docs/i18n.md).
     */
    const en = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    })
    const enPage = await en.newPage()
    enPage.setDefaultTimeout(STEP_MS)
    watch(enPage)

    await step('английская главная открывается на английском', async () => {
      await open(enPage, '/en')
      const lang = await enPage.locator('html').getAttribute('lang')
      if (lang !== 'en') throw new Error(`<html lang="${lang}"> на /en`)
    })

    await step('английский браузер с «/» уезжает на /en', async () => {
      await open(enPage, '/')
      if (new URL(enPage.url()).pathname !== '/en') throw new Error(`«/» привёл на ${enPage.url()}`)
    })

    await step('английский квиз открывается', async () => {
      await open(enPage, '/en/quiz')
      const lang = await enPage.locator('html').getAttribute('lang')
      if (lang !== 'en') throw new Error(`<html lang="${lang}"> на /en/quiz`)
    })

    await step('/ru/quiz — постоянный редирект на /quiz', async () => {
      const res = await enPage.goto(BASE + '/ru/quiz', { waitUntil: 'domcontentloaded', timeout: STEP_MS })
      const hop = res?.request().redirectedFrom()
      const status = (await hop?.response())?.status()
      if (status !== 308) throw new Error(`/ru/quiz ответил ${status ?? 'без редиректа'}`)
      if (res?.url() !== BASE + '/quiz') throw new Error(`/ru/quiz привёл на ${res?.url()}`)
      if (res?.status() !== 200) problems.push(`/quiz после редиректа: документ ${res?.status()}`)
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
