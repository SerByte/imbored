import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож зоны попадания.
 *
 * Утилита .tap описана в app/globals.css подробно и с замерами: половина
 * управляющих элементов продукта — текстовые ссылки-строки высотой 16–20 px,
 * палец — примерно 44, и промах читается не как «маленькая ссылка», а как
 * «сайт не отвечает». Порог WCAG 2.2 AA (2.5.8 Target Size Minimum) — 24 px.
 *
 * Утилита была, дисциплины не было. Замер живых страниц нашёл двадцать три
 * ссылки без неё — включая «Подробнее» под кнопкой входа (16 px), почту на
 * странице политики (21 px), шесть пунктов навигации в шапке (20 px, и на
 * планшете это единственное меню) и все до одной строки-выходы вида
 * «Попробовать снова», «На сегодня всё», «Создать свою →», то есть
 * единственный элемент управления на экранах ошибок и пустых состояний.
 *
 * Проверка статическая, а не браузерная, и это осознанно: половина этих строк
 * живёт в состояниях, которые в браузере надо ещё суметь воспроизвести —
 * «комнаты нет», «не получилось собрать рекомендации», «игрок не подключал
 * библиотеку». Разметка же видна вся и сразу.
 *
 * ССЫЛКА ВНУТРИ ПРЕДЛОЖЕНИЯ. Критерий 2.5.8 выводит её из-под требования:
 * размер такой цели задан интерлиньяжем чужого текста. Но выведена — не
 * значит «нельзя»: у одиночной ссылки в абзаце соседей-целей нет, и узкая
 * зона (.tap-tight, 24 px — ровно порог AA) ей ничего не ломает. Поэтому
 * послаблением пользуемся только там, где оно неизбежно.
 *
 * Неизбежно оно ровно в одном месте — в теле чужого патчноута, где ссылок
 * сколько угодно и они могут стоять подряд в одной строке: там зоны налезли
 * бы друг на друга и правило сломало бы ровно то, ради чего написано.
 */

const ROOT = path.join(__dirname, '..')

/** Конец открывающего тега — с учётом вложенных {} и строк внутри атрибутов. */
function tagEnd(src: string, i: number): number {
  let depth = 0
  let q: string | null = null
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (q) {
      if (c === q && src.charCodeAt(j - 1) !== 92) q = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return j
  }
  return -1
}

/**
 * Классы, из которых элемент получает собственную ВЫСОТУ: вертикальные
 * отступы, заданная высота, позиционирование, скрытие. Такой элемент про
 * зону попадания уже подумал — кнопка с py-3 даёт 48 px и без утилиты.
 *
 * px- сюда НЕ входит, и это стоило одной пропущенной цели: горизонтальный
 * отступ высоту не меняет вообще. Ссылка «Портрет <имя> →» на странице
 * совместимости имела px-2 и оставалась 20 px в высоту — под порогом AA,
 * без зоны и мимо этой проверки, потому что «отступ ведь есть».
 */
const SIZED =
  /\b(?:p|py|pt|pb|h|min-h|size|aspect|inset)-|\b(?:absolute|fixed|sr-only|hidden|block|inline-block|flex|grid)\b/

/** Признак того, что высота элемента — это высота строки текста. */
const TEXTY = /\btext-(?:xs|sm|base|dim|ink|faint|ember-text)\b/

/**
 * Ссылки внутри предложения — исключение 2.5.8 «Inline». У каждой строки
 * причина: без неё через полгода не отличить исключение от пропуска.
 */
type Hit = { at: string; cls: string }

const INLINE: Array<{ file: string; cls: string; why: string }> = [
  {
    file: 'components/NewsBody.tsx',
    cls: 'text-ember-text hover:underline underline-offset-2',
    why: 'ссылки в теле чужого патчноута — их там сколько угодно и подряд',
  },
]

/**
 * Исключение опознаётся по файлу и НАБОРУ КЛАССОВ, а не по номеру строки.
 *
 * Ключом был `файл:строка`, и это оказалось хрупко ровно так, как и звучит:
 * добавление одного импорта в NewsBody.tsx сдвинуло ссылку с 17-й строки на
 * 21-ю, и сторож разом сообщил и о непокрытой цели, и о протухшем
 * исключении — хотя разметка не менялась вовсе. Классы переживают правки,
 * не относящиеся к самой ссылке.
 */
function exempt(hit: Hit): boolean {
  return INLINE.some((x) => hit.at.startsWith(`${x.file}:`) && hit.cls === x.cls)
}

function scan(): Hit[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx')) files.push(p)
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))

  const hits: Hit[] = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    for (const m of src.matchAll(/<(?:a|Link|button)\s/g)) {
      const end = tagEnd(src, m.index)
      if (end < 0) continue
      const attrs = src.slice(m.index, end)
      const cn = attrs.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)
      const cls = (cn ? (cn[1] ?? cn[2] ?? '') : '').replace(/\s+/g, ' ').trim()
      if (/\btap\b/.test(cls)) continue
      if (SIZED.test(cls)) continue
      if (!TEXTY.test(cls)) continue
      hits.push({ at: `${rel}:${src.slice(0, m.index).split('\n').length}`, cls })
    }
  }
  return hits
}

describe('зона попадания', () => {
  const hits = scan()

  test('у текстовых ссылок-строк есть .tap', () => {
    const missing = hits.filter((h) => !exempt(h)).map((h) => `${h.at} — ${h.cls}`)
    expect(
      missing,
      'высота такой ссылки равна высоте строки (16–20 px) — допиши tap, см. блок про зону попадания в globals.css',
    ).toEqual([])
  })

  /**
   * Обратная сторона: исключение, которое перестало существовать, — это
   * молчаливый комментарий про несуществующий код. Список обязан таять вместе
   * с разметкой.
   */
  test('в списке исключений нет протухших строк', () => {
    const stale = INLINE.filter(
      (x) => !hits.some((h) => h.at.startsWith(`${x.file}:`) && h.cls === x.cls),
    ).map((x) => `${x.file} — ${x.cls}`)
    expect(stale, 'эти ссылки уже не подходят под правило — вычеркни их из INLINE').toEqual([])
  })

  test('утилита и её узкий вариант объявлены в globals.css', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    expect(css).toMatch(/\.tap\s*\{[^}]*--tap:\s*44px/)
    expect(css).toMatch(/\.tap-tight\s*\{[^}]*--tap:\s*24px/)
  })
})

/**
 * Кнопки со стилями из CSS-модуля.
 *
 * Скан выше читает классы Tailwind в разметке, а размер кнопки с классом из
 * модуля задаёт CSS — и такие кнопки сторож не видел вовсе. Так прожили точки
 * MorphSlider: 8×8 px с зазором 8, шаг 16 (замер на /game/730), промах по
 * точке на телефоне попадал в сцену и открывал лайтбокс.
 *
 * Правило то же, что у .tap: цель меньше 24 px получает невидимую зону —
 * псевдоэлемент с отрицательным inset, и зона не меньше 24×24.
 */

type Rule = { selector: string; body: string }

/** Правила модуля плоским списком; вложенные в @media тоже попадают сюда. */
function cssRules(src: string): Rule[] {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }))
}

function px(body: string, prop: string): number | null {
  const m = body.match(new RegExp(String.raw`(?:^|[;\s])${prop}:\s*(-?\d+(?:\.\d+)?)px`))
  return m ? Number(m[1]) : null
}

/** inset: a | a b — вертикаль и горизонталь, в px */
function inset(body: string): { y: number; x: number } | null {
  const m = body.match(/(?:^|[;\s])inset:\s*(-?\d+)px(?:\s+(-?\d+)px)?\s*;/)
  if (!m) return null
  const y = Number(m[1])
  return { y, x: m[2] === undefined ? y : Number(m[2]) }
}

function moduleButtons(): Array<{ module: string; cls: string; rules: Rule[] }> {
  const found: Array<{ module: string; cls: string; rules: Rule[] }> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.module.css')) {
        const rules = cssRules(fs.readFileSync(p, 'utf8'))
        const rel = path.relative(ROOT, p).split(path.sep).join('/')
        // Разметка, которая этот модуль подключает, — в той же папке
        const classes = new Set<string>()
        for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
          const src = fs.readFileSync(path.join(dir, f), 'utf8')
          if (!src.includes(`./${e.name}'`)) continue
          for (const m of src.matchAll(/<button\s/g)) {
            const end = tagEnd(src, m.index)
            const attrs = src.slice(m.index, end)
            for (const c of attrs.matchAll(/styles\.(\w+)/g)) classes.add(c[1])
          }
        }
        for (const cls of classes) found.push({ module: rel, cls, rules })
      }
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return found
}

describe('зона попадания в CSS-модулях', () => {
  const buttons = moduleButtons()

  test('скан видит кнопки модулей', () => {
    // без этого тест ниже зеленел бы и тогда, когда поиск сломался
    expect(buttons.map((b) => `${b.module} .${b.cls}`)).toContain(
      'components/morph/MorphSlider.module.css .dot',
    )
  })

  test('кнопка меньше 24 px получает невидимую зону не меньше 24×24', () => {
    const offenders: string[] = []
    for (const b of buttons) {
      const base = b.rules.find((r) => r.selector === `.${b.cls}`)
      if (!base) continue
      const w = px(base.body, 'width')
      const h = px(base.body, 'height')
      if ((w === null || w >= 24) && (h === null || h >= 24)) continue
      const zone = b.rules.find((r) => r.selector === `.${b.cls}::before` || r.selector === `.${b.cls}::after`)
      const ins = zone && inset(zone.body)
      const ok =
        zone &&
        /content:/.test(zone.body) &&
        /position:\s*absolute/.test(zone.body) &&
        /position:\s*relative/.test(base.body) &&
        ins &&
        (w ?? 24) - 2 * ins.x >= 24 &&
        (h ?? 24) - 2 * ins.y >= 24
      if (!ok) offenders.push(`${b.module} .${b.cls} — ${w ?? '?'}×${h ?? '?'} px без зоны 24×24`)
    }
    expect(offenders, 'допиши ::before { content: ""; position: absolute; inset: -Npx } — как у .dot').toEqual([])
  })

  /**
   * Зоны соседних точек не перекрываются: зазор между точками не меньше двух
   * боковых добавок. Иначе зона одной точки ловила бы нажатия, нацеленные в
   * соседнюю, — ровно то, от чего зона и заводилась.
   */
  test('зоны соседних точек слайдера стыкуются, а не перекрываются', () => {
    const rules = cssRules(
      fs.readFileSync(path.join(ROOT, 'components', 'morph', 'MorphSlider.module.css'), 'utf8'),
    )
    const gap = px(rules.find((r) => r.selector === '.indicators')?.body ?? '', 'gap')
    const zone = inset(rules.find((r) => r.selector === '.dot::before')?.body ?? '')
    expect(gap).not.toBeNull()
    expect(zone).not.toBeNull()
    expect(gap!).toBeGreaterThanOrEqual(-2 * zone!.x)
  })
})
