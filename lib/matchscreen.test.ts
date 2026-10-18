import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { MatchOwners, type MatchOwnersGame } from '../components/room/MatchOwners'
import { MatchShare } from '../components/room/MatchShare'
import { matchShareCopy, matchShareUrl } from './matchshare'
import { formatPrice } from './steamregion'
import { storeLink } from './storelink'

/**
 * Экран матча — то, что на нём делают после «Это матч!».
 *
 * Два пробела, которые нашёл аудит. Поделиться сошедшейся пати было нечем:
 * кнопка «Поделиться» жила только в лобби, а на главной эмоции продукта —
 * тупик. И «У тебя её пока нет» слышал один тот, у кого нет: остальные звали
 * его в войс и не знали, что ему сперва в магазин.
 *
 * Компоненты рисуются без браузера (renderToStaticMarkup), а место, куда
 * церемония их ставит, проверяется текстом, как в lib/roomclient.test.ts:
 * сама церемония тянет gsap и без браузера не рисуется.
 */

const ROOT = path.join(__dirname, '..')
const code = (rel: string) =>
  fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('ссылка с экрана матча', () => {
  test('та же комната, своя метка — и ничего из адреса того, кто делится', () => {
    expect(matchShareUrl('https://imbored.cc', 'ABC234')).toBe('https://imbored.cc/room/ABC234?ref=match')
  })

  test('единогласный матч — «голоса всей пати сошлись»', () => {
    const copy = matchShareCopy({ name: 'Deep Rock Galactic', forCount: 4, memberCount: 4 })
    expect(copy.title).toBe('Играем в «Deep Rock Galactic»')
    expect(copy.text).toContain('Deep Rock Galactic')
    expect(copy.text).toContain('сошлись')
  })

  test('матч лидером голосов — честный счёт, а не «все хотят»', () => {
    // То же правило, что у заголовка церемонии (matchByLeader)
    const copy = matchShareCopy({ name: 'Dota 2', forCount: 3, memberCount: 4 })
    expect(copy.text).toContain('3 из 4 за')
    expect(copy.text).not.toContain('сошлись')
  })

  test('без зова «заходите»: сошедшаяся комната новых людей не пускает', () => {
    // join отвечает 409 matched — текст не обещает того, чего не будет
    for (const forCount of [4, 3, null]) {
      const { title, text } = matchShareCopy({ name: 'X', forCount, memberCount: 4 })
      expect(`${title} ${text}`).not.toMatch(/заход/i)
    }
  })

  test('кнопка: «Поделиться», а живая область стоит с первого кадра, пустой', () => {
    const html = renderToStaticMarkup(
      createElement(MatchShare, { roomId: 'ABC234', name: 'Dota 2', forCount: 2, memberCount: 2 }),
    )
    expect(html).toMatch(/<button type="button" class="btn-glass[^"]*">.*Поделиться.*<\/button>/)
    expect(html).toContain('<span role="status" class="sr-only"></span>')
    // запасное поле со ссылкой — только когда скопировать не вышло
    expect(html).not.toContain('<input')
  })

  test('кнопка берёт адрес и текст из этих строителей, а не из адресной строки', () => {
    const src = code('components/room/MatchShare.tsx')
    expect(src).toMatch(/matchShareUrl\(window\.location\.origin, roomId\)/)
    expect(src).toMatch(/matchShareCopy\(/)
    expect(src).not.toMatch(/location\.href/)
  })
})

describe('кому не хватает игры — на экране матча', () => {
  const base: MatchOwnersGame = {
    appid: 1091500,
    store: null,
    storeUrl: null,
    ownedByMe: true,
    missingFor: ['Дима', 'Саша'],
    isFree: false,
    priceFinal: 59900,
    priceCc: 'ru',
    unsold: false,
    discount: null,
  }
  const draw = (game: Partial<MatchOwnersGame>) =>
    renderToStaticMarkup(createElement(MatchOwners, { game: { ...base, ...game } }))
  const PRICE = formatPrice(59900, 'ru')

  test('у всех есть — экран молчит', () => {
    expect(draw({ missingFor: [] })).toBe('')
  })

  test('у тебя есть, у Димы и Саши нет — «Нет у: Дима, Саша» с ценой и «Подарить»', () => {
    const html = draw({})
    expect(html).toContain('Нет у: <span class="text-ink">Дима, Саша</span>')
    expect(html).toContain(PRICE)
    expect(html).not.toContain('У тебя её пока нет')
    // подарок — через страницу игры в магазине: «В корзину», а «в подарок»
    // выбирается уже в корзине
    expect(html).toMatch(/<a href="https:\/\/store\.steampowered\.com\/app\/1091500\/"[^>]*>Подарить — в магазине Steam<\/a>/)
  })

  test('нет ни у тебя, ни у Димы — своя строка с ценой, «Тоже нет у» без второй цены', () => {
    const html = draw({ ownedByMe: false, missingFor: ['Дима'] })
    expect(html).toContain('У тебя её пока нет')
    expect(html).toContain('Тоже нет у: <span class="text-ink">Дима</span>')
    expect(html.split(PRICE)).toHaveLength(2)
    // дарить тому, у кого игры нет самого, — не его кнопка: ему CTA «Открыть в Steam»
    expect(html).not.toContain('Подарить')
  })

  test('нет только у тебя — как было: «У тебя её пока нет · цена»', () => {
    const html = draw({ ownedByMe: false, missingFor: [] })
    expect(html).toContain('У тебя её пока нет')
    expect(html).toContain(PRICE)
    expect(html).not.toContain('Нет у')
  })

  test('цена без региона — без висящей « · »: ценник такую не рисует', () => {
    // старая строка каталога: price_final есть, price_cc нет
    const mine = draw({ ownedByMe: false, missingFor: [], priceCc: null })
    expect(mine).toContain('У тебя её пока нет</p>')
    expect(draw({ priceCc: null })).toContain('Дима, Саша</span></p>')
  })

  test('старый сервер без поля и не участник — молчит о других', () => {
    expect(draw({ missingFor: undefined })).toBe('')
    expect(draw({ missingFor: null })).toBe('')
  })

  test('бесплатную не дарят — «бесплатно» вместо цены и без «Подарить»', () => {
    const html = draw({ isFree: true, priceFinal: null })
    expect(html).toContain('бесплатно')
    expect(html).not.toContain('Подарить')
  })

  test('ноль в цене без isFree — тоже «бесплатно», и тоже без «Подарить»', () => {
    // раздача «забери навсегда»: price_final 0 при скидке 100 %, is_free не
    // тронут. Ценник по тому же правилу говорит «бесплатно» — а подарок рядом
    // с «бесплатно» предлагал бы купить то, что раздают
    const html = draw({ isFree: false, priceFinal: 0 })
    expect(html).toContain('бесплатно')
    expect(html).not.toContain('Подарить')
  })

  test('не продаётся в магазине региона — подарить её там тоже нельзя', () => {
    const html = draw({ unsold: true })
    expect(html).toContain('не продаётся')
    expect(html).not.toContain('Подарить')
  })

  test('игра другого магазина — без «Подарить в Steam»', () => {
    const html = draw({ appid: -3, store: 'epic', storeUrl: 'https://store.epicgames.com/x' })
    expect(html).toContain('Нет у:')
    expect(html).not.toContain('Подарить')
  })

  test('владение не знаем (нет снапшота) — подарок не предлагаем', () => {
    // CTA такому и так ведёт в магазин; «Подарить» рядом — догадка о его библиотеке
    expect(draw({ ownedByMe: null })).not.toContain('Подарить')
  })
})

/**
 * Весть «Играем в X» уходит тем, кто опоздал к выбору, — а они в комнате не
 * участники и попадают на экран «Эта пати уже договорилась». Ссылки на игру
 * там не было: только своя комната и чужие пати, хотя другу, которому
 * сказали «играем в X», чаще всего надо её купить или поставить.
 */
describe('не участник на сошедшейся комнате — где взять игру', () => {
  test('игра Steam — её страница в магазине', () => {
    expect(storeLink({ appid: 620, store: null, storeUrl: null })).toEqual({
      href: 'https://store.steampowered.com/app/620/',
      where: 'Steam',
    })
  })

  test('игра другого магазина — его ссылка и его имя', () => {
    expect(storeLink({ appid: -3, store: 'epic', storeUrl: 'https://store.epicgames.com/x' })).toEqual({
      href: 'https://store.epicgames.com/x',
      where: 'Epic Games',
    })
    // магазин без метки — не выдуманное имя, а просто «в магазине»
    expect(storeLink({ appid: -4, store: 'gog', storeUrl: 'https://gog.com/x' })?.where).toBe('магазине')
  })

  test('чужой магазин без ссылки — молчим, а не ведём на /app/-3/', () => {
    expect(storeLink({ appid: -3, store: 'epic', storeUrl: null })).toBeNull()
  })

  test('экран берёт ссылку из того же правила и ставит её над абзацем о закрытой комнате', () => {
    const room = code('app/[lang]/room/[id]/page.tsx')
    const start = room.indexOf("state.room.status === 'matched' && state.matchedGame && !state.isMember")
    expect(start).toBeGreaterThan(-1)
    const screen = room.slice(start, room.indexOf('<MatchCeremony', start))
    expect(screen).toMatch(/const shop = storeLink\(state\.matchedGame\)/)
    expect(screen).toMatch(
      /<a\s+href=\{shop\.href\}\s+target="_blank"\s+rel="noreferrer"[^>]*>\s*Открыть «\{state\.matchedGame\.name\}» в \{shop\.where\}\s*<\/a>/,
    )
    // тихая ссылка под заголовком, а главная кнопка — по-прежнему своя комната
    const h1 = screen.indexOf('</h1>')
    const link = screen.indexOf('href={shop.href}')
    const own = screen.indexOf('href="/room/new"')
    expect(h1).toBeGreaterThan(-1)
    expect(link).toBeGreaterThan(h1)
    expect(own).toBeGreaterThan(link)
    const anchor = screen.slice(screen.lastIndexOf('<a', link), screen.indexOf('</a>', link))
    expect(anchor).toContain('text-dim')
    expect(anchor).not.toMatch(/btn-/)
  })

  /**
   * Не-участник здесь — не всегда чужой. Профиль, сидящий в пати со входом
   * через Steam, открытый по вставленной ссылке, опрос видит isMember=false и
   * needSteam=true (lib/roomseat). Весть «Играем в X» (MatchShare) уходит в
   * чат ровно этим адресом — и свой, открывший её на телефоне, читал «новых
   * людей в неё уже не пускают»: что его в пати нет, и без пути к своему
   * экрану матча. Экран приглашения открытой комнаты needSteam знал всегда.
   */
  test('свой по ссылке (needSteam) — не «не пускают», а вход через Steam к экрану матча', () => {
    const room = code('app/[lang]/room/[id]/page.tsx')
    const start = room.indexOf("state.room.status === 'matched' && state.matchedGame && !state.isMember")
    const screen = room.slice(start, room.indexOf('<MatchCeremony', start))
    const fork = screen.indexOf('state.needSteam ? (')
    expect(fork, 'развилки needSteam на экране нет').toBeGreaterThan(screen.indexOf('</h1>'))
    const other = screen.indexOf(') : (', fork)
    expect(other).toBeGreaterThan(fork)
    const steam = screen.slice(fork, other)
    expect(steam).toContain('href={`/api/auth/steam?join=${roomId}`}')
    expect(steam).toMatch(/>\s*Войти через Steam\s*</)
    expect(steam).not.toMatch(/не пускают|room\/new/)
    // а «не пускают» и своя комната — чужому, в другой ветке
    expect(screen.slice(other)).toMatch(/не пускают[\s\S]*href="\/room\/new"/)
  })

  test('запасной экран матча отвечает на «где взять» тем же правилом', () => {
    expect(code('components/room/CeremonyBoundary.tsx')).toMatch(/const link = storeLink\(game\)/)
  })
})

describe('церемония: куда это встаёт', () => {
  const ceremony = code('components/MatchCeremony.tsx')

  test('строки владения и «Поделиться» — в кадре CTA, под главной кнопкой', () => {
    const cta = ceremony.indexOf('<div data-beat="cta"')
    const foot = ceremony.indexOf('<div data-beat="foot"')
    expect(cta).toBeGreaterThan(-1)
    const block = ceremony.slice(cta, foot)
    const magnet = block.indexOf('</Magnet>')
    const owners = block.indexOf('<MatchOwners')
    const share = block.indexOf('<MatchShare')
    expect(magnet).toBeGreaterThan(-1)
    expect(owners).toBeGreaterThan(magnet)
    expect(share).toBeGreaterThan(owners)
    // своя строка «У тебя её пока нет» теперь живёт в MatchOwners — не дважды
    expect(ceremony).not.toContain('У тебя её пока нет')
  })

  test('кнопке достаётся код комнаты и счёт — те же, что у заголовка', () => {
    expect(ceremony).toMatch(/<MatchShare[^>]*roomId=\{roomId\}/)
    expect(ceremony).toMatch(/<MatchShare[^>]*forCount=\{forCount\}/)
    expect(ceremony).toMatch(/<MatchShare[^>]*memberCount=\{memberCount\}/)
    expect(code('app/[lang]/room/[id]/page.tsx')).toMatch(/<MatchCeremony[^>]*roomId=\{roomId\}/)
  })

  test('новое — в куске церемонии, а не в начальном наборе комнаты', () => {
    // /room/[id] стоит у самого потолка бюджета (bundle-budget.json): MatchShare
    // и MatchOwners импортирует только церемония, которую страница догружает
    const room = code('app/[lang]/room/[id]/page.tsx')
    expect(room).not.toMatch(/MatchShare|MatchOwners|lib\/matchshare/)
  })
})
