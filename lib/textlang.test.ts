import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { withNicks } from '../app/[lang]/compat/nick'
import * as portraitText from '../app/[lang]/portrait/[steamid]/portrait-text'
import { NewsBody } from '../components/NewsBody'
import type { NewsBlock } from './steamhtml'
import { isRussianText, langOn, textLang, textLangOn, withForeignRuns } from './textlang'

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
 * На английской странице чужим становится русский: патчноут, который издатель
 * выпустил по-русски, на /en читался бы английским голосом. Правило то же,
 * что у textLang, только в обратную сторону.
 */
describe('textLangOn', () => {
  test('на русской странице — ровно textLang', () => {
    for (const [text, game] of [
      ['Patch 0.5.1 Has Been Released', undefined],
      ['Патч 2.31', undefined],
      ['Обновление Counter-Strike 2', 'Counter-Strike 2'],
      ['1.0.3', undefined],
      [null, undefined],
    ] as const) {
      expect(textLangOn('ru', text, game), String(text)).toBe(textLang(text, game))
    }
  })

  test('на английской — ru для русского текста, остальное наследует en', () => {
    expect(textLangOn('en', 'Патч 2.31')).toBe('ru')
    expect(textLangOn('en', 'Станьте вором в VR! Ощутите азарт воровства.')).toBe('ru')
    expect(textLangOn('en', 'Patch 0.5.1 Has Been Released')).toBeUndefined()
    expect(textLangOn('en', '1.0.3')).toBeUndefined()
    expect(textLangOn('en', '版本更新 1.2')).toBeUndefined()
    expect(textLangOn('en', '')).toBeUndefined()
    expect(textLangOn('en', undefined)).toBeUndefined()
  })

  test('название игры в подсчёт не входит и на английской', () => {
    // 13 латинских букв названия перевешивали бы 10 русских — а заголовок русский
    expect(textLangOn('en', 'Обновление Counter-Strike 2', 'Counter-Strike 2')).toBe('ru')
    expect(textLangOn('en', 'Counter-Strike 2 Update', 'Counter-Strike 2')).toBeUndefined()
    expect(textLangOn('en', 'Мор', 'Мор')).toBe('ru')
  })

  /**
   * Ничья букв — русскому голосу. Русское имя магазина «God of War Рагнарёк»
   * (2322010 в копии базы) — восемь латинских на восемь кириллических, и с
   * правилом «строго больше» h1 карточки и ссылка «Similar to “…”» на /en
   * шли без lang: английский голос читал «Рагнарёк» по буквам.
   */
  test('ничья на английской — ru, на русской — по-прежнему без пометки', () => {
    expect(textLangOn('en', 'God of War Рагнарёк')).toBe('ru')
    expect(textLangOn('en', 'Hotfix для VR, фикс')).toBeUndefined()
    // русская страница не меняется: ничья там и так читается русским голосом
    expect(textLangOn('ru', 'God of War Рагнарёк')).toBeUndefined()
    expect(textLang('God of War Рагнарёк')).toBeUndefined()
  })

  test('на английской согласован с isRussianText: ru ровно у русского текста', () => {
    for (const text of ['Станьте вором в VR!', 'Hotfix для VR', 'Ёж и Щука', 'Rise, Tarnished', 'FPS фпс', 'God of War Рагнарёк', '1.0.3']) {
      expect(textLangOn('en', text), text).toBe(isRussianText(text) ? 'ru' : undefined)
    }
  })
})

/**
 * Ники и названия игр внутри английских фраз — одно правило на совместимость
 * и портрет. Раньше у каждой страницы была своя копия langOn и разрезания
 * фразы; теперь обе зовут lib/textlang, и вывод обязан остаться тем же:
 * портрет — куски без обёртки, совместимость — те же куски в одном <span>.
 */
describe('langOn и withForeignRuns', () => {
  const html = (node: ReactNode) => renderToStaticMarkup(createElement('p', null, node))

  test('lang="ru" — только у русского текста и только на /en', () => {
    expect(langOn('en', 'Костя')).toBe('ru')
    expect(langOn('en', 'Mira')).toBeUndefined()
    expect(langOn('en', '1337')).toBeUndefined()
    // Русская страница без атрибутов, как была: латиница там не помечалась
    expect(langOn('ru', 'Mira')).toBeUndefined()
    expect(langOn('ru', 'Костя')).toBeUndefined()
  })

  test('название поровну латиницей и кириллицей — тоже lang="ru"', () => {
    // h1 карточки игры и «Similar to “…”» зовут langOn, «All … updates» — withForeignRuns
    expect(langOn('en', 'God of War Рагнарёк')).toBe('ru')
    expect(langOn('ru', 'God of War Рагнарёк')).toBeUndefined()
    expect(html(withForeignRuns('en', 'All God of War Рагнарёк updates', ['God of War Рагнарёк']))).toBe(
      '<p>All <span lang="ru">God of War Рагнарёк</span> updates</p>',
    )
  })

  test('каждое вхождение — своим узлом, длинное имя раньше своей части', () => {
    expect(html(withForeignRuns('en', 'Костя Pro and Костя', ['Костя', 'Костя Pro', 'Mira']))).toBe(
      '<p><span lang="ru">Костя Pro</span> and <span lang="ru">Костя</span></p>',
    )
    // Спецсимволы ника — буквально, а не регуляркой
    expect(html(withForeignRuns('en', 'Hi, Вася (1.0)?', ['Вася (1.0)?']))).toBe('<p>Hi, <span lang="ru">Вася (1.0)?</span></p>')
  })

  test('нечего помечать — та же строка, одним текстовым узлом', () => {
    expect(withForeignRuns('ru', 'Костя увидит у себя, что вы сравнились.', ['Костя'])).toBe(
      'Костя увидит у себя, что вы сравнились.',
    )
    expect(withForeignRuns('en', 'Mira will see your comparison.', ['Mira', null, undefined])).toBe(
      'Mira will see your comparison.',
    )
  })

  test('портрет и совместимость зовут одно правило', () => {
    expect(portraitText.langOn).toBe(langOn)
    expect(portraitText.withForeignRuns).toBe(withForeignRuns)
    // совместимость — те же куски, но в одном общем <span>: фраза стоит во
    // flex-родителях, и без обёртки ник отъехал бы от «'s» на ширину зазора
    expect(html(withNicks('en', "Костя's player portrait", ['Костя']))).toBe(
      '<p><span><span lang="ru">Костя</span>&#x27;s player portrait</span></p>',
    )
    expect(withNicks('en', "Mira's player portrait", ['Mira'])).toBe("Mira's player portrait")
    expect(withNicks('ru', 'Портрет игрока Костя', ['Костя'])).toBe('Портрет игрока Костя')
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

  // На /en чужим становится русское тело: голос страницы английский
  test('на /en: русское тело — lang="ru", английское — без атрибута', () => {
    const en = (blocks: NewsBlock[]) => renderToStaticMarkup(NewsBody({ blocks, locale: 'en' }))
    expect(en([{ kind: 'p', runs: [{ text: 'Исправлен вылет на Vertigo при загрузке карты' }] }])).toMatch(
      /^<div lang="ru" class="/,
    )
    expect(en([{ kind: 'p', runs: [{ text: 'Fixed a crash on Vertigo' }] }])).not.toContain('lang=')
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
  { file: 'app/[lang]/game/[appid]/news/[gid]/page.tsx', expr: 'heading', count: 1 },
  // «Другие патчи» внизу страницы патча
  { file: 'app/[lang]/game/[appid]/news/[gid]/page.tsx', expr: 'title', count: 1 },
  // архив обновлений игры: ссылкой на страницу патча и текстом рядом со ссылкой в Steam
  { file: 'app/[lang]/game/[appid]/news/page.tsx', expr: 'heading', count: 2 },
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
    // textLangOn — правило lib/textlang с языком страницы: на /en чужой — русский
    expect(src, `${file}: lang считается правилом lib/textlang`).toContain('textLangOn(locale, ')
  })

  /**
   * Язык заголовка считается без названия игры (третий аргумент textLangOn,
   * после языка страницы): иначе «Обновление Counter-Strike 2» уходит
   * английским голосом. Вызов без него здесь — вернувшийся дефект, а не стиль.
   */
  test.each([...new Set(HEADINGS.map((h) => h.file))])('%s: textLangOn знает название игры', (file) => {
    const calls = [...code(file).matchAll(/textLangOn\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((m) => m[1])
    expect(calls.length, `${file}: вызов textLangOn не найден`).toBeGreaterThan(0)
    for (const args of calls) {
      expect(args.split(',').length, `${file}: textLangOn(${args}) без названия игры`).toBeGreaterThanOrEqual(3)
    }
  })

  test('тело патча идёт через NewsBody, а он ставит lang сам', () => {
    expect(code('components/NewsBody.tsx')).toMatch(/lang=\{textLangOn\(locale, blocksToText\(blocks\)\)\}/)
  })
})
