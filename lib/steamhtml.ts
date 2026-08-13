/**
 * Разбор HTML новостей Steam в узкое дерево блоков.
 *
 * Тело новости пишет издатель игры — это недоверенный ввод, и отдавать его в
 * dangerouslySetInnerHTML нельзя. Санитайзер на регекспах — классический
 * источник обходов, поэтому здесь не чистка разметки, а РАЗБОР её в свою
 * структуру: наружу выходят только распознанные блоки, а текст экранирует
 * React. Что не разобрали — то и не покажем, и это безопасная сторона ошибки.
 *
 * Заодно это развязывает нас с оформлением Steam: их классы bb_* отброшены,
 * типографика своя.
 */

export type Inline = { text: string; href?: string; bold?: boolean }

export type NewsBlock =
  | { kind: 'p'; runs: Inline[] }
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'img'; src: string }

/**
 * Картинки грузятся автоматически, поэтому хост — только CDN самого Steam.
 * Это не столько про XSS, сколько про приватность: иначе издатель поставит
 * трекинг-пиксель на страницу нашего читателя и соберёт его IP.
 *
 * Сверка идёт по разобранному hostname, а не по подстроке: `includes` обходится
 * и через `https://evil.example/?x=steamstatic.com`, и через
 * `https://steamstatic.com.evil.example/`.
 */
const IMG_HOSTS =
  /(^|\.)(steamstatic\.com|akamaihd\.net|steamusercontent\.com|steampowered\.com)$/i

/** Вырезаются вместе с содержимым: их текст не нужен даже как текст */
const DROP_PAIRED =
  /<(script|style|iframe|object|embed|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const DROP_LONE = /<\/?(script|style|iframe|object|embed|svg|noscript|template)\b[^>]*>/gi

/** Атрибуты в кавычках могут содержать '>', поэтому они разбираются отдельно */
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g

/** Пробельные символы, которые браузер выкусывает из URL */
const URL_NOISE = /\s+/g

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
}

/**
 * Декодирование сущностей. Нужно дважды: RSS отдаёт HTML в XML-экранировании,
 * так что литеральный «&» приезжает как «&amp;amp;» — внешний слой снимает
 * lib/news, внутренний вот этот.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

function attr(raw: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
  const m = raw.match(re)
  if (!m) return undefined
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim()
}

/**
 * Ссылки: только http(s). javascript:, data:, vbscript: отбрасываем молча.
 * Пробелы и управляющие сначала выкусываем — иначе "java\nscript:" пройдёт
 * проверку, а браузер всё равно выполнит.
 */
function safeHref(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const v = raw.replace(URL_NOISE, '')
  if (!/^https?:\/\/[^/]/i.test(v)) return undefined
  return v.slice(0, 500)
}

function safeImg(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const v = raw.replace(URL_NOISE, '')
  if (!/^https:\/\//i.test(v)) return undefined
  try {
    const host = new URL(v).hostname
    return IMG_HOSTS.test(host) ? v.slice(0, 500) : undefined
  } catch {
    return undefined
  }
}

type Token =
  | { t: 'text'; v: string }
  | { t: 'open'; name: string; raw: string }
  | { t: 'close'; name: string }

function tokenize(html: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of html.matchAll(TAG_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ t: 'text', v: html.slice(last, idx) })
    last = idx + m[0].length
    const name = m[2].toLowerCase()
    if (m[1]) out.push({ t: 'close', name })
    else out.push({ t: 'open', name, raw: m[3] ?? '' })
  }
  if (last < html.length) out.push({ t: 'text', v: html.slice(last) })
  return out
}

/** Блочные теги, на границе которых абзац закрывается */
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'])
const HEADING = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const LIST = new Set(['ul', 'ol'])
const BOLD = new Set(['b', 'strong'])

const MAX_RUN_CHARS = 2000

export function parseSteamHtml(html: string, maxBlocks = 120): NewsBlock[] {
  if (!html) return []
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(DROP_PAIRED, '')
    .replace(DROP_LONE, '')

  const blocks: NewsBlock[] = []
  let runs: Inline[] = []
  let heading = false
  let listItems: Inline[][] | null = null
  let bold = 0
  let href: string | undefined

  const full = () => blocks.length >= maxBlocks

  function add(text: string) {
    if (!text) return
    const prev = runs[runs.length - 1]
    if (prev && prev.href === href && Boolean(prev.bold) === bold > 0) {
      if (prev.text.length < MAX_RUN_CHARS) prev.text += text
      return
    }
    runs.push({
      text: text.slice(0, MAX_RUN_CHARS),
      ...(href ? { href } : {}),
      ...(bold > 0 ? { bold: true } : {}),
    })
  }

  /** Снимает накопленные куски, схлопывая пробелы и обрезая края */
  function takeRuns(): Inline[] {
    const out: Inline[] = []
    for (const r of runs) {
      const text = r.text.replace(/\s+/g, ' ')
      if (!text.trim()) continue
      out.push({ ...r, text })
    }
    runs = []
    if (!out.length) return out
    out[0].text = out[0].text.replace(/^ +/, '')
    out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, '')
    return out.filter((r) => r.text)
  }

  /** Границы абзаца внутри списка не рвут поток: Steam кладёт <p> внутрь <li> */
  function flushPara() {
    if (listItems) return
    const r = takeRuns()
    const wasHeading = heading
    heading = false
    if (!r.length || full()) return
    if (wasHeading) {
      blocks.push({ kind: 'h', text: r.map((x) => x.text).join('').slice(0, 300) })
    } else {
      blocks.push({ kind: 'p', runs: r })
    }
  }

  function closeItem() {
    if (!listItems) return
    const r = takeRuns()
    if (r.length) listItems.push(r)
  }

  function closeList() {
    if (!listItems) return
    closeItem()
    const items = listItems
    listItems = null
    if (items.length && !full()) blocks.push({ kind: 'ul', items })
  }

  for (const tok of tokenize(cleaned)) {
    if (tok.t === 'text') {
      add(decodeEntities(tok.v))
      continue
    }

    if (tok.t === 'open') {
      const n = tok.name
      if (n === 'br') {
        // одиночный <br> у Steam работает как разрыв абзаца в не-bb разметке
        if (listItems) add(' ')
        else flushPara()
      } else if (n === 'img') {
        const src = safeImg(attr(tok.raw, 'src'))
        if (src) {
          flushPara()
          if (!full()) blocks.push({ kind: 'img', src })
        }
      } else if (LIST.has(n)) {
        flushPara()
        closeList()
        listItems = []
      } else if (n === 'li') {
        if (listItems) closeItem()
        else takeRuns()
      } else if (BOLD.has(n)) {
        bold++
      } else if (n === 'a') {
        href = safeHref(attr(tok.raw, 'href'))
      } else if (BLOCK.has(n)) {
        flushPara()
        if (HEADING.has(n) && !listItems) heading = true
      }
      continue
    }

    const n = tok.name
    if (LIST.has(n)) closeList()
    else if (n === 'li') closeItem()
    else if (BOLD.has(n)) bold = Math.max(0, bold - 1)
    else if (n === 'a') href = undefined
    else if (BLOCK.has(n)) flushPara()
  }

  closeList()
  flushPara()
  return blocks
}

/** Плоский текст блоков — для классификатора и промпта Claude */
export function blocksToText(blocks: NewsBlock[], limit = 4000): string {
  const parts: string[] = []
  let total = 0
  for (const b of blocks) {
    let line = ''
    if (b.kind === 'p') line = b.runs.map((r) => r.text).join('')
    else if (b.kind === 'h') line = b.text
    else if (b.kind === 'ul') {
      line = b.items.map((i) => `• ${i.map((r) => r.text).join('')}`).join('\n')
    } else continue
    if (!line.trim()) continue
    parts.push(line)
    total += line.length + 1
    if (total >= limit) break
  }
  return parts.join('\n').slice(0, limit)
}
