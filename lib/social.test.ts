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
    expect(fs.existsSync(path.join(ROOT, 'app', '[lang]', 'opengraph-image.tsx'))).toBe(true)
  })

  test('корень объявляет имя сервиса и язык', () => {
    const layout = read('app/[lang]/layout.tsx')
    expect(layout).toMatch(/siteName:\s*'imbored'/)
    // язык — по сегменту [lang]: ru_RU у русской, en_US у английской
    expect(layout).toMatch(/locale:\s*ogLocale\(locale\)/)
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
      if (file.endsWith(path.join('app', '[lang]', 'layout.tsx'))) continue // корень и есть источник
      for (const m of src.matchAll(/openGraph:\s*\{([\s\S]{0,220}?)\}/g)) {
        // ...ogSite(locale) — тот же OG_SITE, но og:locale на языке страницы
        if (!m[1].includes('...OG_SITE') && !m[1].includes('...ogSite(')) offenders.push(path.relative(ROOT, file))
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
    const layout = read('app/[lang]/layout.tsx')
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
      'app/[lang]/page.tsx': '/',
      'app/[lang]/whatsnew/page.tsx': '/whatsnew',
      'app/[lang]/games/page.tsx': '/games',
      'app/[lang]/support/page.tsx': '/support',
      'app/[lang]/daily/layout.tsx': '/daily',
      // квиз открыт краулеру и идёт в выдачу: canonical сворачивает в него
      // /quiz?from=untouched и прочие хвосты (lib/robots)
      'app/[lang]/quiz/layout.tsx': '/quiz',
    }
    // Тексты на языке страницы — generateMetadata, который отдаёт ownAddress
    // со своими title и description (app/[lang]/daily/layout.tsx)
    for (const [file, url] of Object.entries(own)) {
      expect(read(file), file).toMatch(
        new RegExp(`(?:export const generateMetadata = |export async function generateMetadata\\b[^]*?return )ownAddress\\('${url}'`),
      )
    }
    // /privacy: title и description у каждого языка свои, поэтому generateMetadata —
    // функция, но адрес и картинку даёт тот же ownAddress
    expect(read('app/[lang]/privacy/page.tsx')).toMatch(/return ownAddress\('\/privacy', \{[^}]*\}\)\(props, parent\)/)
  })

  test('у каждого своего openGraph есть свой url и canonical', () => {
    const offenders: string[] = []
    for (const [file, src] of appFiles()) {
      if (file.endsWith(path.join('app', '[lang]', 'layout.tsx'))) continue
      // 404 вне разделов: openGraph корня плюс его карточка (у /_not-found нет
      // [lang], и файл туда не доходит). Своего адреса у 404 нет и быть не
      // должно: она под noindex, а og:url и canonical на мусорный адрес — ложь
      if (file.endsWith(path.join('app', 'global-not-found.tsx'))) continue
      for (const m of src.matchAll(/\bopenGraph:\s*\{/g)) {
        if (!/\burl\b/.test(objectAt(src, m.index))) offenders.push(path.relative(ROOT, file))
      }
      // localeAlternates(locale, url) — canonical на языке страницы и hreflang (lib/site.ts)
      if (/\bopenGraph:\s*\{/.test(src) && !/alternates:\s*(\{\s*canonical\b|localeAlternates\()/.test(src)) {
        offenders.push(path.relative(ROOT, file))
      }
    }
    expect([...new Set(offenders)], 'без своего url страница делится адресом главной').toEqual([])
  })

  /**
   * openGraph.images страницы ВЫТЕСНЯЕТ карточку opengraph-image.tsx: файл
   * Next берёт, только когда у страницы images нет (mergeStaticMetadata в
   * next/dist/lib/metadata/resolve-metadata.js). Случайная такая строка тихо
   * подменяет превью — однажды она уже стоила странице игры сырого баннера
   * 920×430 вместо карточки.
   */
  test('там, где есть opengraph-image.tsx, нет случайного openGraph.images', () => {
    // Намеренно — две страницы: на /en та же карточка того же маршрута, но с
    // английской подписью, а alt у файловой карточки без языка. Next берёт
    // images своего уровня вместо файла; что они ведут на свою карточку —
    // page.test.ts рядом с каждой. Именем, а не окном в 300 знаков ниже: оно
    // пропускало такие страницы случайно
    const deliberate = new Set(['app/[lang]/game/[appid]/news/[gid]/page.tsx', 'app/[lang]/compat/[steamid]/page.tsx'])
    const offenders: string[] = []
    for (const [file, src] of appFiles()) {
      if (!/openGraph:s*{/.test(src)) continue
      if (deliberate.has(path.relative(ROOT, file).split(path.sep).join('/'))) continue
      const dir = path.dirname(file)
      const hasFile =
        fs.existsSync(path.join(dir, 'opengraph-image.tsx')) ||
        fs.existsSync(path.join(ROOT, 'app', '[lang]', 'opengraph-image.tsx'))
      if (hasFile && /openGraph:\s*\{[\s\S]{0,300}?images:/.test(src)) {
        offenders.push(path.relative(ROOT, file))
      }
    }
    expect(offenders, 'images здесь подменяет карточку opengraph-image.tsx').toEqual([])
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

  /**
   * Вторая половина того же правила: зарегистрированный сегмент держит
   * картинку в кэше, только если ответ не несёт своего Cache-Control. Голый
   * new ImageResponse ставит `max-age=0`, app-route его не переписывает, и на
   * проде каждый заход в карточку игры, патча, жанра или выбора отвечал
   * STALE с перерисовкой (lib/ogresponse.ts). Сюда же — card.png портрета и
   * итогов года: это не opengraph-image, но кэш у них тот же.
   */
  test('картинка с revalidate рисуется через isrImage, а не голым ImageResponse', () => {
    const cached = appFiles().filter(
      ([, src]) => /export const revalidate\b/.test(src) && /\bImageResponse\b|\bisrImage\b/.test(src),
    )
    // семь карточек динамических сегментов, итоги года и две card.png
    expect(cached.length, 'картинок с revalidate не найдено').toBeGreaterThanOrEqual(10)
    const offenders = cached
      .filter(([, src]) => /new ImageResponse\(/.test(src) || !/\bisrImage\(/.test(src))
      .map(([file]) => path.relative(ROOT, file).split(path.sep).join('/'))
    expect(offenders, 'max-age=0 от next/og обнуляет срок ISR — см. lib/ogresponse.ts').toEqual([])
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
