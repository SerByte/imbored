import { describe, expect, test } from 'vitest'
import { signSession, verifySession } from './session'

describe('session', () => {
  test('подписанное значение проходит проверку', () => {
    const token = signSession('76561197960287930', 'secret')
    expect(verifySession(token, 'secret')).toBe('76561197960287930')
  })

  test('подделка и чужой секрет отклоняются', () => {
    const token = signSession('76561197960287930', 'secret')
    expect(verifySession(token.replace('76561197960287930', '76561197960287931'), 'secret')).toBeNull()
    expect(verifySession(token, 'other')).toBeNull()
    expect(verifySession('garbage', 'secret')).toBeNull()
  })
})
