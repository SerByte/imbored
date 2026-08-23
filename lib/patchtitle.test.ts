import { describe, expect, test } from 'vitest'
import { stripGameName } from './patchtitle'

describe('заголовок патча без названия игры', () => {
  /** Все строки — настоящие заголовки из Steam, снятые с локальной базы. */
  test('срезает ведущее название вместе с разделителем', () => {
    expect(stripGameName('Portal 2 - Update', 'Portal 2')).toBe('Update')
    expect(stripGameName('Subnautica Security Hotfix', 'Subnautica')).toBe('Security Hotfix')
    expect(stripGameName('Satisfactory 1.2 Update out now!', 'Satisfactory')).toBe(
      '1.2 Update out now!',
    )
    expect(
      stripGameName(
        'Dead Cells Stability Patch: Less Null Access, More Monster Slaying.',
        'Dead Cells',
      ),
    ).toBe('Stability Patch: Less Null Access, More Monster Slaying.')
  })

  test('регистр названия значения не имеет', () => {
    expect(stripGameName('ELDEN RING - Patch Notes Version 1.16.1', 'Elden Ring')).toBe(
      'Patch Notes Version 1.16.1',
    )
  })

  test('название с двоеточием и длинным тире внутри строки', () => {
    expect(
      stripGameName('Black Myth: Wukong — описание обновления 1.0.21.23831', 'Black Myth: Wukong'),
    ).toBe('Описание обновления 1.0.21.23831')
  })

  /**
   * Совпадение по префиксу — не совпадение по названию. Без заглядывания
   * вперёд «Rust» срезал бы четыре буквы у «Rusty» и оставил «y Update».
   */
  test('не режет слово, которое просто начинается так же', () => {
    expect(stripGameName('Rusty Update', 'Rust')).toBe('Rusty Update')
    expect(stripGameName('Factorio Friday Facts #400', 'Fact')).toBe('Factorio Friday Facts #400')
  })

  test('заголовок из одного названия остаётся как есть', () => {
    expect(stripGameName('Portal 2', 'Portal 2')).toBe('Portal 2')
    expect(stripGameName('  Portal 2  ', 'Portal 2')).toBe('Portal 2')
  })

  test('название не в начале — не трогаем', () => {
    expect(stripGameName('Хотфикс для Subnautica', 'Subnautica')).toBe('Хотфикс для Subnautica')
  })

  /** Версия остаётся версией: «v1.0» с заглавной было бы ошибкой. */
  test('регистр поднимается только у настоящего слова', () => {
    expect(stripGameName('Palworld v1.0 - Official Release Changelog', 'Palworld')).toBe(
      'v1.0 - Official Release Changelog',
    )
    expect(stripGameName('Terraria 1.4 hotfix', 'Terraria')).toBe('1.4 hotfix')
  })

  test('пустые входы не роняют', () => {
    expect(stripGameName('', 'Portal 2')).toBe('')
    expect(stripGameName('Update', '')).toBe('Update')
  })
})
