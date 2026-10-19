import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { cyrillicRuns } from './cyrillicruns'
import { withForeignRuns } from './textlang'

/**
 * Русские куски английской строки, которую сервер собрал из ников и
 * названий (экран приглашения в пати). Кусок — от русской буквы до русской
 * буквы; слова английского шаблона его обрывают и в него не попадают.
 */
describe('cyrillicRuns', () => {
  test('ник целиком — с пробелом внутри, обычным и неразрывным', () => {
    expect(cyrillicRuns("Вася Пупкин wants to pick tonight's game")).toEqual(['Вася Пупкин'])
    expect(cyrillicRuns('Already here: Вася Пупкин and Leo')).toEqual(['Вася Пупкин'])
  })

  test('слова шаблона рвут кусок, запятая между русскими никами — нет', () => {
    expect(cyrillicRuns('Already here: Вася, Демо and Петя')).toEqual(['Вася, Демо', 'Петя'])
    expect(cyrillicRuns('Already here: Вася, Demo player and 2 more')).toEqual(['Вася'])
  })

  test('многоточие обрезки — хвост ника, точка и кавычки фразы — нет', () => {
    expect(cyrillicRuns('Already here: Константин Констант… and Leo')).toEqual(['Константин Констант…'])
    expect(cyrillicRuns('First card: “Вальхейм”. Not into it?')).toEqual(['Вальхейм'])
  })

  test('смешанный ник — русская часть своим куском, латинская остаётся английской', () => {
    expect(cyrillicRuns('Вася_Pro99 wants to pick')).toEqual(['Вася'])
    expect(cyrillicRuns('xX_Вася_Xx and Leo')).toEqual(['Вася'])
  })

  test('нечего метить — пустой список, строка остаётся строкой', () => {
    expect(cyrillicRuns('Already here: Demo player and Leo')).toEqual([])
    const en = "Leo wants to pick tonight's game"
    expect(withForeignRuns('en', en, cyrillicRuns(en))).toBe(en)
  })

  test('с withForeignRuns: на /en каждый кусок — своим lang, на русской — строка как есть', () => {
    const line = 'Already here: Вася Пупкин, Demo player and Костя'
    expect(renderToStaticMarkup(createElement('p', null, withForeignRuns('en', line, cyrillicRuns(line))))).toBe(
      '<p>Already here: <span lang="ru">Вася Пупкин</span>, Demo player and <span lang="ru">Костя</span></p>',
    )
    const ru = 'Уже здесь: Вася Пупкин и Костя'
    expect(withForeignRuns('ru', ru, cyrillicRuns(ru))).toBe(ru)
  })
})
