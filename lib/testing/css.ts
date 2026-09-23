import fs from 'node:fs'
import path from 'node:path'

/**
 * Листы стилей приложения — для сторожей, которые читают CSS.
 *
 * Сторожей стилей в lib/ больше десятка, и почти все читают один файл —
 * app/globals.css. Так было верно, пока лист был один. Вторым стал CSS-модуль
 * слайдера (components/morph/MorphSlider.module.css), и сторож размытия его
 * не видел: рукописный -webkit-backdrop-filter уехал в прод, минификатор
 * оставил только префиксную форму, и в Chrome у подписи и кнопок слайдера
 * пропало размытие. Нашли сравнением исходника с собранным CSS, а не тестом.
 *
 * Здесь один обход вместо копии в каждом стороже: app/ и components/
 * рекурсивно, все *.css, включая *.module.css. Остальные сторожа переезжают
 * сюда по мере касания — и обязательно до того, как globals.css начнут
 * резать на части (lib/testing/css.test.ts упадёт первым и перечислит, кого
 * переводить).
 *
 * Модуль только для тестов: продукт его не импортирует.
 */

export const ROOT = path.join(__dirname, '..', '..')

/** Каталоги, где живут листы стилей продукта. */
const SHEET_DIRS = ['app', 'components']

/** Путь от корня репозитория с прямыми слешами — для жалоб вида `app/globals.css:12`. */
export const relPath = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

/**
 * CSS без комментариев. Докблоки стилей часто цитируют ровно то, что сторож
 * запрещает («браузерное кольцо снималось через outline-none», «рукописный
 * -webkit-префикс»), и без этого сторож ловит собственное объяснение.
 *
 * Комментарии заменяются пробелами той же длины, переводы строк внутри них
 * остаются — номера строк и смещения в жалобе совпадают с исходником.
 */
export const stripComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

function cssFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return cssFiles(full)
    return e.name.endsWith('.css') ? [full] : []
  })
}

export type Sheet = {
  /** Путь от корня с прямыми слешами: `app/globals.css`. */
  rel: string
  /** Текст как в файле. */
  raw: string
  /** Тот же текст с погашенными комментариями — см. stripComments. */
  css: string
  /** CSS-модуль (*.module.css): классы локальны, лист грузится с компонентом. */
  module: boolean
}

/** Все листы стилей продукта: app/ и components/, глобальные и модули. */
export function readAppCss(): Sheet[] {
  return SHEET_DIRS.flatMap((d) => cssFiles(path.join(ROOT, d)))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(file, 'utf8')
      return { rel: relPath(file), raw, css: stripComments(raw), module: file.endsWith('.module.css') }
    })
}
