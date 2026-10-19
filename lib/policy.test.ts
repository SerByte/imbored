import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import PrivacyPage from '../app/[lang]/privacy/page'
import { COPY, type PolicyCopy } from '../app/[lang]/privacy/page.copy'
import { LOCALES, type Locale } from './i18n'

/**
 * Сторож даты политики.
 *
 * На странице конфиденциальности стоит строка «Обновлено …». Она полезна ровно
 * до первой правки текста без правки числа: после этого дата не сообщает
 * ничего, а врёт — причём в документе, весь смысл которого в том, что ему
 * можно верить.
 *
 * Забыть тут легко и естественно: правят один абзац, а дата стоит в другом
 * конце файла и в поле зрения не попадает.
 *
 * Поэтому тест снимает отпечаток с ПРОЗЫ политики — с того, что человек
 * читает глазами, — и сравнивает с записанным ниже. Текст живёт в
 * app/[lang]/privacy/page.copy.tsx, по объекту на язык (COPY), но отпечаток
 * снимается не с COPY, а с того, что рисует сама страница на каждом языке:
 * с её видимого текста и подписей (aria-label, title, alt, placeholder) и с
 * title и description из COPY.meta. Слово, вписанное прямо в page.tsx мимо
 * COPY, читатель видит так же — значит, и сторож обязан его видеть. Классы
 * оформления, перестановка вёрстки и комментарии в отпечаток не входят:
 * переверстать страницу можно свободно, а переписать текст — только вместе с
 * датой своего языка.
 *
 * Когда прогон упал: правка текста была намеренной — обнови COPY[язык].updated
 * в app/[lang]/privacy/page.copy.tsx, дату здесь и подставь новый отпечаток из
 * сообщения об ошибке. Правка русского существа — правка и английского текста
 * (и его даты): перевод обязан говорить то же самое.
 */

const PAGE = path.join(__dirname, '..', 'app', '[lang]', 'privacy', 'page.tsx')

/** Отпечаток прозы каждого языка и дата, для которой он действителен. Дата дублируется, чтобы тест видел смену. */
const LOCKS: Record<Locale, { digest: string; updated: string }> = {
  ru: { digest: '9bad6c32f480dfcb', updated: '18 октября 2026' },
  en: { digest: '26dfbda92747707b', updated: 'October 19, 2026' },
}

/** Видимый текст куска JSX: абзацы — строками, разметка и сущности HTML — прочь */
function textOf(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
    .replace(/<\/(?:p|li|div|h\d)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Проза языка в COPY — все строки и видимый текст всех абзацев, по порядку
 * ключей. Обходом, а не списком полей: новое поле с текстом попадёт в
 * проверки ниже само. Без даты.
 */
function prose(copy: PolicyCopy): string {
  const chunks: string[] = []
  const walk = (v: unknown, key?: string): void => {
    if (key === 'updated') return
    if (typeof v === 'string') chunks.push(v)
    else if (isValidElement(v)) chunks.push(textOf(v))
    else if (Array.isArray(v)) for (const x of v) walk(x)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  walk(copy)
  return chunks
    .flatMap((s) => s.split('\n'))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Страница политики на языке — тем же вызовом, что делает Next */
const renderPage = (locale: Locale) =>
  PrivacyPage({ params: Promise.resolve({ lang: locale }), searchParams: Promise.resolve({}) })

/**
 * Проза, которую рисует страница языка: видимый текст и текстовые подписи
 * разметки — тем же рендером, что у читателя, — и без даты: отпечаток
 * действителен ДЛЯ неё. Заголовок вкладки и описание для поиска — из
 * COPY.meta: их отдаёт generateMetadata (вызов держит lib/social.test.ts).
 */
async function pageProse(locale: Locale): Promise<string> {
  const copy = COPY[locale]
  const page = await renderPage(locale)
  const labels = [...renderToStaticMarkup(page).matchAll(/\s(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map(
    (m) => m[1],
  )
  return [copy.meta.title, copy.meta.description, ...labels, textOf(page).split(copy.updated).join('')]
    .flatMap((s) => s.split('\n'))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Раздел политики по номеру — видимым текстом: ответ и абзацы */
function sectionText(locale: Locale, n: string): string {
  const s = COPY[locale].sections.find((x) => x.n === n)
  expect(s, `раздел ${n} (${locale})`).toBeDefined()
  return `${textOf(s?.answer)}\n${textOf(s?.body)}`.replace(/\s+/g, ' ')
}

describe.each(LOCALES)('политика конфиденциальности: %s', (locale) => {
  test('на странице стоит дата обновления', async () => {
    expect(COPY[locale].updated).toBe(LOCKS[locale].updated)
    // и страница её показывает — сразу за «Обновлено»
    expect(fs.readFileSync(PAGE, 'utf8')).toMatch(/\{copy\.updatedLead\}\s*\{copy\.updated\}/)
    expect(textOf(await renderPage(locale))).toContain(`${COPY[locale].updatedLead}${COPY[locale].updated}`)
  })

  test('текст политики не менялся в обход даты', async () => {
    const text = await pageProse(locale)
    expect(text.length, 'проза не извлеклась — проверь pageProse()').toBeGreaterThan(1500)
    const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
    expect(
      digest,
      `текст политики (${locale}) изменился. Если правка намеренная — обнови COPY.${locale}.updated в app/[lang]/privacy/page.copy.tsx, дату в LOCKS и подставь сюда ${digest}`,
    ).toBe(LOCKS[locale].digest)
  })
})

/*
 * Перевод юридического текста — раздел в раздел и абзац в абзац: пропавший
 * абзац английской версии — это обещание, которого англоязычный читатель не
 * получил. Сверяется форма, слова — отпечатком выше.
 */
describe('английская политика — та же, что русская', () => {
  const paragraphs = (node: ReactNode) => (renderToStaticMarkup(createElement(Fragment, null, node)).match(/<p[\s>]/g) ?? []).length

  test('те же разделы, те же абзацы, те же пункты «читаем / не читаем»', () => {
    const shape = (l: Locale) => ({
      sections: COPY[l].sections.map((s) => [s.n, paragraphs(s.body)]),
      reads: COPY[l].reads.length,
      skips: COPY[l].skips.length,
    })
    expect(shape('en')).toEqual(shape('ru'))
  })

  test('ни буквы кириллицы', async () => {
    // и в COPY.en, и в том, что рисует /en/privacy: слово мимо COPY — тоже
    for (const text of [prose(COPY.en), await pageProse('en')]) {
      expect(text.match(/[^\n]*[А-Яа-яЁё][^\n]*/g) ?? []).toEqual([])
    }
  })

  /*
   * Кнопки и разделы, которые проза называет, — теми же словами, что на
   * английских экранах (глоссарий docs/i18n.md): человек ищет на странице
   * ровно то слово, которое прочёл здесь. Апостроф в прозе — типографский.
   */
  test('названия кнопок — словами английских экранов', () => {
    const text = prose(COPY.en).replace(/’/g, "'")
    for (const label of [
      'Liked it',
      'Not it',
      'Into it',
      'Skip',
      'Browse',
      'Send to a friend',
      'Play tonight on PC',
      'Delete everything about me',
      'Your evenings',
      "What's new",
      "Where's that?",
      'Launch',
      'Share',
      'Download card',
    ]) {
      expect(text, label).toContain(`“${label}”`)
    }
  })

  test('числа и сроки — те же, что по-русски', () => {
    for (const n of ['01', '02', '03', '04', '05', '06', '07', '08']) {
      const digits = (l: Locale) => sectionText(l, n).match(/\d+/g) ?? []
      expect(digits('en'), n).toEqual(digits('ru'))
    }
  })
})

/**
 * Потолки, которые считаются по SteamID, — и слово, которым их называет раздел
 * 06.
 *
 * Строка лимитера — bucket:id:окно (lib/ratelimit), и id у части потолков —
 * steamid или personalRateId, то есть тот же steamid (у сессии по ссылке — с
 * номером сессии). Раздел 06 обещает, что обращения считаются по адресу, а
 * прежде называл по SteamID одну ссылку на RSS. В коде так же считались
 * подбор, игра дня, оценки, голоса в пати и ещё десяток действий: читатель
 * политики думал, что его SteamID в счётчики не попадает, пока он не выпустил
 * ссылку на ленту, — а его писала туда каждая оценка.
 *
 * Сторож держит обе стороны: каждый потолок по SteamID в коде назван здесь, а
 * его слово стоит в той части раздела, что говорит про SteamID. Новый такой
 * потолок без слова в политике уронит прогон — тогда допиши его в абзац
 * раздела 06 и сюда. Потолок в памяти инстанса (memoryGate) в базе не лежит, и
 * политике о нём говорить нечего.
 */
const BY_STEAMID: Record<string, Record<Locale, string>> = {
  recommend: { ru: 'подбор', en: 'picks' },
  daily: { ru: 'игра дня', en: 'the game of the day' },
  explore: { ru: '«Полистать»', en: '“Browse”' },
  prepare: { ru: 'разбор библиотеки', en: 'reading your library' },
  feedback: { ru: 'оценки', en: 'ratings' },
  outcome: { ru: 'ответы «как тебе?»', en: 'answers to “How is it?”' },
  'pick-share': { ru: 'ссылки на выбор', en: 'pick links' },
  'room-vote': { ru: 'голоса', en: 'votes' },
  'room-deck': { ru: 'колода', en: 'the deck' },
  'room-leader': { ru: 'остальные действия в пати', en: 'other party actions' },
  'room-likes': { ru: 'остальные действия в пати', en: 'other party actions' },
  'room-trivia': { ru: 'остальные действия в пати', en: 'other party actions' },
  'room-public': { ru: 'остальные действия в пати', en: 'other party actions' },
  feedlink: { ru: 'выпуск ссылки на RSS', en: 'issuing an RSS link' },
  feedrss: { ru: 'сколько раз ридер забирал ленту', en: 'how many times a reader fetched the feed' },
  // Счёт — по SteamID хозяина портрета, а не открывшего: стережёт пересборку
  portrait: {
    ru: 'Пересборка текста портрета считается по SteamID того, чей он',
    en: 'Rebuilding the portrait text is counted against the SteamID of the person it belongs to',
  },
  // Квота демо на умные объяснения — суточная, длиннее прочих окон
  'llm-demo': {
    ru: 'у демо-профиля счётчик подборов с умными объяснениями — не дольше суток',
    en: 'for the demo profile, the counter for picks with smart explanations lasts up to a day',
  },
}

const ROOT = path.join(__dirname, '..')

/** Каждый потолок в базе (checkRate, checkRatesInOrder) — с тем, что стоит у него в id */
function rateGates(): Array<{ file: string; bucket: string; id: string }> {
  const gates: Array<{ file: string; bucket: string; id: string }> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        for (const m of src.matchAll(/(memoryGate\(\s*\{\s*)?bucket:\s*'([^']+)',\s*id:\s*([^,\n}]+)/g)) {
          if (m[1]) continue
          gates.push({ file: rel, bucket: m[2], id: m[3].trim() })
        }
      }
    }
  }
  walk('app')
  walk('lib')
  return gates
}

/** Где в разделе 06 начинается и кончается часть про SteamID — на каждом языке */
const STEAMID_PART: Record<Locale, { from: string; to: string; session: string }> = {
  ru: { from: 'по твоему SteamID', to: 'ближайшей уборкой', session: 'номер этой сессии' },
  en: { from: 'by your SteamID', to: 'next cleanup', session: 'the number of that session' },
}

/** Абзац раздела 06 про SteamID — от «по твоему SteamID» до уборки, видимым текстом */
function steamidPart(locale: Locale): string {
  const text = sectionText(locale, '06')
  const { from, to } = STEAMID_PART[locale]
  const start = text.indexOf(from)
  expect(start, `«${from}» в разделе 06`).toBeGreaterThan(-1)
  const end = text.indexOf(to, start)
  expect(end, `уборка после «${from}»`).toBeGreaterThan(start)
  return text.slice(start, end)
}

describe('раздел 06: что считается по SteamID', () => {
  const gates = rateGates()

  test('сторож видит потолки: и по адресу, и по SteamID', () => {
    // без этого пустой обход прошёл бы сторож ниже вслепую
    expect(gates.find((g) => g.bucket === 'recommend-ip')?.id).toBe('ip')
    expect(gates.find((g) => g.bucket === 'feedback')?.id).toBe('steamid')
  })

  test.each(LOCALES)('%s: каждый потолок по SteamID назван в абзаце про SteamID', (locale) => {
    const bySteamid = [...new Set(gates.filter((g) => /steamid|personalRateId\(/i.test(g.id)).map((g) => g.bucket))]
    expect(bySteamid.sort()).toEqual(Object.keys(BY_STEAMID).sort())
    const part = steamidPart(locale)
    for (const [bucket, word] of Object.entries(BY_STEAMID)) expect(part, bucket).toContain(word[locale])
  })

  /*
   * personalRateId у сессии по ссылке пишет в ключ и номер сессии — иначе
   * чужой со ссылкой на профиль тратил бы потолок владельца. Политика обязана
   * назвать и это: в базе лежит не один SteamID.
   */
  test.each(LOCALES)('%s: у потолков по personalRateId сказано про номер сессии', (locale) => {
    expect(gates.some((g) => g.id.startsWith('personalRateId('))).toBe(true)
    expect(steamidPart(locale)).toContain(STEAMID_PART[locale].session)
  })
})
