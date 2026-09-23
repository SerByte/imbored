import { describe, expect, test } from 'vitest'
import { hashString } from './daily'
import { memberKey } from './roomkey'

const SECRET = 'test-secret'
const SID = '76561198012345678'

describe('memberKey', () => {
  test('стабилен в пределах комнаты: ростер и удаление участника сверяют один и тот же', () => {
    expect(memberKey(SECRET, 'ABC123', SID)).toBe(memberKey(SECRET, 'ABC123', SID))
    expect(memberKey(SECRET, 'ABC123', SID)).toMatch(/^[A-Za-z0-9_-]{12}$/)
  })

  test('один человек в двух комнатах — два разных ключа', () => {
    expect(memberKey(SECRET, 'ABC123', SID)).not.toBe(memberKey(SECRET, 'XYZ789', SID))
  })

  test('без секрета не посчитать: другой секрет — другой ключ', () => {
    // Именно это отличает ключ от прежнего hashString(roomId + steamid),
    // который любой мог пересчитать для каждого кандидата
    expect(memberKey(SECRET, 'ABC123', SID)).not.toBe(memberKey('other', 'ABC123', SID))
    expect(memberKey(SECRET, 'ABC123', SID)).not.toBe(hashString('ABC123' + SID).toString(36))
  })

  test('steamid в ключе не проступает ни куском', () => {
    const key = memberKey(SECRET, 'ABC123', SID)
    for (let n = 4; n <= SID.length; n++) {
      for (let i = 0; i + n <= SID.length; i++) expect(key).not.toContain(SID.slice(i, i + n))
    }
  })
})
