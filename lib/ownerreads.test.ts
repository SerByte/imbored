import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож личного: оценки, скрытое, вечера, «Приглянулось» и список
 * желаемого читаются в продукте только за проверкой isWriter (lib/server).
 *
 * Пишет всё это лишь сессия, доказавшая владение профилем через Steam, или
 * демо. Сессию по вставленной ссылке /api/connect выдаёт на любой публичный
 * профиль, и прочитанное ей — прочитанное чужому человеку. Раньше /library
 * отдавала такой сессии полку скрытого с датами, «зашло», вечера и долю
 * попаданий — и прятала только кнопки. Настоящей страницей это проверяет
 * app/library/page.test.ts; здесь — что новое место, где читают то же самое,
 * не появится без той же проверки.
 *
 * Отсев — другое дело: bannedAppids и listExplore читаются всем, потому что
 * только убирают игры из выдачи и наружу ничего не называют. Поэтому их в
 * списке нет.
 */

const ROOT = path.join(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
/** Код без комментариев: докблоки называют читателей по имени */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** Чтения, результат которых — личное владельца, выводимое как есть */
const OWNER_READS = [
  'listBanned',
  'feedbackStats',
  'listEvenings',
  'listLiked',
  'countLiked',
  'listExploreLiked',
  // Список желаемого: что человек хочет купить, — тоже его, а не того, у
  // кого есть ссылка на профиль
  'getWishlist',
]
const CALL = new RegExp(`\\b(${OWNER_READS.join('|')})\\(`, 'g')

/** Каждый вызов личного чтения в продукте: файл и то, что стоит перед ним */
function calls(): Array<{ file: string; name: string; before: string }> {
  const out: Array<{ file: string; name: string; before: string }> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) {
        // Обвязка тестов продукт не читает
        if (rel !== 'lib/testing') walk(rel)
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && rel !== 'lib/db.ts') {
        const src = code(read(rel))
        for (const m of src.matchAll(CALL)) {
          // С запасом: форматтер может перенести `writer\n    ? listBanned(` на две строки
          out.push({ file: rel, name: m[1], before: src.slice(Math.max(0, m.index - 40), m.index) })
        }
      }
    }
  }
  for (const dir of ['app', 'components', 'lib']) walk(dir)
  return out
}

describe('личное владельца — только за isWriter', () => {
  test('обход находит все места, где его читают', () => {
    const found = calls()
    expect([...new Set(found.map((c) => c.file))].sort()).toEqual([
      'app/api/explore/route.ts',
      'app/library/page.tsx',
    ])
    // Все шесть чтений /library — иначе сторож ослеп на одном из них
    expect(found.filter((c) => c.file === 'app/library/page.tsx').map((c) => c.name).sort()).toEqual(
      ['countLiked', 'feedbackStats', 'getWishlist', 'listBanned', 'listEvenings', 'listLiked'],
    )
  })

  test('каждый вызов стоит за writer ?', () => {
    const bare = calls().filter((c) => !/\bwriter\s*\?\s*$/.test(c.before))
    expect(
      bare.map((c) => `${c.file}: ${c.name}`),
      'личное читается без проверки права записи — его увидит сессия по вставленной ссылке',
    ).toEqual([])
  })

  test.each(['app/library/page.tsx', 'app/api/explore/route.ts'])('%s: writer — это isWriter сессии', (file) => {
    expect(code(read(file))).toMatch(/const writer = (?:session !== null && )?isWriter\(session\)\n/)
  })
})
