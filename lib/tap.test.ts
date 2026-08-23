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
