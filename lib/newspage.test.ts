import { describe, expect, test } from 'vitest'
import { DESCRIPTION_MAX } from './clip'
import {
  indexedNewsPath,
  isNewsGid,
  newsDescription,
  newsHeading,
  newsIndexable,
  newsPageTitle,
  newsPath,
  patchShareUrl,
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
