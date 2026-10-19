import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { personaLabel, playerFallback } from './playername'

const CYRILLIC = /[А-Яа-яЁё]/

const REAL = '76561198000000001'
/** Демо-личность: '000' + основа + цифра варианта (demoSteamId в lib/server) */
const DEMO_PLAYER = '00012345678901231'
const DEMO_FRIEND = '00012345678901232'

describe('playerFallback: запасное имя', () => {
  test('по-русски — как было на всех страницах', () => {
    expect(playerFallback('1234')).toBe('Игрок 1234')
    expect(playerFallback('1234', 'ru')).toBe('Игрок 1234')
  })

  test('по-английски — Player и тот же хвост', () => {
    expect(playerFallback('1234', 'en')).toBe('Player 1234')
    expect(playerFallback('a7k2', 'en')).toBe('Player a7k2')
    expect(playerFallback('0001', 'en')).not.toMatch(CYRILLIC)
  })
})

describe('personaLabel: ник для вывода', () => {
  test('настоящий ник не переводится ни на каком языке', () => {
    for (const locale of ['ru', 'en'] as const) {
      expect(personaLabel(REAL, 'Аня', locale)).toBe('Аня')
      expect(personaLabel(REAL, 'Демо-друг', locale)).toBe('Демо-друг')
    }
  })

  test('по-русски демо-ник — как записан, байт в байт', () => {
    expect(personaLabel(DEMO_PLAYER, 'Демо-игрок')).toBe('Демо-игрок')
    expect(personaLabel(DEMO_FRIEND, 'Демо-друг', 'ru')).toBe('Демо-друг')
    // Пустую строку решает вызывающий: memberLabel проверяет истинность
    expect(personaLabel(DEMO_PLAYER, '', 'ru')).toBe('')
  })

  test('по-английски демо-личность — из глоссария', () => {
    expect(personaLabel(DEMO_FRIEND, 'Демо-друг', 'en')).toBe('Demo friend')
    expect(personaLabel(DEMO_PLAYER, 'Демо-игрок', 'en')).toBe('Demo player')
    // Любой другой записанный ник демо — тоже «демо-игрок»: другого у демо нет
    expect(personaLabel(DEMO_PLAYER, 'Что-то', 'en')).toBe('Demo player')
    for (const label of [personaLabel(DEMO_FRIEND, 'Демо-друг', 'en'), personaLabel(DEMO_PLAYER, 'Демо-игрок', 'en')]) {
      expect(label).not.toMatch(CYRILLIC)
    }
  })

  test('без ника — null на обоих языках: запасное имя у вызывающего', () => {
    for (const locale of ['ru', 'en'] as const) {
      expect(personaLabel(REAL, null, locale)).toBeNull()
      expect(personaLabel(DEMO_PLAYER, undefined, locale)).toBeNull()
    }
  })

  /*
   * Ник демо-друга пишется в двух местах — вход в демо из комнаты
   * (/api/connect) и досев демо (lib/demo). personaLabel узнаёт друга по этой
   * строке; разъедись она в одном из мест, демо-друг на /en стал бы
   * «Demo player».
   */
  test('ник демо-друга — та же строка, что пишет вход в демо', () => {
    const root = path.join(__dirname, '..')
    for (const rel of ['lib/demo.ts', 'app/api/connect/route.ts']) {
      expect(fs.readFileSync(path.join(root, rel), 'utf8'), rel).toContain("variant === 2 ? 'Демо-друг' : 'Демо-игрок'")
    }
  })
})
