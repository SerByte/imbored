import { describe, expect, test } from 'vitest'
import { turbopackContentHash, xxh3 } from './xxh3'

/**
 * Буфер проверки из xxHash (xsum_sanity_check.c, fillTestBuffer): байт —
 * старшие восемь бит генератора, генератор умножается на PRIME64.
 */
function sanityBuffer(len: number): Uint8Array {
  const PRIME32 = BigInt('2654435761')
  const PRIME64 = BigInt('11400714785074694797')
  const MASK = BigInt('0xffffffffffffffff')
  const out = new Uint8Array(len)
  let gen = PRIME32
  for (let i = 0; i < len; i++) {
    out[i] = Number(gen >> BigInt(56))
    gen = (gen * PRIME64) & MASK
  }
  return out
}

const hex = (bytes: Uint8Array) => xxh3(bytes).toString(16).padStart(16, '0')

describe('XXH3-64', () => {
  /*
   * Эталон xxHash с сидом 0 — по длине на каждую ветку алгоритма: пустой
   * вход, 1–3, 4–8, 9–16, 17–128 (по ступеням 32/64/96), 129–240 и длинный
   * вход — блок с перехлёстом последней полосы, ровно по полосе, ровно по
   * блоку и с неполным блоком.
   */
  test.each([
    [0, '2d06800538d394c2'],
    [1, 'c44bdff4074eecdb'],
    [6, '27b56a84cd2d7325'],
    [12, 'a713daf0dfbb77e7'],
    [24, 'a3fe70bf9d3510eb'],
    [48, '397da259ecba1f11'],
    [80, 'bcdefbbb2c47c90a'],
    [195, 'cd94217ee362ec3a'],
    [403, 'cdeb804d65c6dea4'],
    [512, '617e49599013cb6b'],
    [2048, 'dd59e2c3a5f038e0'],
    [2099, 'c6b9d9b3fc9ac765'],
  ])('эталон xxHash, длина %i', (len, expected) => {
    expect(hex(sanityBuffer(len))).toBe(expected)
  })

  /*
   * Ступень 97–128 эталоном не покрыта — её сверили с самим Turbopack:
   * карточка такой длины в next dev, хвост её адреса в og:image.
   */
  test.each([
    [100, 'a47a491dfa6f214d'],
    [120, '484e3869211a8a2d'],
  ])('ступень 97–128 — как у Turbopack, длина %i', (len, expected) => {
    const head = "export const alt = '"
    const tail = "'\nexport default function Image() { return new Response('x') }\n"
    const src = new TextEncoder().encode(head + 'a'.repeat(len - head.length - tail.length) + tail)
    expect(src).toHaveLength(len)
    expect(turbopackContentHash(src)).toBe(expected)
  })

  /*
   * Хвост — всегда 16 знаков: ведущий ноль Turbopack не срезает (карточка
   * портрета в next dev — ?041480c49a99d4ee). Голый toString(16) дал бы
   * здесь пятнадцать знаков.
   */
  test('хвост адреса — 16 знаков, с ведущим нулём', () => {
    expect(xxh3(sanityBuffer(47)).toString(16)).toHaveLength(15)
    expect(turbopackContentHash(sanityBuffer(47))).toBe('050b544c7c6147bd')
  })
})
