import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Версия Node — в одном месте: engines.node в package.json.
 *
 * Её читают Vercel (он ставит engines выше настройки в дашборде) и CI
 * (setup-node с node-version-file). Раньше CI гонял 22-й, а @types/node стоял
 * от 26-го: tsc пропустил бы API, которого на проде нет, и ошибка всплыла бы
 * только в рантайме. Здесь сторожится, что эти три вещи не разъедутся снова.
 */

const ROOT = path.join(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')

const pkg = JSON.parse(read('package.json')) as {
  engines?: { node?: string }
  devDependencies?: Record<string, string>
}

/** Мажор из диапазона вида «22.x», «^22.20.4», «~22» */
function major(range: string | undefined): number | null {
  const m = range?.match(/^[\^~]?(\d+)(?:\.|$)/)
  return m ? Number(m[1]) : null
}

describe('версия Node', () => {
  test('engines.node закреплён мажором', () => {
    expect(pkg.engines?.node).toMatch(/^\d+\.x$/)
  })

  test('типы Node — того же мажора, что и сам Node', () => {
    const node = major(pkg.engines?.node)
    expect(node).not.toBeNull()
    expect(major(pkg.devDependencies?.['@types/node'])).toBe(node)
  })

  test('CI берёт версию из package.json, а не держит свою', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toMatch(/node-version-file:\s*package\.json/)
    expect(ci).not.toMatch(/^\s*node-version:/m)
  })

  test('dependabot не поднимает мажор типов Node в обход engines', () => {
    const dependabot = read('.github/dependabot.yml')
    expect(dependabot).toMatch(
      /dependency-name:\s*'@types\/node'\s*\n\s*update-types:\s*\['version-update:semver-major'\]/,
    )
  })
})
