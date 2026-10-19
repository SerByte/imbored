import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LocaleProvider } from '@/components/LocaleProvider'
import { DiscountCorner, DiscountEnds, PriceTag, PriceWhere, type PriceTagProps } from '@/components/PriceTag'
import * as View from '@/components/PriceTagView'
import { RefundNote } from '@/components/RefundNote'
import { RefundNote as RefundNoteView } from '@/components/RefundNoteView'
import type { Discount } from '@/lib/discount'
import { LOCALES } from '@/lib/i18n'

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
    // русская подпись — в паре tr() с английской (на /en — ' · free')
    const free = src.indexOf("ru: ' · бесплатно'")
    expect(unsold).toBeGreaterThan(-1)
    expect(free).toBeGreaterThan(unsold)
  })
})

/**
 * Ценник на сервере и на клиенте — одна разметка.
 *
 * Серверные страницы (карточка игры, /compat, полка желаемого) рисуют
 * components/PriceTagView с языком страницы пропом — так ценник снова
 * рендерится на сервере и не едет в их клиентский бандл. Клиентские экраны
 * зовут обёртку components/PriceTag с языком из контекста корневого layout.
 * Разойдись они хоть в пробеле — тот же ценник выглядел бы на /game и на
 * /play по-разному, а русская страница перестала бы быть прежней до байта.
 * Та же пара — у строки возврата под ценой (RefundNote / RefundNoteView).
 */
describe('ценник: серверная View с языком пропом = клиентская обёртка в контексте', () => {
  /** Клиентская обёртка — как её ставит корневой layout: язык в контексте */
  const inContext = (locale: (typeof LOCALES)[number], el: ReactElement) =>
    renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, el))
  /** Серверная View — без провайдера: язык ей приходит только пропом */
  const bare = (el: ReactElement) => renderToStaticMarkup(el)

  const SALE: Discount = { percent: 40, finalCents: 119_900, initialCents: 199_900, endsAt: 1_790_000_000, endsLabel: 'до 17 августа' }
  const TAGS: PriceTagProps[] = [
    { priceFinal: 199_900, cc: 'ru' },
    { priceFinal: 5999, cc: 'us', isFree: false, size: 'hero' },
    { priceFinal: 119_900, cc: 'ru', discount: SALE, size: 'hero', className: 'shrink-0' },
    { priceFinal: 119_900, cc: 'kz', discount: SALE, showPercent: false },
    { priceFinal: 1499, cc: 'ru', isFree: true },
    { priceFinal: null, cc: 'ru', isFree: true, unsold: true },
    { priceFinal: null, cc: 'us', unsold: true, className: 'x' },
    { priceFinal: 5999, cc: null },
    { priceFinal: null, cc: 'ru' },
  ]

  test.each(LOCALES)('%s: PriceTag — каждый ответ о цене', (locale) => {
    for (const p of TAGS) {
      const server = bare(createElement(View.PriceTag, { ...p, locale }))
      expect(server, JSON.stringify(p)).toBe(inContext(locale, createElement(PriceTag, p)))
    }
    // сторож не слепой: View правда говорит на языке пропа
    expect(bare(createElement(View.PriceTag, { ...TAGS[4], locale }))).toContain(locale === 'en' ? 'Free' : 'бесплатно')
  })

  test.each(LOCALES)('%s: подпись региона, уголок и срок скидки', (locale) => {
    for (const p of [{ cc: 'ru' }, { cc: 'us', className: 'ml-1' }, { cc: null }, { cc: undefined }]) {
      expect(bare(createElement(View.PriceWhere, { ...p, locale }))).toBe(inContext(locale, createElement(PriceWhere, p)))
    }
    expect(bare(createElement(View.PriceWhere, { cc: 'ru', locale }))).toContain(
      locale === 'en' ? 'price on Russian Steam' : 'цена в российском Steam',
    )
    // уголок и срок языка не знают: обёртка отдаёт те же функции
    expect(DiscountCorner).toBe(View.DiscountCorner)
    expect(DiscountEnds).toBe(View.DiscountEnds)
  })

  test.each(LOCALES)('%s: строка возврата', (locale) => {
    for (const p of [{}, { tone: 'neutral' as const }, { tone: 'pick' as const, className: 'mt-2' }]) {
      expect(bare(createElement(RefundNoteView, { ...p, locale }))).toBe(inContext(locale, createElement(RefundNote, p)))
    }
    expect(bare(createElement(RefundNoteView, { tone: 'neutral', locale }))).toContain(
      locale === 'en' ? 'Refund policy' : 'Правила возврата',
    )
  })

  test('без провайдера клиентская обёртка — русская, как серверная View на ru', () => {
    expect(renderToStaticMarkup(createElement(PriceTag, TAGS[2]))).toBe(bare(createElement(View.PriceTag, { ...TAGS[2], locale: 'ru' })))
  })
})
