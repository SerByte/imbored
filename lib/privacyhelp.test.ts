import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LocaleProvider } from '../components/LocaleProvider'
import { PlaytimeHiddenNote, PrivacyHelp } from '../components/PrivacyHelp'

/**
 * «Я открыл — проверить» в панели скрытой библиотеки.
 *
 * Последним шагом инструкции было «вернись сюда и попробуй снова» — без
 * кнопки, и что значит «снова», человек угадывал сам: после отказа входа
 * через Steam единственной дверью была тихая строка в карточке, а заметное
 * поле для ссылки давало вход только для чтения. Проверяем и саму панель, и
 * то, что каждое место, где она стоит, даёт ей настоящее действие.
 */

const ROOT = path.join(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
/** Код без комментариев: докблоки цитируют то, что здесь ищется */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// Вызовом, а не createElement: у самой PrivacyHelp хуков нет (язык читает
// панель под ней), а у createElement с пропсами, где всё необязательно, TS не
// находит перегрузки
const html = (props: Parameters<typeof PrivacyHelp>[0] = {}) => renderToStaticMarkup(PrivacyHelp(props))
/** То же на /en: язык — из контекста страницы, как его ставит корневой layout */
const htmlEn = (props: Parameters<typeof PrivacyHelp>[0] = {}) =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en' } as ComponentProps<typeof LocaleProvider>, PrivacyHelp(props))).replace(
    /&#x27;/g,
    "'",
  )
const CYRILLIC = /[А-Яа-яЁё]/

describe('панель скрытой библиотеки', () => {
  test('без действия — прежний последний шаг и никакой кнопки', () => {
    const out = html()
    expect(out).toContain('Вернись сюда и попробуй снова')
    expect(out).not.toContain('Я открыл — проверить')
    expect(out).not.toContain('минуту-другую')
  })

  test('вход через Steam — ссылка с тем адресом, что дали, и подпись про задержку', () => {
    const out = html({ retryHref: '/api/auth/steam?join=ABC234' })
    expect(out).toMatch(/<a href="\/api\/auth\/steam\?join=ABC234"[^>]*>Я открыл — проверить<\/a>/)
    expect(out).toContain('Вернись сюда и нажми «Я открыл — проверить»')
    expect(out).toContain('Steam иногда применяет настройку минуту-другую')
    expect(out).not.toContain('<button')
  })

  /*
   * Пока идёт проверка, кнопка отключена для скринридера (aria-disabled), но
   * не для браузера: у disabled он отбирает фокус и уводит его в body, и после
   * повторного отказа клавиатура начинала бы со страницы сверху. Та же ловушка,
   * что уже чинили у переключателей /play, «Не сегодня» /daily и SharePick.
   */
  test('повтор ссылки — кнопка; пока идёт, говорит об этом и держит фокус', () => {
    const idle = html({ onRetry: () => {} })
    expect(idle).toMatch(/<button type="button"[^>]*>Я открыл — проверить<\/button>/)
    expect(idle).toMatch(/<button[^>]*aria-disabled="false"/)
    expect(idle).not.toMatch(/<button[^>]*\sdisabled[=\s>]/)

    const busy = html({ onRetry: () => {}, retrying: true })
    expect(busy).toMatch(/<button type="button"[^>]*>Проверяю…<\/button>/)
    expect(busy).toMatch(/<button[^>]*aria-disabled="true"/)
    expect(busy).toMatch(/<button[^>]*aria-busy="true"/)
    expect(busy, 'disabled уводит фокус в body').not.toMatch(/<button[^>]*\sdisabled[=\s>]/)
    // приглушение — по aria-disabled, как у всех кнопок на время запроса (lib/disabledfocus.test.ts)
    expect(busy).toMatch(/<button[^>]*class="[^"]*aria-disabled:opacity-60/)
    // шаг инструкции по-прежнему называет кнопку её настоящим именем
    expect(busy).toContain('нажми «Я открыл — проверить»')
  })
})

/*
 * Шаги описывают чужой интерфейс, поэтому по-английски — подписи английского
 * клиента Steam дословно: человек ищет глазами ровно эти слова. И шаг
 * по-прежнему называет кнопку её настоящим именем.
 */
describe('панель скрытой библиотеки по-английски', () => {
  test('шаги — словами английского Steam, кнопка — тем же именем, что в шаге', () => {
    const out = htmlEn({ retryHref: '/api/auth/steam?next=%2Flibrary&lang=en' })
    expect(out).toContain('“Game details” → <span class="text-ink">Public</span>')
    expect(out).toContain('Uncheck “Always keep my total playtime private even if users can see my game details”')
    expect(out).toContain('Come back here and press “Done — check again”')
    expect(out).toMatch(/<a href="\/api\/auth\/steam\?next=%2Flibrary&amp;lang=en"[^>]*>Done — check again<\/a>/)
    expect(out).not.toMatch(CYRILLIC)
  })

  test('без действия, повтор ссылки и проверка — без русских слов', () => {
    expect(htmlEn()).toContain('Come back here and try again')
    expect(htmlEn({ onRetry: () => {}, retrying: true })).toMatch(/<button type="button"[^>]*>Checking…<\/button>/)
    for (const props of [{}, { onRetry: () => {} }, { onRetry: () => {}, retrying: true }]) {
      expect(htmlEn(props)).not.toMatch(CYRILLIC)
    }
  })

  test('строка о скрытом времени — тот же шаг и ссылка на подключение на /en', () => {
    const out = renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en' } as ComponentProps<typeof LocaleProvider>, createElement(PlaytimeHiddenNote)))
    expect(out).toContain('Looks like Steam is hiding your playtime')
    expect(out).toContain('Uncheck “Always keep my total playtime private even if users can see my game details”')
    expect(out).toMatch(/<a [^>]*href="\/en\?reconnect=1"[^>]*>reconnect your library<\/a>/)
    expect(out).not.toMatch(CYRILLIC)
  })
})

describe('каждое место панели даёт ей проверку', () => {
  /** Открывающие теги <PrivacyHelp …> по всему коду продукта */
  function tags(): Array<{ file: string; tag: string }> {
    const out: Array<{ file: string; tag: string }> = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) walk(rel)
        else if (e.name.endsWith('.tsx')) {
          const src = code(read(rel))
          for (const m of src.matchAll(/<PrivacyHelp\b/g)) {
            const end = src.indexOf('/>', m.index)
            out.push({ file: rel, tag: src.slice(m.index, end + 2) })
          }
        }
      }
    }
    for (const dir of ['app', 'components']) walk(dir)
    return out
  }

  test('обход находит все пять мест', () => {
    expect(tags().map((t) => t.file).sort()).toEqual([
      'app/[lang]/daily/page.tsx',
      'app/[lang]/explore/page.tsx',
      'app/[lang]/library/page.tsx',
      'app/[lang]/play/page.tsx',
      'components/landing/ConnectCard.tsx',
    ])
  })

  test('ни одна панель не стоит без действия', () => {
    const bare = tags().filter((t) => !/\b(?:retryHref|onRetry)\b/.test(t.tag))
    expect(bare.map((t) => t.file), 'панель без retryHref/onRetry — снова «попробуй» без кнопки').toEqual([])
  })

  /*
   * Проверка на страницах продукта — вход через Steam, который возвращает на
   * ту же страницу: снимок библиотеки пишет вход, а /api/prepare без снимка
   * сам ничего не перезапрашивает. Сессии по ссылке Steam-вход проверкой не
   * навязывается — у неё своя дверь «Подключить заново».
   */
  test.each([
    ['app/[lang]/play/page.tsx', 'readOnly ? undefined : steamLoginFor(lp(locale, `/play?${search}`))'],
    ['app/[lang]/daily/page.tsx', "readOnly ? undefined : steamLoginFor(lp(locale, '/daily'))"],
    ['app/[lang]/explore/page.tsx', "readOnly ? undefined : steamLoginFor(lp(locale, '/explore'))"],
    ['app/[lang]/library/page.tsx', "session && isWriter(session) ? steamLoginFor(lp(locale, '/library')) : undefined"],
  ])('%s: проверка — вход через Steam обратно сюда', (file, expr) => {
    const tag = tags().find((t) => t.file === file)?.tag ?? ''
    expect(tag).toContain(`retryHref={${expr}}`)
  })

  /*
   * Карточка подключения: отказ в адресе (?error=private) — это возврат из
   * Steam, и проверка — снова вход с тем же carry (steamHref собирает его из
   * join/compat/next). Отказ после поля — та же ссылка ещё раз. Панель стоит
   * и на время проверки: кнопка, которую нажали, — в ней.
   */
  test('карточка подключения: вход с тем же carry или повтор поля', () => {
    const card = code(read('components/landing/ConnectCard.tsx'))
    const tag = tags().find((t) => t.file === 'components/landing/ConnectCard.tsx')?.tag ?? ''
    expect(tag).toContain('retryHref: steamHref')
    expect(tag).toContain('onRetry: recheckProfile')
    expect(card).toMatch(/\(error === 'private' \|\| rechecking\) && \(\s*<PrivacyHelp/)
    expect(card, 'отправка поля обязана помечать путь отказа').toMatch(
      /if \(!asDemo\) setLastTry\('form'\)/,
    )
    // кнопка на время проверки не disabled — второй запрос обязан гасить сам обработчик
    expect(card, 'повтор нажатия во время проверки не шлёт второй запрос').toMatch(
      /function recheckProfile\(\) \{\s*if \(!input \|\| busy !== null\) return/,
    )
    expect(card, 'steamHref везёт join, compat и next').toMatch(
      /const steamHref = joinTarget\s*\?\s*`\/api\/auth\/steam\?join=/,
    )
  })
})
