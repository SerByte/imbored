import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { bounceTo, DESTINATIONS, destinationPath } from './destination'

/**
 * Сторож разворота гостя.
 *
 * Половина продукта требует подключённой библиотеки, и пять экранов из шести
 * разворачивали гостя на лендинг молча. Теперь лендинг называет место, куда
 * человек шёл, и туда же возвращает после подключения — а значит по строке
 * запроса начал ездить адрес перехода. Это ровно та конструкция, которой
 * бывает открытый редирект, поэтому проверок здесь две: что список закрыт и
 * что в нём нет дыр.
 */

const ROOT = path.join(__dirname, '..')

describe('разворот гостя на лендинг', () => {
  test('чужой адрес не проходит ни в каком виде', () => {
    const attempts = [
      '//evil.example',
      'https://evil.example',
      'http://evil.example',
      '/library/../../etc',
      '/LIBRARY',
      '/library?x=1',
      '/library#a',
      '\\\\evil.example',
      '/api/auth/logout',
      '/room/ABCDEF',
      '',
      ' ',
      null,
      undefined,
    ]
    for (const raw of attempts) {
      expect(destinationPath(raw), `пропущен ${JSON.stringify(raw)}`).toBeNull()
      expect(bounceTo(raw as string), `bounceTo пропустил ${JSON.stringify(raw)}`).toBe('/')
    }
  })

  test('свои адреса проходят и кодируются', () => {
    for (const p of Object.keys(DESTINATIONS)) {
      expect(destinationPath(p)).toBe(p)
      expect(bounceTo(p)).toBe(`/?next=${encodeURIComponent(p)}`)
    }
  })

  /**
   * Прототипные ключи — классический способ обойти проверку «есть ли такой
   * ключ»: у объектного литерала есть toString, constructor и прочее наследство.
   */
  test('наследованные ключи не считаются адресами', () => {
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(destinationPath(key), `пропущен ${key}`).toBeNull()
    }
  })

  test('у каждого адреса есть и обещание, и подпись кнопки', () => {
    for (const [p, d] of Object.entries(DESTINATIONS)) {
      expect(d.promise.length, `${p}: пустое обещание`).toBeGreaterThan(20)
      expect(d.action.length, `${p}: пустая подпись`).toBeGreaterThan(3)
      /*
       * Подпись кнопки называет ДЕЙСТВИЕ, а не место: «Открыть библиотеку», а
       * не «Библиотека». Проверяется первым словом — русский инфинитив всегда
       * кончается на «ть». Через \b это не выразить: в JS границей слова
       * считаются только латиница и цифры, и на кириллице она никогда не
       * срабатывает (на этом и попался первый вариант проверки).
       */
      expect(d.action.split(' ')[0], `${p}: подпись не начинается с глагола`).toMatch(/ть$/)
    }
  })

  /**
   * Каждый разворот обязан говорить, куда он ведёт. Пустой redirect('/') и
   * router.push('/') — это и есть то самое молчание, ради устранения которого
   * всё затевалось; вернуться оно может одной невнимательной правкой.
   */
  test('в приложении не осталось молчаливых разворотов на лендинг', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) {
          const src = fs.readFileSync(p, 'utf8')
          // SignOut разворачивает НАМЕРЕННО без назначения: человек только что
          // вышел, возвращать его туда, откуда он вышел, — бессмыслица.
          if (p.endsWith(path.join('components', 'SignOut.tsx'))) continue
          for (const m of src.matchAll(/(?:redirect|router\.(?:push|replace))\(\s*'\/'\s*\)/g)) {
            offenders.push(`${path.relative(ROOT, p)}: ${m[0]}`)
          }
        }
      }
    }
    for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
    expect(offenders, 'вместо этого bounceTo(<куда шёл человек>)').toEqual([])
  })
})
