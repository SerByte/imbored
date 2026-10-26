import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { VIBE_TAGS } from './mood'
import { TIME_TAGS } from './recommend'
import { TAG_PRIOR } from './semantics'
import { hasTagRu, tagLabel, tagRu } from './tagsru'
import { TAGS_RU_OVERRIDES } from './tagsru.overrides'
import { TAGS_RU_STEAM } from './tagsru.steam'

describe('tagLabel', () => {
  test('на английском — сам тег Steam, без пробелов по краям', () => {
    expect(tagLabel('Roguelike', 'en')).toBe('Roguelike')
    expect(tagLabel('Dystopian ', 'en')).toBe('Dystopian')
    expect(tagLabel('Тег без перевода', 'en')).toBe('Тег без перевода')
  })

  test('на русском — ровно tagRu', () => {
    for (const tag of ['Roguelike', 'Dystopian ', 'Souls-like', 'Нет такого тега']) {
      expect(tagLabel(tag, 'ru'), tag).toBe(tagRu(tag))
    }
  })

  test('без языка — русский: вызывающий, который язык не прокидывает, получает tagRu', () => {
    for (const tag of ['Roguelike', 'Dystopian ', 'Character Action Game']) {
      expect(tagLabel(tag), tag).toBe(tagRu(tag))
    }
  })

  test('на английском — без кириллицы для любого тега словаря', () => {
    const keys = [...Object.keys(TAGS_RU_STEAM), ...Object.keys(TAGS_RU_OVERRIDES)]
    expect(keys.filter((t) => /[А-Яа-яЁё]/.test(tagLabel(t, 'en')))).toEqual([])
  })
})

describe('tagRu', () => {
  test('переводит по английскому ключу', () => {
    expect(tagRu('Roguelike')).toBe('Рогалик')
    expect(tagRu('Open World')).toBe('Открытый мир')
  })

  test('поправка сильнее словаря Steam', () => {
    expect(TAGS_RU_STEAM['Character Action Game']).toBe('Яркий главный герой')
    expect(tagRu('Character Action Game')).toBe(TAGS_RU_OVERRIDES['Character Action Game'])
  })

  test('незнакомый тег остаётся английским, а не пропадает', () => {
    expect(tagRu('Brand New Steam Tag')).toBe('Brand New Steam Tag')
    expect(hasTagRu('Brand New Steam Tag')).toBe(false)
  })

  test('пробел в хвосте ключа, как у Steam, перевод не ломает', () => {
    // так лежит в tags_json: имя из словаря Steam, с его пробелом
    expect(tagRu('Dystopian ')).toBe('Антиутопия')
  })

  test('имена из прототипа объекта — не подписи', () => {
    expect(tagRu('constructor')).toBe('constructor')
    expect(hasTagRu('toString')).toBe(false)
  })

  /*
   * Настроение и длина сессии — то, что человек выбирает в квизе, и то, что
   * потом называет карточка. Тег из этих списков без перевода вылез бы
   * английским ровно там, где продукт объясняет свой выбор.
   */
  test('у каждого тега настроения и длины сессии есть перевод', () => {
    const lists = [...Object.values(VIBE_TAGS), ...Object.values(TIME_TAGS)].flat()
    expect(lists.filter((t) => !hasTagRu(t))).toEqual([])
  })

  test('у каждого тега приора семантики есть перевод', () => {
    // Приор обещает имена «ровно как в Steam» — перевод заодно это проверяет
    expect(Object.keys(TAG_PRIOR).filter((t) => !hasTagRu(t))).toEqual([])
  })

  test('поправки — только к тегам, которые в словаре Steam есть', () => {
    // Иначе это опечатка в ключе, и поправка молча не сработала бы
    const unknown = Object.keys(TAGS_RU_OVERRIDES).filter((t) => !(t in TAGS_RU_STEAM))
    expect(unknown).toEqual([])
  })
})

/**
 * Сторож мест вывода: теги рисуются подписью, а не ключом.
 *
 * Перевод держится на том, что его зовут на месте вывода, — и новый экран,
 * нарисовавший meta.tags как есть, вернул бы английские теги, не сломав ни
 * одного теста поведения. Поэтому здесь не поведение, а текст.
 *
 * Подпись — tagRu или tagLabel (та же tagRu на русском и сам тег на
 * английском): файл, переведённый на язык страницы, зовёт tagLabel, и
 * сторожу всё равно, какой из двух, — лишь бы не голый ключ.
 */
describe('теги выводятся по-русски', () => {
  const ROOT = path.join(__dirname, '..')
  const WHERE = [
    'components/TagChips.tsx',
    'components/SwipeDeck.tsx',
    'app/[lang]/game/[appid]/page.tsx',
    'app/[lang]/compat/[steamid]/page.tsx',
    'app/[lang]/play/page.tsx',
    'lib/landing.ts',
    'lib/llm.ts',
    'lib/jsonld.ts',
    // «Какого тега нет у…» в викторине пати — варианты ответа это теги
    'lib/trivia.ts',
  ]
  for (const file of WHERE) {
    test(file, () => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(src, `${file}: тег без tagRu или tagLabel вернулся бы ключом`).toMatch(/\b(tagRu|tagLabel)\b/)
    })
  }
})
