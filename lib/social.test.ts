import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож превью в мессенджерах.
 *
 * Ссылку на imbored кидают другому — в этом весь продукт: приглашение в пати,
 * ссылка на совместимость, «смотри, во что зайти». Значит первое впечатление
 * случается в чате, до всякого сайта. И проверить его в вебе нечем: превью
 * собирает краулер, а не браузер.
 *
 * Тест читает исходники, а не рендерит: он сторожит две вещи, каждая из
 * которых уже ломалась ровно один раз.
 */

const ROOT = path.join(__dirname, '..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** Все .tsx приложения — [путь, содержимое]. */
function appFiles(): [string, string][] {
  const out: [string, string][] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push([p, fs.readFileSync(p, 'utf8')])
    }
  }
  walk(path.join(ROOT, 'app'))
  return out
}

/**
 * Объект, открытый первой «{» после позиции at, — по балансу скобок. Ленивая
 * регулярка до первой «}» спотыкалась о `${meta.name}` в заголовке игры.
 */
function objectAt(src: string, at: number): string {
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return src.slice(open)
}

describe('превью в мессенджерах', () => {
  test('у корня есть своя карточка — она достаётся всем, у кого нет своей', () => {
    expect(fs.existsSync(path.join(ROOT, 'app', 'opengraph-image.tsx'))).toBe(true)
  })

  test('корень объявляет имя сервиса и язык', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toMatch(/siteName:\s*'imbored'/)
    expect(layout).toMatch(/locale:\s*'ru_RU'/)
  })

  /**
   * Объект metadata сливается ПОЛЕМ: страница со своим openGraph заменяет
   * корневой целиком, а не дополняет. Именно так три самые пересылаемые
   * страницы молча теряли siteName, и в чате вместо «imbored» показывался
   * голый домен.
   */
  test('каждый свой openGraph подмешивает общую часть', () => {
    const offenders: string[] = []
    for (const [file, src] of appFiles()) {
      if (!/\bopenGraph:\s*\{/.test(src)) continue
      if (file.endsWith(path.join('app', 'layout.tsx'))) continue // корень и есть источник
      for (const m of src.matchAll(/openGraph:\s*\{([\s\S]{0,220}?)\}/g)) {
        if (!m[1].includes('...OG_SITE')) offenders.push(path.relative(ROOT, file))
      }
    }
    expect([...new Set(offenders)], 'openGraph без ...OG_SITE теряет siteName и locale').toEqual([])
  })

  /**
   * og:url — адрес самой страницы. В корне стоял '/', его наследовали все,
   * у кого не было своего openGraph, и VK с Facebook склеивали ссылку на
   * /privacy или /whatsnew с главной.
   */
  test('корень не раздаёт свой og:url всем подряд', () => {
    const layout = read('app/layout.tsx')
    const at = layout.search(/\bopenGraph:\s*\{/)
    expect(at, 'openGraph в корне не найден').toBeGreaterThan(-1)
    expect(objectAt(layout, at)).not.toMatch(/\burl\b/)
  })

  /**
   * Страницы без своей карточки получают адрес через ownAddress — он же
   * переносит корневую картинку, которую свой openGraph иначе стёр бы.
   */
  test('страницы без своей карточки объявляют свой адрес', () => {
    const own: Record<string, string> = {
      'app/page.tsx': '/',
      'app/whatsnew/page.tsx': '/whatsnew',
      'app/privacy/page.tsx': '/privacy',
      'app/support/page.tsx': '/support',
      'app/daily/layout.tsx': '/daily',
    }
    for (const [file, url] of Object.entries(own)) {
      expect(read(file), file).toMatch(new RegExp(`export const generateMetadata = ownAddress\\('${url}'`))
    }
  })

  test('у каждого своего openGraph есть свой url и canonical', () => {
    const offenders: string[] = []
    for (const [file, src] of appFiles()) {
      if (file.endsWith(path.join('app', 'layout.tsx'))) continue
      for (const m of src.matchAll(/\bopenGraph:\s*\{/g)) {
        if (!/\burl\b/.test(objectAt(src, m.index))) offenders.push(path.relative(ROOT, file))
      }
      if (/\bopenGraph:\s*\{/.test(src) && !/alternates:\s*\{\s*canonical\b/.test(src)) {
        offenders.push(path.relative(ROOT, file))
      }
    }
    expect([...new Set(offenders)], 'без своего url страница делится адресом главной').toEqual([])
  })

  /**
   * Файловая метадата приоритетнее объекта metadata. Значит openGraph.images
   * рядом с opengraph-image.tsx никогда не применится — такие строки не
   * ломают превью, но врут читающему код, а однажды уже стоили страницы игры
   * сырого баннера 920×430 вместо карточки.
   */
  test('там, где есть opengraph-image.tsx, нет мёртвого openGraph.images', () => {
    const offenders: string[] = []
    for (const [file, src] of appFiles()) {
      if (!/\bopenGraph:\s*\{/.test(src)) continue
      const dir = path.dirname(file)
      const hasFile =
        fs.existsSync(path.join(dir, 'opengraph-image.tsx')) ||
        fs.existsSync(path.join(ROOT, 'app', 'opengraph-image.tsx'))
      if (hasFile && /openGraph:\s*\{[\s\S]{0,300}?images:/.test(src)) {
        offenders.push(path.relative(ROOT, file))
      }
    }
    expect(offenders, 'images здесь мёртв — картинку даёт opengraph-image.tsx').toEqual([])
  })

  /**
   * revalidate у карточки в динамическом сегменте без generateStaticParams —
   * мёртвая строка: сегмент не попадает в dynamicRoutes манифеста, маршрут
   * остаётся ƒ, и картинка рисуется заново на каждый заход краулера. Так было
   * у четырёх карточек, а потом у карточки игры — самой пересылаемой из всех.
   * Функция у page.tsx того же сегмента картинку не спасает: это отдельный
   * маршрут.
   */
  test('карточка с revalidate в динамическом сегменте регистрирует сегмент', () => {
    const offenders: string[] = []
    for (const [file, src] of appFiles()) {
      if (!['opengraph-image.tsx', 'twitter-image.tsx'].includes(path.basename(file))) continue
      if (!path.relative(ROOT, file).includes('[')) continue
      if (!/export const revalidate\b/.test(src)) continue
      if (!/export (async )?function generateStaticParams\b/.test(src)) {
        offenders.push(path.relative(ROOT, file).split(path.sep).join('/'))
      }
    }
    expect(offenders, 'без generateStaticParams revalidate не значит ничего').toEqual([])
  })

  test('все карточки рисуются в 1200×630 — это то, что показывают Telegram и Discord', () => {
    const cards = appFiles().filter(([f]) => path.basename(f) === 'opengraph-image.tsx')
    expect(cards.length, 'карточек не найдено').toBeGreaterThanOrEqual(3)
    for (const [file, src] of cards) {
      expect(src, path.relative(ROOT, file)).toMatch(/size\s*=\s*\{\s*width:\s*1200,\s*height:\s*630\s*\}/)
      expect(src, path.relative(ROOT, file)).toContain("contentType = 'image/png'")
    }
  })

  /**
   * satori не исполняет CSS-переменные: var(--bg) там превращается в пустую
   * строку. Поэтому цвета в карточках — литералы, и единственная защита от
   * того, что бренд в чате разъедется с брендом на сайте, — держать эти
   * литералы в одном модуле.
   *
   * Шрифты проверяются по факту передачи в ImageResponse, а не по имени
   * импорта: у портрета они приезжают через соседний share-card, который сам
   * реэкспортирует ogFonts, и запрещать это было бы придиркой к пути, а не к
   * сути.
   */
  test('карточки не заводят своих цветов и передают шрифты', () => {
    for (const [file, src] of appFiles().filter(([f]) => path.basename(f) === 'opengraph-image.tsx')) {
      const rel = path.relative(ROOT, file)
      const body = src.replace(/^import[\s\S]*?from '[^']+'$/gm, '')
      const hex = [...body.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0])
      expect(hex, `${rel}: цвет литералом мимо lib/og`).toEqual([])
      expect(src, `${rel}: шрифты не переданы в ImageResponse`).toMatch(/fonts:\s*await\s+\w+/)
    }
  })
})
