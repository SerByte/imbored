import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, test } from 'vitest'

/**
 * Сторож охвата линта.
 *
 * `npm run lint` — это голый `eslint` из корня, и он обходит всё дерево, кроме
 * того, что перечислено в globalIgnores. Claude Code разворачивает рабочие
 * копии агентов в .claude/worktrees/<имя>: полный чекаут чужой ветки, часто со
 * своим .next. Пока их там не было, линт был зелёным; как только появились —
 * тысячи ошибок в собранных чанках и чужом коде, выход с кодом 1 на чистом
 * дереве, и проверка «линт зелёный перед коммитом» перестала что-либо значить.
 *
 * Проверяется поведение, а не текст конфига: спрашиваем сам ESLint, какие пути
 * он пропустит. Пути не обязаны существовать — isPathIgnored смотрит только на
 * правила.
 */

const ROOT = path.join(__dirname, '..')
const eslint = new ESLint({ cwd: ROOT })
const ignored = (rel: string) => eslint.isPathIgnored(path.join(ROOT, rel))

/**
 * Первый вызов грузит eslint.config.mjs вместе со всеми плагинами
 * eslint-config-next — на холодном диске и под параллельным прогоном это может
 * не уложиться в стандартные пять секунд vitest.
 */
describe('охват линта', { timeout: 30_000 }, () => {
  test('рабочие копии агентов не линтуются из корня', async () => {
    expect(await ignored('.claude/worktrees/some-branch/lib/db.ts')).toBe(true)
    expect(await ignored('.claude/worktrees/some-branch/.next/dev/static/chunks/a.js')).toBe(true)
  })

  /**
   * Обратная половина: правило не должно проглотить сам продукт. Слишком
   * широкий шаблон в globalIgnores молча выключил бы линт целиком — а тест выше
   * остался бы зелёным.
   */
  test('код продукта по-прежнему линтуется', async () => {
    for (const rel of ['lib/db.ts', 'app/layout.tsx', 'components/Footer.tsx', 'scripts/sync-news.ts']) {
      expect(await ignored(rel), rel).toBe(false)
    }
  })
})
