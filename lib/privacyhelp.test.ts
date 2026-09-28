import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { PrivacyHelp } from '../components/PrivacyHelp'

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

// Вызовом, а не createElement: хуков у панели нет, а у createElement с
// пропсами, где всё необязательно, TS не находит перегрузки
const html = (props: Parameters<typeof PrivacyHelp>[0] = {}) => renderToStaticMarkup(PrivacyHelp(props))

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
    // приглушение — по aria-disabled: у .btn-glass своё только для :disabled
    expect(busy).toMatch(/<button[^>]*class="[^"]*aria-disabled:opacity-60/)
    // шаг инструкции по-прежнему называет кнопку её настоящим именем
    expect(busy).toContain('нажми «Я открыл — проверить»')
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
      'app/daily/page.tsx',
      'app/explore/page.tsx',
      'app/library/page.tsx',
      'app/play/page.tsx',
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
    ['app/play/page.tsx', 'readOnly ? undefined : steamLoginFor(`/play?${search}`)'],
    ['app/daily/page.tsx', "readOnly ? undefined : steamLoginFor('/daily')"],
    ['app/explore/page.tsx', "readOnly ? undefined : steamLoginFor('/explore')"],
    ['app/library/page.tsx', "session && isWriter(session) ? steamLoginFor('/library') : undefined"],
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
