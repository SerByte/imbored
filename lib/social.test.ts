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
