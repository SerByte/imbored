import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  encodeSearchIndex,
  fromRuLayout,
  readSearchIndex,
  SEARCH_SHOWN,
  searchCatalog,
  searchStatus,
  stepActive,
  type SearchEntry,
} from './catalogsearch'

/** Индекс в порядке «по числу отзывов» — так его отдаёт /search-index.json */
function index(...names: string[]): SearchEntry[] {
  const entries = readSearchIndex(encodeSearchIndex(names.map((name, i) => ({ appid: i + 1, name }))))
  if (!entries) throw new Error('индекс не прочитался')
  return entries
}

const names = (r: ReturnType<typeof searchCatalog>) => r.games.map((g) => g.name)

describe('индекс каталога: провод и чтение', () => {
  test('колонками: номера отдельно, названия отдельно — так он меньше весит сжатым', () => {
    expect(
      encodeSearchIndex([
        { appid: 730, name: 'Counter-Strike 2' },
        { appid: 570, name: 'Dota 2' },
      ]),
    ).toEqual({ ids: [730, 570], names: ['Counter-Strike 2', 'Dota 2'] })
  })

  test('пробелы в названии схлопываются, пустое название не едет вовсе', () => {
    const wire = encodeSearchIndex([
      { appid: 1, name: '  Foo \n\t Bar ' },
      { appid: 2, name: '   ' },
      { appid: 3, name: 'Baz' },
    ])
    expect(wire).toEqual({ ids: [1, 3], names: ['Foo Bar', 'Baz'] })
  })

  test('чтение сохраняет порядок индекса — он и есть порядок популярности', () => {
    const got = readSearchIndex({ ids: [730, 570], names: ['Counter-Strike 2', 'Dota 2'] })
    expect(got?.map((e) => [e.appid, e.name])).toEqual([
      [730, 'Counter-Strike 2'],
      [570, 'Dota 2'],
    ])
  })

  test('сломанная форма — null, а не исключение посреди набора', () => {
    expect(readSearchIndex(null)).toBeNull()
    expect(readSearchIndex('<!doctype html>')).toBeNull()
    expect(readSearchIndex({ ids: [1, 2], names: ['a'] })).toBeNull()
    expect(readSearchIndex({ ids: 'x', names: [] })).toBeNull()
  })

  test('битая строка пропускается, остальные читаются', () => {
    const got = readSearchIndex({ ids: [1, 1.5, -3, 4, 5], names: ['A', 'B', 'C', 7, 'E'] })
    expect(got?.map((e) => e.appid)).toEqual([1, 5])
  })
})

describe('поиск по каталогу', () => {
  test('пустой запрос — пусто: каталог из шести тысяч строк не список', () => {
    const r = searchCatalog(index('Portal', 'Dota 2'), '  — ')
    expect(r.games).toEqual([])
    expect(r.total).toBe(0)
  })

  test('при равном совпадении — порядок индекса, то есть по числу отзывов', () => {
    const r = searchCatalog(index('Portal 2', 'Portal Knights', 'Portal Stories: Mel'), 'portal')
    expect(names(r)).toEqual(['Portal 2', 'Portal Knights', 'Portal Stories: Mel'])
  })

  /*
   * У сиквела отзывов больше, чем у оригинала, и «по числу отзывов» ставило бы
   * «DOOM Eternal» над «DOOM» на запрос «doom». Набранное целиком название
   * весит больше популярности.
   */
  test('точное название — первым, даже если отзывов у него меньше', () => {
    const r = searchCatalog(index('DOOM Eternal', 'DOOM', 'Doomsday Hunters'), 'doom')
    expect(names(r)[0]).toBe('DOOM')
  })

  test('™ не мешает точному совпадению', () => {
    const r = searchCatalog(index('BioShock Infinite', 'BioShock™'), 'bioshock')
    expect(names(r)).toEqual(['BioShock™', 'BioShock Infinite'])
  })

  test('начало названия — выше, чем слова где-то внутри', () => {
    const r = searchCatalog(index('The Witcher 3: Wild Hunt', 'Witcher Tales'), 'witcher')
    expect(names(r)).toEqual(['Witcher Tales', 'The Witcher 3: Wild Hunt'])
  })

  test('начала слов — выше, чем кусок посреди слова', () => {
    const r = searchCatalog(index('Bewitched Forest', 'The Witcher 3: Wild Hunt'), 'witch')
    expect(names(r)).toEqual(['The Witcher 3: Wild Hunt', 'Bewitched Forest'])
  })

  test('слова запроса — в любом порядке, знаки и регистр не мешают', () => {
    const r = searchCatalog(index('Counter-Strike 2', 'The Witcher® 3: Wild Hunt'), 'HUNT witcher')
    expect(names(r)).toEqual(['The Witcher® 3: Wild Hunt'])
  })

  test('ё и е — одно и то же', () => {
    expect(names(searchCatalog(index('Ёлки-палки'), 'елки'))).toEqual(['Ёлки-палки'])
    expect(names(searchCatalog(index('Елки-палки'), 'ёлки'))).toEqual(['Елки-палки'])
  })

  test(`показываем не больше ${SEARCH_SHOWN}, а total считает всё найденное`, () => {
    const many = Array.from({ length: 20 }, (_, i) => `Space Game ${i + 1}`)
    const r = searchCatalog(index(...many), 'space')
    expect(r.games).toHaveLength(SEARCH_SHOWN)
    expect(r.total).toBe(20)
    expect(names(r)[0]).toBe('Space Game 1')
  })

  test('у найденного — номер для адреса карточки', () => {
    const r = searchCatalog(readSearchIndex({ ids: [292030], names: ['The Witcher 3: Wild Hunt'] }) ?? [], 'witcher')
    expect(r.games).toEqual([{ appid: 292030, name: 'The Witcher 3: Wild Hunt' }])
  })
})

describe('запрос, набранный не в той раскладке', () => {
  test('ЙЦУКЕН переводится в QWERTY по клавишам', () => {
    expect(fromRuLayout('цшесрук')).toBe('witcher')
    expect(fromRuLayout('ЦШЕСРУК 3')).toBe('witcher 3')
    expect(fromRuLayout('ифдвгкэы пфеу')).toBe("baldur's gate")
    expect(fromRuLayout('рфда-дшау')).toBe('half-life')
  })

  test('без русских букв переводить нечего', () => {
    expect(fromRuLayout('witcher')).toBeNull()
    expect(fromRuLayout('42')).toBeNull()
  })

  test('«цшесрук» находит The Witcher и говорит, что искали', () => {
    const r = searchCatalog(index('Counter-Strike 2', 'The Witcher 3: Wild Hunt'), 'цшесрук')
    expect(names(r)).toEqual(['The Witcher 3: Wild Hunt'])
    expect(r.layout).toBe('witcher')
  })

  test('русское название находится как есть, раскладка — только следом', () => {
    const r = searchCatalog(index('Ёлки-палки', 'Tkrb Simulator'), 'елки')
    // «елки» в QWERTY — «tkrb»: русское совпадение первым, раскладка за ним
    expect(names(r)).toEqual(['Ёлки-палки', 'Tkrb Simulator'])
  })

  /*
   * Двухбуквенное «да» в QWERTY — «lf», и оно сидит внутри «Half-Life».
   * Раскладку перепутали — но слово всё равно набирали с начала, поэтому
   * переведённый запрос ищется только с начала слов.
   */
  test('переведённый запрос не цепляет кусок посреди слова', () => {
    const r = searchCatalog(index('Half-Life 2'), 'да')
    expect(r.games).toEqual([])
    expect(r.layout).toBeNull()
  })

  test('раскладка не названа, если найденное пришло без неё', () => {
    const r = searchCatalog(index('Ёлки-палки'), 'елки')
    expect(r.layout).toBeNull()
  })
})

describe('стрелки по списку', () => {
  test('вниз — по кругу, из «ничего» — первая', () => {
    expect(stepActive(-1, 3, 'ArrowDown')).toBe(0)
    expect(stepActive(0, 3, 'ArrowDown')).toBe(1)
    expect(stepActive(2, 3, 'ArrowDown')).toBe(0)
  })

  test('вверх — по кругу, из «ничего» — последняя', () => {
    expect(stepActive(-1, 3, 'ArrowUp')).toBe(2)
    expect(stepActive(2, 3, 'ArrowUp')).toBe(1)
    expect(stepActive(0, 3, 'ArrowUp')).toBe(2)
  })

  test('список стал короче выбранного — выбор встаёт в его пределы', () => {
    expect(stepActive(7, 3, 'ArrowDown')).toBe(0)
    expect(stepActive(7, 3, 'ArrowUp')).toBe(2)
  })

  test('строк нет — выбирать нечего', () => {
    expect(stepActive(-1, 0, 'ArrowDown')).toBe(-1)
    expect(stepActive(2, 0, 'ArrowUp')).toBe(-1)
  })
})

describe('строка статуса', () => {
  const found = (total: number, shown = Math.min(total, SEARCH_SHOWN), layout: string | null = null) => ({
    games: Array.from({ length: shown }, (_, i) => ({ appid: i + 1, name: `G${i}` })),
    total,
    layout,
  })

  test('пустой запрос — пустая строка: говорить не о чем', () => {
    expect(searchStatus('ready', '', found(0))).toBe('')
    expect(searchStatus('loading', ' ', found(0))).toBe('')
  })

  test('каталог ещё едет — так и сказано, если уже есть что искать', () => {
    expect(searchStatus('loading', 'port', found(0))).toBe('Загружаю каталог…')
    expect(searchStatus('idle', 'port', found(0))).toBe('Загружаю каталог…')
  })

  test('отказ звучит и без запроса — кнопка повтора рядом', () => {
    expect(searchStatus('failed', '', found(0))).toMatch(/^Каталог не загрузился/)
  })

  test('число найденного — с согласованными глаголом и существительным', () => {
    expect(searchStatus('ready', 'x', found(1))).toBe('Нашлась 1 игра')
    expect(searchStatus('ready', 'x', found(3))).toBe('Нашлись 3 игры')
    expect(searchStatus('ready', 'x', found(5))).toBe('Нашлось 5 игр')
    expect(searchStatus('ready', 'x', found(21))).toBe('Нашлась 21 игра, вот первые 8')
  })

  test('больше, чем показано, — сказано, что это первые', () => {
    expect(searchStatus('ready', 'space', found(37))).toBe('Нашлось 37 игр, вот первые 8')
  })

  test('найдено через раскладку — сказано, по какому запросу', () => {
    expect(searchStatus('ready', 'цшесрук', found(2, 2, 'witcher'))).toBe('Нашлись 2 игры по «witcher»')
  })

  test('ничего — и подсказка, если искали по-русски', () => {
    expect(searchStatus('ready', 'zzz', found(0))).toBe('Ничего не нашлось')
    expect(searchStatus('ready', 'ведьмак', found(0))).toBe(
      'Ничего не нашлось. Названия здесь — как в Steam, обычно латиницей',
    )
  })
})

/*
 * Разметка окна — чтением исходника, как у остальных сторожей доступности:
 * комбобокс без браузера не прогнать, а ломается он одним атрибутом —
 * поле теряет связь со списком, строка встаёт в обход Tab, и скринридер
 * перестаёт слышать, что под полем вообще есть список.
 */
describe('окно поиска — комбобокс по шаблону ARIA', () => {
  const src = fs
    .readFileSync(path.join(__dirname, '..', 'components', 'CatalogSearch.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  /** Открывающий тег целиком — до `>` вне {} и строк (как в lib/liveregion.test.ts) */
  function openingTag(name: string, marker = ''): string {
    let from = 0
    for (;;) {
      const at = src.indexOf(`<${name}`, from)
      if (at < 0) throw new Error(`<${name}${marker ? ` с ${marker}` : ''}> не найден — сторож ослеп`)
      let depth = 0
      let q: string | null = null
      for (let j = at; j < src.length; j++) {
        const c = src[j]
        if (q) {
          if (c === q && src.charCodeAt(j - 1) !== 92) q = null
          continue
        }
        if (c === '"' || c === "'" || c === '`') q = c
        else if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) {
          const tag = src.slice(at, j + 1).replace(/\s+/g, ' ')
          if (tag.includes(marker)) return tag
          break
        }
      }
      from = at + 1
    }
  }

  test('окно — модальный диалог с именем', () => {
    const dialog = openingTag('div', 'role="dialog"')
    expect(dialog).toContain('aria-modal="true"')
    expect(dialog).toMatch(/aria-label="[^"]+"/)
  })

  test('поле — комбобокс, связанный со списком, с выбранной строкой через activedescendant', () => {
    const input = openingTag('input')
    for (const attr of [
      'role="combobox"',
      'aria-controls={listId}',
      'aria-autocomplete="list"',
      'aria-expanded={',
      'aria-activedescendant={',
    ]) {
      expect(input, attr).toContain(attr)
    }
    expect(src, 'у поля есть подпись').toMatch(/<label htmlFor=\{`\$\{id\}-q`\}/)
  })

  test('список — listbox с тем id, на который указывает поле', () => {
    const list = openingTag('div', 'role="listbox"')
    expect(list).toContain('id={listId}')
    expect(list).toMatch(/aria-label="[^"]+"/)
  })

  test('строки — option, выбор объявлен, из обхода Tab вынуты', () => {
    const option = openingTag('GameLink')
    expect(option).toContain('role="option"')
    expect(option).toContain('aria-selected={')
    expect(option).toContain('tabIndex={-1}')
    expect(option).toContain('id={optionId(i)}')
  })
})
