import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { BannedShelf, type BannedGame } from '../components/BannedShelf'
import { LocaleProvider } from '../components/LocaleProvider'

// Островку нужен роутер (useLocaleRouter): до нажатия он только хранится
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {}, back() {}, forward() {} }),
}))

/**
 * Сторож полок забаненного на /library (components/BannedShelf.tsx).
 *
 * Сами полки — клиентский островок, и в браузере их состояния надо ещё
 * собрать: пройденное, скрытое, отказ сети, сессия без права записи. Разметка
 * же видна вся и сразу, поэтому проверка статическая — как у сторожей зоны
 * попадания и склонений.
 */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'components', 'BannedShelf.tsx'), 'utf8')
/** Код без комментариев: объяснение правки не должно попадать под проверку */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('полки скрытого и пройденного', () => {
  /*
   * Видимый текст кнопки один на всю полку, и скринридер зачитывал пять
   * одинаковых «Вернуть в подбор», не говоря, какая к какой игре.
   */
  test('у каждой кнопки возврата имя с названием игры', () => {
    const at = CODE.indexOf('aria-label={')
    expect(at, 'aria-label у кнопок полки не найден — сторож ослеп').toBeGreaterThan(-1)
    const label = CODE.slice(at, CODE.indexOf('className=', at))
    // Обе полки: у пройденного своё действие, у скрытого своё
    expect(label).toContain('`Снова предлагать «${g.name}»`')
    expect(label).toContain('`Вернуть «${g.name}» в подбор`')
  })

  /*
   * «Чистилище» на портрете — нераспакованное, а здесь было забаненное: одно
   * слово на двух экранах значило разное. И «Ты выгнал N» подавал пройденное
   * как изгнанное.
   */
  test('ни «Чистилища», ни «выгнал» в разметке полок', () => {
    expect(CODE).not.toMatch(/Чистилище|выгнал/)
  })

  // Обесцвечивает GameCardBody по флагу dim — флаг обязан зависеть только от
  // полки скрытого, а не стоять на всех карточках
  test('пройденное не обесцвечивается — серой остаётся только полка скрытого', () => {
    expect(CODE).toMatch(/dim=\{shelf === 'hidden'\}/)
  })

  /*
   * Полки — из пропа, а не из копии в состоянии. «Уже прошёл» в «Твоих
   * вечерах» на той же странице зовёт router.refresh(), и копия, снятая с
   * первой разметки, новой пройденной игры не видела: вернуть её было не с
   * чего до перезагрузки. Снятое здесь прячет множество поверх пропа, а
   * забывает его новый проп, где игры уже нет, — иначе снятая и отмеченная
   * снова игра так и не вернулась бы на полку.
   */
  test('полки выводятся из пропа: refresh приносит новую игру', () => {
    expect(CODE).not.toMatch(/useState\(games\)\s*const \[failed/)
    expect(CODE).not.toMatch(/setItems\(/)
    expect(CODE).toMatch(/const items = games\.filter\(\(g\) => !removed\.has\(g\.appid\)\)/)
    expect(CODE).toMatch(/if \(seen !== games\) \{\s*setSeen\(games\)/)
    const prune = CODE.slice(CODE.indexOf('if (seen !== games) {'), CODE.indexOf('const items = games'))
    expect(prune, 'снятое забывается, когда сервер его больше не отдаёт').toMatch(/present\.has\(id\)/)
  })
})

/*
 * Английские полки настоящим рендером. Имя кнопки начинается с её видимых
 * слов (WCAG 2.5.3, как у «Уже прошёл»): «Suggest “X” again» рвало «Suggest
 * again», и голосом кнопку было не позвать. Абзац под заголовком — в числе заголовка: под
 * «1 game …» строка про «they» читалась ошибкой.
 */
describe('полки скрытого и пройденного на /en', () => {
  const game = (appid: number, name: string, done: boolean): BannedGame => ({
    appid,
    name,
    headerImage: null,
    art: null,
    done,
  })
  const html = (games: BannedGame[]) =>
    renderToStaticMarkup(
      createElement(
        LocaleProvider,
        { locale: 'en' } as ComponentProps<typeof LocaleProvider>,
        createElement(BannedShelf, { games, writer: true }),
      ),
    ).replaceAll('&#x27;', "'")
  /** Кнопка полки: имя и видимый текст */
  const buttons = (out: string) =>
    [...out.matchAll(/<button type="button" aria-label="([^"]*)" class="pill[^"]*">([^<]*)<\/button>/g)].map(
      ([, name, text]) => ({ name, text }),
    )

  test('имя кнопки начинается с её видимых слов', () => {
    const got = buttons(html([game(1, 'Portal 2', true), game(2, 'Celeste', false)]))
    expect(got).toEqual([
      { name: 'Back into picks: “Celeste”', text: 'Back into picks' },
      { name: 'Suggest again: “Portal 2”', text: 'Suggest again' },
    ])
  })

  test('одна игра — абзац в единственном числе, несколько — во множественном', () => {
    const one = html([game(1, 'Portal 2', true), game(2, 'Celeste', false)])
    expect(one).toContain('1</span> game we no longer suggest')
    expect(one).toContain("It's really gone from your picks")
    expect(one).toContain("We don't suggest it because you finished it")
    const many = html([game(1, 'A', true), game(2, 'B', true), game(3, 'C', false), game(4, 'D', false)])
    expect(many).toContain("They're really gone from your picks")
    expect(many).toContain("We don't suggest them because you finished them")
  })
})
