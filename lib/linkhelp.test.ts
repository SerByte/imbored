import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AccessNote, PASSWORD_NOTE_ID } from '../components/landing/ConnectFallback'
import { LINK_HELP_ID, LinkHelp, LinkHelpToggle } from '../components/landing/LinkHelp'
import { CLIENT_EVENTS, parseTrackEvent, TRACK_PATH } from './track'

/**
 * Подсказки у входа: «Где взять?» у поля ссылки и подпись про пароль у
 * «Войти через Steam».
 *
 * Поле просит ссылку, ник или код друга и не говорило, откуда их взять, а
 * сноска обещала «Пароль не спрашиваем» — хотя через секунду после нажатия
 * пароль спрашивает Steam. Обе правки стоят на первом экране, у которого
 * потолок высоты (CONNECT_CARD_MIN_H) держит подмену фолбэка неподвижной, —
 * поэтому сторожится и текст, и то, что закрытая подсказка не занимает строки.
 */

const ROOT = path.join(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
/** Код без комментариев: докблоки цитируют то, что здесь ищется */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const CARD = 'components/landing/ConnectCard.tsx'
const FALLBACK = 'components/landing/ConnectFallback.tsx'

function allTsx(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return allTsx(rel)
    return e.name.endsWith('.tsx') ? [rel] : []
  })
}

/** Сколько раз шаблон встречается в коде продукта, по файлам */
function hits(re: RegExp): string[] {
  const all = new RegExp(re.source, 'g')
  return [...allTsx('app'), ...allTsx('components')].flatMap((file) => {
    const n = [...code(read(file)).matchAll(all)].length
    return n ? [`${file} — ${n}`] : []
  })
}

const panel = (open: boolean) => renderToStaticMarkup(createElement(LinkHelp, { open }))
const toggle = (open: boolean) =>
  renderToStaticMarkup(createElement(LinkHelpToggle, { open, onToggle: () => {} }))

describe('«Где взять?» у поля', () => {
  test('закрытая панель в разметке, но спрятана, раскрытая — видна', () => {
    expect(panel(false)).toMatch(new RegExp(`^<div id="${LINK_HELP_ID}" hidden=""`))
    expect(panel(true)).toMatch(new RegExp(`^<div id="${LINK_HELP_ID}"`))
    expect(panel(true)).not.toMatch(/^<div[^>]*\shidden/)
  })

  test('шаги называют чужой интерфейс его словами', () => {
    const out = panel(true)
    expect(out).toContain('«Профиль»')
    expect(out).toContain('«Скопировать адрес страницы»')
    expect(out).toContain('«Добавить друга»')
    // ник из ссылки, а не имя в профиле — иначе badinput
    expect(out).toContain('/id/')
  })

  /*
   * Правый клик и меню страницы есть только в клиенте на компьютере, а
   * главную открывают с телефона. Без своей строки у телефона оставался бы
   * один код для друзей.
   */
  test('у телефона свой путь — через браузер, ссылкой на свой профиль', () => {
    const out = panel(true)
    expect(out).toContain('В Steam на компьютере:')
    const phone = out.match(/<p[^>]*>С телефона:([\s\S]*?)<\/p>/)
    expect(phone, 'строки для телефона нет').not.toBeNull()
    const line = (phone as RegExpMatchArray)[1]
    expect(line).toMatch(
      /<a href="https:\/\/steamcommunity\.com\/my" target="_blank" rel="noreferrer"[^>]*>steamcommunity\.com\/my<\/a>/,
    )
    expect(line).toContain('скопируй адрес из строки браузера')
  })

  test('кнопка — раскрывашка: своё имя, состояние и связь с панелью', () => {
    const closed = toggle(false)
    expect(closed).toMatch(/^<button type="button"/)
    expect(closed, 'без type="button" кнопка внутри формы отправит её').toContain('type="button"')
    expect(closed).toContain('aria-label="Где взять ссылку?"')
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).toContain(`aria-controls="${LINK_HELP_ID}"`)
    // имя содержит видимое: «Где взять» — для голосового ввода
    expect(closed).toMatch(/<span class="join-help-word">Где взять<\/span>\?<\/button>$/)
    expect(toggle(true)).toContain('aria-expanded="true"')
  })

  /*
   * Слева от кнопки вплотную поле с отступом в 4 px: штатная зона .tap
   * (−6 px с каждого бока) легла бы на его край, и нажатие в конец длинной
   * ссылки раскрывало бы подсказку вместо того, чтобы ставить каретку.
   */
  test('зона пальца у кнопки не заходит в поле', () => {
    expect(toggle(false)).toMatch(/class="tap tap-flush-start /)
    const css = read('app/globals.css')
    // блок (pointer: coarse), который начинается с самой зоны .tap::after, — до своей скобки
    const coarse = css.match(/@media \(pointer: coarse\) \{\s*(\.tap::after[\s\S]*?)\n\}/)
    expect(coarse, 'блока (pointer: coarse) с зоной .tap нет').not.toBeNull()
    // та же специфичность, что у .tap::after, — побеждает тот, кто ниже, то есть модификатор
    expect((coarse as RegExpMatchArray)[1]).toMatch(
      /\.tap::after \{[\s\S]*\.tap-flush-start::after \{\s*inset-inline-start: 0;/,
    )
  })

  /*
   * Бюджет высоты: у гостевой карточки на телефоне до потолка три пикселя, и
   * строка под полем сдвинула бы первый экран при подмене фолбэка. Поэтому
   * кнопка — в строке самого поля, а панель — после формы и в закрытом виде
   * через hidden, то есть вне потока.
   */
  test('кнопка в строке поля, панель — сразу за формой', () => {
    const src = code(read(CARD))
    const row = src.match(/<div className="join-field">([\s\S]*?)<\/div>/)
    expect(row, 'строка поля .join-field в карточке не найдена').not.toBeNull()
    const inRow = (row as RegExpMatchArray)[1]
    expect(inRow).toContain('id="steam-profile"')
    expect(inRow, 'кнопка ушла из строки поля — закрытая подсказка займёт строку').toMatch(
      /<LinkHelpToggle\b/,
    )

    const formEnd = src.indexOf('</form>')
    const panelAt = src.indexOf('<LinkHelp open={helpOpen} />')
    expect(panelAt, 'панель подсказки не найдена').toBeGreaterThan(-1)
    expect(panelAt, 'панель обязана стоять после формы, а не в пилюле').toBeGreaterThan(formEnd)

    expect(hits(/<LinkHelpToggle\b/)).toEqual([`${CARD} — 1`])
    expect(hits(/<LinkHelp\b/), 'второй экземпляр — второй такой же id').toEqual([`${CARD} — 1`])
  })

  /*
   * Плейсхолдер и кнопка делят строку впритык (счёт — в globals.css у
   * .join-field): без ужатого правого отступа поля и без «?» вместо слова на
   * тесном экране плейсхолдер оборвётся посреди слова.
   */
  test('на тесном экране слово прячется, поле отдаёт кнопке свой правый отступ', () => {
    const css = read('app/globals.css')
    expect(css).toMatch(/\.join-field input \{\s*padding-right: 4px;/)
    const narrow = css.match(/@media ([^{]*max-width[^{]*)\{\s*\.join-help-word \{\s*display: none;/)
    expect(narrow, 'правила, прячущего слово на узком экране, нет').not.toBeNull()
    expect((narrow as RegExpMatchArray)[1], 'низкий экран сужает карточку отступом').toContain(
      'max-height: 700px',
    )
    // основа auto: между 560 и 640 обёртка кнопки ещё w-full и съела бы строку в ноль
    expect(css).toMatch(/\.join-field \{[^}]*flex: 1 1 auto;/)
    // запас у плейсхолдера — единицы пикселей: не влез — пусть кончится «…», а не обрубком
    expect(css).toMatch(/\.join-field input \{[^}]*text-overflow: ellipsis;/)
  })
})

describe('счёт раскрытий', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * Свежий модуль — метка «уже посчитано» живёт в нём, — и маяк, который
   * просто считает вызовы: сколько раз ушло событие, видно сразу, без разбора
   * тела.
   */
  async function fresh() {
    const beacon = vi.fn<(path: string, body: Blob) => boolean>(() => true)
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} })
    vi.stubGlobal('navigator', { sendBeacon: beacon })
    vi.resetModules()
    const { toggleLinkHelp } = await import('../components/landing/LinkHelp')
    return { toggleLinkHelp, beacon }
  }

  test('событие — в списке, который принимает /api/event', () => {
    expect(CLIENT_EVENTS as readonly string[]).toContain('link_help_open')
    expect(parseTrackEvent({ event: 'link_help_open', source: 'room' })).toEqual({
      event: 'link_help_open',
      source: 'room',
    })
  })

  test('считается раскрытие, закрытие — нет', async () => {
    const { toggleLinkHelp, beacon } = await fresh()
    expect(toggleLinkHelp(true), 'нажатие на раскрытой закрывает').toBe(false)
    expect(beacon, 'закрытие ушло в счёт').not.toHaveBeenCalled()

    expect(toggleLinkHelp(false), 'нажатие на закрытой раскрывает').toBe(true)
    expect(beacon).toHaveBeenCalledTimes(1)
    const [to, body] = beacon.mock.calls[0]
    expect(to).toBe(TRACK_PATH)
    expect(JSON.parse(await body.text())).toMatchObject({ event: 'link_help_open' })
  })

  test('раскрытие — раз за документ, сколько бы раз ни открывали', async () => {
    const { toggleLinkHelp, beacon } = await fresh()
    let open = false
    for (let i = 0; i < 5; i++) open = toggleLinkHelp(open)
    expect(open).toBe(true)
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  test('форма решает нажатие через toggleLinkHelp, а не сама', () => {
    expect(code(read(CARD))).toMatch(/onToggle=\{\(\) => setHelpOpen\(toggleLinkHelp\(helpOpen\)\)\}/)
  })

  /*
   * Политика перечисляет считаемые шаги поимённо — счётчик, которого в ней
   * нет, был бы тем самым «считаем больше, чем сказали».
   */
  test('раскрытие названо в /privacy среди считаемых шагов', () => {
    expect(read('app/privacy/page.tsx').replace(/\s+/g, ' ')).toMatch(
      /Ещё мы считаем несколько шагов:[^.]*раскрытие подсказки «Где взять\?» у поля ссылки/,
    )
  })
})

describe('подпись у «Войти через Steam»', () => {
  const note = () => renderToStaticMarkup(createElement(AccessNote))

  test('сноска говорит, где вводится пароль, и не обещает «не спрашиваем»', () => {
    const out = note()
    expect(out).toContain(
      `<span id="${PASSWORD_NOTE_ID}">Пароль вводишь на сайте Steam — мы его не видим.</span>`,
    )
    expect(out, 'пароль спросит Steam через секунду — обещание ломалось в момент доверия').not.toContain(
      'Пароль не спрашиваем',
    )
    expect(out).toContain('href="/privacy"')
  })

  /*
   * Вход через Steam читает и открытый список желаемого (fetchWishlist, полка
   * на /library). Обещание у двери — ответ тому, кто колеблется, и «только
   * список игр» рядом с ней было бы неправдой ровно в момент доверия. /privacy
   * это чтение называет, но до неё колеблющийся доходит не всегда.
   */
  test('обещание у двери входа называет список желаемого, пока его читаем', () => {
    const readsWishlist = code(read('lib/steam.ts')).includes('IWishlistService/GetWishlist')
    expect(readsWishlist, 'желаемое больше не читаем — сними его и с подписей у дверей').toBe(true)
    expect(note()).toContain('список желаемого')
    // вторая дверь — приглашение сравниться на /compat
    expect(code(read('app/compat/[steamid]/page.tsx')).replace(/\s+/g, ' ')).toMatch(
      /Прочитаем [^.]*список желаемого/,
    )
    expect(hits(/только\s+список\s+игр/)).toEqual([])
  })

  test('дверь Steam ссылается на фразу — и в фолбэке, и у гостя', () => {
    expect(code(read(FALLBACK))).toMatch(
      /href="\/api\/auth\/steam"\s+aria-describedby=\{PASSWORD_NOTE_ID\}/,
    )
    const card = code(read(CARD))
    const guestAt = card.indexOf(') : (', card.indexOf('view.authed ?'))
    expect(guestAt, 'ветка гостя не найдена').toBeGreaterThan(-1)
    expect(card.slice(guestAt)).toMatch(/href=\{steamHref\}\s+aria-describedby=\{PASSWORD_NOTE_ID\}/)
  })

  /*
   * Фолбэк и карточка подменяют друг друга на первом экране при гидратации:
   * разные слова в сноске читались бы морганием, а две копии текста
   * разъезжаются на первой правке.
   */
  test('сноска одна на фолбэк и карточку', () => {
    expect(hits(/<AccessNote \/>/)).toEqual([`${CARD} — 1`, `${FALLBACK} — 1`])
    expect(hits(/Пароль вводишь на сайте Steam/)).toEqual([`${FALLBACK} — 1`])
    expect(hits(/Читаем\s+игры с часами/)).toEqual([`${FALLBACK} — 1`])
    // id фразы — в одном месте, дверь берёт его константой
    expect(hits(new RegExp(PASSWORD_NOTE_ID))).toEqual([`${FALLBACK} — 1`])
  })
})
