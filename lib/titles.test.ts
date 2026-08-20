import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож заголовков вкладки.
 *
 * У страницы должен быть свой <title>. Без него она наследует заголовок сайта,
 * и человек с несколькими открытыми вкладками imbored видит в них одно и то же
 * слово — подборка, портрет и лендинг становятся неразличимы.
 *
 * Ловушка тут не в невнимательности, а в правиле Next: metadata экспортируется
 * ТОЛЬКО из серверного модуля. Страница с 'use client' объявить заголовок не
 * может — ей нужен соседний layout.tsx. Про это легко забыть ровно в тот
 * момент, когда страницу делают клиентской.
 *
 * И забывали: для /rooms и /quiz layout завели (в комментарии к rooms прямо
 * написано, зачем), а /play и /room/new пропустили. /play — главный экран
 * продукта. Поэтому теперь проверка, а не память.
 */

const APP = path.join(__dirname, '..', 'app')

/**
 * Страницы, которым свой заголовок не нужен, и почему. Список намеренно
 * короткий и с причиной у каждой строки: «исключение без объяснения» через
 * полгода не отличить от пропущенного бага.
 */
const EXEMPT: Record<string, string> = {
  'page.tsx': 'лендинг — заголовок сайта здесь и есть правильный',
  'portrait/page.tsx': 'редирект на /portrait/[steamid], своей разметки нет',
}

function declaresTitle(file: string): boolean {
  if (!fs.existsSync(file)) return false
  const src = fs.readFileSync(file, 'utf8')
  return /export\s+(?:const|async\s+function|function)\s+(?:metadata|generateMetadata)\b/.test(src)
}

function pages(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'page.tsx') out.push(path.relative(APP, p).split(path.sep).join('/'))
    }
  }
  walk(APP)
  return out.sort()
}

/**
 * Заголовок ищем вверх по цепочке сегментов — но НЕ до корня: корневой
 * app/layout.tsx как раз и даёт то самое общее имя, от которого мы уходим.
 */
function hasOwnTitle(rel: string): boolean {
  const dir = path.dirname(rel)
  if (declaresTitle(path.join(APP, rel))) return true
  const parts = dir === '.' ? [] : dir.split('/')
  for (let i = parts.length; i > 0; i--) {
    if (declaresTitle(path.join(APP, ...parts.slice(0, i), 'layout.tsx'))) return true
  }
  return false
}

describe('заголовок вкладки', () => {
  test('у каждой страницы он свой, а не унаследованный от сайта', () => {
    const offenders = pages().filter((p) => !(p in EXEMPT) && !hasOwnTitle(p))
    expect(
      offenders,
      'клиентской странице нужен соседний layout.tsx с metadata — см. app/rooms/layout.tsx',
    ).toEqual([])
  })

  /**
   * Проверка на саму проверку. Сторож ищет заголовок вверх по дереву, и
   * ошибиться тут легко в сторону «всегда зелёный»: достаточно случайно
   * дотянуться до корневого layout, и любая страница станет «с заголовком».
   */
  test('корневой layout за свой заголовок не считается', () => {
    expect(declaresTitle(path.join(APP, 'layout.tsx')), 'корень объявляет metadata').toBe(true)
    // Вымышленная страница в пустом сегменте: заголовка у неё нет ниоткуда,
    // кроме корня — и сторож обязан это назвать нарушением.
    expect(hasOwnTitle('нет-такого-раздела/page.tsx')).toBe(false)
  })

  test('исключения не разрослись', () => {
    expect(Object.keys(EXEMPT).length, 'каждое исключение — с причиной в комментарии').toBeLessThanOrEqual(4)
  })
})
