import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож парадной кнопки.
 *
 * Кнопка «сделать главное» — самый частый элемент продукта: подобрать игру,
 * смотреть в Steam, создать комнату, попробовать снова. И она была набрана
 * РУКАМИ двадцать пять раз в пятнадцати файлах.
 *
 * Копии разъехались ровно так, как разъезжаются копии: отступы гуляли между
 * `py-2.5`, `py-3` и `py-5`, скругление совпадало случайно, а отклик на
 * нажатие был у двух из двадцати пяти — остальные под пальцем не двигались
 * вовсе. Когда на главной кнопку довели до ума (заливка с бликом, тёплая тень,
 * состояния покоя, наведения, нажатия, отключено и ЗАНЯТА), выигрывала от
 * этого одна страница из шестнадцати.
 *
 * Теперь вид живёт в одном классе `.btn-ember`, а размер остаётся утилитами на
 * месте применения — класс лежит в @layer components и потому утилитам
 * проигрывает (см. докблок над ним в globals.css).
 *
 * ЧТО ИМЕННО ЗАПРЕЩЕНО. Не «заливка акцентом» вообще: плашка цены, ярлык дня и
 * счётчик колоды — это заливка на `rounded-full`, другой элемент и другая
 * роль. Запрещено сочетание, которое и есть парадная кнопка: заливка + цвет
 * поверх заливки + радиус 14.
 */

const ROOT = path.join(__dirname, '..')

function tsxFiles(): [string, string][] {
  const out: [string, string][] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx'))
        out.push([path.relative(ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')])
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

describe('парадная кнопка', () => {
  test('не набирается руками — только классом .btn-ember', () => {
    const offenders: string[] = []
    for (const [file, src] of tsxFiles()) {
      src.split('\n').forEach((line, i) => {
        if (!line.includes('bg-ember')) return
        if (!line.includes('text-on-ember')) return
        if (!line.includes('rounded-[14px]')) return
        /*
         * Утилиты с ПРЕФИКСОМ ВАРИАНТА — не копия кнопки.
         *
         * Скип-ссылка в app/layout.tsx набирает тот же список через
         * `focus-visible:`: она не существует, пока на неё не встали с
         * клавиатуры. Общим классом её не заменить — у него нет состояния
         * «меня нет до фокуса», — и запрещать её незачем: разъехаться с
         * парадной кнопкой она не может, потому что кнопкой не является.
         */
        if (line.includes(':bg-ember')) return
        offenders.push(`${file}:${i + 1}`)
      })
    }
    expect(
      offenders,
      'вид парадной кнопки берётся из .btn-ember; размер — утилитами рядом с ним',
    ).toEqual([])
  })

  /**
   * Класс обязан остаться в слое: без него утилиты размера проигрывают ему при
   * равной специфичности, и `py-5` у большой кнопки колоды молча превращается в
   * `py-[13px]`. Замерено именно так, поэтому проверка, а не комментарий.
   */
  test('вид кнопки лежит в @layer components, иначе утилиты размера не сработают', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    const at = css.indexOf('.btn-ember {')
    expect(at, 'класс .btn-ember не найден').toBeGreaterThan(-1)

    // Считаем скобки от каждого открытия слоя: если хоть один @layer components
    // ещё не закрыт к моменту объявления класса — класс внутри него.
    let inside = false
    for (const m of css.matchAll(/@layer components\s*\{/g)) {
      let depth = 1
      let i = m.index! + m[0].length
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++
        else if (css[i] === '}') depth--
        i++
      }
      if (m.index! < at && at < i) inside = true
    }
    expect(inside, '.btn-ember обязан объявляться внутри @layer components').toBe(true)
  })

  test('растяжка во всю ширину — модификатором, а не второй заливкой', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    expect(css, 'нет модификатора .btn-ember.is-block').toMatch(/\.btn-ember\.is-block/)
  })
})
