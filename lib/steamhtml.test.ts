import { describe, expect, test } from 'vitest'
import { blocksToText, decodeEntities, parseSteamHtml, stripBbcode } from './steamhtml'

/**
 * Тело новости — недоверенный HTML от издателя игры. Проверяем не только то,
 * что разметка Steam разбирается, но и то, что через разбор НЕ проходит:
 * дырка здесь означает XSS на странице игры.
 */

/** Реальное тело обновления CS2 от 12.08.2026, снято с RSS-ленты Steam */
const CS2 = `<p class="bb_paragraph">[ КАРТЫ ]</p><p class="bb_paragraph">Fachwerk</p><ul class="bb_ul"><li><p class="bb_paragraph">Карта обновлена до последней версии из мастерской (<a class="bb_link" href="https://steamcommunity.com/sharedfiles/filedetails/changelog/3442040035" target="_blank" rel="" >список изменений</a>).</p></li></ul><p class="bb_paragraph">Shelter</p><ul class="bb_ul"><li><p class="bb_paragraph">Карта обновлена до последней версии из мастерской (<a class="bb_link" href="https://steamcommunity.com/sharedfiles/filedetails/changelog/3737179295" target="_blank" rel="" >список изменений</a>).</p></li></ul>`

describe('parseSteamHtml: разметка Steam', () => {
  const blocks = parseSteamHtml(CS2)

  test('абзацы и списки разбираются по порядку', () => {
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'p', 'ul', 'p', 'ul'])
  })

  test('текст абзаца сохраняется', () => {
    expect(blocks[0]).toEqual({ kind: 'p', runs: [{ text: '[ КАРТЫ ]' }] })
    expect(blocks[1]).toEqual({ kind: 'p', runs: [{ text: 'Fachwerk' }] })
  })

  test('вложенный в <li> абзац не рвёт пункт списка на части', () => {
    // Steam кладёт <p> внутрь <li>; наивный разбор дал бы пустой список
    const ul = blocks[2]
    expect(ul.kind).toBe('ul')
    if (ul.kind !== 'ul') return
    expect(ul.items).toHaveLength(1)
    expect(ul.items[0].map((r) => r.text).join('')).toBe(
      'Карта обновлена до последней версии из мастерской (список изменений).',
    )
  })

  test('ссылка внутри пункта сохраняет href', () => {
    const ul = blocks[2]
    if (ul.kind !== 'ul') throw new Error('ожидался список')
    const link = ul.items[0].find((r) => r.href)
    expect(link?.text).toBe('список изменений')
    expect(link?.href).toBe(
      'https://steamcommunity.com/sharedfiles/filedetails/changelog/3442040035',
    )
  })

  test('классы bb_* и прочие атрибуты не утекают наружу', () => {
    expect(JSON.stringify(blocks)).not.toContain('bb_')
    expect(JSON.stringify(blocks)).not.toContain('target')
  })
})

describe('parseSteamHtml: заголовки, жирный, картинки, <br>', () => {
  test('заголовок становится отдельным блоком', () => {
    expect(parseSteamHtml('<h2>Патч 2.31</h2><p>текст</p>')).toEqual([
      { kind: 'h', text: 'Патч 2.31' },
      { kind: 'p', runs: [{ text: 'текст' }] },
    ])
  })

  test('жирный помечается на куске, а не на всём абзаце', () => {
    const [b] = parseSteamHtml('<p>обычный <b>жирный</b> снова</p>')
    expect(b).toEqual({
      kind: 'p',
      runs: [{ text: 'обычный ' }, { text: 'жирный', bold: true }, { text: ' снова' }],
    })
  })

  test('<br> разрывает абзац, пустые куски отбрасываются', () => {
    expect(parseSteamHtml('первый<br><br>второй')).toEqual([
      { kind: 'p', runs: [{ text: 'первый' }] },
      { kind: 'p', runs: [{ text: 'второй' }] },
    ])
  })

  test('картинка с CDN Steam проходит', () => {
    expect(
      parseSteamHtml('<img src="https://clan.fastly.steamstatic.com/images/1/a.png" />'),
    ).toEqual([{ kind: 'img', src: 'https://clan.fastly.steamstatic.com/images/1/a.png' }])
  })

  test('картинка с чужого хоста отбрасывается', () => {
    // автозагрузка картинки со стороннего домена — утечка IP читателя
    expect(parseSteamHtml('<img src="https://evil.example.com/track.gif" />')).toEqual([])
    expect(parseSteamHtml('<img src="http://clan.fastly.steamstatic.com/a.png" />')).toEqual([])
  })
})

describe('parseSteamHtml: недоверенный ввод', () => {
  test('script вырезается вместе с содержимым', () => {
    const blocks = parseSteamHtml('<p>до</p><script>alert(1)</script><p>после</p>')
    expect(blocks).toEqual([
      { kind: 'p', runs: [{ text: 'до' }] },
      { kind: 'p', runs: [{ text: 'после' }] },
    ])
    expect(JSON.stringify(blocks)).not.toContain('alert')
  })

  test('незакрытый script тоже не оставляет исполняемого следа', () => {
    // текст мог бы просочиться, но наружу уходит структура, а не разметка
    expect(JSON.stringify(parseSteamHtml('<script src="//x/y.js">'))).not.toContain('script')
  })

  test('iframe, style, svg и object выбрасываются', () => {
    for (const tag of ['iframe', 'style', 'svg', 'object', 'embed', 'noscript']) {
      expect(parseSteamHtml(`<${tag}>вред</${tag}><p>ок</p>`)).toEqual([
        { kind: 'p', runs: [{ text: 'ок' }] },
      ])
    }
  })

  test('обработчики событий не сохраняются: атрибуты вообще не переносятся', () => {
    const blocks = parseSteamHtml('<p onclick="alert(1)" onerror="alert(2)">текст</p>')
    expect(blocks).toEqual([{ kind: 'p', runs: [{ text: 'текст' }] }])
    expect(JSON.stringify(blocks)).not.toContain('alert')
  })

  test('javascript:-ссылка теряет href, но не текст', () => {
    const [b] = parseSteamHtml('<p><a href="javascript:alert(1)">клик</a></p>')
    expect(b).toEqual({ kind: 'p', runs: [{ text: 'клик' }] })
  })

  test('обфускация схемы пробелами и переносами не проходит', () => {
    for (const bad of ['java\nscript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)']) {
      const [b] = parseSteamHtml(`<p><a href="${bad}">клик</a></p>`)
      expect(b).toEqual({ kind: 'p', runs: [{ text: 'клик' }] })
    }
  })

  test('data: и vbscript: тоже отбрасываются', () => {
    for (const bad of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)', '//evil.com']) {
      const [b] = parseSteamHtml(`<p><a href="${bad}">клик</a></p>`)
      expect(b?.kind === 'p' && b.runs[0].href).toBeFalsy()
    }
  })

  test('обычная внешняя ссылка остаётся: патчноуты ссылаются наружу законно', () => {
    const [b] = parseSteamHtml('<p><a href="https://example.com/notes">заметки</a></p>')
    expect(b).toEqual({
      kind: 'p',
      runs: [{ text: 'заметки', href: 'https://example.com/notes' }],
    })
  })

  test('неизвестные теги не ломают разбор, текст сохраняется', () => {
    expect(parseSteamHtml('<p>а <marquee>б</marquee> <custom-el>в</custom-el></p>')).toEqual([
      { kind: 'p', runs: [{ text: 'а б в' }] },
    ])
  })

  test('мусор вместо разметки не роняет разбор', () => {
    expect(() => parseSteamHtml('<<<>>> <p unclosed')).not.toThrow()
    expect(parseSteamHtml('')).toEqual([])
  })

  test('число блоков ограничено: тело новости идёт в базу', () => {
    const huge = '<p>x</p>'.repeat(500)
    expect(parseSteamHtml(huge, 10)).toHaveLength(10)
  })
})

describe('decodeEntities', () => {
  test('именованные и числовые сущности', () => {
    expect(decodeEntities('&laquo;Игра&raquo; &amp; ещё &#1055;&#x41F;')).toBe('«Игра» & ещё ПП')
  })

  test('двойное экранирование RSS снимается двумя проходами', () => {
    // литеральный «&» приезжает как &amp;amp;
    expect(decodeEntities(decodeEntities('A&amp;amp;B'))).toBe('A&B')
  })

  test('неизвестная сущность остаётся как есть', () => {
    expect(decodeEntities('&nosuch; &amp;')).toBe('&nosuch; &')
  })
})

describe('blocksToText', () => {
  test('склеивает абзаки и списки в плоский текст для классификатора', () => {
    expect(blocksToText(parseSteamHtml(CS2))).toContain('• Карта обновлена')
    expect(blocksToText(parseSteamHtml(CS2))).toContain('[ КАРТЫ ]')
  })

  test('картинки в текст не попадают', () => {
    const blocks = parseSteamHtml('<img src="https://a.steamstatic.com/x.png" /><p>текст</p>')
    expect(blocksToText(blocks)).toBe('текст')
  })

  test('длина ограничена', () => {
    const blocks = parseSteamHtml('<p>' + 'я'.repeat(5000) + '</p>')
    expect(blocksToText(blocks, 100)).toHaveLength(100)
  })
})

/**
 * BBCode, доехавший до текста, — это неразобранная разметка, а правило файла
 * говорит: что не разобрали, то и не показываем. Для HTML оно соблюдалось, а
 * для BBCode нет: часть новостей Steam приходит с ним внутри, и он проходил
 * мимо правила текстом.
 */
describe('остатки BBCode', () => {
  test('структурные теги вырезаются из текста', () => {
    expect(stripBbcode('было [/url] стало')).toBe('было   стало')
    expect(stripBbcode('[h3]1.15 FAQs[/h3]')).toBe(' 1.15 FAQs ')
    expect(stripBbcode('[b]How much is 1.15?[/b]')).toBe(' How much is 1.15? ')
    expect(stripBbcode('[url=https://example.com]тут[/url]')).toBe(' тут ')
  })

  /** В скобках бывает и настоящий текст — патчноут Factorio про rich text. */
  test('незнакомые скобки не трогаем', () => {
    expect(stripBbcode('Fixed [sprite] rich text tag being accessible')).toBe(
      'Fixed [sprite] rich text tag being accessible',
    )
    expect(stripBbcode('урон [12-18] в секунду')).toBe('урон [12-18] в секунду')
  })

  test('замена пробелом, а не склейкой слов', () => {
    expect(stripBbcode('слово[/url]слово').replace(/\s+/g, ' ')).toBe('слово слово')
  })

  test('в разобранном дереве тегов не остаётся', () => {
    const blocks = parseSteamHtml(
      '<p>Смотри <a href="https://example.com">анонс</a>[/url] [h3]FAQ[/h3] [b]сколько?[/b] бесплатно.</p>',
    )
    const text = JSON.stringify(blocks)
    expect(text).not.toContain('[/url]')
    expect(text).not.toContain('[h3]')
    expect(text).not.toContain('[b]')
    expect(text).toContain('FAQ')
    expect(text).toContain('бесплатно')
  })

  /**
   * Потолок длины куска проверялся ДО склейки и после неё не применялся: в
   * базе нашёлся кусок в 5865 символов при потолке в 2000 — подпись одной
   * ссылки, сплошной строкой на экране.
   */
  test('потолок длины куска держится и при склейке', () => {
    /*
     * Куски обязаны прийти РАЗНЫМИ вызовами add() с одинаковым состоянием —
     * иначе срабатывает ветка создания, которая обрезала и до правки. Их
     * разделяют <span>: тег не меняет ни href, ни жирность, поэтому куски
     * склеиваются, а это и есть проверяемый путь.
     */
    const chunk = 'а'.repeat(900)
    const html = `<p>${chunk}<span>${chunk}</span>${chunk}<span>${chunk}</span></p>`
    const blocks = parseSteamHtml(html)
    for (const b of blocks) {
      if (b.kind !== 'p') continue
      for (const run of b.runs) expect(run.text.length).toBeLessThanOrEqual(2000)
    }
  })
})
