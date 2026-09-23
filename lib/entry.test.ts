import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { ENTRY_HIGH_TAGS, ENTRY_LOW_TAGS, entryCost, entryLine, showsEntry } from './entry'
import { SEMANTICS_MIN_CONFIDENCE } from './semantics'
import { hasTagRu } from './tagsru'
import type { GameSemantics } from './types'

function sem(timeToFun: GameSemantics['timeToFun'], confidence = 0.8): GameSemantics {
  return {
    v: 1,
    axes: { challenge: 50, complexity: 50, pace: 50 },
    session: { bucket: 'medium', minutes: 40, canStopAnytime: false },
    timeToFun,
    confidence,
    n: 60,
    basis: confidence > 0.4 ? 'tags+reviews' : 'tags',
  }
}

describe('entryCost', () => {
  test('жанр с высоким порогом — high, с низким — low, по тегам', () => {
    expect(entryCost({ tags: { 'Grand Strategy': 100, Historical: 50 } })).toEqual({
      level: 'high',
      hours: null,
      basis: 'tags',
    })
    expect(entryCost({ tags: { Arcade: 100 } })).toEqual({ level: 'low', hours: null, basis: 'tags' })
  })

  test('спор тегов и молчание — null: строки нет', () => {
    expect(entryCost({ tags: { Automation: 100, Casual: 80 } })).toBeNull()
    expect(entryCost({ tags: { Action: 100, Indie: 80 } })).toBeNull()
    expect(entryCost({ tags: {} })).toBeNull()
  })

  test('уверенная семантика старше тегов — и её «ни то ни другое» тоже', () => {
    const tags = { Arcade: 100 }
    expect(entryCost({ tags, semantics: sem({ bucket: 'slow', hours: 3 }) })).toEqual({
      level: 'high',
      hours: 3,
      basis: 'reviews',
    })
    expect(entryCost({ tags: { Automation: 100 }, semantics: sem({ bucket: 'fast', hours: null }) })).toEqual({
      level: 'low',
      hours: null,
      basis: 'reviews',
    })
    // отзывы не увидели ни медленного, ни быстрого старта — жанр их не переспорит
    expect(entryCost({ tags, semantics: sem({ bucket: null, hours: null }) })).toBeNull()
  })

  test('семантика по одним тегам не уверена — решают списки', () => {
    const weak = sem({ bucket: 'slow', hours: null }, SEMANTICS_MIN_CONFIDENCE - 0.1)
    expect(entryCost({ tags: { Arcade: 100 }, semantics: weak })).toEqual({
      level: 'low',
      hours: null,
      basis: 'tags',
    })
  })

  test('теги списков — настоящие теги Steam: у каждого есть русская подпись', () => {
    // опечатка в ключе молча выключила бы жанр целиком
    expect([...ENTRY_HIGH_TAGS, ...ENTRY_LOW_TAGS].filter((t) => !hasTagRu(t))).toEqual([])
  })
})

describe('entryLine', () => {
  test('часы из отзывов — числом и со склонением', () => {
    expect(entryLine({ level: 'high', hours: 3, basis: 'reviews' })).toBe(
      'Раскрывается не сразу: по отзывам — через 3 часа',
    )
    expect(entryLine({ level: 'high', hours: 5, basis: 'reviews' })).toBe(
      'Раскрывается не сразу: по отзывам — через 5 часов',
    )
    expect(entryLine({ level: 'high', hours: 21.4, basis: 'reviews' })).toContain('через 21 час')
  })

  test('про отзывы — со ссылкой на них, про жанр — как про жанр', () => {
    expect(entryLine({ level: 'high', hours: null, basis: 'reviews' })).toContain('в отзывах')
    expect(entryLine({ level: 'low', hours: null, basis: 'reviews' })).toContain('в отзывах')
    expect(entryLine({ level: 'high', hours: null, basis: 'tags' })).not.toContain('отзыв')
    expect(entryLine({ level: 'low', hours: null, basis: 'tags' })).not.toContain('отзыв')
  })
})

describe('showsEntry', () => {
  test('строка — только у неосвоенного', () => {
    expect(showsEntry('untouched')).toBe(true)
    expect(showsEntry('backlog')).toBe(true)
    expect(showsEntry('new')).toBe(true)
    expect(showsEntry('comeback')).toBe(false)
    expect(showsEntry('familiar')).toBe(false)
  })
})

describe('клиентобезопасность', () => {
  test('lib/entry.ts тянет только чистые модули: строку рисует /play', () => {
    const src = fs.readFileSync(path.join(__dirname, 'entry.ts'), 'utf8')
    const runtime = [...src.matchAll(/^import (?!type )[^\n]*?from '([^']+)'/gm)].map((m) => m[1])
    expect(runtime).toEqual(['./plural', './semantics'])
  })
})
