import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { NEAR_SHOWN, nearPlayedLabel, ownedNearStore, parseOwnedNear } from './ownednear'

const ROOT = path.join(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('«Похожее уже есть у тебя» — разбор и подпись', () => {
  test('строгий разбор: битое и чужое — мимо, потолок — NEAR_SHOWN', () => {
    expect(
      parseOwnedNear([
        { appid: 1, name: 'Dead Cells', minutes: 0 },
        { appid: 'x', name: 'мусор', minutes: 0 },
        { appid: 2, name: '  ', minutes: 5 },
        { appid: -3, name: 'Чужой магазин', minutes: 5 },
        { appid: 4, name: 'Hades', minutes: null },
        { appid: 5, name: 'Spelunky', minutes: -1 },
        { appid: 6, name: 'Четвёртая', minutes: 1 },
      ]),
    ).toEqual([
      { appid: 1, name: 'Dead Cells', minutes: 0 },
      { appid: 4, name: 'Hades', minutes: null },
      // отрицательные минуты — не «не запускал», а «не знаем»
      { appid: 5, name: 'Spelunky', minutes: null },
    ])
    expect(NEAR_SHOWN).toBe(3)
    expect(parseOwnedNear(undefined)).toEqual([])
    expect(parseOwnedNear({ appid: 1 })).toEqual([])
  })

  test('ноль — «не запускал», скрытое время — без подписи, а не «не запускал»', () => {
    expect(nearPlayedLabel(0)).toBe('не запускал')
    expect(nearPlayedLabel(null)).toBeNull()
    expect(nearPlayedLabel(25)).toBe('наиграно 25 мин')
    expect(nearPlayedLabel(180)).toBe('наиграно 3 ч')
  })

  test('на /en — подпись по-английски, тем же правилом', () => {
    expect(nearPlayedLabel(0, 'en')).toBe('never launched')
    expect(nearPlayedLabel(null, 'en')).toBeNull()
    expect(nearPlayedLabel(25, 'en')).toBe('25 min played')
    expect(nearPlayedLabel(180, 'en')).toBe('3 h played')
    expect(nearPlayedLabel(74_040, 'en')).toBe('1,234 h played')
  })

  test('хранилище будит подписчиков и помнит, для какой игры список', () => {
    let calls = 0
    const off = ownedNearStore.subscribe(() => calls++)
    ownedNearStore.set({ appid: 7, games: [{ appid: 8, name: 'Игра', minutes: 0 }] })
    expect(ownedNearStore.get()?.appid).toBe(7)
    expect(ownedNearStore.server()).toBeNull()
    off()
    ownedNearStore.set(null)
    expect(calls).toBe(1)
  })
})

/*
 * Сторож устройства: строка не заводит своего запроса и не трогает ISR.
 * Обратно это возвращается одной строкой fetch в островке — и тогда каждый
 * заход вошедшего на карточку стоил бы двух вызовов функции вместо одного.
 */
describe('«Похожее уже есть у тебя» — тем же запросом, что «Запустить»', () => {
  /*
   * Строку ISR не рисует (на сервере хранилище пустое), и тест страницы «на
   * /en нет кириллицы» её не видит. Островок пришёл из main по-русски уже
   * после перевода страницы — поэтому сторож здесь: русский в нём только
   * парой tr, а подпись наигранного — с языком.
   */
  test('OwnedNear говорит на языке страницы: русский — только парой tr', () => {
    const src = code(read('components', 'OwnedNear.tsx'))
    expect(src).toContain('const locale = useLocale()')
    expect(src).toContain('nearPlayedLabel(g.minutes, locale)')
    const bare = src.replace(/\btr\(locale, \{ ru: '[^']*', en: '[^']*' \}\)/g, 'tr()')
    expect(bare.match(/.{0,30}[А-Яа-яЁё].{0,30}/g)).toBeNull()
  })

  test('OwnedNear ничего не спрашивает сам — только читает хранилище', () => {
    const src = code(read('components', 'OwnedNear.tsx'))
    expect(src).not.toMatch(/\bfetch\(/)
    expect(src).toContain('ownedNearStore')
    // ссылка на карточку — без префетча (GameLink), как у «Похожих»
    expect(src).toMatch(/<GameLink\b/)
  })

  test('OwnedLaunch спрашивает near только по слову страницы и кладёт ответ в хранилище', () => {
    const src = code(read('components', 'OwnedLaunch.tsx'))
    expect(src).toContain("${near ? '&near=1' : ''}")
    expect(src).toMatch(/if \(near\) ownedNearStore\.set\(\{ appid, games: parseOwnedNear\(d\.near\) \}\)/)
  })

  /*
   * Хранилище модульное: выход и «Удалить всё обо мне» уходят на главную
   * переходом роутера, и без явного сброса «Назад» на ту же карточку
   * показал бы вышедшему гостю чужую полку — OwnedLaunch гостю ничего не
   * спрашивает и список не перезапишет. Второй замок — в самой строке.
   */
  test('выход и «Удалить всё обо мне» стирают список до перехода, а строка встаёт только у пишущей сессии', () => {
    for (const [file, gate] of [
      ['SignOut.tsx', "if (reply === 'failed')"],
      ['ForgetMe.tsx', "if (reply !== 'done')"],
    ] as const) {
      const src = code(read('components', file))
      const at = src.indexOf('ownedNearStore.set(null)')
      expect(at, file).toBeGreaterThan(src.indexOf(gate))
      expect(at, file).toBeLessThan(src.indexOf("router.replace('/')"))
    }
    const near = code(read('components', 'OwnedNear.tsx'))
    expect(near).toContain('useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server)')
    expect(near).toMatch(/if \(writer !== true \|\| !near \|\|/)
  })

  test('страница просит near только при готовых соседях и ставит строку над «Похожими»', () => {
    const page = code(read('app', '[lang]', 'game', '[appid]', 'page.tsx'))
    expect(page).toMatch(
      /const nearAsk = !meta\.storeUrl && !verdict && data\.similar\.length > 0 && !data\.similarTag/,
    )
    expect(page).toMatch(/<OwnedLaunch\b[\s\S]{0,300}?near=\{nearAsk\}/)
    const line = page.indexOf('<OwnedNear appid={appid} />')
    expect(line).toBeGreaterThan(-1)
    expect(line).toBeLessThan(page.indexOf("tr(locale, { ru: 'Похожие', en: 'Similar games' })"))
  })
})
