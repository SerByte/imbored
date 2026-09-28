import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { PriceTag, PriceWhere } from '@/components/PriceTag'

/**
 * Сторож бесплатных игр на ценниках.
 *
 * У Counter-Strike 2 в каталоге одновременно is_free = 1 и price_final = 1499:
 * это цена Prime, а не игры, и хранится она осознанно (см. lib/catalog.test.ts).
 * Правильно её рисует только PriceTag, которому передали isFree, — он
 * проверяет бесплатность раньше цены. Страница игры, /play и /daily это
 * делали, а полка «на будущее» на /compat — нет, и показывала $14.99 за
 * бесплатную игру. Ошибка не видна ни на одном тестовом числе: у платной игры
 * всё верно и без признака.
 *
 * Поэтому правило простое и статическое: у каждого PriceTag есть isFree.
 * Где бесплатных не бывает в принципе, так и пишется — isFree={false}, чтобы
 * это было решение, а не пропуск.
 */

const ROOT = path.join(__dirname, '..')

function sourceFiles(): [string, string][] {
  const out: [string, string][] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx$/.test(e.name)) {
        out.push([path.relative(ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')])
      }
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

describe('ценник и бесплатные игры', () => {
  test('каждый PriceTag знает, бесплатна ли игра', () => {
    const offenders: string[] = []
    let seen = 0
    for (const [file, src] of sourceFiles()) {
      for (const m of src.matchAll(/<PriceTag\b/g)) {
        seen++
        const end = src.indexOf('/>', m.index)
        const tag = src.slice(m.index, end)
        if (!/\bisFree=/.test(tag)) {
          offenders.push(`${file}:${src.slice(0, m.index).split('\n').length}`)
        }
      }
    }
    // Сторож, который ничего не нашёл, — сломанный сторож: PriceTag живёт
    // минимум на пяти экранах.
    expect(seen).toBeGreaterThan(4)
    expect(offenders, 'передай isFree в PriceTag').toEqual([])
  })
})

/**
 * Сторож валюты на ценниках.
 *
 * Цена без региона — число без валюты: после смены STEAM_STORE_CC доллары
 * карточки, отданной раньше, нарисовались бы рублями (lib/steamregion). Поэтому
 * у каждого PriceTag есть cc — регион, приехавший с сервера рядом с ценой, —
 * а деньги пишутся только через formatPrice: «$» руками в разметке уже жил на
 * /library, на портрете и в колоде пати.
 */
describe('ценник и валюта', () => {
  test('каждый PriceTag знает регион своей цены', () => {
    const offenders: string[] = []
    for (const [file, src] of sourceFiles()) {
      for (const m of src.matchAll(/<PriceTag\b/g)) {
        const tag = src.slice(m.index, src.indexOf('/>', m.index))
        if (!/\bcc=/.test(tag)) offenders.push(`${file}:${src.slice(0, m.index).split('\n').length}`)
      }
    }
    expect(offenders, 'передай cc в PriceTag').toEqual([])
  })

  test('деньги — только через formatPrice: ни «$» руками, ни деления на сотню', () => {
    const offenders: string[] = []
    for (const [file, src] of sourceFiles()) {
      if (/\/ 100\)\.toFixed\(/.test(src)) offenders.push(`${file}: / 100).toFixed(`)
      if (/\$\$\{/.test(src) || />\$\{/.test(src)) offenders.push(`${file}: $ перед числом`)
    }
    expect(offenders).toEqual([])
  })
})

describe('PriceTag: порядок ответов о цене', () => {
  const html = (props: Parameters<typeof PriceTag>[0]) => renderToStaticMarkup(createElement(PriceTag, props))
  const NB = String.fromCharCode(0xa0)

  test('цена — в валюте своего региона', () => {
    expect(html({ priceFinal: 199_900, cc: 'ru' })).toContain(`1${NB}999${NB}₽`)
    expect(html({ priceFinal: 5999, cc: 'us' })).toContain(`59,99${NB}$`)
  })

  test('«не продаётся» первым, даже раньше «бесплатно», потом «бесплатно», потом цена', () => {
    // Бесплатная, но магазин региона её не показывает: взять её там нельзя, и
    // разметка (offersOf) у такой игры Offer не ставит — страница говорит то же
    const hiddenFree = html({ priceFinal: null, cc: 'ru', isFree: true, unsold: true })
    expect(hiddenFree).toContain('не продаётся в российском Steam')
    expect(hiddenFree).not.toContain('бесплатно')
    const unsold = html({ priceFinal: null, cc: 'ru', unsold: true })
    expect(unsold).toContain('не продаётся в российском Steam')
    expect(unsold).not.toContain('₽')
    // isFree сильнее цены: у CS2 в базе цена Prime рядом с is_free
    expect(html({ priceFinal: 1499, cc: 'ru', isFree: true })).toContain('бесплатно')
    // «не продаётся» без региона сказать нечем — остаётся то, что известно без него
    expect(html({ priceFinal: null, cc: null, isFree: true, unsold: true })).toContain('бесплатно')
  })

  test('без региона цены нет: число без валюты не рисуется', () => {
    expect(html({ priceFinal: 5999, cc: null })).toBe('')
    expect(html({ priceFinal: 5999, cc: null, isFree: true })).toContain('бесплатно')
  })

  test('подпись региона — мелкой строкой, и только когда он есть', () => {
    expect(renderToStaticMarkup(createElement(PriceWhere, { cc: 'ru' }))).toContain('цена в российском Steam')
    expect(renderToStaticMarkup(createElement(PriceWhere, { cc: null }))).toBe('')
  })
})

/**
 * «Не продаётся» и бесплатность.
 *
 * Бесплатную игру, которую магазин региона не показывает, из него не взять:
 * Warzone бесплатна в US, а российский Steam отвечает на неё visible:false.
 * Признак unsold едет к ценнику рядом с isFree, а выбирает ценник — PriceTag и
 * строка колоды (SwipeDeck) ставят «не продаётся» первым, как и разметка
 * (offersOf в lib/jsonld не ставит Offer скрытой игре, даже нулевой).
 * Погасить признак бесплатностью по дороге — снова написать «бесплатно» там,
 * где разметка молчит. Так было в пяти местах сразу: колода, её роут, матч
 * комнаты, /compat и полка /explore.
 */
describe('«не продаётся» не гасится бесплатностью', () => {
  function allSources(): [string, string][] {
    const out: [string, string][] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') walk(p)
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          out.push([path.relative(ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')])
        }
      }
    }
    for (const dir of ['app', 'components', 'lib']) walk(path.join(ROOT, dir))
    return out
  }

  test('ни одна производная unsold не смотрит на бесплатность', () => {
    const offenders: string[] = []
    let seen = 0
    for (const [file, src] of allSources()) {
      src.split('\n').forEach((line, i) => {
        if (!/\bunsold\s*[:=]|нетВРегионе\s*=/.test(line)) return
        seen++
        // У JSX-атрибута — только его значение: isFree рядом в той же строке
        // ценника (PatchRow) — это передача обоих признаков, ровно как надо
        const jsx = line.match(/\bunsold=\{([^}]*)\}/)
        if (/isFree|бесплатн/.test(jsx ? jsx[1] : line)) offenders.push(`${file}:${i + 1}`)
      })
    }
    // Сторож, который ничего не нашёл, — сломанный сторож
    expect(seen).toBeGreaterThan(5)
    expect(offenders, 'не гаси unsold бесплатностью: порядок решает ценник').toEqual([])
  })

  test('строка колоды спрашивает «нет в регионе» раньше «бесплатно»', () => {
    const src = fs.readFileSync(path.join(ROOT, 'components', 'SwipeDeck.tsx'), 'utf8')
    const unsold = src.indexOf('card.unsold && card.priceCc')
    const free = src.indexOf("? ' · бесплатно'")
    expect(unsold).toBeGreaterThan(-1)
    expect(free).toBeGreaterThan(unsold)
  })
})
