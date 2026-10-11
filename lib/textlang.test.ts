import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { NewsBody } from '../components/NewsBody'
import type { NewsBlock } from './steamhtml'
import { isRussianText, textLang } from './textlang'

describe('isRussianText', () => {
  test('русское описание с латинскими названиями — русское', () => {
    expect(isRussianText('Станьте вором в VR! Ощутите азарт воровства.')).toBe(true)
  })

  test('английское — нет, даже с одним русским словом', () => {
    expect(isRussianText('Rise, Tarnished, and be guided by grace')).toBe(false)
    expect(isRussianText('A game about Москва and everything else in the world')).toBe(false)
  })

  test('пусто — не русское', () => {
    expect(isRussianText(undefined)).toBe(false)
    expect(isRussianText('')).toBe(false)
  })
})

describe('textLang', () => {
  test('латиница перевешивает — en', () => {
    // живые заголовки /whatsnew, с которых начался аудит
    expect(textLang('Patch 0.5.1 Has Been Released')).toBe('en')
    expect(textLang('Discover The Season of Scares Update!')).toBe('en')
    expect(textLang('1.5.3.4 Hotfix Patch Notes')).toBe('en')
    expect(textLang('A game about Москва and everything else in the world')).toBe('en')
  })

  test('русское — без пометки: кусок наследует lang="ru" страницы', () => {
    expect(textLang('Патч 2.31')).toBeUndefined()
    expect(textLang('Станьте вором в VR! Ощутите азарт воровства.')).toBeUndefined()
    expect(textLang('Black Myth: Wukong — описание обновления 1.0.21.23831')).toBeUndefined()
  })

  /**
   * «Не русский» ещё не значит «английский»: цифры языка не имеют, а
   * китайский заголовок с lang="en" был бы той же неправдой, что с ru.
   */
  test('без латиницы — без пометки, даже если не русский', () => {
    expect(textLang('1.0.3')).toBeUndefined()
    expect(textLang('版本更新 1.2')).toBeUndefined()
    expect(textLang('')).toBeUndefined()
    expect(textLang(null)).toBeUndefined()
    expect(textLang(undefined)).toBeUndefined()
  })

  /**
   * Название игры — имя собственное, и WCAG 3.1.2 имена собственные из
   * правила исключает. А букв у него много: в «Обновление Counter-Strike 2»
   * латиницы 13 против 10 кириллических, и русский заголовок Valve уезжал
   * английским голосом — на всех патчах верхней игры каталога.
   */
  test('название игры в подсчёт не входит', () => {
    expect(textLang('Обновление Counter-Strike 2', 'Counter-Strike 2')).toBeUndefined()
    expect(textLang('Обновление Team Fortress 2', 'Team Fortress 2')).toBeUndefined()
    // английское остаётся английским и без названия
    expect(textLang('Counter-Strike 2 Update', 'Counter-Strike 2')).toBe('en')
    expect(textLang('Patch 0.5.1 Has Been Released', 'Satisfactory')).toBe('en')
    // без названия правило прежнее — ради этого его и передают
    expect(textLang('Обновление Counter-Strike 2')).toBe('en')
  })

  test('заголовок из одного названия — решает само название', () => {
    // букв после вычета не осталось — считаем, как без него
    expect(textLang('Counter-Strike 2', 'Counter-Strike 2')).toBe('en')
    expect(textLang('Мор', 'Мор')).toBeUndefined()
  })

  test('согласован с isRussianText: русское никогда не помечается en', () => {
    for (const text of ['Станьте вором в VR!', 'Hotfix для VR', 'Ёж и Щука', 'Rise, Tarnished', 'FPS фпс']) {
      if (isRussianText(text)) expect(textLang(text), text).toBeUndefined()
      else if (/[A-Za-z]/.test(text)) expect(textLang(text), text).toBe('en')
    }
  })
})

/**
 * Тело патча — самый длинный чужой текст на сайте, и важнее заголовков:
 * NewsBody помечает его сам, чтобы ни одно из трёх мест (лента, блок на
 * карточке игры, страница патча) не забыло.
 */
describe('NewsBody помечает язык тела', () => {
  const html = (blocks: NewsBlock[]) => renderToStaticMarkup(NewsBody({ blocks }))

  test('английское тело — lang="en" на корне', () => {
    const blocks: NewsBlock[] = [
      { kind: 'h', text: 'Weapons' },
      { kind: 'ul', items: [[{ text: 'Reduced AK-47 recoil' }], [{ text: 'Fixed a crash on Vertigo' }]] },
      { kind: 'p', runs: [{ text: 'Thanks for ' }, { text: 'playing', bold: true }] },
    ]
    expect(html(blocks)).toMatch(/^<div lang="en" class="/)
  })

  test('русское тело — без атрибута: наследует страницу', () => {
    const blocks: NewsBlock[] = [
      { kind: 'h', text: 'Оружие' },
      { kind: 'ul', items: [[{ text: 'Уменьшена отдача AK-47' }], [{ text: 'Исправлен вылет на Vertigo' }]] },
    ]
    expect(html(blocks)).not.toContain('lang=')
  })

  test('язык решает всё тело, а не первый блок', () => {
    const blocks: NewsBlock[] = [
      { kind: 'h', text: 'v1.2 — FPS' },
      { kind: 'p', runs: [{ text: 'Исправили падение частоты кадров на старых видеокартах и вылеты при загрузке' }] },
    ]
    expect(html(blocks)).not.toContain('lang=')
  })
})

const ROOT = path.join(__dirname, '..')
/** Код без комментариев: они цитируют то, что здесь ищется */
const code = (p: string) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*/gm, '')

/**
 * Заголовки патчей — там, где они стоят текстом. Место опознаётся по
 * выражению в JSX, а не по номеру строки; count не даёт сторожу ослепнуть,
 * когда разметку перепишут и выражение сменит имя. Подписи кнопок
 * («Что изменилось: …» в aria-label) сюда не входят: lang части атрибута не
 * поставить.
 */
const HEADINGS: Array<{ file: string; expr: string; count: number }> = [
  { file: 'components/whatsnew/PatchRow.tsx', expr: 'heading', count: 2 },
  { file: 'components/whatsnew/Cover.tsx', expr: 'item.title', count: 1 },
  { file: 'components/GameNews.tsx', expr: 'heading', count: 2 },
  { file: 'app/game/[appid]/news/[gid]/page.tsx', expr: 'heading', count: 1 },
  // «Другие патчи» внизу страницы патча
  { file: 'app/game/[appid]/news/[gid]/page.tsx', expr: 'title', count: 1 },
]

describe('заголовок патча несёт свой lang', () => {
  test.each(HEADINGS)('$file: {$expr}', ({ file, expr, count }) => {
    const src = code(file)
    const esc = expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hits = [...src.matchAll(new RegExp(`>\\s*\\{${esc}\\}\\s*<`, 'g'))]
    expect(hits.length, `${file}: {${expr}} текстом — сторож ослеп или место сменилось`).toBe(count)
    for (const hit of hits) {
      const open = src.lastIndexOf('<', hit.index)
      const tag = src.slice(open, hit.index + 1).replace(/\s+/g, ' ')
      expect(tag, `${file}: {${expr}} без lang — английский заголовок читается русским голосом`).toMatch(
        /\slang=\{/,
      )
    }
    expect(src, `${file}: lang считается правилом lib/textlang`).toContain('textLang(')
  })

  /**
   * Язык заголовка считается без названия игры (второй аргумент textLang):
   * иначе «Обновление Counter-Strike 2» уходит английским голосом. Вызов с
   * одним аргументом здесь — вернувшийся дефект, а не стиль.
   */
  test.each([...new Set(HEADINGS.map((h) => h.file))])('%s: textLang знает название игры', (file) => {
    const calls = [...code(file).matchAll(/textLang\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((m) => m[1])
    expect(calls.length, `${file}: вызов textLang не найден`).toBeGreaterThan(0)
    for (const args of calls) expect(args, `${file}: textLang(${args}) без названия игры`).toContain(',')
  })

  test('тело патча идёт через NewsBody, а он ставит lang сам', () => {
    expect(code('components/NewsBody.tsx')).toMatch(/lang=\{textLang\(blocksToText\(blocks\)\)\}/)
  })
})
