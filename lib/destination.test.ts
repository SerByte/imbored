import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  bounceTo,
  DESTINATION_PATHS,
  destinationPath,
  destinationUrl,
  GUEST_BOUNCE,
  GUEST_HUBS,
  guestBounce,
  loginCarry,
  loginTarget,
  reconnectHref,
  steamLoginFor,
} from './destination'
import { destinationFor, destinationPromise, DESTINATIONS, destinations } from './destinationtext'
import { playHref, presetHref, ROOM_PRESETS, roomBridgeHref, VIBE_PRESETS } from './presets'

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
    for (const p of DESTINATION_PATHS) {
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

  /**
   * Адреса и тексты лендинга живут в разных модулях (тексты — не в первой
   * загрузке каждой страницы, см. lib/destinationtext.ts). Тип satisfies там
   * держит их вместе при сборке, а это — то же для тех, кто тип обойдёт.
   */
  test('текст есть ровно у каждого адреса — не больше и не меньше', () => {
    expect(Object.keys(DESTINATIONS).sort()).toEqual([...DESTINATION_PATHS].sort())
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
          // ForgetMe — по той же причине: после «Удалить всё обо мне» идти
          // некуда, кроме главной. Но его разворот не молчит, пока перед ним
          // стоит метка удаления: строку «всё удалено» зажигает она
          // (lib/forgotnotice), а не адрес — /?forgot=1 жил бы в истории и
          // звучал через месяц снова. Без метки — такой же нарушитель
          if (p.endsWith(path.join('components', 'SignOut.tsx'))) continue
          if (
            p.endsWith(path.join('components', 'ForgetMe.tsx')) &&
            /markForgot\(\)\s*(?:\/\/.*\s*)*router\.replace\(\s*'\/'\s*\)/.test(src)
          ) {
            continue
          }
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
    // английский хаб — на английский лендинг, next — адрес без языка
    expect(guestBounce('/en/library', false)).toBe('/en?next=%2Flibrary')
    expect(guestBounce('/en/compat', false)).toBe('/en?next=%2Fcompat')
    expect(guestBounce('/en/portrait', false)).toBe('/en?next=%2Fportrait')
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
    expect(guestBounce('/en/compat/76561197960287930', false)).toBeNull()
    expect(guestBounce('/en', false)).toBeNull()
  })

  /**
   * Прокси разворачивает только туда, где лендинг знает, что сказать: адрес не
   * из DESTINATION_PATHS bounceTo свёл бы к голому «/» — ровно то молчание,
   * ради которого всё затевалось.
   */
  test('каждый хаб — место назначения лендинга', () => {
    for (const p of GUEST_HUBS) {
      expect((DESTINATION_PATHS as readonly string[]).includes(p), p).toBe(true)
      expect(Object.hasOwn(DESTINATIONS, p), `${p}: нет текста лендинга`).toBe(true)
    }
  })

  /*
   * Клиентские страницы разворачивают сами, после 401 от своего API, — и
   * разворот обязан ЗАМЕНИТЬ их запись в истории, а не добавить лендинг
   * поверх. С push история была [..., откуда пришёл, /daily, /?next=…]:
   * «Назад» с лендинга открывал /daily, тот снова получал 401 и снова уводил
   * на лендинг, стирая «вперёд». Гость не мог уйти «Назад» дальше /daily —
   * к той странице, откуда пришёл. Запись без сессии мертва, её не жалко.
   *
   * /play и /explore чинили по отдельности, и /daily с тем же узором
   * остался на push. Поэтому сторож — один на все три, со счётом мест:
   * разворот на входе и разворот после прогрева у каждой свои.
   *
   * /room/new здесь нет намеренно: там разворот — ответ на «Создать
   * комнату», а не на открытие страницы, и запись /room/new без ?preset=
   * живая — «Назад» с лендинга возвращает к выбору настроения, а не в новый
   * разворот.
   */
  test('клиентские страницы разворачивают гостя заменой записи, а не новой', () => {
    /** Комментарии гасятся: докблоки цитируют сами правила */
    const code = (file: string) =>
      fs
        .readFileSync(path.join(ROOT, 'app', '[lang]', file, 'page.tsx'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const pages = [
      ['play', "router.replace(bounceTo('/play', search))"],
      ['explore', "router.replace(bounceTo('/explore'))"],
      ['daily', "router.replace(bounceTo('/daily'))"],
    ] as const
    for (const [file, call] of pages) {
      const src = code(file)
      expect(src.match(/router\.push\(bounceTo\([^\n]*/g) ?? [], `app/[lang]/${file}: разворот push'ем`).toEqual([])
      expect(src.split(call).length - 1, `app/[lang]/${file}: оба разворота — заменой`).toBe(2)
    }
  })

  /**
   * Сама страница по-прежнему разворачивает: без неё протухшая кука (прокси
   * видит только её наличие) оставила бы человека на пустой странице.
   */
  test('страницы-хабы сохраняют свой redirect(bounceTo) на случай мёртвой куки', () => {
    const pages: Record<string, string> = {
      '/library': path.join('app', '[lang]', 'library', 'page.tsx'),
      '/compat': path.join('app', '[lang]', 'compat', 'page.tsx'),
      '/portrait': path.join('app', '[lang]', 'portrait', 'page.tsx'),
    }
    expect(Object.keys(pages).sort()).toEqual([...GUEST_HUBS].sort())
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

  test('выдача, библиотека, новая комната, своя комната и лента патчей', () => {
    for (const where of ['/play', '/library', '/room/new', '/room/ABC234', '/whatsnew']) {
      const href = steamLoginFor(where)
      expect(href.startsWith('/api/auth/steam'), where).toBe(true)
      expect(back(href), where).toBe(where)
    }
  })

  /*
   * Секретную ссылку на RSS выпускает только вошедший через Steam, и сессия
   * по ссылке на профиль получает на /whatsnew строку «Войти через Steam».
   * Голый вход уводил после возврата на /quiz — прочь от ссылки, ради которой
   * входили.
   */
  test('лента патчей: next=/whatsnew переживает вход и отказ, вкладка — нет', () => {
    expect(steamLoginFor('/whatsnew')).toBe('/api/auth/steam?next=%2Fwhatsnew')
    // Отказ входа (?error=private) везёт то же, что и старт: loginCarry
    expect(loginCarry(new URLSearchParams('next=%2Fwhatsnew&error=private')).toString()).toBe(
      'next=%2Fwhatsnew',
    )
    // Хвоста у ленты нет: ?feed=popular — та же страница, и через вход не едет
    expect(steamLoginFor('/whatsnew?feed=popular')).toBe('/api/auth/steam?next=%2Fwhatsnew')
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

  // «Похожее на X — под моё настроение» со страницы игры: гость проходит квиз,
  // /play разворачивает его на вход — и после входа выдача обязана быть
  // соседями X, а не обычной
  test('затравка «Как «X», но…» переживает вход, мусор в ней — нет', () => {
    const seeded = playHref({ time: 'short', vibe: 'chill', social: 'solo' }, { lean: 'fresh', seed: 1145360 })
    expect(destinationUrl(seeded)).toBe(seeded)
    const next = query(bounceTo('/play', query(seeded))).get('next')
    expect(loginTarget(new URLSearchParams(loginCarry(new URLSearchParams({ next: next ?? '' }))))).toBe(seeded)
    expect(loginTarget(query(steamLoginFor(seeded)))).toBe(seeded)
    expect(destinationUrl('/play?seed=-12')).toBe('/play?seed=-12')
    for (const junk of ['0', '12abc', '1e3', '', '9007199254740993']) {
      expect(destinationUrl(`/play?seed=${junk}`), junk).toBe('/play')
    }
  })

  // «Подобрать рогалики из своей библиотеки» со страницы жанра: гость
  // проходит квиз, /play разворачивает его на вход — и после входа выдача
  // обязана быть рогаликами. Мусор (не адрес страницы) отбрасывается здесь
  test('жанр переживает вход, мусор в нём — нет', () => {
    const genred = playHref({ time: 'short', vibe: 'chill', social: 'solo' }, { lean: 'fresh', genre: 'roguelike' })
    expect(genred).toBe('/play?time=short&vibe=chill&social=solo&lean=fresh&genre=roguelike')
    expect(destinationUrl(genred)).toBe(genred)
    const next = query(bounceTo('/play', query(genred))).get('next')
    expect(loginTarget(new URLSearchParams(loginCarry(new URLSearchParams({ next: next ?? '' }))))).toBe(genred)
    expect(loginTarget(query(steamLoginFor(genred)))).toBe(genred)
    expect(destinationUrl('/play?genre=point-and-click')).toBe('/play?genre=point-and-click')
    for (const junk of ['Roguelike', 'point & click', '-x', 'a--b', '', 'x'.repeat(41), '//evil.example']) {
      expect(destinationUrl(`/play?genre=${encodeURIComponent(junk)}`), junk).toBe('/play')
    }
  })

  test('/play без строки запроса — как раньше', () => {
    expect(bounceTo('/play', new URLSearchParams())).toBe('/?next=%2Fplay')
    expect(bounceTo('/play', null)).toBe('/?next=%2Fplay')
    expect(steamLoginFor('/play?')).toBe('/api/auth/steam?next=%2Fplay')
  })
})

/**
 * Квиз гостя кончается честным последним шагом.
 *
 * Гость отвечал на три вопроса, квиз вёл его на /play, тот показывал экран
 * прогрева и через круг до сервера (401) разворачивал на лендинг — а
 * лендинг встречал общим обещанием выдачи, как будто трёх ответов не было.
 * Теперь квиз, знающий, что перед ним гость (knownGuest в lib/sessionhint),
 * ведёт на лендинг сам, а лендинг повторяет сказанное: «Пара часов ·
 * Расслабиться · Один — запомнили».
 */
describe('квиз гостя: сразу на лендинг, и лендинг помнит ответы', () => {
  const query = (href: string) => new URLSearchParams(href.split('?')[1] ?? '')
  const MOOD = { time: 'medium', vibe: 'chill', social: 'solo' } as const
  /** Что увидит гость над заголовком после такого разворота */
  const landingSays = (landing: string) => destinationPromise(destinationUrl(query(landing).get('next')))

  /*
   * Квиз разворачивает сам — и обязан развернуть ровно туда же, куда
   * развернул бы /play: настроение, ось, затравка, рулетка и фокус едут
   * через вход и после него собирают ту же выдачу.
   */
  test('разворот квиза — тот же адрес, что у /play, со всем запросом', () => {
    for (const href of [
      playHref(MOOD),
      playHref({ time: 'short', vibe: 'engaged', social: 'friends' }, { lean: 'fresh' }),
      playHref(MOOD, { seed: 1145360 }),
      playHref(MOOD, { genre: 'roguelike' }),
      playHref(MOOD, { roulette: true }),
      playHref(MOOD, { focus: 'untouched' }),
      ...VIBE_PRESETS.map((p) => presetHref(p)),
    ]) {
      expect(bounceTo(href), href).toBe(bounceTo('/play', query(href)))
      expect(loginTarget(query(bounceTo(href))), href).toBe(href)
    }
  })

  test('ответы квиза — над заголовком лендинга', () => {
    expect(landingSays(bounceTo(playHref(MOOD)))).toBe(
      'Пара часов · Расслабиться · Один — запомнили. Остался последний шаг: подключи Steam, и выберем одну игру из твоей библиотеки.',
    )
    // ось и затравка ответ не отменяют: настроение сказано
    const seeded = playHref({ time: 'long', vibe: 'engaged', social: 'friends' }, { lean: 'fresh', seed: 1145360 })
    expect(landingSays(bounceTo(seeded))).toMatch(/^Весь вечер · Напрячься · С друзьями — запомнили\./)
    for (const p of VIBE_PRESETS) {
      expect(landingSays(bounceTo(presetHref(p))), p.label).toMatch(/ — запомнили\. /)
    }
  })

  /*
   * «Мне повезёт» и «Ни разу не запускал» настроение выбирают за человека —
   * кубиком и дефолтом. «Запомнили» про то, чего он не говорил, было бы
   * неправдой: им — общее обещание выдачи.
   */
  test('рулетка, «нераспакованное» и неполное настроение — общее обещание', () => {
    const general = DESTINATIONS['/play'].promise
    expect(landingSays(bounceTo(playHref(MOOD, { roulette: true })))).toBe(general)
    expect(landingSays(bounceTo(playHref(MOOD, { focus: 'untouched' })))).toBe(general)
    expect(destinationPromise('/play?time=short&vibe=chill')).toBe(general)
    expect(destinationPromise('/play')).toBe(general)
  })

  test('остальные места — свои обещания, чужое — ничего', () => {
    for (const p of DESTINATION_PATHS) expect(destinationPromise(p), p).toBe(DESTINATIONS[p].promise)
    expect(destinationPromise('/room/new?preset=quick')).toBe(DESTINATIONS['/room/new'].promise)
    for (const raw of [null, '', '/rooms', 'toString', '__proto__']) {
      expect(destinationPromise(raw), String(raw)).toBeNull()
    }
  })

  /** Исходники — без комментариев: докблоки цитируют сами правила */
  const code = (...p: string[]) =>
    fs
      .readFileSync(path.join(ROOT, ...p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  test('квиз ведёт гостя на лендинг сам, остальных — в выдачу, как раньше', () => {
    const quiz = code('app', '[lang]', 'quiz', 'page.tsx')
    const go = quiz.slice(quiz.indexOf('const go = useCallback('), quiz.indexOf('function pick('))
    expect(go).toMatch(/const href = playHref\(/)
    // push, а не replace: запись квиза живая, «Назад» с лендинга — к ответам
    expect(go).toMatch(/router\.push\(knownGuest\(\) \? bounceTo\(href\) : href\)/)
    expect(go).toContain("track('quiz_done')")
    // и говорит о последнем шаге заранее — только гостю наверняка, только
    // после гидратации (снимок сервера — «не гость»), внизу первого шага
    expect(quiz).toMatch(/const guest = useSyncExternalStore\(subscribeSessionHint, knownGuest, notGuest\)/)
    expect(quiz).toMatch(/const notGuest = \(\) => false/)
    // Строка — на языке страницы (tr), русская ветка — те же слова
    expect(quiz).toMatch(
      /\{stepIndex === 0 && guest && \(\s*<p[^>]*>\s*\{tr\(locale, \{\s*ru: 'Потом останется подключить библиотеку/,
    )
    // вне потока: строка, пришедшая с ответом touch, не двигает вопрос и плитки
    const note = quiz.slice(quiz.indexOf('{stepIndex === 0 && guest && ('), quiz.indexOf('Потом останется'))
    expect(note).toMatch(/className="absolute [^"]*\btop-full\b/)
  })

  test('лендинг берёт обещание у destinationPromise, а не у списка напрямую', () => {
    const notice = code('components', 'landing', 'HeroNotice.tsx')
    // и на языке страницы: второй аргумент — locale из useLocale
    expect(notice).toMatch(/destinationPromise\(destinationUrl\(search\.get\('next'\)\), locale\)/)
    expect(notice).not.toMatch(/\bDESTINATIONS\b/)
  })
})

/**
 * Настроение новой комнаты через вход.
 *
 * Хост выбирает настроение до создания, и если его разворачивает на вход —
 * гостя на лендинг, сессию по ссылке в Steam, — после возврата комната
 * создаётся сразу с выбранным. Без хвоста он отвечал бы на тот же вопрос
 * второй раз.
 */
describe('настроение комнаты переживает вход', () => {
  const query = (href: string) => new URLSearchParams(href.split('?')[1] ?? '')

  test('каждый пресет доезжает через лендинг и через Steam', () => {
    for (const p of ROOM_PRESETS) {
      const here = `/room/new?preset=${p.key}`
      expect(destinationUrl(here), p.key).toBe(here)
      // гость → лендинг → подключение → туда же
      const landing = bounceTo('/room/new', new URLSearchParams({ preset: p.key }))
      expect(destinationPath(query(landing).get('next')), p.key).toBe('/room/new')
      expect(loginTarget(query(landing)), p.key).toBe(here)
      // сессия по ссылке → вход через Steam → туда же
      expect(loginTarget(query(steamLoginFor(here))), p.key).toBe(here)
    }
  })

  test('чужой ключ и посторонние параметры отбрасываются, место остаётся', () => {
    expect(destinationUrl('/room/new?preset=rage')).toBe('/room/new')
    expect(destinationUrl('/room/new?preset=quick&next=%2F%2Fevil.example')).toBe(
      '/room/new?preset=quick',
    )
    // настроение выдачи комнате не хвост
    expect(destinationUrl('/room/new?time=short&vibe=chill&social=friends')).toBe('/room/new')
    // и наоборот: ключ комнаты выдаче не хвост
    expect(destinationUrl('/play?preset=quick')).toBe('/play')
  })

  test('без выбора — как раньше', () => {
    expect(bounceTo('/room/new')).toBe('/?next=%2Froom%2Fnew')
    expect(steamLoginFor('/room/new')).toBe('/api/auth/steam?next=%2Froom%2Fnew')
  })

  /*
   * Подсказка с /play (?hint=) — отмеченный похожий пресет на экране выбора.
   * Без неё гость после входа вернулся бы к выбору без отметки, а мост обещал
   * «похоже на твоё».
   */
  test('подсказка доезжает через лендинг и через Steam наравне с пресетом', () => {
    for (const p of ROOM_PRESETS) {
      const here = `/room/new?hint=${p.key}`
      expect(destinationUrl(here), p.key).toBe(here)
      const landing = bounceTo('/room/new', new URLSearchParams({ hint: p.key }))
      expect(destinationPath(query(landing).get('next')), p.key).toBe('/room/new')
      expect(loginTarget(query(landing)), p.key).toBe(here)
      expect(loginTarget(query(steamLoginFor(here))), p.key).toBe(here)
    }
  })

  test('чужая подсказка отбрасывается; выбранный пресет перекрывает подсказку', () => {
    expect(destinationUrl('/room/new?hint=rage')).toBe('/room/new')
    expect(destinationUrl('/room/new?hint=__proto__')).toBe('/room/new')
    expect(destinationUrl('/room/new?hint=talk&preset=quick')).toBe('/room/new?preset=quick')
    // чужой preset не губит годную подсказку
    expect(destinationUrl('/room/new?preset=rage&hint=talk')).toBe('/room/new?hint=talk')
    // подсказка комнаты выдаче не хвост
    expect(destinationUrl('/play?hint=talk')).toBe('/play')
  })

  /*
   * «Позвать в эту игру»: гость со страницы игры жмёт кнопку, его разворачивает
   * на вход, и после входа комната обязана создаться с той же игрой первой
   * картой, а не без неё.
   */
  test('предложенная игра доезжает через вход — одна и вместе с настроением', () => {
    for (const here of ['/room/new?game=548430', '/room/new?preset=quick&game=548430', '/room/new?hint=talk&game=892970']) {
      expect(destinationUrl(here), here).toBe(here)
      expect(loginTarget(query(steamLoginFor(here))), here).toBe(here)
      const landing = bounceTo('/room/new', new URLSearchParams(here.split('?')[1]))
      expect(loginTarget(query(landing)), here).toBe(here)
    }
  })

  test('чужая игра в адресе отбрасывается, остальное доезжает', () => {
    expect(destinationUrl('/room/new?game=-1')).toBe('/room/new')
    expect(destinationUrl('/room/new?game=abc&preset=quick')).toBe('/room/new?preset=quick')
    expect(destinationUrl('/room/new?game=570%2F..%2F..')).toBe('/room/new')
    // игра комнаты выдаче не хвост
    expect(destinationUrl('/play?game=570')).toBe('/play')
  })

  test('каждый мост с /play переживает вход без изменений', () => {
    for (const time of ['short', 'medium', 'long'] as const) {
      for (const vibe of ['chill', 'engaged'] as const) {
        const href = roomBridgeHref({ time, vibe, social: 'friends' })
        expect(href, `${time}|${vibe}`).not.toBeNull()
        expect(destinationUrl(href), `${time}|${vibe}`).toBe(href)
        expect(loginTarget(query(steamLoginFor(href!))), `${time}|${vibe}`).toBe(href)
      }
    }
  })
})

/**
 * «Подключить заново» вёл на голую главную, а она вошедшему поля не давала:
 * «С возвращением» и кнопка в подбор — туда же, откуда развернуло.
 */
describe('«Подключить заново» ведёт к полю, а не по кругу', () => {
  /** Кнопка «Подключить…», чей адрес — голая главная */
  const BARE = /<Link\s[^>]*href=(?:"\/"|\{'\/'\})[^>]*>\s*Подключить/g

  test('адрес раскрывает поле и везёт совместимость', () => {
    expect(reconnectHref()).toBe('/?reconnect=1')
    expect(reconnectHref({ compat: '76561197960287930' })).toBe(
      '/?compat=76561197960287930&reconnect=1',
    )
    // Чужое в адрес не едет: карточка читает compat как назначение
    expect(reconnectHref({ compat: '../evil' })).toBe('/?reconnect=1')
  })

  /*
   * next — место, откуда пришли за своей библиотекой (полоса демо). После
   * подключения карточка уводит по нему обратно, а не туда, куда поведёт
   * память настроения. Порядок и проверка те же, что у loginCarry.
   */
  test('next везёт место назначения — только из закрытого списка', () => {
    expect(reconnectHref({ next: '/daily' })).toBe('/?next=%2Fdaily&reconnect=1')
    const play = playHref({ time: 'short', vibe: 'chill', social: 'solo' })
    const q = new URLSearchParams(reconnectHref({ next: play }).slice(2))
    expect(destinationUrl(q.get('next'))).toBe(play)
    for (const evil of ['//evil.example', '/rooms', 'https://evil.example/play']) {
      expect(reconnectHref({ next: evil }), evil).toBe('/?reconnect=1')
    }
    // Совместимость важнее — как у loginCarry
    expect(reconnectHref({ compat: '76561197960287930', next: '/daily' })).toBe(
      '/?compat=76561197960287930&reconnect=1',
    )
  })

  test('ни одна кнопка «Подключить…» не ведёт на голую главную', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.tsx')) {
          const src = fs.readFileSync(p, 'utf8')
          for (const m of src.matchAll(BARE)) {
            offenders.push(`${path.relative(ROOT, p)}:${src.slice(0, m.index).split('\n').length}`)
          }
        }
      }
    }
    for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
    expect(offenders, 'вместо href="/" — reconnectHref() из lib/destination').toEqual([])
  })

  test('сторож видит ту самую кнопку', () => {
    const bad = '<Link href="/" className="btn-ember px-6 py-3">\n            Подключить заново\n'
    expect([...bad.matchAll(BARE)]).toHaveLength(1)
  })
})

/**
 * Английская версия. Раньше список знал только русские пути: ?next=/en/play
 * отбрасывался целиком, и гость с английской выдачи после входа попадал на
 * русский квиз. Теперь путь сверяется без префикса языка, а язык едет рядом —
 * в адресе места, в адресе лендинга или параметром lang у входа.
 */
describe('места назначения на английском', () => {
  const query = (href: string) => new URLSearchParams(href.split('?')[1] ?? '')
  const q = (s: string) => new URLSearchParams(s)
  const QUIZ = playHref({ time: 'short', vibe: 'engaged', social: 'friends' }, { lean: 'fresh', seed: 1145360 })

  test('английский адрес места проходит и сохраняет язык; русский — без префикса', () => {
    for (const p of DESTINATION_PATHS) {
      expect(destinationUrl(`/en${p}`), p).toBe(`/en${p}`)
      // место — ключ текстов лендинга, он без языка (см. ниже про кнопку)
      expect(destinationPath(`/en${p}`), p).toBe(p)
      expect(destinationPath(`/en${p}?x=1`), p).toBe(p)
      // так страница русской ветки видит свой путь на сервере (usePathname)
      expect(destinationUrl(`/ru${p}`), p).toBe(p)
    }
    expect(destinationUrl(`/en${QUIZ}`)).toBe(`/en${QUIZ}`)
    expect(destinationUrl('/en/play?time=short&vibe=chill&social=solo&x=%3Cscript%3E')).toBe(
      '/en/play?time=short&vibe=chill&social=solo',
    )
    expect(destinationUrl('/en/library?x=1')).toBe('/en/library')
    expect(destinationUrl('/en/room/new?preset=quick&game=548430')).toBe('/en/room/new?preset=quick&game=548430')
  })

  test('префикс языка не открывает дыр в списке', () => {
    for (const raw of [
      '/en',
      '/en/',
      '/en//evil.example',
      '/en/https://evil.example',
      '/EN/library',
      '/en/LIBRARY',
      '/enx/play',
      '/en-us/play',
      '/de/play',
      '/en/en/play',
      '/en/play/',
      '/en/play#x?time=short',
      '/en/room/ABCDEF',
      '/en/api/auth/logout',
      '/en/toString',
      '/en/__proto__',
      'en/play',
    ]) {
      expect(destinationUrl(raw), raw).toBeNull()
      expect(destinationPath(raw), raw).toBeNull()
    }
  })

  test('лендинг — на языке места, next — без языка', () => {
    expect(bounceTo('/en/library')).toBe('/en?next=%2Flibrary')
    expect(bounceTo('/en/play', query(QUIZ))).toBe(`/en?next=${encodeURIComponent(QUIZ)}`)
    expect(bounceTo(`/en${QUIZ}`)).toBe(bounceTo('/en/play', query(QUIZ)))
    expect(bounceTo('/en/room/new', q('preset=quick'))).toBe('/en?next=%2Froom%2Fnew%3Fpreset%3Dquick')
    // тот же адрес, что у разворота прокси
    for (const hub of GUEST_HUBS) expect(bounceTo(`/en${hub}`), hub).toBe(guestBounce(`/en${hub}`, false))
    // чужое — голая главная того же языка, а не русская
    expect(bounceTo('/en/rooms')).toBe('/en')
    expect(bounceTo('/en//evil.example')).toBe('/en')
    // русский — как был
    expect(bounceTo('/play', query(QUIZ))).toBe(`/?next=${encodeURIComponent(QUIZ)}`)
    expect(bounceTo('/ru/library')).toBe('/?next=%2Flibrary')
  })

  test('вход везёт язык места параметром lang, а next — без языка', () => {
    expect(loginCarry(q('next=%2Fen%2Flibrary')).toString()).toBe('next=%2Flibrary&lang=en')
    expect(loginCarry(q(`next=${encodeURIComponent(`/en${QUIZ}`)}`)).get('next')).toBe(QUIZ)
    // голый ?lang= ставит и читает сам роут: отказ не несёт его в адрес лендинга
    expect(loginCarry(q('next=%2Flibrary&lang=en')).toString()).toBe('next=%2Flibrary')
    expect(loginCarry(q('join=ABC123&lang=en')).toString()).toBe('join=ABC123')
    // пати и совместимость по-прежнему важнее
    expect(loginCarry(q('join=ABC123&next=%2Fen%2Fdaily')).toString()).toBe('join=ABC123')
    // мусор с префиксом — не место
    expect(loginCarry(q('next=%2Fen%2F%2Fevil.example')).toString()).toBe('')
  })

  test('после входа — туда же и на том же языке', () => {
    expect(loginTarget(q('next=%2Fdaily&lang=en'))).toBe('/en/daily')
    expect(loginTarget(q('next=%2Fen%2Fdaily'))).toBe('/en/daily')
    expect(loginTarget(q('join=ABC123&lang=en&state=x'))).toBe('/en/room/ABC123')
    expect(loginTarget(q('compat=76561197960287930&lang=en'))).toBe('/en/compat/76561197960287930')
    expect(loginTarget(q('lang=en'))).toBe('/en/quiz')
    expect(loginTarget(q('next=https%3A%2F%2Fevil.example&lang=en'))).toBe('/en/quiz')
    // чужой язык — русский, как у всего сайта
    expect(loginTarget(q('next=%2Fdaily&lang=de'))).toBe('/daily')
  })

  test('подсказка «войди через Steam» с английской страницы', () => {
    expect(steamLoginFor('/en/library')).toBe('/api/auth/steam?next=%2Flibrary&lang=en')
    expect(steamLoginFor('/en/room/ABC234')).toBe('/api/auth/steam?join=ABC234&lang=en')
    expect(steamLoginFor('/en/whatsnew?feed=popular')).toBe('/api/auth/steam?next=%2Fwhatsnew&lang=en')
    // незнакомое место — голый вход, но на своём языке
    expect(steamLoginFor('/en/game/730')).toBe('/api/auth/steam?lang=en')
    expect(steamLoginFor('/en')).toBe('/api/auth/steam?lang=en')
    // русский путь сервера пререндера — тот же вход, что в браузере
    expect(steamLoginFor('/ru/library')).toBe(steamLoginFor('/library'))
  })

  test('круг целиком: английская страница → Steam → та же английская страница', () => {
    for (const where of [
      '/en/play',
      `/en${QUIZ}`,
      '/en/library',
      '/en/room/new?preset=quick',
      '/en/room/ABC234',
      '/en/whatsnew',
    ]) {
      expect(loginTarget(query(steamLoginFor(where))), where).toBe(where)
    }
  })

  /*
   * Гость с /en/play → /en?next=/play (next без языка) → «Sign in with Steam»
   * на английском лендинге: карточка кладёт next как есть, а язык старт
   * входа берёт из Referer и ставит lang=en сам (app/api/auth/steam). Возврат
   * — снова на английскую выдачу с тем же настроением.
   */
  test('круг через лендинг: next без языка и lang от старта входа', () => {
    const landing = bounceTo('/en/play', query(QUIZ))
    expect(landing.startsWith('/en?')).toBe(true)
    const next = query(landing).get('next')
    const start = loginCarry(new URLSearchParams({ next: next ?? '' }))
    start.set('lang', 'en')
    start.set('state', 'x')
    expect(loginTarget(start)).toBe(`/en${QUIZ}`)
  })

  // ?next=/en/play прямо в адресе лендинга (ссылка извне, старая вкладка):
  // раньше отбрасывался, теперь доезжает на английскую выдачу и без Referer
  test('next с префиксом языка переживает вход и без Referer', () => {
    const start = loginCarry(new URLSearchParams({ next: `/en${QUIZ}` }))
    expect(start.get('lang')).toBe('en')
    expect(loginTarget(start)).toBe(`/en${QUIZ}`)
  })

  /*
   * Карточка входа (components/landing/ConnectCard) ищет кнопку по
   * DESTINATIONS[destinationPath(next)], а строка над заголовком — по
   * destinationPromise(next). На /?next=/en/library место с языком не
   * находилось в текстах: обещание говорило про библиотеку, кнопка — общее
   * «Подобрать игру», а вела в библиотеку. Кнопка, обещание и адрес обязаны
   * называть одно место.
   */
  test('кнопка карточки, обещание и адрес — про одно место и для адреса с языком', () => {
    for (const p of DESTINATION_PATHS) {
      for (const raw of [`/en${p}`, `/ru${p}`, p]) {
        const next = destinationUrl(raw)
        const key = destinationPath(next)
        expect(key, raw).toBe(p)
        const dest = key ? DESTINATIONS[key] : null
        expect(dest, raw).toBe(DESTINATIONS[p])
        expect(destinationFor(next), raw).toBe(dest)
        expect(destinationPromise(next), raw).toBe(dest?.promise)
      }
    }
  })

  test('«Подключить заново» — на главную языка места', () => {
    expect(reconnectHref({ next: '/en/daily' })).toBe('/en?next=%2Fdaily&reconnect=1')
    expect(reconnectHref({ next: `/en${QUIZ}` })).toBe(`/en?next=${encodeURIComponent(QUIZ)}&reconnect=1`)
    expect(reconnectHref({ compat: '76561197960287930', next: '/en/daily' })).toBe(
      '/en?compat=76561197960287930&reconnect=1',
    )
    expect(reconnectHref({ next: '/en/rooms' })).toBe('/?reconnect=1')
    expect(reconnectHref()).toBe('/?reconnect=1')
  })
})

/**
 * Тексты английского лендинга — те же правила, что у русских: текст ровно у
 * каждого места, кнопка называет действие, гость с /play читает про одну игру.
 */
describe('тексты лендинга по-английски', () => {
  const EN = destinations('en')
  const CYRILLIC = /[А-Яа-яЁё]/
  const MOOD = { time: 'medium', vibe: 'chill', social: 'solo' } as const

  test('текст есть ровно у каждого адреса', () => {
    expect(Object.keys(EN).sort()).toEqual([...DESTINATION_PATHS].sort())
    expect(destinations()).toBe(DESTINATIONS)
  })

  /*
   * У русской кнопки глагол узнаётся по «-ть». У английской — повелительное
   * наклонение, и проверить его можно только списком: окончания у него нет.
   * Список — глаголы, а не места: «Library» или «Your library» не пройдут.
   */
  test('кнопка начинается с глагола в повелительном наклонении', () => {
    const IMPERATIVES = ['Open', 'Show', 'Find', 'Browse', 'Build', 'Get', 'Create']
    for (const [p, d] of Object.entries(EN)) {
      expect(IMPERATIVES, `${p}: «${d.action}»`).toContain(d.action.split(' ')[0])
      expect(d.promise.length, `${p}: пустое обещание`).toBeGreaterThan(20)
      expect(d.promise, p).not.toMatch(CYRILLIC)
      expect(d.action, p).not.toMatch(CYRILLIC)
    }
  })

  test('гость, развёрнутый с /play, читает про одну игру; кнопки — из глоссария', () => {
    expect(EN['/play'].promise).toMatch(/^One game/)
    expect(EN['/play'].action).toBe('Find a game')
    expect(EN['/room/new'].action).toBe('Create a room')
    expect(EN['/compat'].action).toBe('Get the link')
    // комната — из библиотек всех, кто в ней, а не из нескольких своих
    expect(EN['/room/new'].promise).toBe("A room is built from everyone's libraries — connect yours and we'll create it.")
  })

  test('ответы квиза — над заголовком, подписями английского квиза', () => {
    expect(destinationPromise(playHref(MOOD), 'en')).toBe(
      "A couple of hours · Unwind · Solo — got it. One last step: connect Steam and we'll pick one game from your library.",
    )
    // адрес с языком — то же место
    expect(destinationPromise(`/en${playHref(MOOD)}`, 'en')).toBe(destinationPromise(playHref(MOOD), 'en'))
    expect(destinationPromise(`/en${playHref(MOOD)}`)).toBe(destinationPromise(playHref(MOOD)))
    expect(destinationPromise(playHref(MOOD, { roulette: true }), 'en')).toBe(EN['/play'].promise)
    for (const p of DESTINATION_PATHS) expect(destinationPromise(p, 'en'), p).toBe(EN[p].promise)
    for (const raw of [null, '', '/rooms', '/en/rooms', 'toString', '__proto__', '/en/__proto__']) {
      expect(destinationPromise(raw, 'en'), String(raw)).toBeNull()
    }
  })

  test('destinationFor узнаёт место по адресу с языком и без', () => {
    expect(destinationFor('/en/play?time=short', 'en')).toBe(EN['/play'])
    expect(destinationFor('/play', 'en')).toBe(EN['/play'])
    expect(destinationFor('/en/library')).toBe(DESTINATIONS['/library'])
    for (const raw of [null, '', '/rooms', 'toString', '/en/constructor']) {
      expect(destinationFor(raw, 'en'), String(raw)).toBeNull()
    }
  })
})
