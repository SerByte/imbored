import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { applyStoredTheme, saveTheme, STORAGE_KEY } from '../components/ThemeToggle'
import { syncThemeColor, THEME_COLOR } from './themecolor'

/**
 * Цвет обвязки браузера — вслед за шапкой.
 *
 * DOM в тестах нет, поэтому документ и чтение стиля — заглушки: шапка с
 * заданным --bg и meta с тем, что сейчас в разметке.
 */

function page(headerBg: string | null, meta = true) {
  const tag = { content: THEME_COLOR }
  const header = {}
  const doc = {
    querySelector: (sel: string) => {
      if (sel === 'body > header') return headerBg === null ? null : header
      if (sel === 'meta[name="theme-color"]') return meta ? tag : null
      return null
    },
  } as unknown as Pick<Document, 'querySelector'>
  const styleOf = (el: Element) => {
    expect(el, 'стиль читается у шапки, а не у страницы').toBe(header)
    return { getPropertyValue: (name: string) => (name === '--bg' ? ` ${headerBg ?? ''}` : '') }
  }
  return { doc, styleOf, tag }
}

describe('syncThemeColor', () => {
  test('светлая тема над контентом — молочная полоса', () => {
    const { doc, styleOf, tag } = page('#f5f5f7')
    syncThemeColor(doc, styleOf)
    expect(tag.content).toBe('#f5f5f7')
  })

  /** Тот же человек на светлой, но шапка над героем: правило шапки дало ей --bg зоны */
  test('над кино-зоной — тёмная, в какой бы теме ни был сайт', () => {
    const { doc, styleOf, tag } = page('#050505')
    tag.content = '#f5f5f7'
    syncThemeColor(doc, styleOf)
    expect(tag.content).toBe('#050505')
  })

  test('«Что нового» — свой фон зоны, а не общий тёмный', () => {
    const { doc, styleOf, tag } = page('#050507')
    syncThemeColor(doc, styleOf)
    expect(tag.content).toBe('#050507')
  })

  test('нет шапки, meta или значения — цвет не трогаем', () => {
    for (const p of [page(null), page(''), page('#f5f5f7', false)]) {
      expect(() => syncThemeColor(p.doc, p.styleOf)).not.toThrow()
      expect(p.tag.content).toBe(THEME_COLOR)
    }
  })
})

const ROOT = path.join(__dirname, '..')
/** Код без комментариев: они цитируют то, что здесь ищется */
const code = (p: string) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*/gm, '')

/**
 * Два места, где меняется то, что стоит под шапкой, — и оба обязаны
 * перекрасить обвязку ПОСЛЕ своей правки: --bg шапки читается уже с новым
 * атрибутом.
 */
describe('обвязку перекрашивают те, кто меняет шапку', () => {
  test('ChromeZone — на каждом решении наблюдателя, после data-chrome', () => {
    const src = code('components/ChromeZone.tsx')
    const at = src.indexOf('new IntersectionObserver(')
    expect(at, 'наблюдатель не найден — сторож ослеп').toBeGreaterThan(-1)
    const callback = src.slice(at, src.indexOf('{ rootMargin', at))
    const attr = callback.lastIndexOf('root.dataset.chrome')
    const sync = callback.indexOf('syncThemeColor()')
    expect(sync, 'наблюдатель меняет шапку, а адресная строка остаётся прежней').toBeGreaterThan(-1)
    expect(sync, 'перекрашивать после data-chrome, иначе прочитается старый --bg').toBeGreaterThan(attr)
  })

  test('ThemeToggle — после data-theme', () => {
    const src = code('components/ThemeToggle.tsx')
    const at = src.indexOf('function toggle()')
    expect(at, 'toggle не найден — сторож ослеп').toBeGreaterThan(-1)
    const body = src.slice(at, src.indexOf('\n  }\n', at))
    const attr = body.lastIndexOf('dataset.theme')
    const sync = body.indexOf('syncThemeColor()')
    expect(sync, 'тема сменилась, а адресная строка осталась прежней').toBeGreaterThan(-1)
    expect(sync).toBeGreaterThan(attr)
  })
})

/**
 * Светлая тема на 404 изнутри страницы (/game/<нет такой>, /pick/<истёк>).
 *
 * notFound() без Suspense над ним держит статус 404, но документ при этом
 * приходит пустой оболочкой <html id="__next_error__">, и корневой лэйаут
 * рисует уже браузер (createRoot, а не гидратация). Скрипт темы из
 * app/layout.tsx в таком документе создаёт React, а созданный React <script>
 * не исполняется никогда — data-theme не ставился, и тот, кто выбрал светлую,
 * получал тёмную страницу с «тёмным» значком темы. Тему ставит ThemeToggle:
 * он в шапке, то есть монтируется и в таком документе.
 */
describe('сохранённая тема — и там, где скрипт темы не исполнился', () => {
  /** <html> и хранилище — заглушками: DOM в тестах нет */
  function root(theme?: string) {
    return { dataset: (theme ? { theme } : {}) as DOMStringMap }
  }
  const stored = (value: string | null) => () => ({ getItem: () => value })

  test('сохранена светлая, атрибута нет — ставим', () => {
    const html = root()
    expect(applyStoredTheme(html, stored('light'))).toBe(true)
    expect(html.dataset.theme).toBe('light')
  })

  test('тёмная, ничего не сохранено или атрибут уже стоит — не трогаем', () => {
    for (const value of ['dark', null]) {
      const html = root()
      expect(applyStoredTheme(html, stored(value))).toBe(false)
      expect(html.dataset.theme).toBeUndefined()
    }
    // Поставил скрипт темы — обычный путь серверного рендера; второй раз
    // перекрашивать обвязку незачем
    expect(applyStoredTheme(root('light'), stored('light'))).toBe(false)
  })

  /** Хранилище бросает (приватный режим, запрет данных сайта) — как и в скрипте темы */
  test('хранилище бросает — тема базовая, страница цела', () => {
    const html = root()
    const blocked = () => {
      throw new Error('SecurityError')
    }
    expect(() => applyStoredTheme(html, blocked)).not.toThrow()
    expect(html.dataset.theme).toBeUndefined()
  })

  test('ключ хранилища — тот же, что читает скрипт темы', () => {
    const layout = fs.readFileSync(path.join(ROOT, 'app', '[lang]', 'layout.tsx'), 'utf8')
    expect(layout).toContain(`localStorage.getItem('${STORAGE_KEY}')`)
  })

  /*
   * Эффект разметки, а не обычный: он идёт до первой отрисовки, и тёмного
   * кадра между рендером и правкой нет. Обвязку перекрашивает следом — как
   * toggle.
   */
  test('ThemeToggle ставит её до отрисовки и перекрашивает обвязку следом', () => {
    const src = code('components/ThemeToggle.tsx')
    const at = src.indexOf('useLayoutEffect(')
    expect(at, 'эффект разметки не найден — тема на 404 снова тёмная').toBeGreaterThan(-1)
    const effect = src.slice(at, src.indexOf('}, [])', at))
    expect(effect).toMatch(/if \(applyStoredTheme\(document\.documentElement, \(\) => localStorage\)\) syncThemeColor\(\)/)
  })
})

/**
 * Выбор темы запоминается, а запрет хранилища — не авария.
 *
 * Чтение темы стояло в try с самого начала (скрипт темы, applyStoredTheme), а
 * запись в toggle() — нет. При «не сохранять данные сайтов» в Chrome или
 * запрете кук в Firefox бросает уже само обращение к localStorage: тема на
 * экране менялась, а исключение уходило из обработчика клика в window.onerror
 * и оттуда отчётом в /api/clienterr — на каждое нажатие, про известное и
 * безвредное. Тема просто не запомнится до перезагрузки.
 */
describe('запись выбора темы', () => {
  test('выбор уходит в хранилище под тем же ключом, что читает скрипт темы', () => {
    const saved = new Map<string, string>()
    saveTheme('light', () => ({ setItem: (k: string, v: string) => void saved.set(k, v) }))
    expect(saved.get(STORAGE_KEY)).toBe('light')
  })

  test('хранилище бросает уже на обращении — переключение не бросает', () => {
    const blocked = () => {
      throw new Error('SecurityError: The operation is insecure.')
    }
    expect(() => saveTheme('dark', blocked)).not.toThrow()
    const full = () => ({
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(() => saveTheme('light', full)).not.toThrow()
  })

  test('toggle пишет только через saveTheme — голого localStorage.setItem в нём нет', () => {
    const src = code('components/ThemeToggle.tsx')
    const at = src.indexOf('function toggle()')
    const body = src.slice(at, src.indexOf('\n  }\n', at))
    expect(body).toMatch(/saveTheme\(next, \(\) => localStorage\)/)
    expect(body).not.toMatch(/localStorage\.setItem/)
  })
})
