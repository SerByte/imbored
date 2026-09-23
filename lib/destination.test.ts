import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  bounceTo,
  DESTINATIONS,
  destinationPath,
  destinationUrl,
  GUEST_BOUNCE,
  guestBounce,
  loginCarry,
  loginTarget,
  steamLoginFor,
} from './destination'
import { playHref, presetHref, VIBE_PRESETS } from './presets'

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
      '/library#a',
      '/play#x?time=short',
      '/play/?time=short',
      '//evil.example?next=/play',
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
      expect(destinationUrl(raw), `destinationUrl пропустил ${JSON.stringify(raw)}`).toBeNull()
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

/**
 * Разворот до рендера — в proxy.ts. Страница с loading.tsx успевала отдать
 * каркас со статусом 200 раньше, чем её redirect() прочёл куку.
 */
describe('гость разворачивается до рендера', () => {
  test('без сессии хабы уводят на лендинг и помнят, куда человек шёл', () => {
    expect(guestBounce('/library', false)).toBe('/?next=%2Flibrary')
    expect(guestBounce('/compat', false)).toBe('/?next=%2Fcompat')
    expect(guestBounce('/portrait', false)).toBe('/?next=%2Fportrait')
  })

  test('с сессией пропускает — подпись проверит сама страница', () => {
    for (const p of GUEST_BOUNCE) expect(guestBounce(p, true), p).toBeNull()
  })

  test('личные страницы по ссылке из чата открываются без сессии', () => {
    expect(guestBounce('/compat/76561197960287930', false)).toBeNull()
    expect(guestBounce('/portrait/76561197960287930', false)).toBeNull()
    expect(guestBounce('/', false)).toBeNull()
    expect(guestBounce('/game/730', false)).toBeNull()
    // похожее на хаб — не хаб
    expect(guestBounce('/libraryx', false)).toBeNull()
    expect(guestBounce('/compat/', false)).toBeNull()
  })

  /**
   * Прокси разворачивает только туда, где лендинг знает, что сказать: адрес без
   * записи в DESTINATIONS bounceTo свёл бы к голому «/» — ровно то молчание,
   * ради которого всё затевалось.
   */
  test('каждый хаб — место назначения лендинга', () => {
    for (const p of GUEST_BOUNCE) expect(Object.hasOwn(DESTINATIONS, p), p).toBe(true)
  })

  /**
   * Сама страница по-прежнему разворачивает: без неё протухшая кука (прокси
   * видит только её наличие) оставила бы человека на пустой странице.
   */
  test('страницы-хабы сохраняют свой redirect(bounceTo) на случай мёртвой куки', () => {
    const pages: Record<string, string> = {
      '/library': path.join('app', 'library', 'page.tsx'),
      '/compat': path.join('app', 'compat', 'page.tsx'),
      '/portrait': path.join('app', 'portrait', 'page.tsx'),
    }
    expect(Object.keys(pages).sort()).toEqual([...GUEST_BOUNCE].sort())
    for (const [p, file] of Object.entries(pages)) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(src, file).toContain(`bounceTo('${p}')`)
    }
  })
})

/**
 * Что едет через вход в Steam. Одна функция на старт, успех и каждый отказ:
 * раньше отказы теряли код пати, и приглашённый со скрытой библиотекой после
 * второй попытки попадал на /quiz вместо комнаты.
 */
describe('вход через Steam помнит, куда человек шёл', () => {
  const q = (s: string) => new URLSearchParams(s)

  test('пати важнее совместимости, совместимость важнее next', () => {
    expect(loginCarry(q('join=ABC123&compat=76561197960287930&next=%2Fdaily')).toString()).toBe('join=ABC123')
    expect(loginCarry(q('compat=76561197960287930&next=%2Fdaily')).toString()).toBe(
      'compat=76561197960287930',
    )
    expect(loginCarry(q('next=%2Fdaily')).toString()).toBe('next=%2Fdaily')
    expect(loginCarry(q('')).toString()).toBe('')
  })

  test('едет только проверенное', () => {
    // кривой код пати не перебивает честный next
    expect(loginCarry(q('join=abc123&next=%2Fdaily')).toString()).toBe('next=%2Fdaily')
    expect(loginCarry(q('join=ABC12')).toString()).toBe('')
    expect(loginCarry(q('compat=123')).toString()).toBe('')
    expect(loginCarry(q('next=%2F%2Fevil.example')).toString()).toBe('')
    // служебное — state, openid.*, error — не едет никогда
    expect(loginCarry(q('state=abc&error=auth&openid.mode=id_res')).toString()).toBe('')
  })

  test('после входа — туда же', () => {
    expect(loginTarget(q('join=ABC123&state=x'))).toBe('/room/ABC123')
    expect(loginTarget(q('compat=76561197960287930'))).toBe('/compat/76561197960287930')
    expect(loginTarget(q('next=%2Fdaily'))).toBe('/daily')
    expect(loginTarget(q('next=https%3A%2F%2Fevil.example'))).toBe('/quiz')
    expect(loginTarget(q(''))).toBe('/quiz')
  })
})

/**
 * Подсказка «войди через Steam» у сессии, которой писать нельзя. Возврат идёт
 * через тот же loginTarget, что и у обычного входа, поэтому проверяем круг
 * целиком: ссылка → query возврата → адрес, куда человека приведут.
 */
describe('вход через Steam из подсказки возвращает на место', () => {
  const back = (href: string) => loginTarget(new URLSearchParams(href.split('?')[1] ?? ''))

  test('выдача, библиотека, новая комната и своя комната', () => {
    for (const where of ['/play', '/library', '/room/new', '/room/ABC234']) {
      const href = steamLoginFor(where)
      expect(href.startsWith('/api/auth/steam'), where).toBe(true)
      expect(back(href), where).toBe(where)
    }
  })

  test('комната едет кодом, а не адресом', () => {
    expect(steamLoginFor('/room/ABC234')).toBe('/api/auth/steam?join=ABC234')
  })

  test('чужое и незнакомое — голый вход, без next', () => {
    for (const where of ['/rooms', '//evil.example', '/room/abc234', '/room/ABC234/x', '']) {
      expect(steamLoginFor(where), where).toBe('/api/auth/steam')
    }
  })
})

/**
 * Настроение квиза через вход.
 *
 * Гость отвечал на три вопроса, /play разворачивал его на лендинг голым
 * next=/play — и после входа выдача собиралась по дефолтному настроению.
 * Проверяем круг целиком: разворот → лендинг → вход в Steam → возврат, и
 * отдельно — что по дороге не пролезает ничего, кроме проверенного.
 */
describe('ответы квиза переживают вход', () => {
  const QUIZ = playHref(
    { time: 'short', vibe: 'engaged', social: 'friends' },
    { lean: 'fresh', roulette: true, focus: 'untouched' },
  )
  const query = (href: string) => new URLSearchParams(href.split('?')[1] ?? '')

  test('адрес квиза и пресетов проходит без изменений', () => {
    expect(destinationUrl(QUIZ)).toBe(QUIZ)
    for (const p of VIBE_PRESETS) expect(destinationUrl(presetHref(p)), p.label).toBe(presetHref(p))
  })

  test('разворот с /play → лендинг → Steam → та же выдача', () => {
    const landing = bounceTo('/play', query(QUIZ))
    const next = query(landing).get('next')
    expect(destinationPath(next), 'лендинг должен узнать место и показать его обещание').toBe('/play')
    // Карточка входа кладёт next как есть, старт входа пропускает его через loginCarry
    const start = loginCarry(new URLSearchParams({ next: next ?? '' }))
    // Steam возвращает тот же query плюс state и openid.*
    const back = new URLSearchParams(start)
    back.set('state', 'x')
    back.set('openid.mode', 'id_res')
    expect(loginTarget(back)).toBe(QUIZ)
  })

  test('мусор в параметрах отбрасывается, проверенное остаётся', () => {
    expect(destinationUrl('/play?time=short&vibe=chill&social=solo&x=%3Cscript%3E')).toBe(
      '/play?time=short&vibe=chill&social=solo',
    )
    // половина настроения — не настроение: дефолты подставит сама выдача
    expect(destinationUrl('/play?time=short&vibe=chill')).toBe('/play')
    expect(destinationUrl('/play?time=forever&vibe=chill&social=solo&lean=fresh')).toBe(
      '/play?lean=fresh',
    )
    expect(destinationUrl('/play?roulette=yes&from=elsewhere&lean=rage')).toBe('/play')
    expect(destinationUrl('/play?next=%2F%2Fevil.example')).toBe('/play')
    expect(destinationUrl('/play?time=short#&vibe=chill&social=solo')).toBe('/play')
    // хвост бывает только у выдачи: у остальных мест он отбрасывается, место остаётся
    expect(destinationUrl('/library?x=1')).toBe('/library')
    expect(destinationUrl('/daily?time=short&vibe=chill&social=solo')).toBe('/daily')
  })

  test('подсказка «войди через Steam» на выдаче везёт настроение', () => {
    expect(loginTarget(query(steamLoginFor(QUIZ)))).toBe(QUIZ)
  })

  test('/play без строки запроса — как раньше', () => {
    expect(bounceTo('/play', new URLSearchParams())).toBe('/?next=%2Fplay')
    expect(bounceTo('/play', null)).toBe('/?next=%2Fplay')
    expect(steamLoginFor('/play?')).toBe('/api/auth/steam?next=%2Fplay')
  })
})
