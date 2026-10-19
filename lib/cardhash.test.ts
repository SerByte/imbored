import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { CARD_HASH, cardUrl, type CardFile } from './cardhash'
import { turbopackContentHash } from './testing/xxh3'

const ROOT = path.join(__dirname, '..')

describe('хеш файловой карточки превью', () => {
  /*
   * Тот же хеш, что Turbopack ставит в адрес файла. Упало — карточку
   * поправили, а строку в lib/cardhash.ts нет: английский адрес перестал бы
   * сбрасывать кэш мессенджеров вместе с русским. Новое значение — в
   * сообщении теста.
   */
  test.each(Object.keys(CARD_HASH) as CardFile[])('%s — хеш совпадает с файлом', (file) => {
    expect(path.basename(file)).toBe('opengraph-image.tsx')
    const bytes = fs.readFileSync(path.join(ROOT, file))
    expect(CARD_HASH[file], `${file}: впишите в CARD_HASH новый хеш`).toBe(turbopackContentHash(bytes))
  })

  test('адрес — путь страницы, /opengraph-image и хеш', () => {
    expect(cardUrl('/en', 'app/[lang]/opengraph-image.tsx')).toBe(
      `/en/opengraph-image?${CARD_HASH['app/[lang]/opengraph-image.tsx']}`,
    )
  })
})
