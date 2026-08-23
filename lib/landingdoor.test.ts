import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { RIBBON_SCORE } from './ribbonlight'

/**
 * Сторож главной.
 *
 * Главная переезжала трижды, и каждый раз по одной причине: она то показывала,
 * не давая ничего сделать, то давала, ничего не показав. Нынешняя раскладка
 * держит оба порядка сразу — карточка подключения в первом экране, шесть
 * закреплённых сцен ниже, — и у неё есть условия, которые ломаются молча.
 *
 * ПЕРВОЕ: форма ровно одна. Соблазн поставить вторую карточку внизу («чтобы не
 * скроллить обратно») выглядит безобидно и ломает три вещи разом: два
 * <input id="steam-profile"> в одном документе — это неуникальный id и мёртвый
 * label for, а две парадные кнопки «Подобрать игру» — два разных обещания.
 *
 * ВТОРОЕ: карточка стоит в первом экране. Ровно это и было дефектом
 * предыдущей версии: вошедшему, приглашённому в пати и вернувшемуся из Steam
 * с ?error= единственное действие сайта отъезжало на четыре секции вниз, а
 * строку ошибки не было видно вовсе.
 *
 * ТРЕТЬЕ: у любого движения есть путь покоя. Иначе «уменьшить движение»
 * превращается из настройки доступности в сломанную страницу — и заметит это
 * только тот, у кого настройка включена, то есть никогда не мы.
 *
 * ЧЕТВЁРТОЕ: идентификаторы сцен совпадают с партитурой света ленты. Это
 * единственная связь между двумя файлами, и она держится на строках: переименуй
 * сцену — и лента молча перестанет реагировать на неё, оставшись в состоянии
 * предыдущей.
 */

const ROOT = path.join(__dirname, '..')
const PAGE = path.join(ROOT, 'app', 'page.tsx')
const LANDING = path.join(ROOT, 'components', 'landing')
const SCENES = path.join(LANDING, 'scenes')

/** Код без комментариев: объяснение правки не должно попадать под проверку. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

function allTsx(): string[] {
  return [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))]
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

describe('главная', () => {
  const page = code(fs.readFileSync(PAGE, 'utf8'))
  const landing = walk(LANDING)

  test('поле профиля в проекте ровно одно', () => {
    const hits = allTsx().flatMap((file) => {
      const n = [...code(fs.readFileSync(file, 'utf8')).matchAll(/id="steam-profile"/g)].length
      return n ? [`${rel(file)} — ${n}`] : []
    })
    expect(
      hits,
      'id должен быть уникальным, иначе label for указывает не туда, а браузер подставляет сохранённое не в то поле',
    ).toEqual(['components/landing/ConnectCard.tsx — 1'])
  })

  test('карточка подключения на главной одна', () => {
    const used = landing.flatMap((file) => {
      const n = [...code(fs.readFileSync(file, 'utf8')).matchAll(/<ConnectCard\b/g)].length
      return n ? [`${rel(file)} — ${n}`] : []
    })
    expect(used, 'вторая карточка — это второй такой же id и второе «Подобрать игру»').toEqual([
      'components/landing/scenes/Hero.tsx — 1',
    ])
  })

  test('карточка стоит в первом экране, а не под рассказом о продукте', () => {
    const hero = code(fs.readFileSync(path.join(SCENES, 'Hero.tsx'), 'utf8'))
    expect(hero, 'карточка уехала из героя — значит и из первого экрана').toMatch(/<ConnectCard\b/)

    const heroAt = page.search(/<Hero\b/)
    const painAt = page.search(/<Pain\b/)
    expect(heroAt, 'герой на главной не найден').toBeGreaterThan(-1)
    expect(painAt, 'вторая сцена на главной не найдена').toBeGreaterThan(-1)
    expect(heroAt, 'герой обязан идти первым').toBeLessThan(painAt)
  })

  /**
   * Голая ссылка в Steam внизу увела бы приглашённого в пати на общий подбор:
   * адрес входа собирается из ?join / ?compat / ?next и живёт в карточке.
   *
   * Исключение ровно одно — фолбэк: без JS параметры назначения посчитать
   * нечем, и рабочая дверь важнее точного адреса.
   */
  test('вход без параметров назначения есть только в фолбэке', () => {
    const hits = [PAGE, ...landing].flatMap((file) => {
      const n = [...code(fs.readFileSync(file, 'utf8')).matchAll(/href="\/api\/auth\/steam"/g)]
        .length
      return n ? [rel(file)] : []
    })
    expect(hits).toEqual(['components/landing/ConnectFallback.tsx'])
  })

  test('низ страницы возвращает наверх якорем, а не второй формой', () => {
    const money = code(fs.readFileSync(path.join(SCENES, 'Money.tsx'), 'utf8'))
    expect(money, 'кнопка внизу должна вести к первому экрану').toMatch(/href="#main"/)
  })

  /**
   * Перевёрнутый сторож: раньше здесь запрещалось движение на прокрутке,
   * теперь оно и есть замысел страницы. Охраняется вторая половина сделки.
   */
  test('у хореографии главной есть путь покоя', () => {
    /*
     * Сцене достаточно жить внутри <Stage>: обёртка не вызывает build при
     * «уменьшить движение» вовсе, и сцена остаётся обычной секцией. Эта
     * поблажка не может протухнуть молча — проверка ниже требует, чтобы сама
     * обёртка спрашивала настройку.
     */
    const stage = code(fs.readFileSync(path.join(LANDING, 'Stage.tsx'), 'utf8'))
    expect(stage, 'обёртка сцены обязана спрашивать «уменьшить движение»').toMatch(
      /prefers-reduced-motion/,
    )

    const offenders = [PAGE, ...landing].flatMap((file) => {
      const src = code(fs.readFileSync(file, 'utf8'))
      const moves = /\bScrollTrigger\b|\bScrollSmoother\b|\bwhileInView\b|\buseScroll\b/.test(src)
      if (!moves) return []
      const asks = /prefers-reduced-motion|useReducedMotion/.test(src)
      const inStage = /<Stage\b/.test(src)
      return asks || inStage ? [] : [rel(file)]
    })
    expect(
      offenders,
      'этот файл двигает страницу на прокрутке, не спрашивает «уменьшить движение» и не прикрыт обёрткой сцены',
    ).toEqual([])
  })

  /**
   * Начальные состояния прячутся только внутри колбэков сцены — `enter` и
   * `build`. Голый gsap.set с opacity: 0 в теле компонента отработает и при
   * «уменьшить движение», где ни один из колбэков не вызывается, — и человек
   * получит пустой экран навсегда.
   */
  test('сцены прячут содержимое только внутри enter и build', () => {
    const offenders = walk(SCENES).flatMap((file) => {
      const src = code(fs.readFileSync(file, 'utf8'))
      const marks = ['enter={', 'build={'].map((m) => src.indexOf(m)).filter((i) => i >= 0)
      const firstCallback = marks.length ? Math.min(...marks) : -1
      const before = firstCallback === -1 ? src : src.slice(0, firstCallback)
      return /gsap\.set\s*\(/.test(before) ? [rel(file)] : []
    })
    expect(
      offenders,
      'спрятать контент можно только внутри enter или build — иначе при «уменьшить движение» он спрятан навсегда',
    ).toEqual([])
  })

  test('идентификаторы сцен совпадают с партитурой света ленты', () => {
    const inMarkup = new Set<string>()
    for (const file of walk(SCENES)) {
      for (const m of code(fs.readFileSync(file, 'utf8')).matchAll(/<Stage[\s\S]{0,200}?id="([a-z]+)"/g)) {
        inMarkup.add(m[1])
      }
    }
    const inScore = new Set(RIBBON_SCORE.map((s) => s.scene).filter((s): s is string => !!s))
    expect(
      [...inScore].sort(),
      'партитура света ссылается на сцену, которой нет в разметке',
    ).toEqual([...inMarkup].sort())
  })

  test('фолбэк и карточка держат одну высоту из одного места', () => {
    const fallback = fs.readFileSync(path.join(LANDING, 'ConnectFallback.tsx'), 'utf8')
    const card = fs.readFileSync(path.join(LANDING, 'ConnectCard.tsx'), 'utf8')
    expect(fallback).toMatch(/export const CONNECT_CARD_MIN_H = 'min-h-\[\d+px\]'/)
    expect(
      code(card),
      'карточка обязана брать потолок из общей константы, иначе подмена фолбэка снова начнёт дёргать первый экран',
    ).toContain('CONNECT_CARD_MIN_H')
  })
})
