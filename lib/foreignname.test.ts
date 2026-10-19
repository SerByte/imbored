import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LocaleProvider } from '@/components/LocaleProvider'
import { SplitHeading } from '@/components/SplitHeading'

/**
 * Русское название игры и русский ник на /en — чужой текст (WCAG 3.1.2):
 * английский голос скринридера читает кириллицу по буквам. Каталог хранит
 * часть названий только по-русски («Одни из нас™: Часть II Обновленная
 * версия», «Marvel Человек-Паук 2»), а ники аудитории — чаще русские, чем
 * нет. Правило одно — langOn из lib/textlang: lang="ru" на /en, когда
 * кириллицы в тексте не меньше латиницы; на русской странице атрибута нет, как не
 * было, — русская разметка прежняя до байта.
 */

const ROOT = path.join(__dirname, '..')

/** Исходник без комментариев: сторож читает код, а не докблок о нём */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function heading(locale: 'ru' | 'en' | null, name: string): string {
  const el = createElement(SplitHeading, null, name)
  if (!locale) return renderToStaticMarkup(el)
  return renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, el))
}

const RU_NAME = 'Одни из нас™: Часть II Обновленная версия'
const EN_NAME = 'The Last of Us™ Part II Remastered'

describe('SplitHeading: заголовок из названия или ника', () => {
  /*
   * Герой /play и /daily (HeroTitle), матч, обложка «Что нового», портрет:
   * текст заголовка — в aria-label на теге, слова под ним скрыты, так что
   * lang на самом теге закрывает разом и то, что слышно, и то, что видно.
   */
  test('на /en русское название — lang="ru" на самом заголовке', () => {
    const html = heading('en', RU_NAME)
    expect(html).toMatch(/^<h1 class="" lang="ru" aria-label="Одни из нас™: Часть II Обновленная версия">/)
    expect(html).toContain('<span aria-hidden="true" class="split-word">Одни</span>')
  })

  test('на /en латинское название — без атрибута, наследует en страницы', () => {
    expect(heading('en', EN_NAME)).toMatch(/^<h1 class="" aria-label="The Last of Us™ Part II Remastered">/)
  })

  test('на русской странице — разметка прежняя до байта, с провайдером и без', () => {
    for (const name of [RU_NAME, EN_NAME]) {
      expect(heading('ru', name), name).toBe(heading(null, name))
      expect(heading('ru', name), name).not.toContain('lang=')
    }
  })
})

describe('строки с названием и ником на /en помечены', () => {
  /*
   * Поиск по каталогу находит игру и по русскому названию («рагнарёк»):
   * главное название строки бывает русским само, не только второй ряд
   * алиаса. Своим узлом — только когда помечать есть что: русская строка
   * списка — тот же текстовый узел, что был.
   */
  test('окно поиска: главное название строки — через langOn', () => {
    const src = code('components/CatalogSearch.tsx')
    expect(src).toMatch(/import \{ langOn \} from '@\/lib\/textlang'/)
    expect(src).toContain('{langOn(locale, g.name) ? <span lang="ru">{g.name}</span> : g.name}')
    // голого {g.name} в строке списка не осталось
    expect(src.match(/\{g\.name\}/g)).toHaveLength(1)
  })

  /*
   * «Welcome back, Тестовый Игрок.» — единственное место личных экранов, где
   * ник шёл без пометки: портрет, итоги года и совместимость зовут langOn.
   */
  test('приветствие на главной: ник из Steam — через langOn', () => {
    const src = code('components/landing/ConnectCard.tsx')
    expect(src).toMatch(/import \{ langOn \} from '@\/lib\/textlang'/)
    expect(src).toContain(
      '<span lang={langOn(locale, view.personaName)} className="font-semibold">{view.personaName}</span>',
    )
  })
})
