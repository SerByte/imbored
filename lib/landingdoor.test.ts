import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож двери на главной.
 *
 * Главная переезжала дважды и оба раза по одной причине: она то показывала,
 * не давая ничего сделать, то давала, ничего не показав. Нынешняя раскладка
 * держит оба порядка сразу — карточка подключения в первом экране, рассказ о
 * продукте ниже по прокрутке, — и у этой раскладки есть три условия, которые
 * ломаются молча.
 *
 * ПЕРВОЕ: форма ровно одна. Соблазн поставить вторую карточку внизу страницы
 * («чтобы не скроллить обратно») выглядит безобидно и ломает сразу три вещи:
 * два <input id="steam-profile"> в одном документе — это неуникальный id и
 * мёртвый label for, а две парадные кнопки «Подобрать игру» — два разных
 * обещания на одном экране.
 *
 * ВТОРОЕ: карточка стоит в герое, а не под рассказом. Ровно это и было
 * дефектом предыдущей версии: вошедшему, приглашённому в пати и вернувшемуся
 * из Steam с ?error= единственное действие сайта отъезжало на четыре секции
 * вниз, а строку ошибки не было видно вовсе.
 *
 * ТРЕТЬЕ: прокрутка ничего не анимирует. Это прямое требование к странице, а
 * не вкус: блоки, выезжающие на прокрутке, здесь не нужны. Требование живёт в
 * докблоке app/page.tsx — тест не даёт ему остаться одним лишь комментарием.
 */

const ROOT = path.join(__dirname, '..')
const PAGE = path.join(ROOT, 'app', 'page.tsx')
const LANDING = path.join(ROOT, 'components', 'landing')

/** Код без комментариев: иначе сторож ловит объяснение правки вместо правки. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Все .tsx проекта — форма могла бы завестись где угодно, не только на главной. */
function allTsx(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx')) out.push(p)
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

describe('дверь на главной', () => {
  const page = code(fs.readFileSync(PAGE, 'utf8'))

  test('поле профиля в проекте ровно одно', () => {
    const hits = allTsx().flatMap((file) => {
      const n = [...code(fs.readFileSync(file, 'utf8')).matchAll(/id="steam-profile"/g)].length
      return n ? [`${path.relative(ROOT, file).split(path.sep).join('/')} — ${n}`] : []
    })
    expect(
      hits,
      'id должен быть уникальным, иначе label for указывает не туда, а браузер подставляет сохранённое не в то поле',
    ).toEqual(['components/landing/ConnectCard.tsx — 1'])
  })

  test('карточка подключения на главной одна', () => {
    const used = [...page.matchAll(/<ConnectCard\b/g)].length
    expect(used, 'вторая карточка — это второй такой же id и второе «Подобрать игру»').toBe(1)
  })

  test('карточка стоит в первом экране, а не под рассказом о продукте', () => {
    // Поиск с границей слова, а не indexOf: indexOf('<ConnectCard') радостно
    // находит и <ConnectCardЧтоУгодно, то есть проверка проходила бы там, где
    // настоящей карточки на странице уже нет.
    const card = page.search(/<ConnectCard\b/)
    const primer = page.search(/<Primer\b/)
    expect(card, '<ConnectCard> на главной не найден').toBeGreaterThan(-1)
    expect(primer, '<Primer> на главной не найден').toBeGreaterThan(-1)
    expect(
      card,
      'карточка снова уехала ниже рассказа — вошедший опять будет искать кнопку прокруткой',
    ).toBeLessThan(primer)

    // И именно ВНУТРИ кино-зоны, а не просто выше по файлу: карточка, вынутая
    // из героя и поставленная строкой выше рассказа, прошла бы проверку
    // порядка и всё равно не была бы в первом экране.
    const hero = page.indexOf('id="connect"')
    expect(hero, 'у первого экрана нет якоря #connect — кнопке снизу некуда возвращать').toBeGreaterThan(-1)
    const heroEnd = page.indexOf('</section>', hero)
    expect(heroEnd, 'кино-зона не закрыта — разбирать нечего').toBeGreaterThan(hero)
    expect(
      card > hero && card < heroEnd,
      'карточка стоит вне кино-зоны — значит и вне первого экрана',
    ).toBe(true)
  })

  test('низ страницы возвращает к карточке якорем, а не второй формой', () => {
    expect(page, 'кнопка внизу должна вести к #connect').toMatch(/href="#connect"/)
    // Голая ссылка в Steam внизу увела бы приглашённого в пати на общий подбор:
    // адрес входа собирается из ?join / ?compat / ?next и живёт в карточке.
    const bareSteam = [...page.matchAll(/href="\/api\/auth\/steam"/g)].length
    expect(bareSteam, 'вход без параметров назначения на главной не место').toBe(0)
  })

  test('прокрутка на главной ничего не двигает', () => {
    const files = [PAGE, ...fs.readdirSync(LANDING).map((f) => path.join(LANDING, f))]
    const banned = /\bwhileInView\b|\buseScroll\b|\bscrollYProgress\b|\bScrollTrigger\b|\bIntersectionObserver\b|\bonScroll\b/
    const hits = files.flatMap((file) => {
      const m = code(fs.readFileSync(file, 'utf8')).match(banned)
      return m ? [`${path.relative(ROOT, file).split(path.sep).join('/')} — ${m[0]}`] : []
    })
    expect(
      hits,
      'блоки, выезжающие на прокрутке, на главной не нужны — см. докблок app/page.tsx',
    ).toEqual([])
  })

  test('фолбэк и карточка держат одну высоту из одного места', () => {
    const fallback = fs.readFileSync(path.join(LANDING, 'ConnectFallback.tsx'), 'utf8')
    const cardSrc = fs.readFileSync(path.join(LANDING, 'ConnectCard.tsx'), 'utf8')
    expect(fallback).toMatch(/export const CONNECT_CARD_MIN_H = 'min-h-\[\d+px\]'/)
    expect(
      code(cardSrc),
      'карточка обязана брать потолок из общей константы, иначе подмена фолбэка снова начнёт дёргать первый экран',
    ).toContain('CONNECT_CARD_MIN_H')
  })
})
