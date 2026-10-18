import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  encodeSearchIndex,
  fromRuLayout,
  readSearchIndex,
  SEARCH_SHOWN,
  searchCatalog,
  searchStatus,
  stepActive,
  type SearchEntry,
} from './catalogsearch'

/** Индекс в порядке «по числу отзывов» — так его отдаёт /search-index.json */
function index(...names: string[]): SearchEntry[] {
  const entries = readSearchIndex(encodeSearchIndex(names.map((name, i) => ({ appid: i + 1, name }))))
  if (!entries) throw new Error('индекс не прочитался')
  return entries
}

const names = (r: ReturnType<typeof searchCatalog>) => r.games.map((g) => g.name)

describe('индекс каталога: провод и чтение', () => {
  test('колонками: номера отдельно, названия отдельно — так он меньше весит сжатым', () => {
    expect(
      encodeSearchIndex([
        { appid: 730, name: 'Counter-Strike 2' },
        { appid: 570, name: 'Dota 2' },
      ]),
    ).toEqual({ ids: [730, 570], names: ['Counter-Strike 2', 'Dota 2'] })
  })

  test('пробелы в названии схлопываются, пустое название не едет вовсе', () => {
    const wire = encodeSearchIndex([
      { appid: 1, name: '  Foo \n\t Bar ' },
      { appid: 2, name: '   ' },
      { appid: 3, name: 'Baz' },
    ])
    expect(wire).toEqual({ ids: [1, 3], names: ['Foo Bar', 'Baz'] })
  })

  test('чтение сохраняет порядок индекса — он и есть порядок популярности', () => {
    const got = readSearchIndex({ ids: [730, 570], names: ['Counter-Strike 2', 'Dota 2'] })
    expect(got?.map((e) => [e.appid, e.name])).toEqual([
      [730, 'Counter-Strike 2'],
      [570, 'Dota 2'],
    ])
  })

  test('сломанная форма — null, а не исключение посреди набора', () => {
    expect(readSearchIndex(null)).toBeNull()
    expect(readSearchIndex('<!doctype html>')).toBeNull()
    expect(readSearchIndex({ ids: [1, 2], names: ['a'] })).toBeNull()
    expect(readSearchIndex({ ids: 'x', names: [] })).toBeNull()
  })

  test('битая строка пропускается, остальные читаются', () => {
    const got = readSearchIndex({ ids: [1, 1.5, -3, 4, 5], names: ['A', 'B', 'C', 7, 'E'] })
    expect(got?.map((e) => e.appid)).toEqual([1, 5])
  })

  /*
   * Пустой индекс отдаёт сборка без базы (app/search-index.json), и ISR
   * держит его до суток. Прочитанный как «каталог пуст», он сутки отвечал бы
   * «Ничего не нашлось» на «Dota 2»; как отказ — это «Каталог не загрузился»
   * с кнопкой повтора.
   */
  test('пустой индекс — null, как сломанный: живого каталога без игр не бывает', () => {
    expect(readSearchIndex({ ids: [], names: [] })).toBeNull()
  })

  /*
   * Границы слов считаются раз при чтении: words — все слова свёртки, spaced —
   * только слова через пробел (ступени — у tierOf). Слова через пробел
   * сворачиваются порознь и в сумме обязаны дать ровно tight, иначе начала
   * съехали бы на чужие буквы; слово, от которого свёртка не оставила ничего
   * («&»), начала не даёт.
   */
  test('границы слов: через пробел и через знак — порознь, и обе — по tight', () => {
    const [stalker, mount] = index('S.T.A.L.K.E.R. 2: Heart of Chornobyl', 'Mount & Blade II: Bannerlord')
    expect(stalker.tight).toBe('stalker2heartofchornobyl')
    expect(stalker.words).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 15])
    expect(stalker.spaced).toEqual([0, 7, 8, 13, 15])
    expect(mount.tight).toBe('mountbladeiibannerlord')
    expect(mount.spaced).toEqual([0, 5, 10, 12])
  })

  test('индекс из одних битых строк — тоже null, а не пустой каталог', () => {
    expect(readSearchIndex({ ids: [-1, 0, 2.5], names: ['A', 'B', 'C'] })).toBeNull()
    expect(readSearchIndex({ ids: [7], names: ['  ™ '] })).toBeNull()
  })
})

/*
 * Два названия у одной игры. Каталог хранит английское название магазина
 * (games.name — lib/catalog, STORE_LANGUAGE), а обогащение карточки
 * приносит ещё и русское, если оно у игры в Steam своё (games.name_ru —
 * правило названий в апсерте, lib/db). Прежде русское затирало английское,
 * и «witcher 3» отвечал «Ничего не нашлось» на «Ведьмак 3: Дикая Охота» —
 * одну из тридцати самых популярных игр каталога, а с ней «Хогвартс.
 * Наследие», «Призрак Цусимы» и ещё шесть десятков.
 */
describe('два названия: английское из магазина и русское', () => {
  const WITCHER = { appid: 292030, name: 'The Witcher 3: Wild Hunt', nameRu: 'Ведьмак 3: Дикая Охота' }
  const GWENT = { appid: 1284410, name: 'GWENT: The Witcher Card Game', nameRu: 'ГВИНТ: Ведьмак. Карточная игра' }
  const both = (...rows: Array<{ appid: number; name: string; nameRu?: string | null }>) =>
    readSearchIndex(encodeSearchIndex(rows)) ?? []

  test('второе название едет, только если оно другое, — по номеру строки', () => {
    expect(
      encodeSearchIndex([
        { appid: 570, name: 'Dota 2' },
        WITCHER,
        // Русское название магазина и есть английское — второго нет
        { appid: 873190, name: 'ЕСТЬ ДВА СТУЛА', nameRu: 'ЕСТЬ ДВА СТУЛА' },
        // Свёртка та же — искать по нему нечего
        { appid: 7670, name: 'BioShock™', nameRu: 'BioShock' },
        { appid: 1, name: 'Foo', nameRu: '   ' },
        { appid: 2, name: 'Bar', nameRu: null },
      ]),
    ).toEqual({
      ids: [570, 292030, 873190, 7670, 1, 2],
      names: ['Dota 2', 'The Witcher 3: Wild Hunt', 'ЕСТЬ ДВА СТУЛА', 'BioShock™', 'Foo', 'Bar'],
      alt: { 1: 'Ведьмак 3: Дикая Охота' },
    })
  })

  test('номер строки — после выброшенных пустых названий, пробелы схлопнуты', () => {
    expect(
      encodeSearchIndex([{ appid: 1, name: '  ' }, { ...WITCHER, nameRu: ' Ведьмак 3:\n Дикая Охота ' }]),
    ).toEqual({ ids: [292030], names: ['The Witcher 3: Wild Hunt'], alt: { 0: 'Ведьмак 3: Дикая Охота' } })
  })

  test('«witcher 3» и «ведьмак 3» находят одну и ту же игру', () => {
    const catalog = both({ appid: 570, name: 'Dota 2' }, WITCHER)
    expect(searchCatalog(catalog, 'witcher 3').games.map((g) => g.appid)).toEqual([292030])
    expect(searchCatalog(catalog, 'ведьмак 3').games.map((g) => g.appid)).toEqual([292030])
    expect(searchCatalog(catalog, 'дикая охота').games.map((g) => g.appid)).toEqual([292030])
  })

  /*
   * Строка списка называет игру английским названием — тем же, что у её
   * карточки. Нашлась она по русскому — русское вторым рядом: иначе на
   * «ведьмак» человек видел бы строку, где его слова нет вовсе.
   */
  test('нашлось по русскому — оно в находке вторым названием, по английскому — нет', () => {
    const catalog = both(WITCHER)
    expect(searchCatalog(catalog, 'ведьмак').games).toStrictEqual([
      { appid: 292030, name: 'The Witcher 3: Wild Hunt', alias: 'Ведьмак 3: Дикая Охота' },
    ])
    expect(searchCatalog(catalog, 'witcher').games).toStrictEqual([
      { appid: 292030, name: 'The Witcher 3: Wild Hunt' },
    ])
    // Оба подходят одинаково («3») — второе название ничего не объясняет
    expect(searchCatalog(catalog, '3').games).toStrictEqual([{ appid: 292030, name: 'The Witcher 3: Wild Hunt' }])
  })

  test('из двух названий считается лучшее совпадение', () => {
    // У ГВИНТа отзывов больше, но «ведьмак» с начала русского названия — только у Ведьмака 3
    const catalog = both(GWENT, WITCHER)
    expect(names(searchCatalog(catalog, 'ведьмак'))).toEqual([WITCHER.name, GWENT.name])
    expect(names(searchCatalog(catalog, 'witcher'))).toEqual([GWENT.name, WITCHER.name])
  })

  test('русский запрос, нашедший игру по русскому названию, раскладку не пробует', () => {
    const r = searchCatalog(both(WITCHER, { appid: 1, name: 'Dtlmvfr Simulator' }), 'ведьмак')
    expect(names(r)).toEqual([WITCHER.name])
    expect(r.layout).toBeNull()
    expect(searchStatus('ready', 'ведьмак', r)).toBe('Нашлась 1 игра')
  })

  test('битые вторые названия пропускаются, а строки и индекс остаются', () => {
    const body = { ids: [1, 2, 3], names: ['Alpha', 'Beta', 'Gamma'] }
    for (const alt of ['x', [1], null, 7]) {
      expect(readSearchIndex({ ...body, alt })?.map((e) => e.alt), String(alt)).toEqual([
        undefined,
        undefined,
        undefined,
      ])
    }
    const got = readSearchIndex({ ...body, alt: { 0: 7, 1: 'Бета', 2: ' ™ ', 9: 'Лишнее' } })
    expect(got?.map((e) => e.alt?.name)).toEqual([undefined, 'Бета', undefined])
  })
})

describe('поиск по каталогу', () => {
  test('пустой запрос — пусто: каталог из шести тысяч строк не список', () => {
    const r = searchCatalog(index('Portal', 'Dota 2'), '  — ')
    expect(r.games).toEqual([])
    expect(r.total).toBe(0)
  })

  test('при равном совпадении — порядок индекса, то есть по числу отзывов', () => {
    const r = searchCatalog(index('Portal 2', 'Portal Knights', 'Portal Stories: Mel'), 'portal')
    expect(names(r)).toEqual(['Portal 2', 'Portal Knights', 'Portal Stories: Mel'])
  })

  /*
   * У сиквела отзывов больше, чем у оригинала, и «по числу отзывов» ставило бы
   * «DOOM Eternal» над «DOOM» на запрос «doom». Набранное целиком название
   * весит больше популярности.
   */
  test('точное название — первым, даже если отзывов у него меньше', () => {
    const r = searchCatalog(index('DOOM Eternal', 'DOOM', 'Doomsday Hunters'), 'doom')
    expect(names(r)[0]).toBe('DOOM')
  })

  test('™ не мешает точному совпадению', () => {
    const r = searchCatalog(index('BioShock Infinite', 'BioShock™'), 'bioshock')
    expect(names(r)).toEqual(['BioShock™', 'BioShock Infinite'])
  })

  test('начало названия — выше, чем слова где-то внутри', () => {
    const r = searchCatalog(index('The Witcher 3: Wild Hunt', 'Witcher Tales'), 'witcher')
    expect(names(r)).toEqual(['Witcher Tales', 'The Witcher 3: Wild Hunt'])
  })

  test('начала слов — выше, чем кусок посреди слова', () => {
    const r = searchCatalog(index('Bewitched Forest', 'The Witcher 3: Wild Hunt'), 'witch')
    expect(names(r)).toEqual(['The Witcher 3: Wild Hunt', 'Bewitched Forest'])
  })

  test('слова запроса — в любом порядке, знаки и регистр не мешают', () => {
    const r = searchCatalog(index('Counter-Strike 2', 'The Witcher® 3: Wild Hunt'), 'HUNT witcher')
    expect(names(r)).toEqual(['The Witcher® 3: Wild Hunt'])
  })

  test('ё и е — одно и то же', () => {
    expect(names(searchCatalog(index('Ёлки-палки'), 'елки'))).toEqual(['Ёлки-палки'])
    expect(names(searchCatalog(index('Елки-палки'), 'ёлки'))).toEqual(['Елки-палки'])
  })

  test(`показываем не больше ${SEARCH_SHOWN}, а total считает всё найденное`, () => {
    const many = Array.from({ length: 20 }, (_, i) => `Space Game ${i + 1}`)
    const r = searchCatalog(index(...many), 'space')
    expect(r.games).toHaveLength(SEARCH_SHOWN)
    expect(r.total).toBe(20)
    expect(names(r)[0]).toBe('Space Game 1')
  })

  test('у найденного — номер для адреса карточки', () => {
    const r = searchCatalog(readSearchIndex({ ids: [292030], names: ['The Witcher 3: Wild Hunt'] }) ?? [], 'witcher')
    expect(r.games).toEqual([{ appid: 292030, name: 'The Witcher 3: Wild Hunt' }])
  })
})

/*
 * Знаки внутри названия — апостроф, точки акронима, дефис, двоеточие — свёртка
 * делала разделителем, и набранное без них не находилось вовсе: «stalker 2»
 * против « s t a l k e r 2 …», «halflife» против « half life 2». Статус при
 * этом говорил «Ничего не нашлось», будто игры нет в каталоге, — на самых
 * искомых названиях. Названия ниже — как в Steam, знак в знак.
 */
describe('знаки внутри названия: набрано с ними, без них или слитно', () => {
  const catalog = index(
    "Baldur's Gate 3",
    'S.T.A.L.K.E.R. 2: Heart of Chornobyl',
    "Garry's Mod",
    'Half-Life 2',
    'Counter-Strike 2',
    'Marvel’s Spider-Man Remastered',
    'Sid Meier’s Civilization® VI',
    "Don't Starve Together",
    'S.T.A.L.K.E.R.: Shadow of Chornobyl',
    'Half-Life: Alyx',
    "Baldur's Gate: Enhanced Edition",
    'F.E.A.R.',
    'Dota 2',
    'Cafe Arcade',
  )
  const first = (q: string) => names(searchCatalog(catalog, q))[0]
  const all = (q: string) => names(searchCatalog(catalog, q))

  test("апостроф: «baldurs gate», «baldur’s gate» и «baldur's gate» — одно и то же", () => {
    for (const q of ['baldurs gate', "baldur's gate", 'baldur’s gate', 'baldurs', 'baldur']) {
      expect(all(q), q).toEqual(["Baldur's Gate 3", "Baldur's Gate: Enhanced Edition"])
    }
    expect(first('garrys mod')).toBe("Garry's Mod")
    expect(first('sid meiers')).toBe('Sid Meier’s Civilization® VI')
    expect(first('dont starve')).toBe("Don't Starve Together")
  })

  test('точки акронима: «stalker 2» находит S.T.A.L.K.E.R. 2, «stalker» — обе части', () => {
    expect(first('stalker 2')).toBe('S.T.A.L.K.E.R. 2: Heart of Chornobyl')
    expect(first('s.t.a.l.k.e.r. 2')).toBe('S.T.A.L.K.E.R. 2: Heart of Chornobyl')
    expect(all('stalker')).toEqual(['S.T.A.L.K.E.R. 2: Heart of Chornobyl', 'S.T.A.L.K.E.R.: Shadow of Chornobyl'])
    expect(all('stalker shadow')).toEqual(['S.T.A.L.K.E.R.: Shadow of Chornobyl'])
  })

  test('точное название, набранное без точек, — первым: «fear» → F.E.A.R.', () => {
    expect(first('fear')).toBe('F.E.A.R.')
  })

  test('дефис: «halflife», «half life» и «half-life» находят Half-Life', () => {
    for (const q of ['halflife', 'half life', 'half-life']) {
      expect(all(q), q).toEqual(['Half-Life 2', 'Half-Life: Alyx'])
    }
    expect(first('halflife 2')).toBe('Half-Life 2')
    expect(first('counterstrike')).toBe('Counter-Strike 2')
    // Не с начала названия: слово запроса начинается там же, где «Spider»
    expect(first('spiderman')).toBe('Marvel’s Spider-Man Remastered')
  })

  test('цифра слитно со словом: «dota2» — это Dota 2', () => {
    expect(first('dota2')).toBe('Dota 2')
  })

  /*
   * Пробел названия — не знак: слитно через него ищется, но ступенью ниже
   * любого настоящего начала слова. Иначе слово, набранное с начала, — самый
   * частый набор, — ставило бы рядом со своим названием чужое, склеенное
   * через пробел («for the king» слитно начинается с «fort»), и по отзывам
   * выше. Названия ниже — по убыванию отзывов, как в индексе.
   */
  test('слитно через пробел названия — ниже настоящего начала слова: «fort», «theme», «away»', () => {
    const spaced = index(
      'For The King',
      'The Messenger',
      'A Way Out',
      'Team Fortress 2',
      'Emily is Away',
      'Fort Solis',
      'Theme Park Manager',
      'Away: The Survival Series',
    )
    const all = (q: string) => names(searchCatalog(spaced, q))
    expect(all('fort')).toEqual(['Fort Solis', 'Team Fortress 2', 'For The King'])
    expect(all('theme')).toEqual(['Theme Park Manager', 'The Messenger'])
    expect(all('away')).toEqual(['Away: The Survival Series', 'Emily is Away', 'A Way Out'])
    // Пробел запроса там же, где пробел названия, — это набор по словам, а не склейка
    expect(all('for the')[0]).toBe('For The King')
  })

  /*
   * Буква акронима — слово свёртки, но слитно с неё не начинают: «ker» —
   * хвост «stalker», а не начало чего-то в «S.T.A.L.K.E.R.», и «ear» — не
   * «F.E.A.R.». Слитно — только с начала слова через пробел. Слово запроса,
   * умещающееся в слово свёртки, по-прежнему ищется с его начала и посреди
   * дефиса: «life» → Half-Life, «man» → Spider-Man.
   */
  test('слитно — только с начала слова через пробел, а не с буквы посреди акронима', () => {
    expect(all('ker')).toEqual([])
    // «ear» — кусок «heart», ступенью «где-то внутри», а F.E.A.R. он не находит
    expect(all('ear')).toEqual(['S.T.A.L.K.E.R. 2: Heart of Chornobyl'])
    expect(all('talker')).toEqual([])
    expect(all('life')).toEqual(['Half-Life 2', 'Half-Life: Alyx'])
    expect(first('man')).toBe('Marvel’s Spider-Man Remastered')
  })

  /*
   * Слитно — значит через знаки СВОЕГО слова, а не с середины чужого:
   * «cafearcade» содержит «fear», но человек, набравший «fear», ищет не
   * «Cafe Arcade».
   */
  test('слитный запрос начинается с начала слова названия, а не с его середины', () => {
    expect(all('fear')).toEqual(['F.E.A.R.'])
    expect(all('lflife')).toEqual([])
  })

  test('нашлось — и статус не говорит «Ничего не нашлось»', () => {
    for (const q of ['baldurs gate', 'stalker 2', 'garrys mod', 'halflife']) {
      expect(searchStatus('ready', q, searchCatalog(catalog, q)), q).toMatch(/^Нашл/)
    }
  })

  /*
   * Свёртка — с обеих сторон: знаки и пробелы не считаются и у ЗАПРОСА.
   * Слитное название, набранное раздельно или с точками, — «cyber punk»,
   * «pay day 2», «s.t.a.l.k.e.r», — иначе находилось только «где-то внутри»
   * (ступень 4) и стояло под любым более популярным названием, где эти буквы
   * просто встречаются: «Repay the Holiday 2» содержит и «pay», и «day».
   */
  test('слитное название, набранное раздельно или с точками, — выше случайных вхождений', () => {
    // Случайные вхождения — выше по отзывам: по ним и видно, что слитное — выше ступенью
    const glued = index(
      'Cyber Steampunk Racing',
      'Cyberpunk 2077',
      'Repay the Holiday 2',
      'PAYDAY 2',
      'Last Walker Stand',
      'Stalker Online',
    )
    expect(names(searchCatalog(glued, 'cyber punk'))[0]).toBe('Cyberpunk 2077')
    expect(names(searchCatalog(glued, 'pay day 2'))[0]).toBe('PAYDAY 2')
    expect(names(searchCatalog(glued, 's.t.a.l.k.e.r'))[0]).toBe('Stalker Online')
  })

  /*
   * Но набранное по словам совпадение — выше слитного: «dark s» — это
   * человек, набирающий «dark souls», а не «Darksiders», даже если у
   * Darksiders отзывов больше. Слитный путь для запроса — запасной.
   *
   * И «с начала названия» — значит с началом каждого слова запроса на
   * границе слов названия, а не только те же буквы подряд: «to t» и «Total
   * War» слитно начинаются с «tot», но «to» в нём — не слово, а «t» стоит
   * посреди «total». Это совпадение по словам (ступень 2), и «To the Moon»,
   * набранное с начала, — выше, хоть у Total War отзывов и больше.
   */
  test('совпадение по словам запроса — выше совпадения слитно', () => {
    const dark = index('Darksiders Genesis', 'Away: The Survival Series', 'DARK SOULS™ III', 'A Way Out')
    expect(names(searchCatalog(dark, 'dark s'))).toEqual(['DARK SOULS™ III', 'Darksiders Genesis'])
    expect(names(searchCatalog(dark, 'a way'))).toEqual(['A Way Out', 'Away: The Survival Series'])
    const start = index('Total War: WARHAMMER III', "Assassin's Creed Shadows", 'To the Moon', 'A Short Hike')
    expect(names(searchCatalog(start, 'to t'))).toEqual(['To the Moon', 'Total War: WARHAMMER III'])
    expect(names(searchCatalog(start, 'a s'))).toEqual(['A Short Hike', "Assassin's Creed Shadows"])
  })
})

describe('запрос, набранный не в той раскладке', () => {
  test('ЙЦУКЕН переводится в QWERTY по клавишам', () => {
    expect(fromRuLayout('цшесрук')).toBe('witcher')
    expect(fromRuLayout('ЦШЕСРУК 3')).toBe('witcher 3')
    expect(fromRuLayout('ифдвгкэы пфеу')).toBe("baldur's gate")
    expect(fromRuLayout('рфда-дшау')).toBe('half-life')
  })

  test('без русских букв переводить нечего', () => {
    expect(fromRuLayout('witcher')).toBeNull()
    expect(fromRuLayout('42')).toBeNull()
  })

  test('«цшесрук» находит The Witcher и говорит, что искали', () => {
    const r = searchCatalog(index('Counter-Strike 2', 'The Witcher 3: Wild Hunt'), 'цшесрук')
    expect(names(r)).toEqual(['The Witcher 3: Wild Hunt'])
    expect(r.layout).toBe('witcher')
  })

  /*
   * Прежде раскладку искали всегда и ставили следом за найденным как есть:
   * здесь — «Ёлки-палки», а за ней «Tkrb Simulator» («елки» в QWERTY —
   * «tkrb»). Но запрос, нашедший что-то как набран, — не перепутанная
   * раскладка, и перевод добавлял к нему только шум: обрывки по две буквы,
   * которые сидят в начале слов сотен названий. Раскладка теперь — спасение
   * пустого ответа, а не довесок к непустому.
   */
  test('нашлось как набрано — раскладку не пробуют', () => {
    const r = searchCatalog(index('Ёлки-палки', 'Tkrb Simulator'), 'елки')
    expect(names(r)).toEqual(['Ёлки-палки'])
    expect(r.total).toBe(1)
    expect(r.layout).toBeNull()
  })

  test('как набрано — ничего, тогда раскладка', () => {
    const r = searchCatalog(index('Tkrb Simulator'), 'елки')
    expect(names(r)).toEqual(['Tkrb Simulator'])
    expect(r.layout).toBe('tkrb')
  })

  test('апостроф и точки в раскладке: «Пфккнэы Ьщв», «Вщтэе Ыефкму», «ыефдлук 2»', () => {
    const catalog = index("Garry's Mod", "Don't Starve Together", 'S.T.A.L.K.E.R. 2: Heart of Chornobyl')
    const garry = searchCatalog(catalog, 'Пфккнэы Ьщв')
    expect(names(garry)).toEqual(["Garry's Mod"])
    expect(garry.layout).toBe("garry's mod")
    expect(names(searchCatalog(catalog, 'Вщтэе Ыефкму'))).toEqual(["Don't Starve Together"])
    const stalker = searchCatalog(catalog, 'ыефдлук 2')
    expect(names(stalker)).toEqual(['S.T.A.L.K.E.R. 2: Heart of Chornobyl'])
    expect(stalker.layout).toBe('stalker 2')
    // Раньше «ыефдлук» переводился в «stalker» — и всё равно не находил: точки
    // акронима резали название на буквы
    const bare = searchCatalog(catalog, 'ыефдлук')
    expect(names(bare)).toEqual(['S.T.A.L.K.E.R. 2: Heart of Chornobyl'])
    expect(bare.layout).toBe('stalker')
  })

  /*
   * б, ю, ж, х, ъ стоят на клавишах знаков, э — апострофа, ё — обратной
   * кавычки. Русское слово с ними в QWERTY распадается на обрывки: «баба» —
   * «,f,f», то есть «f f», а «f» — начало слова в сотнях названий. Строка
   * статуса при этом говорила «Нашлось 119 игр по «,f,f»». Одни обрывки короче
   * трёх букв — не слово, набранное не в той раскладке, а след русского слова.
   */
  test('русское слово, распавшееся в QWERTY на обрывки по 1–2 буквы, ничего не находит', () => {
    const catalog = index(
      'Team Fortress 2',
      'Fallout 4',
      'Brawlhalla',
      'Just Cause 3',
      'TUNIC',
      'Killing Floor 2',
      'For The King',
    )
    // «баба яга» — «f f zuf»: слово от трёх букв есть, но ни одно название с него не начинается
    for (const q of ['баба', 'ёжик', 'эхо', 'бег', 'бабл', 'хаб', 'её', 'баба яга']) {
      const r = searchCatalog(catalog, q)
      expect(r.games, q).toEqual([])
      expect(r.total, q).toBe(0)
      expect(r.layout, q).toBeNull()
      // Подсказка — та же, что у любого русского запроса без находки (см. «строка статуса»)
      expect(searchStatus('ready', q, r), q).toBe(
        'Ничего не нашлось. Русское название есть не у каждой игры — попробуй как в Steam, латиницей',
      )
    }
  })

  /*
   * Но обрывок рядом с длинным словом — не след русского слова: знак в
   * настоящих названиях стоит и после короткого — «vs.», «Mr.», «40,000»,
   * «2:», — а э на клавише апострофа стирается свёрткой, оставляя «I'm»
   * словом «im». Прежде хватало одного обрывка в любом слове запроса, и все
   * эти названия, набранные не в той раскладке, отвечали «Ничего не
   * нашлось». Длинное слово сужает выдачу само: ступени раскладки требуют,
   * чтобы каждое слово начиналось там, где слово названия.
   */
  test('знак после короткого слова названия — не обрывок, если в запросе есть длинное слово', () => {
    const catalog = index(
      'Warhammer 40,000: Space Marine 2',
      'Plants vs. Zombies GOTY Edition',
      'S.T.A.L.K.E.R. 2: Heart of Chornobyl',
      "I'm on Observation Duty",
      'Mr. Prepper',
    )
    const found = (q: string) => {
      const r = searchCatalog(catalog, q)
      return [names(r)[0], r.layout]
    }
    expect(found('Здфтеы мыю Ящьишуы')).toEqual(['Plants vs. Zombies GOTY Edition', 'plants vs. zombies'])
    expect(found('Цфкрфььук 40б000')).toEqual(['Warhammer 40,000: Space Marine 2', 'warhammer 40,000'])
    expect(found('Ькю Зкуззук')).toEqual(['Mr. Prepper', 'mr. prepper'])
    expect(found('Шэь щт Щиыукмфешщт Вген')).toEqual(["I'm on Observation Duty", "i'm on observation duty"])
    expect(found('Ыефдлук 2Ж Руфке ща Срщктщинд')).toEqual([
      'S.T.A.L.K.E.R. 2: Heart of Chornobyl',
      'stalker 2; heart of chornobyl',
    ])
    // Пока длинного слова нет, «Ькю» («mr.») — одни обрывки, как «баба»
    expect(searchCatalog(catalog, 'Ькю').total).toBe(0)
  })

  /*
   * Короткое — не значит обрывок. «ц» — первая клавиша «цшесрук», «Ф» в
   * «Ф Цфн Щге» — целое слово «A»: букв на клавишах знаков в них нет, и
   * они ищутся, как раньше.
   */
  test('короткое слово без знаков — не обрывок: первая клавиша и «A Way Out» ищутся', () => {
    const catalog = index('The Witcher 3: Wild Hunt', 'A Way Out', 'I Am Bread')
    const w = searchCatalog(catalog, 'ц')
    expect(names(w)).toEqual(['The Witcher 3: Wild Hunt', 'A Way Out'])
    expect(w.layout).toBe('w')
    expect(names(searchCatalog(catalog, 'Ф Цфн Щге'))).toEqual(['A Way Out'])
    expect(names(searchCatalog(catalog, 'Ш Фь Икуфв'))).toEqual(['I Am Bread'])
  })

  /*
   * Двухбуквенное «да» в QWERTY — «lf», и оно сидит внутри «Half-Life».
   * Раскладку перепутали — но слово всё равно набирали с начала, поэтому
   * переведённый запрос ищется только с начала слов.
   */
  test('переведённый запрос не цепляет кусок посреди слова', () => {
    const r = searchCatalog(index('Half-Life 2'), 'да')
    expect(r.games).toEqual([])
    expect(r.layout).toBeNull()
  })

  /*
   * Подсказку видят и слышат в строке статуса: «… по «baldur s gate»» —
   * свёртка без апострофа — выглядела опечаткой ровно там, где сказано, что
   * искали (сейчас свёртка дала бы «baldurs gate» — тоже не то, что набрано).
   * Сопоставление по-прежнему свёрнутое.
   */
  test('раскладку называют как набрано — с апострофом и дефисом, а не свёрнутой', () => {
    const baldur = searchCatalog(index("Baldur's Gate 3"), 'ифдвгкэы пфеу')
    expect(names(baldur)).toEqual(["Baldur's Gate 3"])
    expect(baldur.layout).toBe("baldur's gate")
    const halfLife = searchCatalog(index('Half-Life 2'), 'рфда-дшау')
    expect(names(halfLife)).toEqual(['Half-Life 2'])
    expect(halfLife.layout).toBe('half-life')
  })

  test('лишние пробелы в названной раскладке схлопнуты', () => {
    expect(searchCatalog(index('The Witcher 3: Wild Hunt'), '  цшесрук   3 ').layout).toBe('witcher 3')
  })

  test('раскладка не названа, если найденное пришло без неё', () => {
    const r = searchCatalog(index('Ёлки-палки'), 'елки')
    expect(r.layout).toBeNull()
  })
})

describe('стрелки по списку', () => {
  test('вниз — по кругу, из «ничего» — первая', () => {
    expect(stepActive(-1, 3, 'ArrowDown')).toBe(0)
    expect(stepActive(0, 3, 'ArrowDown')).toBe(1)
    expect(stepActive(2, 3, 'ArrowDown')).toBe(0)
  })

  test('вверх — по кругу, из «ничего» — последняя', () => {
    expect(stepActive(-1, 3, 'ArrowUp')).toBe(2)
    expect(stepActive(2, 3, 'ArrowUp')).toBe(1)
    expect(stepActive(0, 3, 'ArrowUp')).toBe(2)
  })

  test('список стал короче выбранного — выбор встаёт в его пределы', () => {
    expect(stepActive(7, 3, 'ArrowDown')).toBe(0)
    expect(stepActive(7, 3, 'ArrowUp')).toBe(2)
  })

  test('строк нет — выбирать нечего', () => {
    expect(stepActive(-1, 0, 'ArrowDown')).toBe(-1)
    expect(stepActive(2, 0, 'ArrowUp')).toBe(-1)
  })
})

describe('строка статуса', () => {
  const found = (total: number, shown = Math.min(total, SEARCH_SHOWN), layout: string | null = null) => ({
    games: Array.from({ length: shown }, (_, i) => ({ appid: i + 1, name: `G${i}` })),
    total,
    layout,
  })

  test('пустой запрос — пустая строка: говорить не о чем', () => {
    expect(searchStatus('ready', '', found(0))).toBe('')
    expect(searchStatus('loading', ' ', found(0))).toBe('')
  })

  test('каталог ещё едет — так и сказано, если уже есть что искать', () => {
    expect(searchStatus('loading', 'port', found(0))).toBe('Загружаю каталог…')
    expect(searchStatus('idle', 'port', found(0))).toBe('Загружаю каталог…')
  })

  test('отказ звучит и без запроса — кнопка повтора рядом', () => {
    expect(searchStatus('failed', '', found(0))).toMatch(/^Каталог не загрузился/)
  })

  test('число найденного — с согласованными глаголом и существительным', () => {
    expect(searchStatus('ready', 'x', found(1))).toBe('Нашлась 1 игра')
    expect(searchStatus('ready', 'x', found(3))).toBe('Нашлись 3 игры')
    expect(searchStatus('ready', 'x', found(5))).toBe('Нашлось 5 игр')
    expect(searchStatus('ready', 'x', found(21))).toBe('Нашлась 21 игра, вот первые 8')
  })

  test('больше, чем показано, — сказано, что это первые', () => {
    expect(searchStatus('ready', 'space', found(37))).toBe('Нашлось 37 игр, вот первые 8')
  })

  test('найдено через раскладку — сказано, по какому запросу', () => {
    expect(searchStatus('ready', 'цшесрук', found(2, 2, 'witcher'))).toBe('Нашлись 2 игры по «witcher»')
  })

  /*
   * Русский запрос ищет и русские названия (второе название игры, см.
   * «два названия»), но они есть только у игр, которым его дал Steam. Прежняя
   * подсказка — «названия здесь… обычно латиницей» — говорила, что по-русски
   * искать незачем, а теперь «ведьмак» находит; сказано, почему не нашлось
   * здесь и что набрать.
   */
  test('ничего — и подсказка, если искали по-русски', () => {
    expect(searchStatus('ready', 'zzz', found(0))).toBe('Ничего не нашлось')
    expect(searchStatus('ready', 'гонки', found(0))).toBe(
      'Ничего не нашлось. Русское название есть не у каждой игры — попробуй как в Steam, латиницей',
    )
  })
})

/*
 * Разметка окна — чтением исходника, как у остальных сторожей доступности:
 * комбобокс без браузера не прогнать, а ломается он одним атрибутом —
 * поле теряет связь со списком, строка встаёт в обход Tab, и скринридер
 * перестаёт слышать, что под полем вообще есть список.
 */
describe('окно поиска — комбобокс по шаблону ARIA', () => {
  const src = fs
    .readFileSync(path.join(__dirname, '..', 'components', 'CatalogSearch.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  /** Открывающий тег целиком — до `>` вне {} и строк (как в lib/liveregion.test.ts) */
  function openingTag(name: string, marker = ''): string {
    let from = 0
    for (;;) {
      const at = src.indexOf(`<${name}`, from)
      if (at < 0) throw new Error(`<${name}${marker ? ` с ${marker}` : ''}> не найден — сторож ослеп`)
      let depth = 0
      let q: string | null = null
      for (let j = at; j < src.length; j++) {
        const c = src[j]
        if (q) {
          if (c === q && src.charCodeAt(j - 1) !== 92) q = null
          continue
        }
        if (c === '"' || c === "'" || c === '`') q = c
        else if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) {
          const tag = src.slice(at, j + 1).replace(/\s+/g, ' ')
          if (tag.includes(marker)) return tag
          break
        }
      }
      from = at + 1
    }
  }

  test('окно — модальный диалог с именем', () => {
    const dialog = openingTag('div', 'role="dialog"')
    expect(dialog).toContain('aria-modal="true"')
    expect(dialog).toMatch(/aria-label="[^"]+"/)
  })

  test('поле — комбобокс, связанный со списком, с выбранной строкой через activedescendant', () => {
    const input = openingTag('input')
    for (const attr of [
      'role="combobox"',
      'aria-controls={listId}',
      'aria-autocomplete="list"',
      'aria-expanded={',
      'aria-activedescendant={',
    ]) {
      expect(input, attr).toContain(attr)
    }
    expect(src, 'у поля есть подпись').toMatch(/<label htmlFor=\{`\$\{id\}-q`\}/)
  })

  test('список — listbox с тем id, на который указывает поле', () => {
    const list = openingTag('div', 'role="listbox"')
    expect(list).toContain('id={listId}')
    expect(list).toMatch(/aria-label="[^"]+"/)
  })

  test('строки — option, выбор объявлен, из обхода Tab вынуты', () => {
    const option = openingTag('GameLink')
    expect(option).toContain('role="option"')
    expect(option).toContain('aria-selected={')
    expect(option).toContain('tabIndex={-1}')
    expect(option).toContain('id={optionId(i)}')
  })

  /*
   * Серии различаются хвостом названия: «The Legend of Heroes: Trails of Cold
   * Steel», «… II», «… III», «… IV»; «The Dark Pictures Anthology: House of
   * Ashes» и она же «- Friend's Pass». Строка в одну линию с многоточием
   * на телефоне (~265 px у текста при ширине 375) показывала четыре
   * одинаковых «Trails of C…», а полное название жило только в title —
   * подсказке, которой у пальца нет. Название переносится, и хвост виден.
   * Сторож — против «прибраться» обратно в truncate.
   */
  test('название в строке переносится, а не режется многоточием', () => {
    const row = src.slice(src.indexOf('<GameLink'), src.indexOf('</GameLink>'))
    expect(row, 'строка найдена').toContain('{g.name}')
    expect(row).not.toMatch(/\btruncate\b|line-clamp-|title=\{g\.name\}/)
    expect(row).toMatch(/min-w-0[^"]*break-words|break-words[^"]*min-w-0/)
  })

  test('нашлось по русскому названию — оно в строке вторым рядом', () => {
    const row = src.slice(src.indexOf('<GameLink'), src.indexOf('</GameLink>'))
    expect(row).toMatch(/\{g\.alias && /)
  })
})
