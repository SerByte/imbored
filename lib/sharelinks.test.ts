import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож ссылок, которыми делятся.
 *
 * 1. У каждой — метка ?ref= (lib/track, withRef): без неё приход по ссылке
 *    не отличить от прихода с поиска, и воронка «поделился → пришли»
 *    слепнет. Строится ссылка через withRef или готовый строитель
 *    (roomShareUrl и ему подобные *ShareUrl), и файл, который делится,
 *    обязан звать один из них.
 * 2. «Скопировано» — одно на весь сайт, в components/ShareLink.tsx. Отклик
 *    был свой в каждом месте: текст, текст с галочкой, галочка вместо иконки.
 */

const ROOT = path.join(__dirname, '..')

function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
        out.push([path.relative(ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')])
      }
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('ссылки, которыми делятся', () => {
  test('каждое место, которое делится, ставит метку ref', () => {
    const offenders: string[] = []
    let sharing = 0
    for (const [file, src] of sources()) {
      if (file === 'components/ShareLink.tsx') continue
      const code = withoutComments(src)
      if (!/useShareLink\(|<ShareLinkField\b/.test(code)) continue
      sharing++
      if (!/withRef\(|\w+ShareUrl\(/.test(code)) offenders.push(file)
    }
    expect(sharing, 'мест, которые делятся, не найдено — сторож ослеп').toBeGreaterThanOrEqual(5)
    expect(offenders, 'ссылка без ?ref= — приход по ней не отличить от поиска').toEqual([])
  })

  test('«Скопировано» — только в components/ShareLink.tsx', () => {
    const offenders = sources()
      .filter(([file, src]) => file !== 'components/ShareLink.tsx' && withoutComments(src).includes('Скопировано'))
      .map(([file]) => file)
    expect(offenders, 'свой отклик «Скопировано» — возьми share.label из useShareLink').toEqual([])
  })
})
