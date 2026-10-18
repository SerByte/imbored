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

  test('«Поделиться» с /en ведёт на английскую страницу', () => {
    expect(patchShareUrl('https://imbored.cc', 730, '5123894512345', 'en')).toBe(
      'https://imbored.cc/en/game/730/news/5123894512345?ref=patch',
    )
    expect(patchShareUrl('https://imbored.cc', 730, '5123894512345', 'ru')).toBe(
      'https://imbored.cc/game/730/news/5123894512345?ref=patch',
    )
  })
})
