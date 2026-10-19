import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LocaleProvider } from '../components/LocaleProvider'
import { useShareLink } from '../components/ShareLink'
import { SwipeDeck, type DeckCard } from '../components/SwipeDeck'
import { CeremonyFallback } from '../components/room/CeremonyBoundary'
import { LeaderPick } from '../components/room/LeaderPick'
import { MyLikesRail, NearMissList } from '../components/room/LikesStrips'
import { MatchOwners, type MatchOwnersGame } from '../components/room/MatchOwners'
import { MatchShare } from '../components/room/MatchShare'
import { MemberRoster } from '../components/room/MemberRoster'
import { RoomWaiting } from '../components/room/RoomWaiting'
import { cyrillicRuns } from './cyrillicruns'
import { sessionPhrase, sessionTrait } from './gametraits'
import type { Locale } from './i18n'
import type { RoomMemberView } from './room'
import { inviteDoor } from './roominvite'
import { withForeignRuns } from './textlang'
import { reach, rel, ROOT } from './testing/importgraph'
import type { GameMeta } from './types'

/**
 * Пати на /en — экраны, которые видит участник, без браузера.
 *
 * Тесты комнаты сторожат русские строки (lib/roomclient, lib/matchscreen,
 * lib/disabledfocus) и молчали бы, оставь перевод на английской странице
 * хоть одну русскую подпись: функция не знает, позвали её с языком или нет.
 * Здесь те же экраны рисуются под английским языком страницы и не имеют
 * права нести кириллицу — кроме ников из Steam, которые не переводят.
 * Русский без провайдера — тот же, что и с русским провайдером: язык по
 * умолчанию.
 *
 * Компоненты, которым нужны браузер и роутер (страница комнаты, RoomCodeForm),
 * проверяет прогон i18n-audit по живым страницам.
 */

const CYRILLIC = /[А-Яа-яЁё]/

/** Видимый текст и атрибуты для человека — без разметки и имён классов */
function human(html: string): string {
  const attrs = [...html.matchAll(/\s(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map((m) => m[1])
  return [html.replace(/<[^>]+>/g, ' '), ...attrs].join(' ')
}

function draw(node: ReactElement, locale?: Locale): string {
  return renderToStaticMarkup(
    locale ? createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, node) : node,
  )
}

/**
 * Разметка без того, что честно помечено lang="ru" (ник, название): что
 * осталось с кириллицей, английский голос прочтёт по буквам. «(you)» внутри
 * помеченной строки ростера возвращает себе lang="en" — его текст остаётся.
 */
function bare(html: string): string {
  let prev: string
  do {
    prev = html
    html = html
      .replace(/<span lang="en">([^<]*)<\/span>/g, '$1')
      .replace(/<(\w+)\b[^>]*\slang="ru"[^>]*>[^<]*<\/\1>/g, '')
  } while (html !== prev)
  return html
}

const member = (over: Partial<RoomMemberView>): RoomMemberView => ({
  id: 'k1',
  name: 'Mia',
  me: false,
  votes: 0,
  done: false,
  ...over,
})

describe('запасной экран матча по-английски', () => {
  const game = { appid: 620, name: 'Portal 2', store: null, storeUrl: null }

  test("матч — «It's a match», ссылка в Steam целиком, повтор — «Reload page»", () => {
    const html = draw(createElement(CeremonyFallback, { game, memberCount: 2, takeFocus: false }), 'en')
    expect(html).toMatch(/<h1 tabindex="-1"[^>]*>It&#x27;s a match: “Portal 2”<\/h1>/)
    expect(html).toContain('>Open in Steam</a>')
    expect(html).toContain('Reload page')
    expect(human(html)).not.toMatch(CYRILLIC)
  })

  test('лидер голосов — «Agreed» и честный счёт', () => {
    const html = draw(
      createElement(CeremonyFallback, { game: { ...game, forCount: 3 }, memberCount: 4, takeFocus: false }),
      'en',
    )
    expect(html).toMatch(/<h1 tabindex="-1"[^>]*>Agreed: “Portal 2”<\/h1>/)
    expect(html).toContain('3 of 4 said yes')
    expect(human(html)).not.toMatch(CYRILLIC)
  })

  test('магазин без метки — «Open store page»', () => {
    const html = draw(
      createElement(CeremonyFallback, {
        game: { appid: -4, name: 'X', store: 'gog', storeUrl: 'https://gog.com/x' },
        memberCount: 2,
        takeFocus: false,
      }),
      'en',
    )
    expect(html).toContain('>Open store page</a>')
  })

  test('русский — без провайдера и с русским провайдером один и тот же', () => {
    const el = createElement(CeremonyFallback, { game, memberCount: 2, takeFocus: false })
    expect(draw(el, 'ru')).toBe(draw(el))
  })
})

describe('«Go with it» по-английски', () => {
  const leader = { appid: 620, name: 'Portal 2', headerImage: null, art: null, forCount: 3, memberCount: 4 }
  const html = (taking: boolean, miss: 'stale' | 'failed' | null = null) =>
    draw(createElement(LeaderPick, { leader, taking, miss, onTake: () => {} }), 'en')

  test('вопрос, счёт и кнопка — глоссарием', () => {
    const idle = html(false)
    expect(idle).toContain('Go with “Portal 2”?')
    expect(idle).toMatch(/>3<\/span> of <span[^>]*>4<\/span> said yes\./)
    expect(idle).toMatch(/<button[^>]*aria-disabled="false"[^>]*>Go with it<\/button>/)
    expect(html(true)).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Going with it…<\/button>/)
    for (const miss of ['stale', 'failed'] as const) expect(human(html(false, miss))).not.toMatch(CYRILLIC)
  })
})

describe('«почти совпали» и свои «играем» по-английски', () => {
  const near = [
    { forNames: ['Mia', 'Leo'], pendingNames: ['Sam'], meFor: true, mePending: false, games: 1 },
    { forNames: ['Mia', 'Sam'], pendingNames: [], meFor: false, mePending: true, games: 3 },
  ]

  test('порядок английский: число после «yes on», а не после глагола', () => {
    const html = renderToStaticMarkup(createElement(NearMissList, { near, locale: 'en' }))
    expect(html).toContain('Almost a match')
    expect(html).toMatch(/Mia and Leo: yes on<\/span><span[^>]*>1<\/span><span[^>]*>game\.<\/span>/)
    expect(html).toMatch(/>3<\/span><span[^>]*>games\.<\/span>/)
    // Без двоеточия: «Ждём: …» прячет падеж ника, у английского предлога его нет
    expect(html).toContain('Waiting for Sam.')
    expect(html).toContain('Waiting for you.')
    expect(human(html)).not.toMatch(CYRILLIC)
  })

  test('три имени и больше — английским списком «A, B and C», а не « and » между каждой парой', () => {
    const many = [{ forNames: ['Mia', 'Leo', 'Sam'], pendingNames: ['Ann', 'Max', 'Zoe'], meFor: false, mePending: false, games: 2 }]
    const html = renderToStaticMarkup(createElement(NearMissList, { near: many, locale: 'en' }))
    expect(html).toContain('Mia, Leo and Sam: yes on')
    expect(html).toContain('Waiting for Ann, Max and Zoe.')
  })

  test("рельс своих «играем» — «You're in on N games»", () => {
    const games = [{ appid: 620, name: 'Portal 2', headerImage: null, art: null }]
    const html = renderToStaticMarkup(createElement(MyLikesRail, { games, locale: 'en' }))
    expect(html).toMatch(/You&#x27;re in on <span[^>]*>1<\/span> game/)
    expect(human(html)).not.toMatch(CYRILLIC)
  })

  test('без языка — прежний русский', () => {
    const html = renderToStaticMarkup(createElement(NearMissList, { near }))
    expect(html).toContain('Mia и Leo: совпала')
    expect(html).toContain('Ждём: Sam.')
  })
})

describe('кому не хватает игры — по-английски', () => {
  const base: MatchOwnersGame = {
    appid: 1091500,
    store: null,
    storeUrl: null,
    ownedByMe: true,
    missingFor: ['Leo', 'Sam'],
    isFree: false,
    priceFinal: 199_900,
    priceCc: 'ru',
    unsold: false,
    discount: null,
  }

  test('«Not owned by» и «Gift it on the Steam store» — словами колоды и глоссария', () => {
    const html = draw(createElement(MatchOwners, { game: base }), 'en')
    expect(html).toContain('Not owned by: <span class="text-ink">Leo, Sam</span>')
    expect(html).toContain('>Gift it on the Steam store</a>')
  })

  test("нет и у смотрящего — «You don't own it yet» и «Also not owned by»", () => {
    const html = draw(createElement(MatchOwners, { game: { ...base, ownedByMe: false, missingFor: ['Leo'] } }), 'en')
    expect(html).toContain('You don&#x27;t own it yet')
    expect(html).toContain('Also not owned by: <span class="text-ink">Leo</span>')
  })
})

describe('«Поделиться» матчем по-английски', () => {
  test('кнопка — «Share», живая область — с первого кадра', () => {
    const html = draw(createElement(MatchShare, { roomId: 'ABC234', name: 'Dota 2', forCount: 2, memberCount: 2 }), 'en')
    expect(html).toMatch(/<button type="button" class="btn-glass[^"]*">.*Share.*<\/button>/)
    expect(html).toContain('<span role="status" class="sr-only"></span>')
  })
})

describe('ростер по-английски', () => {
  const members = [member({ id: 'a', name: 'Mia', me: true, votes: 20, done: true }), member({ id: 'b', name: 'Leo', votes: 5 })]

  test("«Who's where», «(you)», «Remove … from party» и фраза скринридера", () => {
    const html = draw(
      createElement(MemberRoster, { members, deckSize: 20, isHost: true, onRemove: () => {}, hint: null }),
      'en',
    )
    expect(html).toContain('Who&#x27;s where')
    expect(html).toContain('Mia (you)')
    expect(html).toContain('aria-label="Remove Leo from party"')
    expect(html).toContain('Mia (you): 20 of 20, deck done')
    expect(html).toContain('Leo: 5 of 20, still swiping')
    expect(human(html)).not.toMatch(CYRILLIC)
  })

  test('русский — прежняя фраза скринридера', () => {
    const html = draw(createElement(MemberRoster, { members, deckSize: 20 }))
    expect(html).toContain('Mia (ты): 20 из 20, колода пройдена')
  })
})

/** RoomWaiting с настоящей ссылкой «Поделиться» — ей нужен хук */
function Waiting(props: Omit<ComponentProps<typeof RoomWaiting>, 'share'>) {
  const share = useShareLink('room', () => 'https://imbored.cc/en/room/ABC234?ref=room', 'Party ABC234', 'x')
  return createElement(RoomWaiting, { ...props, share })
}

describe('экран ожидания по-английски', () => {
  const base: Omit<ComponentProps<typeof RoomWaiting>, 'share'> = {
    roomId: 'ABC234',
    isHost: true,
    isPublic: false,
    members: [member({ id: 'a', me: true, votes: 20, done: true })],
    deckSize: 20,
    deckTotal: 20,
    near: [],
    myLikes: [],
    leader: null,
    takingLeader: false,
    leaderMiss: null,
    onTakeLeader: () => {},
    hasMore: true,
    pulling: false,
    pullFailed: false,
    onPullMore: () => {},
    cameFromDeck: false,
    onTogglePublic: () => {},
    onRemoveMember: () => {},
    onLeave: () => {},
    leaving: false,
    leaveMiss: null,
    missedMember: null,
    publicBusy: false,
    publicMiss: null,
  }
  /*
   * «Скопировано» и подписи состояния ссылки — общий components/ShareLink, его
   * переводят отдельно; здесь проверяются слова самой комнаты.
   */
  const ours = (html: string) => human(html)

  test('один в комнате — развилка «Invite friends / Let others in»', () => {
    const html = draw(createElement(Waiting, base), 'en')
    expect(html).toContain('It&#x27;s just you here — no one to match with')
    expect(html).toContain('Invite friends')
    expect(html).toContain('Let others in')
    expect(html).toContain('20 more games')
    expect(html).toContain('Leave party')
    expect(ours(html)).not.toMatch(CYRILLIC)
  })

  test('ждём остальных — заголовок, ростер и строка под ним', () => {
    const html = draw(
      createElement(Waiting, {
        ...base,
        members: [member({ id: 'a', me: true, votes: 20, done: true }), member({ id: 'b', name: 'Leo', votes: 3 })],
      }),
      'en',
    )
    expect(html).toContain('Deck done — waiting for one more')
    expect(html).toContain('The match will show up on its own — no need to refresh.')
    expect(html).toContain('There are 2 of you. Done swiping: 1 of 2.')
    expect(ours(html)).not.toMatch(CYRILLIC)
  })

  test('все отсвайпали, есть лидер — «Go with …?» и «Top pick» скринридеру', () => {
    const html = draw(
      createElement(Waiting, {
        ...base,
        members: [member({ id: 'a', me: true, votes: 20, done: true }), member({ id: 'b', name: 'Leo', votes: 20, done: true })],
        leader: { appid: 620, name: 'Portal 2', headerImage: null, art: null, forCount: 2, memberCount: 2 },
      }),
      'en',
    )
    expect(html).toContain('Everyone&#x27;s done swiping — and not a single match')
    expect(html).toContain('Top pick: “Portal 2”, 2 of 2 said yes.')
    expect(ours(html)).not.toMatch(CYRILLIC)
  })

  test('русское название лидера в живой сводке — своим lang; на русской — та же строка', () => {
    const props = {
      ...base,
      members: [member({ id: 'a', me: true, votes: 20, done: true }), member({ id: 'b', name: 'Leo', votes: 20, done: true })],
      leader: { appid: 892970, name: 'Вальхейм', headerImage: null, art: null, forCount: 2, memberCount: 2 },
    }
    const en = draw(createElement(Waiting, props), 'en')
    expect(en).toContain('Top pick: “<span lang="ru">Вальхейм</span>”, 2 of 2 said yes.</p>')
    expect(human(bare(en))).not.toMatch(CYRILLIC)
    const ru = draw(createElement(Waiting, props), 'ru')
    expect(ru).toContain('Лидер голосов: «Вальхейм», 2 из 2 за.</p>')
    expect(ru).not.toContain('lang="ru"')
  })

  test('пустая колода — «Nothing to choose from»', () => {
    const html = draw(
      createElement(Waiting, {
        ...base,
        members: [member({ id: 'a', me: true }), member({ id: 'b', name: 'Leo' })],
        deckTotal: 0,
        hasMore: false,
      }),
      'en',
    )
    expect(html).toContain('Nothing to choose from')
    expect(ours(html)).not.toMatch(CYRILLIC)
  })
})

describe('колода пати по-английски', () => {
  const card: DeckCard = {
    appid: 892970,
    name: 'Valheim',
    ownedByAll: false,
    missingFor: ['Leo'],
    priceFinal: 49_900,
    priceCc: 'ru',
    headerImage: null,
    tags: ['Survival', 'Open World'],
    session: { label: 'Match', value: '~15 min' },
  }
  const deck = (c: DeckCard, locale?: Locale) =>
    draw(createElement(SwipeDeck, { cards: [c], onVote: () => {}, votedCount: 0, deckTotal: 20, nowSec: 0 }), locale)

  test("кнопки «I'm in / Pass», «Not owned by», цена, сессия и теги — по-английски", () => {
    const html = deck(card, 'en')
    expect(html).toContain('I&#x27;m in')
    expect(html).toContain('Pass')
    expect(html).toContain('Not owned by: Leo · ₽499')
    expect(html).toContain('~15 min matches')
    expect(html).toContain('Survival · Open World')
    expect(human(html)).not.toMatch(CYRILLIC)
  })

  test('бесплатная, своя у всех и не в регионе — без русских хвостов', () => {
    expect(deck({ ...card, isFree: true, priceFinal: undefined }, 'en')).toContain('Not owned by: Leo · free')
    expect(deck({ ...card, unsold: true }, 'en')).toContain('not on Russian Steam')
    expect(human(deck({ ...card, ownedByAll: true }, 'en'))).not.toMatch(CYRILLIC)
  })

  /*
   * Колода говорит сессию своей копией правила sessionPhrase — чтобы не везти
   * lib/gametraits с семантикой в первую загрузку комнаты. Копия обязана
   * совпадать с правилом в каждой ветке: матч, сессия в минутах, на вечер.
   */
  test('фраза сессии на карте — ровно sessionPhrase на обоих языках', () => {
    const semantics = (minutes: number, bucket: string, canStopAnytime: boolean) =>
      ({ confidence: 1, session: { minutes, bucket, canStopAnytime } }) as unknown as GameMeta['semantics']
    const metas: Array<Pick<GameMeta, 'semantics' | 'categories'>> = [
      { semantics: semantics(15, 'short', false), categories: [1, 49] },
      { semantics: semantics(40, 'medium', true), categories: [2] },
      { semantics: semantics(240, 'long', true), categories: [2] },
    ]
    let checked = 0
    for (const locale of ['ru', 'en'] as const) {
      for (const meta of metas) {
        const trait = sessionTrait(meta, locale)
        if (!trait) continue
        checked++
        const html = deck({ ...card, session: trait }, locale)
        expect(html, `${locale}: ${trait.label} ${trait.value}`).toContain(`>${sessionPhrase(trait, locale)}</span>`)
      }
    }
    expect(checked, 'семантика не дала ни одной сессии — сторож ослеп').toBeGreaterThanOrEqual(4)
  })

  test('колода не тянет lib/gametraits в первую загрузку', () => {
    const files = [...reach(path.join(ROOT, 'components/SwipeDeck.tsx')).files].map(rel)
    expect(files).toContain('lib/i18n.ts')
    expect(files, 'семантика и правила длины — в первой загрузке комнаты ради одной фразы').not.toContain(
      'lib/gametraits.ts',
    )
  })

  /*
   * Название игры и ники — данные. На /en русское название («Смута») без
   * lang="ru" английский голос читает по буквам (WCAG 3.1.2): полка под
   * колодой в /explore помечает его (GameCardName), а заголовок карты — нет.
   * Та же пометка — в строке «Card N of M: …» для скринридера, в причине карты
   * /explore (название и ориентир via) и у русского ника в «Not owned by».
   */
  test('русское название и ник на /en — своим lang, латиница — без атрибута', () => {
    const html = deck({ ...card, name: 'Смута', missingFor: ['Вася', 'Leo'] }, 'en')
    expect(html).toContain('<h2 lang="ru" class="font-display text-display-sm">Смута</h2>')
    expect(html).toContain('Card 1 of 20: <span lang="ru">Смута</span>')
    expect(html).toContain('Not owned by: <span lang="ru">Вася</span>, Leo · ₽499')
    const why = deck(
      {
        ...card,
        name: 'Смута',
        via: { appid: 1, name: 'Ведьмак' },
        reason: 'You already have 130 h in “Смута”. Like “Ведьмак”, but calmer.',
      },
      'en',
    )
    expect(why).toContain(
      'You already have 130 h in “<span lang="ru">Смута</span>”. Like “<span lang="ru">Ведьмак</span>”, but calmer.',
    )
    const latin = deck({ ...card, reason: 'You already have 130 h in “Valheim”.' }, 'en')
    expect(latin).toContain('>You already have 130 h in “Valheim”.</p>')
    expect(latin).toContain('<h2 class="font-display text-display-sm">Valheim</h2>')
    expect(latin).toContain('Card 1 of 20: Valheim</p>')
    expect(latin).not.toContain('lang=')
  })

  test('на русской странице пометки нет — разметка прежняя', () => {
    const html = deck({ ...card, name: 'Смута', missingFor: ['Вася'], reason: 'Уже 130 ч в «Смута».' })
    expect(html).toContain('<h2 class="font-display text-display-sm">Смута</h2>')
    expect(html).toContain('>Уже 130 ч в «Смута».</p>')
    expect(html).toContain('Карта 1 из 20: Смута</p>')
    expect(html).toContain('Нет у: Вася · 499')
    expect(html).not.toContain('lang=')
  })

  test('русская колода — прежняя: «Играем!», «Нет у», склейка сессии', () => {
    // сессию сервер присылает на языке запроса — русскую русской странице
    const html = deck({ ...card, session: { label: 'Матч', value: '~15 мин' } })
    expect(html).toContain('Играем!')
    expect(html).toContain('Нет у: Leo')
    expect(html).toContain('матч ~15 мин')
  })
})

/*
 * Ники из Steam и названия игр — данные, их не переводят (docs/i18n.md,
 * «Чего НЕ переводить»), но голос скринридера выбирается по lang: на /en
 * русский ник («Вася Пупкин») и русское название (часть каталога хранится
 * только по-русски) без пометки английский голос читает по буквам (WCAG
 * 3.1.2). Правило одно на сайт — langOn и withForeignRuns из lib/textlang;
 * на русской странице атрибута нет, разметка прежняя до байта.
 */
describe('пати на /en: русский ник и русское название — своим lang', () => {
  const VASYA = 'Вася Пупкин'

  test('ростер: строка с title, фраза скринридера и имя ✕ хоста', () => {
    const members = [
      member({ id: 'a', name: 'Костя', me: true, votes: 20, done: true }),
      member({ id: 'b', name: VASYA, votes: 5 }),
      member({ id: 'c', name: 'Leo', votes: 3 }),
    ]
    const html = draw(
      createElement(MemberRoster, { members, deckSize: 20, isHost: true, onRemove: () => {}, hint: null }),
      'en',
    )
    // видимая строка: lang на самом span — в его title только ник
    expect(html).toMatch(/<span aria-hidden="true" title="Вася Пупкин" lang="ru" class="[^"]*">Вася Пупкин<\/span>/)
    // своя строка: «(you)» внутри помеченной строки — снова английский
    expect(html).toMatch(/title="Костя" lang="ru" class="[^"]*">Костя<span lang="en"> \(you\)<\/span><\/span>/)
    expect(html).toContain('<span lang="ru">Костя</span> (you): 20 of 20, deck done')
    expect(html).toContain('<span lang="ru">Вася Пупкин</span>: 5 of 20, still swiping')
    // имя ✕ — текстом с пометкой: у куска aria-label своего lang не бывает
    expect(html).not.toContain('aria-label="Remove Вася Пупкин from party"')
    expect(html).toContain('<span class="sr-only">Remove <span lang="ru">Вася Пупкин</span> from party</span>')
    expect(html).toContain('title="Remove Вася Пупкин from party"')
    // латинский ник — как был: aria-label и без атрибута lang
    expect(html).toContain('aria-label="Remove Leo from party"')
    expect(html).toContain('Leo: 3 of 20, still swiping')
    // title ✕ — подсказка для глаза; кроме неё кириллицы вне пометки нет
    expect(human(bare(html)).replace('Remove Вася Пупкин from party', '')).not.toMatch(CYRILLIC)
  })

  test('ростер на русской — без пометки, aria-label прежний; латиница на /en — без атрибута', () => {
    const members = [member({ id: 'a', name: 'Костя', me: true, votes: 20, done: true }), member({ id: 'b', name: VASYA, votes: 5 })]
    const el = createElement(MemberRoster, { members, deckSize: 20, isHost: true, onRemove: () => {}, hint: null })
    const ru = draw(el, 'ru')
    expect(ru).toBe(draw(el))
    expect(ru).not.toContain('lang=')
    expect(ru).toContain('aria-label="Убрать Вася Пупкин из пати"')
    expect(ru).toContain('Костя (ты): 20 из 20, колода пройдена')
    const latin = [member({ id: 'a', name: 'Mia', me: true }), member({ id: 'b', name: 'Leo' })]
    const en = draw(createElement(MemberRoster, { members: latin, deckSize: 20, isHost: true, onRemove: () => {} }), 'en')
    expect(en).not.toContain('lang=')
  })

  test('«почти совпали»: ники в «yes on» и в «Waiting for»', () => {
    const near = [{ forNames: [VASYA, 'Leo'], pendingNames: ['Костя', 'Sam'], meFor: false, mePending: false, games: 2 }]
    const en = renderToStaticMarkup(createElement(NearMissList, { near, locale: 'en' }))
    expect(en).toContain('<span lang="ru">Вася Пупкин</span> and Leo: yes on')
    expect(en).toContain('Waiting for <span lang="ru">Костя</span> and Sam.')
    expect(human(bare(en))).not.toMatch(CYRILLIC)
    const ru = renderToStaticMarkup(createElement(NearMissList, { near }))
    expect(ru).toContain('Вася Пупкин и Leo: совпало')
    expect(ru).toContain('Ждём: Костя, Sam.')
    expect(ru).not.toContain('lang=')
  })

  test('рельс своих «играем»: подпись — единственное имя картинки, русская — своим lang', () => {
    const games = [
      { appid: 892970, name: 'Вальхейм', headerImage: null, art: null },
      { appid: 620, name: 'Portal 2', headerImage: null, art: null },
    ]
    const en = renderToStaticMarkup(createElement(MyLikesRail, { games, locale: 'en' }))
    expect(en).toMatch(/<span lang="ru" class="text-\[10px\][^"]*">Вальхейм<\/span>/)
    expect(en).toMatch(/<span class="text-\[10px\][^"]*">Portal 2<\/span>/)
    expect(renderToStaticMarkup(createElement(MyLikesRail, { games }))).not.toContain('lang=')
  })

  test('«Go with “X”?» — русское название своим lang, «Берём «X»?» прежний', () => {
    const leader = { appid: 892970, name: 'Вальхейм', headerImage: null, art: null, forCount: 2, memberCount: 3 }
    const el = createElement(LeaderPick, { leader, taking: false, miss: null, onTake: () => {} })
    expect(draw(el, 'en')).toContain('<h3 class="font-semibold">Go with “<span lang="ru">Вальхейм</span>”?</h3>')
    const ru = draw(el, 'ru')
    expect(ru).toContain('<h3 class="font-semibold">Берём «Вальхейм»?</h3>')
    expect(ru).not.toContain('lang=')
  })

  /*
   * Строки экрана приглашения собирает сервер: ник обрезан с многоточием, а
   * на /en пробелы в метках «Already here» неразрывные (app/api/room/[id]),
   * так что дословно имён ростера в них нет — комната метит куски кириллицы
   * из самой строки (cyrillicRuns). Здесь — те самые строки inviteDoor.
   */
  test('экран приглашения: ник в заголовке, обрезанный и неразрывный — в «Already here», игра — в строке карты', () => {
    const door = inviteDoor(
      {
        host: VASYA,
        names: [VASYA, 'Demo player', 'Константин Константинопольский'].map((n) => n.replace(/ /g, ' ')),
        seed: { appid: 892970, name: 'Вальхейм', headerImage: null, art: null },
      },
      'en',
    )
    const mark = (text: string) =>
      renderToStaticMarkup(createElement('p', null, withForeignRuns('en', text, cyrillicRuns(text))))
    expect(mark(door.title)).toBe('<p><span lang="ru">Вася Пупкин</span> wants to pick tonight&#x27;s game</p>')
    const here = mark(door.here ?? '')
    expect(here).toMatch(
      /^<p>Already here: <span lang="ru">Вася Пупкин<\/span>, Demo player and <span lang="ru">Константин [^<]*…<\/span><\/p>$/,
    )
    expect(bare(here)).not.toMatch(CYRILLIC)
    const seed = door.seed!
    expect(renderToStaticMarkup(createElement('p', null, withForeignRuns('en', seed.line, [seed.name])))).toContain(
      'First card: “<span lang="ru">Вальхейм</span>”.',
    )
  })
})

/** Исходник без комментариев: сторож читает код, а не докблок о нём */
function code(file: string): string {
  return fs
    .readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/*
 * Страница комнаты, доска и «новая комната» без роутера и опроса не
 * рисуются — их строки сторожит код, а живую разметку проверяет прогон
 * scripts/i18n-audit.ts. Сторож — о том, что ник и название идут через
 * пометку, а не голым текстом.
 */
describe('страницы пати метят ники и названия', () => {
  test('комната: состав над колодой, «Removed from party», дверь и матч', () => {
    const src = code('app/[lang]/room/[id]/RoomPage.tsx')
    expect(src).toContain('{langOn(locale, m.name) ? <span lang="ru">{m.name}</span> : m.name}')
    expect(src).toMatch(/withForeignRuns\(\s*locale,\s*kickShown\.phase === 'done'[\s\S]*?\[kickShown\.name\],\s*\)/)
    expect(src).toContain('const doorText = (text: string) => withForeignRuns(locale, text, cyrillicRuns(text))')
    expect(src).toContain('doorText(door.title)')
    expect(src).toContain('doorText(door.here)')
    expect(src).toContain('withForeignRuns(locale, door.seed.line, [door.seed.name])')
    expect(src).toContain('withForeignRuns(locale, matchSaid, [state.matchedGame?.name])')
    expect(src).toMatch(/langOn\(locale, state\.matchedGame\.name\) \? \(\s*<span lang="ru">\{state\.matchedGame\.name\}<\/span>/)
    // голых строк двери не осталось
    expect(src).not.toMatch(/\{door\??\.(?:title|here|seed\.line)\}/)
  })

  test('доска: имена в карточке открытой пати', () => {
    expect(code('app/[lang]/rooms/page.tsx')).toContain(
      "withForeignRuns(locale, `${r.memberNames.join(', ')} · `, r.memberNames)",
    )
  })

  test('новая комната: первая карта', () => {
    expect(code('app/[lang]/room/new/page.tsx')).toContain(
      'withForeignRuns(locale, `First card: “${seedName}”.`, [seedName])',
    )
  })
})
