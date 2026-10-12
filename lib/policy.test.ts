import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож даты политики.
 *
 * На странице конфиденциальности стоит строка «Обновлено …». Она полезна ровно
 * до первой правки текста без правки числа: после этого дата не сообщает
 * ничего, а врёт — причём в документе, весь смысл которого в том, что ему
 * можно верить.
 *
 * Забыть тут легко и естественно: правят один абзац, дата стоит на семьдесят
 * строк выше и в поле зрения не попадает.
 *
 * Поэтому тест снимает отпечаток с ПРОЗЫ страницы — с того, что человек
 * читает глазами, — и сравнивает с записанным ниже. Классы оформления,
 * перестановка разметки и комментарии в отпечаток не входят: переверстать
 * страницу можно свободно, а переписать текст — только вместе с датой.
 *
 * Когда прогон упал: правка текста была намеренной — обнови UPDATED в
 * app/privacy/page.tsx и подставь сюда новый отпечаток из сообщения об ошибке.
 */

const PAGE = path.join(__dirname, '..', 'app', 'privacy', 'page.tsx')

/** Отпечаток прозы, действительный для даты ниже. */
const DIGEST = '03d37497cbdfe54b'

/** Та же дата, что и в UPDATED на странице. Дублируется, чтобы тест видел смену. */
const UPDATED = '12 октября 2026'

/**
 * Видимый текст страницы: строки-ответы, заголовки разделов и текстовые узлы
 * JSX. Комментарии вырезаются первыми — иначе отпечаток ловил бы объяснение
 * правки вместо самой правки.
 */
function prose(src: string): string {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*\/\/[^\n]*$/gm, '')
  const chunks: string[] = []
  for (const m of code.matchAll(/\b(?:title|answer)=["']([^"']+)["']/g)) chunks.push(m[1])
  for (const m of code.matchAll(/>([^<>{}]*[А-Яа-яЁё][^<>{}]*)[<{]/g)) chunks.push(m[1])
  for (const m of code.matchAll(/^\s*'([^']*[А-Яа-яЁё][^']*)',?\s*$/gm)) chunks.push(m[1])
  return chunks
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

describe('политика конфиденциальности', () => {
  const src = fs.readFileSync(PAGE, 'utf8')

  test('на странице стоит дата обновления', () => {
    expect(src).toContain(`const UPDATED = '${UPDATED}'`)
    expect(src).toContain('Обновлено {UPDATED}')
  })

  test('текст политики не менялся в обход даты', () => {
    const text = prose(src)
    expect(text.length, 'проза не извлеклась — проверь prose()').toBeGreaterThan(1500)
    const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
    expect(
      digest,
      `текст политики изменился. Если правка намеренная — обнови UPDATED в app/privacy/page.tsx и подставь сюда ${digest}`,
    ).toBe(DIGEST)
  })
})

/**
 * Потолки, которые считаются по SteamID, — и слово, которым их называет раздел
 * 06.
 *
 * Строка лимитера — bucket:id:окно (lib/ratelimit), и id у части потолков —
 * steamid или personalRateId, то есть тот же steamid (у сессии по ссылке — с
 * номером сессии). Раздел 06 обещает, что обращения считаются по адресу, а
 * прежде называл по SteamID одну ссылку на RSS. В коде так же считались
 * подбор, игра дня, оценки, голоса в пати и ещё десяток действий: читатель
 * политики думал, что его SteamID в счётчики не попадает, пока он не выпустил
 * ссылку на ленту, — а его писала туда каждая оценка.
 *
 * Сторож держит обе стороны: каждый потолок по SteamID в коде назван здесь, а
 * его слово стоит в той части раздела, что говорит про SteamID. Новый такой
 * потолок без слова в политике уронит прогон — тогда допиши его в абзац
 * раздела 06 и сюда. Потолок в памяти инстанса (memoryGate) в базе не лежит, и
 * политике о нём говорить нечего.
 */
const BY_STEAMID: Record<string, string> = {
  recommend: 'подбор',
  daily: 'игра дня',
  explore: '«Полистать»',
  prepare: 'разбор библиотеки',
  feedback: 'оценки',
  outcome: 'ответы «как тебе?»',
  'pick-share': 'ссылки на выбор',
  'room-vote': 'голоса',
  'room-deck': 'колода',
  'room-leader': 'остальные действия в пати',
  'room-likes': 'остальные действия в пати',
  'room-trivia': 'остальные действия в пати',
  'room-public': 'остальные действия в пати',
  feedlink: 'выпуск ссылки на RSS',
  feedrss: 'сколько раз ридер забирал ленту',
  // Счёт — по SteamID хозяина портрета, а не открывшего: стережёт пересборку
  portrait: 'Пересборка текста портрета считается по SteamID того, чей он',
  // Квота демо на умные объяснения — суточная, длиннее прочих окон
  'llm-demo': 'у демо-профиля счётчик подборов с умными объяснениями — не дольше суток',
}

const ROOT = path.join(__dirname, '..')

/** Каждый потолок в базе (checkRate, checkRatesInOrder) — с тем, что стоит у него в id */
function rateGates(): Array<{ file: string; bucket: string; id: string }> {
  const gates: Array<{ file: string; bucket: string; id: string }> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        for (const m of src.matchAll(/(memoryGate\(\s*\{\s*)?bucket:\s*'([^']+)',\s*id:\s*([^,\n}]+)/g)) {
          if (m[1]) continue
          gates.push({ file: rel, bucket: m[2], id: m[3].trim() })
        }
      }
    }
  }
  walk('app')
  walk('lib')
  return gates
}

/** Абзац раздела 06 про SteamID — от «по твоему SteamID» до уборки, текстом без разметки */
function steamidPart(src: string): string {
  const from = src.indexOf('n="06"')
  const to = src.indexOf('n="07"')
  expect(from, 'раздел 06').toBeGreaterThan(-1)
  expect(to, 'раздел 07').toBeGreaterThan(from)
  const text = src
    .slice(from, to)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\{' '\}/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
  const start = text.indexOf('по твоему SteamID')
  expect(start, '«по твоему SteamID» в разделе 06').toBeGreaterThan(-1)
  const end = text.indexOf('ближайшей уборкой', start)
  expect(end, 'уборка после «по твоему SteamID»').toBeGreaterThan(start)
  return text.slice(start, end)
}

describe('раздел 06: что считается по SteamID', () => {
  const src = fs.readFileSync(PAGE, 'utf8')
  const gates = rateGates()

  test('сторож видит потолки: и по адресу, и по SteamID', () => {
    // без этого пустой обход прошёл бы сторож ниже вслепую
    expect(gates.find((g) => g.bucket === 'recommend-ip')?.id).toBe('ip')
    expect(gates.find((g) => g.bucket === 'feedback')?.id).toBe('steamid')
  })

  test('каждый потолок по SteamID назван в абзаце про SteamID', () => {
    const bySteamid = [...new Set(gates.filter((g) => /steamid|personalRateId\(/i.test(g.id)).map((g) => g.bucket))]
    expect(bySteamid.sort()).toEqual(Object.keys(BY_STEAMID).sort())
    const part = steamidPart(src)
    for (const [bucket, word] of Object.entries(BY_STEAMID)) expect(part, bucket).toContain(word)
  })

  /*
   * personalRateId у сессии по ссылке пишет в ключ и номер сессии — иначе
   * чужой со ссылкой на профиль тратил бы потолок владельца. Политика обязана
   * назвать и это: в базе лежит не один SteamID.
   */
  test('у потолков по personalRateId сказано про номер сессии', () => {
    expect(gates.some((g) => g.id.startsWith('personalRateId('))).toBe(true)
    expect(steamidPart(src)).toContain('номер этой сессии')
  })
})
