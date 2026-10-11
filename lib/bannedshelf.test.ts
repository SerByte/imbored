import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

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
