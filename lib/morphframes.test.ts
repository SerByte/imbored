import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Слайдер кадров рисует по требованию, а не на каждом rAF.
 *
 * Вендорная петля MorphEngine звала requestAnimationFrame без условия, пока
 * слайдер смонтирован. Герой /play и /daily после своего перехода стоит, а
 * петля перерисовывала тот же полноэкранный кадр 60–120 раз в секунду — и
 * компоновщик вместе с каждым новым кадром канваса пересчитывал пять слоёв
 * backdrop-filter над ним и зерно с mix-blend. Наблюдатель видимости в
 * HeroShots держал только автоплей, а докблок обещал, что «RAF засыпает».
 * Слайдер /game так же рисовал дрейф, уехав за край экрана.
 *
 * WebGL в тестах нет, поэтому сторож читает исходник: каждое из обещаний
 * снимается одной строкой, и глазом это видно только в трассе Performance.
 */

const ROOT = path.join(__dirname, '..')
const src = fs
  .readFileSync(path.join(ROOT, 'components', 'morph', 'MorphSlider.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*/gm, '')

/** Тело метода движка: от сигнатуры до закрывающей скобки на отступе метода */
function method(signature: RegExp): string {
  const m = signature.exec(src)
  expect(m, `${signature} не найден в MorphSlider.tsx`).toBeTruthy()
  const from = m!.index
  const to = src.indexOf('\n  }\n', from)
  return src.slice(from, to)
}

describe('кадры слайдера — по требованию', () => {
  test('петля просит следующий кадр, только пока что-то движется', () => {
    const loop = method(/private loop\(t: number\): void \{/)
    expect(loop, 'безусловный rAF — та самая вечная перерисовка').not.toMatch(/requestAnimationFrame\(/)
    expect(loop).toMatch(/if \(this\.moving\(\)\) this\.invalidate\(\)/)
    // Сначала рисуем, потом решаем: последний кадр после commit обязан быть нарисован
    expect(loop.indexOf('renderer.render(')).toBeLessThan(loop.indexOf('this.moving()'))
  })

  test('«движется» — это переход, протяжка или дрейф на экране', () => {
    const moving = method(/private moving\(\): boolean \{/)
    expect(moving).toMatch(/this\.animating/)
    expect(moving).toMatch(/this\.dragging/)
    expect(moving, 'дрейф без зрителя рисовать незачем').toMatch(/this\.watched && this\.drift\(/)
  })

  test('конструктор не заводит петлю мимо invalidate', () => {
    const ctor = method(/constructor\(container: HTMLElement, config: EngineConfig\) \{/)
    expect(ctor).not.toMatch(/requestAnimationFrame\(/)
  })

  /**
   * Кто меняет картинку в покое, обязан попросить кадр, иначе она не дойдёт до
   * экрана. Самый коварный — resize: setSize стирает холст, и вставший слайдер
   * после поворота телефона остался бы пустым.
   */
  test('кадр просят все, кто меняет картинку', () => {
    for (const sig of [
      /private resize\(\): void \{/,
      /private run\(target: number\): void \{/,
      /beginDrag\(\): boolean \{/,
      /endDrag\(\): void \{/,
      /private commit\(target: number\): void \{/,
      /setWatched\(watched: boolean\): void \{/,
    ]) {
      expect(method(sig), String(sig)).toMatch(/this\.invalidate\(\)/)
    }
    const onload = src.match(/img\.onload = \(\) => \{([\s\S]*?)\n {6}\}/)?.[1] ?? ''
    expect(onload, 'доехавшая текстура без кадра осталась бы серой заглушкой').toMatch(/this\.invalidate\(\)/)
  })

  test('потерянный контекст и разборка больше кадров не просят', () => {
    expect(method(/private onContextLost\(e: Event\): void \{/)).toMatch(/this\.dead = true/)
    expect(method(/destroy\(\): void \{/)).toMatch(/this\.dead = true/)
    expect(method(/invalidate\(\): void \{/)).toMatch(/!this\.dead/)
  })

  test('видимость сцены доходит до движка', () => {
    expect(src).toMatch(/seenRef\.current = entry\.isIntersecting/)
    expect(src).toMatch(/engine\.setWatched\(entry\.isIntersecting && !stillRef\.current\)/)
    expect(src).toMatch(/io\.disconnect\(\)/)
  })

  /**
   * Сцена под лайтбоксом для наблюдателя видимости остаётся на экране: оверлей
   * лежит поверх страницы и её не сдвигает. После тапа по кадру на /game
   * канвас снова рисовал дрейф на каждый vsync — под затемнением с
   * backdrop-filter, то есть ровно с той перерисовкой слоёв размытия, ради
   * которой петля рисует по требованию. И «Пауза» гасила автолистание, но не
   * дрейф: кадр продолжал покачиваться у того, кто движение остановил.
   */
  test('под лайтбоксом и после «Паузы» дрейф стоит', () => {
    expect(src).toMatch(/const still = paused \|\| stopped/)
    expect(src).toMatch(/engineRef\.current\?\.setWatched\(seenRef\.current && !still\)/)
    expect(src).toMatch(/\}, \[still\]\)/)
    // Движок, пересобранный под лайтбоксом, тоже стоит
    expect(src).toMatch(/engine\.setWatched\(seenRef\.current && !stillRef\.current\)/)
  })

  test('под лайтбоксом не листает и автоплей', () => {
    expect(src).toMatch(/if \(!autoplay \|\| paused \|\|/)
    expect(src).toMatch(/\[autoplay, autoplayDelay, paused,/)
  })

  test('страница игры ставит слайдер на паузу, пока открыт лайтбокс', () => {
    const shots = fs
      .readFileSync(path.join(ROOT, 'components', 'GameShots.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*/gm, '')
    const at = shots.indexOf('<MorphSlider')
    expect(at).toBeGreaterThan(-1)
    expect(shots.slice(at, shots.indexOf('/>', at))).toMatch(/\bpaused=\{open !== null\}/)
  })

  /**
   * Время шейдера — не абсолютное время rAF: после паузы шум и дрейф прыгнули
   * бы на первом же кадре. Копится только по нарисованным кадрам, с потолком
   * шага — как snowTime у снега.
   */
  test('время шейдера копится по нарисованным кадрам', () => {
    const loop = method(/private loop\(t: number\): void \{/)
    expect(loop).not.toMatch(/uTime\.value = t \* 0\.001/)
    expect(loop).toMatch(/Math\.min\(t - this\.last, \d+\)/)
  })
})

/**
 * Дрейф в шейдере на uReduce не смотрел: под «уменьшить движение» кадр на
 * /game покачивался бесконечно. Ноль движок ставит сам, и в униформ, и в
 * решение петли — иначе она рисовала бы стоящий кадр ради дрейфа, которого нет.
 */
describe('дрейф под «уменьшить движение»', () => {
  test('эффективный дрейф — ноль', () => {
    expect(method(/private drift\(opts: EngineOptions\): number \{/)).toMatch(
      /return this\.reducedMotion \? 0 : opts\.drift/,
    )
    expect(src, 'униформ получает сырое значение мимо drift()').not.toMatch(/uDrift\.value = opts\.drift/)
    expect(src).not.toMatch(/uDrift: \{ value: opts\.drift \}/)
  })
})
