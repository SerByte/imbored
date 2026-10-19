/**
 * XXH3-64 с нулевым сидом — тот хеш, которым Turbopack подписывает адрес
 * файловой карточки превью: /ru/opengraph-image?91b1f53ea01c02b3.
 *
 * Нужен сторожу lib/cardhash.test.ts: английская страница, объявляющая
 * карточку своего уровня записью ради английского alt, приписывает этот хеш
 * сама (lib/cardhash.ts), и сторож пересчитывает его по байтам файла.
 * Готового XXH3 в зависимостях нет — Node умеет md5 и sha, а не xxHash, — и
 * тащить пакет ради одного теста дороже, чем полторы сотни строк здесь.
 *
 * Что считает Turbopack (метадата-картинки в next-core): XXH3-64 от байтов
 * файла как есть, без префикса длины, — шестнадцатеричной строкой ровно в
 * 16 знаков, с ведущими нулями. Сверено с ним самим: next dev этой ветки
 * (/ru/opengraph-image?91b1f53ea01c02b3, /ru/game/730/opengraph-image?bef074ffb1a98a54,
 * у карточки портрета — ?041480c49a99d4ee, ноль впереди не срезан) и сборка
 * на проде из main (imbored.cc/opengraph-image?66b57ea37086be79,
 * …/game/730/opengraph-image?f87ae5af52929e47) — все ровно XXH3 своих
 * файлов. Сама функция — по эталону xxHash 0.8 (XXH3_64bits со стандартным
 * секретом); проверка — векторы его же xsum_sanity_check.c в xxh3.test.ts
 * на каждую ветку длины, кроме 97–128 байт: её сверили с Turbopack.
 *
 * 64-битная арифметика — на BigInt с маской: медленно, но карточка весит
 * десяток килобайт, и тест это не замечает.
 *
 * Модуль только для тестов: продукт его не импортирует.
 */

/* Литералы вида 1n цель tsconfig (ES2017) запрещает — сдвиги и маски именами, как в lib/steam.ts */
const N0 = BigInt(0)
const N1 = BigInt(1)
const N8 = BigInt(8)
const N24 = BigInt(24)
const N28 = BigInt(28)
const N29 = BigInt(29)
const N32 = BigInt(32)
const N33 = BigInt(33)
const N35 = BigInt(35)
const N37 = BigInt(37)
const N47 = BigInt(47)
const N49 = BigInt(49)
const N64 = BigInt(64)
const MASK = (N1 << N64) - N1
const LOW8 = BigInt(0xff)
const LOW32 = BigInt(0xffffffff)
const P32_1 = BigInt('0x9e3779b1')
const P32_2 = BigInt('0x85ebca77')
const P32_3 = BigInt('0xc2b2ae3d')
const P64_1 = BigInt('0x9e3779b185ebca87')
const P64_2 = BigInt('0xc2b2ae3d27d4eb4f')
const P64_3 = BigInt('0x165667b19e3779f9')
const P64_4 = BigInt('0x85ebca77c2b2ae63')
const P64_5 = BigInt('0x27d4eb2f165667c5')
const PRIME_MX1 = BigInt('0x165667919e3779f9')
const PRIME_MX2 = BigInt('0x9fb21c651e98df25')

/** Стандартный секрет XXH3 (XXH3_kSecret), 192 байта */
const SECRET = Uint8Array.from([
  0xb8, 0xfe, 0x6c, 0x39, 0x23, 0xa4, 0x4b, 0xbe, 0x7c, 0x01, 0x81, 0x2c, 0xf7, 0x21, 0xad, 0x1c,
  0xde, 0xd4, 0x6d, 0xe9, 0x83, 0x90, 0x97, 0xdb, 0x72, 0x40, 0xa4, 0xa4, 0xb7, 0xb3, 0x67, 0x1f,
  0xcb, 0x79, 0xe6, 0x4e, 0xcc, 0xc0, 0xe5, 0x78, 0x82, 0x5a, 0xd0, 0x7d, 0xcc, 0xff, 0x72, 0x21,
  0xb8, 0x08, 0x46, 0x74, 0xf7, 0x43, 0x24, 0x8e, 0xe0, 0x35, 0x90, 0xe6, 0x81, 0x3a, 0x26, 0x4c,
  0x3c, 0x28, 0x52, 0xbb, 0x91, 0xc3, 0x00, 0xcb, 0x88, 0xd0, 0x65, 0x8b, 0x1b, 0x53, 0x2e, 0xa3,
  0x71, 0x64, 0x48, 0x97, 0xa2, 0x0d, 0xf9, 0x4e, 0x38, 0x19, 0xef, 0x46, 0xa9, 0xde, 0xac, 0xd8,
  0xa8, 0xfa, 0x76, 0x3f, 0xe3, 0x9c, 0x34, 0x3f, 0xf9, 0xdc, 0xbb, 0xc7, 0xc7, 0x0b, 0x4f, 0x1d,
  0x8a, 0x51, 0xe0, 0x4b, 0xcd, 0xb4, 0x59, 0x31, 0xc8, 0x9f, 0x7e, 0xc9, 0xd9, 0x78, 0x73, 0x64,
  0xea, 0xc5, 0xac, 0x83, 0x34, 0xd3, 0xeb, 0xc3, 0xc5, 0x81, 0xa0, 0xff, 0xfa, 0x13, 0x63, 0xeb,
  0x17, 0x0d, 0xdd, 0x51, 0xb7, 0xf0, 0xda, 0x49, 0xd3, 0x16, 0x55, 0x26, 0x29, 0xd4, 0x68, 0x9e,
  0x2b, 0x16, 0xbe, 0x58, 0x7d, 0x47, 0xa1, 0xfc, 0x8f, 0xf8, 0xb8, 0xd1, 0x7a, 0xd0, 0x31, 0xce,
  0x45, 0xcb, 0x3a, 0x8f, 0x95, 0x16, 0x04, 0x28, 0xaf, 0xd7, 0xfb, 0xca, 0xbb, 0x4b, 0x40, 0x7e,
])
const SECRET_SIZE = SECRET.length
const SECRET_VIEW = new DataView(SECRET.buffer)
const secret64 = (at: number) => SECRET_VIEW.getBigUint64(at, true)
const secret32 = (at: number) => BigInt(SECRET_VIEW.getUint32(at, true))

const STRIPE_LEN = 64
const SECRET_CONSUME_RATE = 8
const SECRET_LASTACC_START = 7
const SECRET_MERGEACCS_START = 11
const SECRET_SIZE_MIN = 136
const MIDSIZE_STARTOFFSET = 3
const MIDSIZE_LASTOFFSET = 17

const mul = (a: bigint, b: bigint) => (a * b) & MASK
/** 64×64 → 128 и xor половин (XXH3_mul128_fold64) */
const fold = (a: bigint, b: bigint) => {
  const p = a * b
  return (p & MASK) ^ (p >> N64)
}
const rotl = (x: bigint, r: bigint) => ((x << r) | (x >> (N64 - r))) & MASK
const swap64 = (x: bigint) => {
  let out = N0
  for (let i = 0; i < 8; i++) {
    out = (out << N8) | (x & LOW8)
    x >>= N8
  }
  return out
}
const avalanche = (h: bigint) => {
  h ^= h >> N37
  h = mul(h, PRIME_MX1)
  return h ^ (h >> N32)
}
const avalancheXxh64 = (h: bigint) => {
  h ^= h >> N33
  h = mul(h, P64_2)
  h ^= h >> N29
  h = mul(h, P64_3)
  return h ^ (h >> N32)
}
const rrmxmx = (h: bigint, len: bigint) => {
  h ^= rotl(h, N49) ^ rotl(h, N24)
  h = mul(h, PRIME_MX2)
  h ^= ((h >> N35) + len) & MASK
  h = mul(h, PRIME_MX2)
  return h ^ (h >> N28)
}

/** XXH3-64 от байтов, сид 0, — беззнаковым 64-битным BigInt. */
export function xxh3(bytes: Uint8Array): bigint {
  const len = bytes.length
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const in64 = (at: number) => view.getBigUint64(at, true)
  const in32 = (at: number) => BigInt(view.getUint32(at, true))
  const L = BigInt(len)
  const mix16 = (at: number, sec: number) => fold(in64(at) ^ secret64(sec), in64(at + 8) ^ secret64(sec + 8))

  if (len === 0) return avalancheXxh64(secret64(56) ^ secret64(64))
  if (len <= 3) {
    const combined = ((bytes[0] << 16) | (bytes[len >> 1] << 24) | bytes[len - 1] | (len << 8)) >>> 0
    return avalancheXxh64(BigInt(combined) ^ (secret32(0) ^ secret32(4)))
  }
  if (len <= 8) {
    const input64 = (in32(len - 4) + (in32(0) << N32)) & MASK
    return rrmxmx(input64 ^ (secret64(8) ^ secret64(16)), L)
  }
  if (len <= 16) {
    const lo = in64(0) ^ (secret64(24) ^ secret64(32))
    const hi = in64(len - 8) ^ (secret64(40) ^ secret64(48))
    return avalanche((L + swap64(lo) + hi + fold(lo, hi)) & MASK)
  }
  if (len <= 128) {
    let acc = mul(L, P64_1)
    if (len > 32) {
      if (len > 64) {
        if (len > 96) acc += mix16(48, 96) + mix16(len - 64, 112)
        acc += mix16(32, 64) + mix16(len - 48, 80)
      }
      acc += mix16(16, 32) + mix16(len - 32, 48)
    }
    acc += mix16(0, 0) + mix16(len - 16, 16)
    return avalanche(acc & MASK)
  }
  if (len <= 240) {
    let acc = mul(L, P64_1)
    for (let i = 0; i < 8; i++) acc += mix16(16 * i, 16 * i)
    let end = mix16(len - 16, SECRET_SIZE_MIN - MIDSIZE_LASTOFFSET)
    acc = avalanche(acc & MASK)
    for (let i = 8; i < Math.floor(len / 16); i++) end += mix16(16 * i, 16 * (i - 8) + MIDSIZE_STARTOFFSET)
    return avalanche((acc + end) & MASK)
  }

  // Длинный вход: полосы по 64 байта, блоки по 16 полос, перемешивание после блока
  const acc = [P32_3, P64_1, P64_2, P64_3, P64_4, P32_2, P64_5, P32_1]
  const stripe = (at: number, sec: number) => {
    for (let lane = 0; lane < 8; lane++) {
      const data = in64(at + 8 * lane)
      const key = data ^ secret64(sec + 8 * lane)
      acc[lane ^ 1] = (acc[lane ^ 1] + data) & MASK
      acc[lane] = (acc[lane] + (key & LOW32) * (key >> N32)) & MASK
    }
  }
  const stripesPerBlock = (SECRET_SIZE - STRIPE_LEN) / SECRET_CONSUME_RATE
  const blockLen = STRIPE_LEN * stripesPerBlock
  const blocks = Math.floor((len - 1) / blockLen)
  for (let n = 0; n < blocks; n++) {
    for (let s = 0; s < stripesPerBlock; s++) stripe(n * blockLen + s * STRIPE_LEN, s * SECRET_CONSUME_RATE)
    for (let lane = 0; lane < 8; lane++) {
      let a = acc[lane]
      a ^= a >> N47
      a ^= secret64(SECRET_SIZE - STRIPE_LEN + 8 * lane)
      acc[lane] = mul(a, P32_1)
    }
  }
  const lastStripes = Math.floor((len - 1 - blockLen * blocks) / STRIPE_LEN)
  for (let s = 0; s < lastStripes; s++) stripe(blocks * blockLen + s * STRIPE_LEN, s * SECRET_CONSUME_RATE)
  stripe(len - STRIPE_LEN, SECRET_SIZE - STRIPE_LEN - SECRET_LASTACC_START)

  let result = mul(L, P64_1)
  for (let i = 0; i < 4; i++) {
    const sec = SECRET_MERGEACCS_START + 16 * i
    result += fold(acc[2 * i] ^ secret64(sec), acc[2 * i + 1] ^ secret64(sec + 8))
  }
  return avalanche(result & MASK)
}

/**
 * Хвост адреса файловой карточки так, как его пишет Turbopack: XXH3 байтов
 * файла, 16 шестнадцатеричных знаков. Ведущий ноль остаётся: у карточки
 * портрета Turbopack пишет ?041480c49a99d4ee, а голый toString(16) дал бы
 * пятнадцать знаков и чужой адрес.
 */
export function turbopackContentHash(bytes: Uint8Array): string {
  return xxh3(bytes).toString(16).padStart(16, '0')
}
