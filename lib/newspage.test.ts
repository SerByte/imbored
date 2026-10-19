import { describe, expect, test } from 'vitest'
import { DESCRIPTION_MAX } from './clip'
import {
  hasEnglishContent,
  indexedNewsPath,
  isNewsGid,
  newsDescription,
  newsHeading,
  newsIndexable,
  newsPageTitle,
  newsPath,
  newsTitleOn,
  patchHeading,
  patchShareUrl,
  patchToken,
  SITEMAP_NEWS_MAX,
  SITEMAP_NEWS_WINDOW_SEC,
} from './newspage'
import type { NewsBlock } from './steamhtml'

const BODY: NewsBlock[] = [
  { kind: 'h', text: 'Геймплей' },
  {
    kind: 'ul',
    items: [[{ text: 'Взрывная волна бомбы теперь взаимодействует с дымом.' }], [{ text: 'Починили вылет на Anubis.' }]],
  },
]

describe('адрес патча', () => {
  test('gid — как у Steam: буквы, цифры, дефис и подчёркивание, до 64 знаков', () => {
    expect(isNewsGid('5123894512345')).toBe(true)
    expect(isNewsGid('abc_DEF-1')).toBe(true)
    expect(isNewsGid('a'.repeat(64))).toBe(true)
    for (const bad of ['', 'a'.repeat(65), '../x', 'a b', '1;DROP', 'й', null, undefined, 12]) {
      expect(isNewsGid(bad), String(bad)).toBe(false)
    }
  })

  test('путь — под карточкой игры', () => {
    expect(newsPath(730, '5123894512345')).toBe('/game/730/news/5123894512345')
  })

  test('окно карты сайта — девяносто дней, потолок держит протокол', () => {
    expect(SITEMAP_NEWS_WINDOW_SEC).toBe(90 * 86_400)
    expect(SITEMAP_NEWS_MAX).toBeLessThan(50_000)
  })
})

describe('заголовок патча', () => {
  test('название игры в начале заголовка срезается — оно стоит строкой выше', () => {
    expect(newsHeading('Portal 2 - Update', 'Portal 2')).toBe('Update')
    expect(newsHeading('Патч 2.31', 'Cyberpunk 2077')).toBe('Патч 2.31')
  })

  test('без игры заголовок остаётся как есть', () => {
    expect(newsHeading('  Обновление от 19.08  ', null)).toBe('Обновление от 19.08')
  })

  test('<title>: игра, патч и вопрос из запроса', () => {
    expect(newsPageTitle('Counter-Strike 2 — Обновление', 'Counter-Strike 2')).toBe(
      'Counter-Strike 2: Обновление — что изменилось',
    )
    expect(newsPageTitle('Патч 2.31', 'Cyberpunk 2077')).toBe('Cyberpunk 2077: Патч 2.31 — что изменилось')
    expect(newsPageTitle('Патч 2.31', undefined)).toBe('Патч 2.31 — что изменилось')
  })

  /**
   * Valve выпускает каждое обновление CS2 под одним заголовком —
   * «Обновление Counter-Strike 2», с названием в конце. Без даты все страницы
   * патчей верхней игры каталога получали один и тот же <title> (в базе их
   * восемнадцать подряд), и в выдаче и ридерах они выглядели одной страницей,
   * повторённой много раз, — да ещё с названием дважды.
   */
  const AUG3 = Date.UTC(2026, 7, 3, 18) / 1000

  test('заголовок без номера версии получает дату, название — один раз', () => {
    expect(newsPageTitle('Обновление Counter-Strike 2', 'Counter-Strike 2', AUG3)).toBe(
      'Обновление Counter-Strike 2 от 3 августа 2026 г. — что изменилось',
    )
    expect(newsPageTitle('Portal 2 - Update', 'Portal 2', AUG3)).toBe(
      'Portal 2: Update от 3 августа 2026 г. — что изменилось',
    )
  })

  test('цифры в самом заголовке различают его и так — даты не нужно', () => {
    expect(newsPageTitle('Патч 2.31', 'Cyberpunk 2077', AUG3)).toBe('Cyberpunk 2077: Патч 2.31 — что изменилось')
    expect(newsPageTitle('Counter-Strike 2: Release Notes for 9/25/2026', 'Counter-Strike 2', AUG3)).toBe(
      'Counter-Strike 2: Release Notes for 9/25/2026 — что изменилось',
    )
  })

  test('цифры названия игры версией не считаются', () => {
    // «2» в Counter-Strike 2 — не номер патча: без даты заголовки снова совпали бы
    expect(newsPageTitle('Counter-Strike 2', 'Counter-Strike 2', AUG3)).toBe(
      'Counter-Strike 2 от 3 августа 2026 г. — что изменилось',
    )
  })

  test('без даты публикации — как раньше', () => {
    expect(newsPageTitle('Обновление Counter-Strike 2', 'Counter-Strike 2')).toBe(
      'Обновление Counter-Strike 2 — что изменилось',
    )
  })

  test('двойной пробел в заголовке издателя не съедает название игры впереди', () => {
    // «есть ли имя в заголовке» решалось сравнением с текстом без имени, а
    // тот выходил со схлопнутыми пробелами — и «Hotfix  notes», где имени
    // нет вовсе, терял «Cyberpunk 2077:» в <title>
    expect(newsPageTitle('Hotfix  notes 2.1', 'Cyberpunk 2077')).toBe(
      'Cyberpunk 2077: Hotfix  notes 2.1 — что изменилось',
    )
  })

  test('обычное слово, совпавшее с названием игры, именем не считается', () => {
    // «control» здесь — про управление, а не про игру: без учёта регистра
    // заголовок сходил за «имя уже есть», и «Control:» пропадал из <title>
    expect(newsPageTitle('Improved control options', 'Control', AUG3)).toBe(
      'Control: Improved control options от 3 августа 2026 г. — что изменилось',
    )
    // имя, написанное как имя, по-прежнему не повторяется
    expect(newsPageTitle('Обновление Counter-Strike 2', 'Counter-Strike 2', AUG3)).toBe(
      'Обновление Counter-Strike 2 от 3 августа 2026 г. — что изменилось',
    )
  })
})

describe('описание патча', () => {
  test('пересказ — первым: это и есть своё у страницы', () => {
    const d = newsDescription({ title: 'Патч', tldr: 'Дым гасит взрывную волну.', blocks: BODY }, 'CS2')
    expect(d).toBe('Дым гасит взрывную волну.')
  })

  test('длинный пересказ режется по слову и в предел выдачи', () => {
    const tldr = 'Переработали баланс оружия и карты, '.repeat(8).trim()
    const d = newsDescription({ title: 'Патч', tldr, blocks: [] }, 'CS2')
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(d.endsWith('…')).toBe(true)
  })

  test('без пересказа — начало самого поста одной строкой, без маркеров списка', () => {
    const d = newsDescription({ title: 'Патч', blocks: BODY }, 'CS2')
    expect(d).toBe(
      'Геймплей Взрывная волна бомбы теперь взаимодействует с дымом. Починили вылет на Anubis.',
    )
  })

  test('ни пересказа, ни тела — заголовок страницы, а не пустота', () => {
    expect(newsDescription({ title: 'Патч 2.31', blocks: [] }, 'Cyberpunk 2077')).toBe(
      'Cyberpunk 2077: Патч 2.31 — что изменилось.',
    )
  })
})

describe('индексация', () => {
  test('в поиск — только пересказ у живой игры каталога', () => {
    expect(newsIndexable('Починили дым', true)).toBe(true)
    // копия поста Steam: в выдаче спорила бы с оригиналом
    expect(newsIndexable(null, true)).toBe(false)
    expect(newsIndexable('   ', true)).toBe(false)
    // мёртвая или не каталожная игра — как её собственная карточка
    expect(newsIndexable('Починили дым', false)).toBe(false)
  })
})

describe('ссылка с заголовка патча', () => {
  const row = { appid: 730, gid: '5123894512345', kind: 'patch', rank: 5000, tldr: 'Починили дым' }

  test('пересказ у игры каталога — ссылка на страницу патча', () => {
    expect(indexedNewsPath(row)).toBe('/game/730/news/5123894512345')
  })

  test('noindex-страниц в разметке нет: без пересказа и у игры вне каталога', () => {
    // копия поста Steam: так выглядят хотфиксы, пересказ им не пишется
    expect(indexedNewsPath({ ...row, tldr: undefined })).toBeNull()
    expect(indexedNewsPath({ ...row, tldr: null })).toBeNull()
    expect(indexedNewsPath({ ...row, tldr: '  ' })).toBeNull()
    // rank = 0 — игра не прошла фильтры каталога (getGameRanks)
    expect(indexedNewsPath({ ...row, rank: 0 })).toBeNull()
  })

  test('ссылки нет туда, где loadPatch отдаст 404', () => {
    expect(indexedNewsPath({ ...row, kind: 'news' })).toBeNull()
    expect(indexedNewsPath({ ...row, gid: '../x' })).toBeNull()
    expect(indexedNewsPath({ ...row, appid: -101 })).toBeNull()
  })
})

describe('patchShareUrl', () => {
  test('адрес патча с меткой ref=patch', () => {
    expect(patchShareUrl('https://imbored.cc', 730, '5123894512345')).toBe(
      'https://imbored.cc/game/730/news/5123894512345?ref=patch',
    )
  })
})

/** Ни одной русской буквы: английский заголовок не должен протекать русским словом */
const CYRILLIC = /[А-Яа-яЁё]/

describe('страница патча по-английски', () => {
  const AUG3 = Date.UTC(2026, 7, 3, 18) / 1000

  test('<title>: те же правила и «— what changed»', () => {
    expect(newsPageTitle('Counter-Strike 2 — Update', 'Counter-Strike 2', undefined, 'en')).toBe(
      'Counter-Strike 2: Update — what changed',
    )
    expect(newsPageTitle('Patch 2.31', 'Cyberpunk 2077', AUG3, 'en')).toBe('Cyberpunk 2077: Patch 2.31 — what changed')
    expect(newsPageTitle('Patch 2.31', undefined, undefined, 'en')).toBe('Patch 2.31 — what changed')
  })

  test('дата — когда заголовок патчи не различает: в скобках, коротким месяцем', () => {
    // название в начале срезается и встаёт впереди через двоеточие, как по-русски
    expect(newsPageTitle('Counter-Strike 2 Update', 'Counter-Strike 2', AUG3, 'en')).toBe(
      'Counter-Strike 2: Update (Aug 3, 2026) — what changed',
    )
    // название в конце — одно, без повтора впереди
    expect(newsPageTitle('Update for Counter-Strike 2', 'Counter-Strike 2', AUG3, 'en')).toBe(
      'Update for Counter-Strike 2 (Aug 3, 2026) — what changed',
    )
    expect(newsPageTitle('Portal 2 - Update', 'Portal 2', AUG3, 'en')).toBe('Portal 2: Update (Aug 3, 2026) — what changed')
    expect(newsPageTitle('Improved control options', 'Control', AUG3, 'en')).toBe(
      'Control: Improved control options (Aug 3, 2026) — what changed',
    )
    // дата — в UTC, как у русской: в 23:30 по UTC это всё ещё 3 августа
    expect(newsPageTitle('Update', 'Portal 2', Date.UTC(2026, 7, 3, 23, 30) / 1000, 'en')).toBe(
      'Portal 2: Update (Aug 3, 2026) — what changed',
    )
    expect(newsPageTitle('Counter-Strike 2 Update', 'Counter-Strike 2', AUG3, 'en')).not.toMatch(CYRILLIC)
  })

  /*
   * Общий «{Game} update» — ответ newsTitleOn посту без английского
   * заголовка. <title>, og:title и RSS — тем же словом, что h1, карточка и
   * крошка (patchHeading): не режут его до «Update» и не ставят игру обратно
   * через двоеточие. С номером он режется, как любой заголовок с названием
   * впереди, — «Update 7.41d» не пустое слово.
   */
  test('общий «{Game} update» — целиком, как в h1, с датой', () => {
    const generic = newsTitleOn({ title: 'Обновление Counter-Strike 2' }, 'Counter-Strike 2', 'en')
    expect(generic).toBe('Counter-Strike 2 update')
    expect(newsPageTitle(generic, 'Counter-Strike 2', AUG3, 'en')).toBe(
      'Counter-Strike 2 update (Aug 3, 2026) — what changed',
    )
    expect(newsPageTitle(generic, 'Counter-Strike 2', undefined, 'en')).toBe('Counter-Strike 2 update — what changed')
    expect(patchHeading({ title: 'Обновление Counter-Strike 2' }, 'Counter-Strike 2', 'en')).toBe(generic)
    // без игры — «Update», как было
    expect(newsPageTitle(newsTitleOn({ title: 'Обновление' }, null, 'en'), null, AUG3, 'en')).toBe(
      'Update (Aug 3, 2026) — what changed',
    )
    // с номером — режется, как раньше
    const versioned = newsTitleOn({ title: 'Обновление 7.41d' }, 'Dota 2', 'en')
    expect(versioned).toBe('Dota 2 update 7.41d')
    expect(newsPageTitle(versioned, 'Dota 2', AUG3, 'en')).toBe('Dota 2: Update 7.41d — what changed')
    // свой английский заголовок издателя — по общим правилам, хоть и похож
    expect(newsPageTitle('Counter-Strike 2 Update', 'Counter-Strike 2', AUG3, 'en')).toBe(
      'Counter-Strike 2: Update (Aug 3, 2026) — what changed',
    )
  })

  test('без языка — русский заголовок, как был', () => {
    expect(newsPageTitle('Portal 2 - Update', 'Portal 2', AUG3)).toBe(newsPageTitle('Portal 2 - Update', 'Portal 2', AUG3, 'ru'))
    expect(newsPageTitle('Portal 2 - Update', 'Portal 2', AUG3)).toMatch(/— что изменилось$/)
  })

  test('описание: пересказ языка страницы, иначе нерусское начало поста, иначе заголовок', () => {
    const EN_BODY: NewsBlock[] = [{ kind: 'p', runs: [{ text: 'Fixed a crash on Anubis.' }] }]
    expect(newsDescription({ title: 'Patch', tldr: 'Smoke now blocks the blast.', blocks: BODY }, 'CS2', 'en')).toBe(
      'Smoke now blocks the blast.',
    )
    expect(newsDescription({ title: 'Patch', blocks: EN_BODY }, 'CS2', 'en')).toBe('Fixed a crash on Anubis.')
    // русское тело на английской странице — не сниппет: встаёт заголовок
    expect(newsDescription({ title: 'Patch 2.31', blocks: BODY }, 'Cyberpunk 2077', 'en')).toBe(
      'Cyberpunk 2077: Patch 2.31 — what changed.',
    )
    expect(newsDescription({ title: 'Patch 2.31', blocks: [] }, 'Cyberpunk 2077', 'en')).not.toMatch(CYRILLIC)
    // по-русски русское тело — как было
    expect(newsDescription({ title: 'Патч', blocks: BODY }, 'CS2')).toMatch(/^Геймплей/)
  })

  test('описание на /en: немецкое или китайское тело — не сниппет, как и русское (isEnglishText, п. 9)', () => {
    const DE: NewsBlock[] = [
      { kind: 'p', runs: [{ text: 'Wir haben die Karte und das Menü für dich überarbeitet, und die Steuerung ist nicht mehr träge.' }] },
    ]
    const ZH: NewsBlock[] = [{ kind: 'p', runs: [{ text: '修复了加载时的崩溃问题，并新增了 PvP 模式。' }] }]
    expect(newsDescription({ title: 'Update 1.5', blocks: DE }, 'Some Game', 'en')).toBe('Some Game: Update 1.5 — what changed.')
    expect(newsDescription({ title: 'Update 1.5', blocks: ZH }, 'Some Game', 'en')).toBe('Some Game: Update 1.5 — what changed.')
    // по-русски тело любого языка — как было
    expect(newsDescription({ title: 'Update 1.5', blocks: DE }, 'Some Game')).toMatch(/^Wir haben/)
  })

  test('описание на /en без пересказа и тела: заголовок — titleEn или «{Game} update», не русский', () => {
    expect(
      newsDescription({ title: 'Обновление 1.5: новая карта', titleEn: 'Update 1.5: a new map', blocks: BODY }, 'Some Game', 'en'),
    ).toBe('Some Game: Update 1.5: a new map — what changed.')
    // общий заголовок — с номером версии из заголовка издателя
    expect(newsDescription({ title: 'Обновление 1.5: новая карта', blocks: [] }, 'Some Game', 'en')).toBe(
      'Some Game: Update 1.5 — what changed.',
    )
    // общий заголовок без номера — целиком, как в h1: не «Some Game: Update»
    expect(newsDescription({ title: 'Обновление: новая карта', blocks: [] }, 'Some Game', 'en')).toBe(
      'Some Game update — what changed.',
    )
    // по-русски — заголовок издателя, titleEn не читается
    expect(newsDescription({ title: 'Обновление 1.5', titleEn: 'Update 1.5', blocks: [] }, 'Some Game')).toBe(
      'Some Game: Обновление 1.5 — что изменилось.',
    )
  })

  test('заголовок поста на языке страницы (newsTitleOn)', () => {
    const ru = { title: 'Обновление 1.5: новая карта' }
    expect(newsTitleOn({ ...ru, titleEn: 'Update 1.5: a new map' }, 'Hades', 'en')).toBe('Update 1.5: a new map')
    // общий заголовок сохраняет номер версии из заголовка издателя
    expect(newsTitleOn({ ...ru, titleEn: '  ' }, 'Hades', 'en')).toBe('Hades update 1.5')
    expect(newsTitleOn({ ...ru, titleEn: null }, 'Hades', 'en')).toBe('Hades update 1.5')
    expect(newsTitleOn(ru, null, 'en')).toBe('Update 1.5')
    expect(newsTitleOn({ title: 'Обновление: новая карта' }, 'Hades', 'en')).toBe('Hades update')
    // английский заголовок и заголовок без букв — как есть
    expect(newsTitleOn({ title: 'Patch 2.31 is out' }, 'Hades', 'en')).toBe('Patch 2.31 is out')
    expect(newsTitleOn({ title: '1.0.3' }, 'Hades', 'en')).toBe('1.0.3')
    // немецкий и китайский — как русский
    expect(newsTitleOn({ title: 'Das Update für die Karte und das Menü' }, 'Hades', 'en')).toBe('Hades update')
    expect(newsTitleOn({ title: '版本更新公告' }, 'Hades', 'en')).toBe('Hades update')
    // повторный вызов ничего не меняет
    expect(newsTitleOn({ title: newsTitleOn(ru, 'Hades', 'en') }, 'Hades', 'en')).toBe('Hades update 1.5')
    const bare = { title: 'Обновление: новая карта' }
    expect(newsTitleOn({ title: newsTitleOn(bare, 'Hades', 'en') }, 'Hades', 'en')).toBe('Hades update')
    const season = { title: 'Сезон 5: Вечная охота' }
    expect(newsTitleOn(season, 'Destiny 2', 'en')).toBe('Destiny 2 season 5 update')
    expect(newsTitleOn({ title: newsTitleOn(season, 'Destiny 2', 'en') }, 'Destiny 2', 'en')).toBe('Destiny 2 season 5 update')
    // по-русски — заголовок издателя как есть, перевод не читается
    expect(newsTitleOn({ ...ru, titleEn: 'Update 1.5' }, 'Hades')).toBe('Обновление 1.5: новая карта')
    expect(newsTitleOn({ ...ru, titleEn: 'Update 1.5' }, 'Hades', 'ru')).toBe('Обновление 1.5: новая карта')
  })

  /**
   * Номер — то, что различает патчи игры с русским заголовком на /en:
   * без него «Обновление 7.41c», «7.41d» и «7.41e» читались тремя «Dota 2
   * update» подряд. Дата через точки номером не считается — по-английски
   * «12.08» читается и декабрём, а дату <title> ставит сам.
   */
  test('номер версии или сезона из заголовка (patchToken)', () => {
    const v = (title: string, game?: string) => patchToken(title, game)?.value ?? null
    expect(v('Обновление 7.41d')).toBe('7.41d')
    expect(v('Обновление 7.41e и летняя чистка')).toBe('7.41e')
    expect(v('Вышла версия 0.93L')).toBe('0.93L')
    expect(v('Обновление 3.0.436. Авто-распаковка построек')).toBe('3.0.436')
    expect(v('[v0.9.6]  Оперативные исправления. Детали')).toBe('v0.9.6')
    expect(v('Новое обновление (ver1.1.4 Добавлена поддержка новых языков)')).toBe('ver1.1.4')
    expect(v('Black Myth: Wukong — описание обновления 1.0.21.23831', 'Black Myth: Wukong')).toBe('1.0.21.23831')
    expect(v('Хотфикс от 11 августа — 1.1.1.2')).toBe('1.1.1.2')
    expect(v('Обновление Sun Haven 3.1: Улучшения удобства игры', 'Sun Haven')).toBe('3.1')
    // число из названия игры, годовщина, дата — не номер
    expect(v('Обновление Counter-Strike 2', 'Counter-Strike 2')).toBeNull()
    expect(v('Обновление в честь 20-летия Half-Life 2')).toBeNull()
    expect(v('Небольшое обновление от 12.08.2026')).toBeNull()
    expect(v('«Хогвартс. Наследие» - Патч для ПК - 03.12.25')).toBeNull()
    expect(v('Football Manager 2024: патч 24.2', 'Football Manager 2024')).toBe('24.2')
    // сезон — когда версии нет
    expect(patchToken('Сезон 5: Вечная охота')).toEqual({ kind: 'season', value: '5' })
    expect(patchToken('Начало 12-го сезона')).toEqual({ kind: 'season', value: '12' })
    expect(patchToken('Обновление 2.1 и начало сезона 3')).toEqual({ kind: 'version', value: '2.1' })
    expect(patchToken('Межсезонье 2026')).toBeNull()
  })

  test('заголовок патча: общий «{Game} update» — целиком, с номером — без названия (patchHeading)', () => {
    expect(patchHeading({ title: 'Обновление Counter-Strike 2' }, 'Counter-Strike 2', 'en')).toBe('Counter-Strike 2 update')
    expect(patchHeading({ title: 'Обновление 7.41d' }, 'Dota 2', 'en')).toBe('Update 7.41d')
    expect(patchHeading({ title: 'Обновление: летняя чистка' }, null, 'en')).toBe('Update')
    expect(patchHeading({ title: 'Обновление 7.41d', titleEn: 'Dota 2 - Update 7.41d' }, 'Dota 2', 'en')).toBe('Update 7.41d')
    expect(patchHeading({ title: 'Portal 2 - Update' }, 'Portal 2', 'en')).toBe('Update')
    // русская страница — ровно newsHeading, как было
    for (const title of ['Обновление Counter-Strike 2', 'Portal 2 - Update', 'Counter-Strike 2 update', '']) {
      expect(patchHeading({ title }, 'Counter-Strike 2'), title).toBe(newsHeading(title, 'Counter-Strike 2'))
    }
  })

  test('«Поделиться» с /en ведёт на английскую страницу', () => {
    expect(patchShareUrl('https://imbored.cc', 730, '5123894512345', 'en')).toBe(
      'https://imbored.cc/en/game/730/news/5123894512345?ref=patch',
    )
    expect(patchShareUrl('https://imbored.cc', 730, '5123894512345', 'ru')).toBe(
      'https://imbored.cc/game/730/news/5123894512345?ref=patch',
    )
  })
})

describe('hasEnglishContent: есть ли посту что сказать на /en', () => {
  const ru: NewsBlock[] = [{ kind: 'p', runs: [{ text: 'Починили сеть и баланс оружия.' }] }]
  const en: NewsBlock[] = [{ kind: 'p', runs: [{ text: 'Fixed the netcode and weapon balance.' }] }]

  test('английский пересказ или английское тело — да', () => {
    expect(hasEnglishContent({ tldrEn: 'Fixed the netcode.', blocks: ru })).toBe(true)
    expect(hasEnglishContent({ blocks: en })).toBe(true)
  })

  test('русское тело без пересказа, пустое тело, пересказ из пробелов — нет', () => {
    expect(hasEnglishContent({ blocks: ru })).toBe(false)
    expect(hasEnglishContent({ blocks: [] })).toBe(false)
    expect(hasEnglishContent({ tldrEn: '   ', blocks: ru })).toBe(false)
  })
})
