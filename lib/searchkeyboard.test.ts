import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { holdKeyboard } from '@/components/SearchLauncher'
import { code, ROOT } from './testing/importgraph'

/**
 * Сторож клавиатуры «Найти игру» на телефоне.
 *
 * iPhone поднимает клавиатуру, только если фокус в поле пришёл внутри жеста
 * пользователя. На касании чанк окна к click почти никогда не успевает:
 * pointerenter у пальца приходит вместе с pointerdown, click — через
 * 50–150 мс, а чанку нужен круг до сервера (components/SearchLauncher). Окно
 * вставало после await, фокус в его поле приходил вне жеста — и человек видел
 * поле без клавиатуры и тапал второй раз. Ровно на первом открытии после
 * загрузки страницы.
 *
 * Клавиатуру держит подставка (holdKeyboard): невидимое поле, фокус в которое
 * приходит в самом click, — а окно, приехав, переводит фокус в своё поле.
 * Ломается это молча и только на телефоне: перенеси подставку в .then — и на
 * десктопе всё как было. Браузера в тестах нет, поэтому подставка проверяется
 * на макете документа, а порядок в обработчике — чтением исходника, как у
 * остальных сторожей окна (lib/catalogsearch.test.ts).
 */

/** Макет документа: ровно то, чего касается подставка */
function fakeDocument() {
  // Свойством, а не переменной: фокус ставит метод поля (this)
  const focus = { active: null as FakeInput | null }
  const body = {
    children: [] as FakeInput[],
    append(el: FakeInput) {
      body.children.push(el)
    },
  }
  class FakeInput {
    attrs: Record<string, string> = {}
    style = { cssText: '' }
    readOnly = false
    value = ''
    focusedWith: FocusOptions | undefined
    private onBlur: Array<() => void> = []
    get isConnected() {
      return body.children.includes(this)
    }
    setAttribute(name: string, value: string) {
      this.attrs[name] = value
    }
    addEventListener(type: string, fn: () => void) {
      if (type === 'blur') this.onBlur.push(fn)
    }
    focus(options?: FocusOptions) {
      this.focusedWith = options
      focus.active = this
    }
    remove() {
      body.children = body.children.filter((c) => c !== this)
    }
    /** Фокус ушёл в другое поле — как в браузере: blur приходит старому */
    loseFocus() {
      if (focus.active !== this) return
      focus.active = null
      for (const fn of this.onBlur) fn()
    }
  }
  const doc = {
    body,
    created: [] as string[],
    createElement(tag: string) {
      doc.created.push(tag)
      return new FakeInput()
    },
    get activeElement() {
      return focus.active
    },
  }
  return doc
}

afterEach(() => vi.unstubAllGlobals())

function hold() {
  const doc = fakeDocument()
  vi.stubGlobal('document', doc)
  const proxy = holdKeyboard() as unknown as ReturnType<typeof doc.createElement>
  return { doc, proxy }
}

describe('подставка держит клавиатуру, пока чанк окна в пути', () => {
  test('это поле, и фокус в нём — в том же вызове, а не после await', () => {
    const { doc, proxy } = hold()
    expect(doc.created).toEqual(['input'])
    expect(doc.body.children).toContain(proxy)
    expect(doc.activeElement, 'фокус не пришёл синхронно — жест кончится раньше').toBe(proxy)
  })

  /*
   * Клавиатуры нет у readonly, у display:none и visibility:hidden фокуса нет
   * вовсе, а поле мельче 16 px Safari приближает страницу. Невидимость — только
   * прозрачностью.
   */
  test('клавиатуру поднимет: не readonly, видимо для фокуса, 16 px', () => {
    const { proxy } = hold()
    expect(proxy.readOnly).toBe(false)
    const css = proxy.style.cssText.replace(/\s+/g, '')
    expect(css).toContain('font-size:16px')
    expect(css).toContain('opacity:0')
    expect(css).not.toMatch(/display:none|visibility:hidden/)
  })

  test('глазу и прокрутке её нет', () => {
    const { proxy } = hold()
    expect(proxy.style.cssText.replace(/\s+/g, '')).toContain('position:fixed')
    expect(proxy.focusedWith).toEqual({ preventScroll: true })
  })

  /*
   * Прежде подставка была aria-hidden. Но фокус в ней — сама её суть, а
   * aria-hidden на элементе с фокусом Chrome не исполняет: пишет в консоль
   * «Blocked aria-hidden…» и отдаёт скринридеру безымянное поле. Пока чанк
   * окна едет (на медленной связи — секунды), человек слышал «поле
   * редактирования» без имени, набирал в него — и фокус молча прыгал в окно.
   *
   * Теперь подставка — то же, чем станет: комбобокс поиска (поле окна —
   * role="combobox", lib/catalogsearch.test.ts), свёрнутый, потому что списка
   * ещё нет, с именем кнопки, которую только что нажали. Переход в поле окна
   * звучит как продолжение, а не как смена элемента.
   */
  test('скринридеру — свёрнутый комбобокс «Найти игру», а не безымянное скрытое поле', () => {
    const { proxy } = hold()
    expect(proxy.attrs['aria-hidden'], 'aria-hidden на поле с фокусом Chrome не исполняет').toBeUndefined()
    expect(proxy.attrs.role).toBe('combobox')
    expect(proxy.attrs['aria-expanded']).toBe('false')
    expect(proxy.attrs['aria-label']).toBe('Найти игру')
  })

  // На /en имя подставки — то же, что у значка: «Search games», не «Find a game» (глоссарий)
  test('на английском подставка называется по-английски', () => {
    const doc = fakeDocument()
    vi.stubGlobal('document', doc)
    const proxy = holdKeyboard('en') as unknown as ReturnType<typeof doc.createElement>
    expect(proxy.attrs['aria-label']).toBe('Search games')
  })

  test('имя подставки — имя кнопки-значка: одна строка, а не две копии', () => {
    const launcher = code(fs.readFileSync(path.join(ROOT, 'components', 'SearchLauncher.tsx'), 'utf8'))
    expect(launcher.match(/'Найти игру'/g), 'строка имени одна — в константе').toHaveLength(1)
    expect(launcher).toMatch(/aria-label=\{field \? undefined : NAME\[locale\]\}/)
    expect(launcher).toMatch(/setAttribute\('aria-label', NAME\[locale\]\)/)
  })

  test('фокус ушёл — в поле окна или куда угодно — подставка уходит сама', () => {
    const { doc, proxy } = hold()
    proxy.loseFocus()
    expect(proxy.isConnected).toBe(false)
    expect(doc.body.children).toEqual([])
  })
})

/*
 * Порядок в обработчике нажатия — чтением исходника: без React-рендера click
 * не прогнать, а ломается он перестановкой одной строки.
 */
describe('нажатие на «Найти игру»', () => {
  const launcher = code(fs.readFileSync(path.join(ROOT, 'components', 'SearchLauncher.tsx'), 'utf8'))
  const dialog = code(fs.readFileSync(path.join(ROOT, 'components', 'CatalogSearch.tsx'), 'utf8'))
  const onClick = launcher.slice(launcher.indexOf('onClick={'), launcher.indexOf('<Icon name="search"'))

  test('обработчик нажатия найден — иначе сторожа ниже пусты', () => {
    expect(onClick).toContain('loadDialog()')
  })

  test('чанк в пути — подставка встаёт до loadDialog, в самом нажатии', () => {
    expect(onClick).toMatch(/const proxy = holdKeyboard\(locale\)\s*loadDialog\(\)\.then\(/)
  })

  /*
   * Готовый чанк монтирует окно в том же нажатии (докблок SearchLauncher): его
   * эффект ставит фокус в поле внутри жеста, и подставка там лишняя.
   */
  test('чанк уже здесь — окно сразу, без подставки', () => {
    const ready = onClick.slice(0, onClick.indexOf('return'))
    expect(ready).toMatch(/if \(loaded\)/)
    expect(ready).toContain("setOpen({ Dialog: loaded, seed: '' })")
    expect(ready).not.toContain('holdKeyboard')
  })

  test('набранное в подставку, пока чанк ехал, окно получает и открывается с ним', () => {
    expect(onClick).toContain('setOpen({ Dialog, seed: proxy.value })')
    expect(launcher).toContain('seed={open.seed}')
    expect(dialog).toMatch(/useState\(seed\.slice\(0, SEARCH_QUERY_MAX\)\)/)
  })

  /*
   * Без этого отказ чанка оставлял клавиатуру поднятой над невидимым полем.
   * Фокус возвращается, только если он всё ещё в подставке: ушёл сам — его не
   * трогают.
   */
  test('чанк не доехал — фокус с подставки обратно на кнопку', () => {
    expect(onClick).toMatch(/if \(proxy\.isConnected\) opener\.current\?\.focus\(\)/)
  })

  /*
   * Отказ чанка — не тишина. После деплоя старая вкладка просит кусок
   * прежней сборки, и 404 повторяется на каждое нажатие до перезагрузки:
   * «нажми ещё раз» тут не помогает, помогает «обнови страницу». Отчёт —
   * тем же путём, что у островков (lib/searchmiss.test.ts), а человеку —
   * строка: живая область стоит всегда, текст приходит с отказом и гаснет в
   * начале новой попытки, так что повтор звучит снова (lib/liveregion.test.ts).
   */
  test('отказ чанка: отчёт и строка, а прежний отказ гаснет до новой попытки', () => {
    const miss = onClick.slice(onClick.indexOf('(err: unknown) =>'))
    expect(miss).toMatch(/reportClientError\(\{\s*kind: 'boundary',\s*error: err,\s*island: 'search'/)
    expect(miss).toContain('setMissed(true)')
    const attempt = onClick.slice(0, onClick.indexOf('const proxy = holdKeyboard(locale)'))
    expect(attempt).toContain('setMissed(false)')
  })

  /*
   * Отказ гас только на медленном пути. А чанк доезжает и без нажатия:
   * фокус, вернувшийся на кнопку после отказа, сам запускает прогрев, и
   * моргнувшая связь к нему уже вернулась. Следующее нажатие шло быстрым
   * путём — окно открывалось, а строка-поле так и говорила «обнови
   * страницу», значок — красным, до перезагрузки. Поэтому сброс стоит до
   * развилки, и быстрый путь без него недостижим. Поведением то же — в
   * lib/searchmiss.test.ts.
   */
  test('быстрый путь недостижим с прежним отказом: сброс — до развилки', () => {
    const reset = onClick.indexOf('setMissed(false)')
    expect(reset).toBeGreaterThan(-1)
    expect(reset).toBeLessThan(onClick.indexOf('if (loaded)'))
    // и ровно один: второй сброс после развилки — признак, что первый уехал
    expect(onClick.match(/setMissed\(false\)/g)).toHaveLength(1)
  })

  test('приехавший прогрев гасит прежний отказ — и на готовом модуле тоже', () => {
    expect(launcher).toMatch(/const warm = \(\) => loadDialog\(\)\.then\(\(\) => setMissed\(false\), \(\) => \{\}\)/)
    // прогрев — в самой кнопке, где есть её setMissed, а не общей функцией модуля
    expect(launcher.indexOf('const warm =')).toBeGreaterThan(launcher.indexOf('export function SearchLauncher'))
  })

  test('строка отказа — живая область, которая стоит всегда; видна у строки-поля и в подсказке значка', () => {
    expect(launcher).toMatch(
      /<span role="status" className=\{missed && !field \? 'search-miss' : 'sr-only'\}>\s*\{missed \? MISSED\[locale\] : ''\}\s*<\/span>/,
    )
    expect(launcher).toMatch(/\{field && \(missed \? MISSED\[locale\] : FIELD\[locale\]\)\}/)
    expect(launcher).toMatch(/const FIELD = \{ ru: 'Найти игру по названию', en: '[^']+' \}/)
    expect(launcher).toMatch(/title=\{field \? undefined : missed \? MISSED\[locale\] : NAME\[locale\]\}/)
    // текст отказа — одной константой: каждая копия кириллицы — байты каждой страницы
    expect(launcher.match(/'Поиск не загрузился — обнови страницу'/g)).toHaveLength(1)
  })

  /*
   * title телефон не показывает, а в шапке телефона значок — главный вход в
   * поиск: после деплоя зрячий видел моргнувшую клавиатуру и красную лупу, и
   * ни слова о том, что делать. Строка под значком видима, стоит у правого
   * края ряда шапки и не перехватывает нажатий по тому, что под шапкой.
   */
  test('у значка отказ виден строкой под ним, а не только в title', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    const rule = css.slice(css.indexOf('.search-miss {'), css.indexOf('}', css.indexOf('.search-miss {')))
    expect(rule).toContain('position: absolute')
    expect(rule).toContain('top: 100%')
    expect(rule).toContain('right: 0')
    expect(rule).toContain('white-space: nowrap')
    expect(rule).toContain('pointer-events: none')
    // подложка — фон: под шапкой проезжает и герой, и текст
    expect(rule).toContain('background: var(--bg)')
    expect(rule).toContain('color: var(--danger)')
    // опора строки — ряд значков шапки, а не край экрана за полем px-safe
    const layout = code(fs.readFileSync(path.join(ROOT, 'app', '[lang]', 'layout.tsx'), 'utf8'))
    const row = layout.slice(0, layout.indexOf('<SearchLauncher />'))
    expect(row.slice(row.lastIndexOf('<div className="'))).toMatch(/^<div className="relative flex /)
  })

  /*
   * Подставка уходит по blur, и уйти она должна до того, как фон станет
   * инертным: фокус в поле окна — первым делом эффекта монтирования.
   */
  test('окно переводит фокус в своё поле раньше, чем делает фон инертным', () => {
    const focusAt = dialog.indexOf('inputRef.current?.focus()')
    expect(focusAt).toBeGreaterThan(-1)
    expect(focusAt).toBeLessThan(dialog.indexOf('makeInert('))
  })
})

/*
 * Клавиатура телефона 100dvh не уменьшает — ни на iPhone, ни в Chrome на
 * Android по умолчанию, — и окно с восемью строками (~470 px) уходило низом
 * под клавиатуру, не становясь при этом листаемым. Потолок высоты окна
 * считается от visualViewport.
 */
describe('окно поиска не уходит под клавиатуру', () => {
  const dialog = code(fs.readFileSync(path.join(ROOT, 'components', 'CatalogSearch.tsx'), 'utf8'))

  test('высота видимой части экрана — в --vvh окна, и следит за resize', () => {
    expect(dialog).toContain('window.visualViewport')
    expect(dialog).toMatch(/setProperty\('--vvh', `\$\{viewport\.height\}px`\)/)
    expect(dialog).toMatch(/viewport\.addEventListener\('resize', fit\)/)
    expect(dialog).toMatch(/viewport\.removeEventListener\('resize', fit\)/)
  })

  test('потолок высоты окна — от --vvh, и на телефоне, и с sm', () => {
    // className окна — первый после role="dialog": он в том же открывающем теге
    const className = /className="([^"]+)"/.exec(dialog.slice(dialog.indexOf('role="dialog"')))?.[1] ?? ''
    expect(className, 'не нашёлся className окна').not.toBe('')
    const caps = className.split(' ').filter((c) => /(^|:)max-h-/.test(c))
    expect(caps).toHaveLength(2)
    for (const cap of caps) expect(cap).toContain('var(--vvh,100dvh)')
    expect(dialog).toContain('ref={panelRef}')
  })
})

/*
 * Esc в окне поиска двухшаговый (докблок CatalogSearch): сначала стирает
 * набранное, на пустом поле закрывает окно. Подсказка клавиш говорила одно
 * «Esc — закрыть» — и человек, набравший «port» и нажавший Esc, видел, как
 * пропал запрос, а окно осталось. Подсказка идёт за тем же условием, что и
 * обработчик.
 */
describe('подсказка Esc — то, что Esc сделает сейчас', () => {
  const dialog = code(fs.readFileSync(path.join(ROOT, 'components', 'CatalogSearch.tsx'), 'utf8'))

  test('обработчик: с набранным — стирает, на пустом — закрывает', () => {
    expect(dialog).toMatch(/if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\)\s*if \(query\) \{\s*setQuery\(''\)/)
  })

  test('подсказка по тому же условию: «стереть» при набранном, «закрыть» на пустом', () => {
    expect(dialog).toContain("Esc — {query ? 'стереть' : 'закрыть'}")
    expect(dialog).not.toMatch(/Esc — закрыть\s*</)
  })
})
