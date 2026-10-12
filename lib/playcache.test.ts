import { afterEach, describe, expect, test, vi } from 'vitest'
import { PLAN_HOLD_MS } from './eveningplan'
import { NEUTRAL_MOOD } from './mood'
import {
  PLAY_CACHE_TTL_MS,
  PLAY_CACHE_VERSION,
  WARM_MARK_TTL_MS,
  forgetPlay,
  hasFreshDeal,
  hasFreshWarm,
  heldPlanned,
  parsePlayCache,
  parseRecentBans,
  parseWarmMark,
  playCacheKey,
  playCacheStore,
  readRecentBans,
  recentlyBanned,
  rememberBan,
  restoreDeal,
  viewerFrom,
  warmIsFresh,
  warmMarkStore,
  whoAmI,
  withBan,
  type PlayCache,
} from './playcache'
import { unkeyDeal } from './mutetags'
import { forgetPlanned } from './planforget'
import type { PlayPick } from './playflow'
import { runWarmup, startPrewarm } from './warmup'

const ME = '76561197960287930'
const OTHER = '76561197960265728'
const NOW = 1_780_000_000_000
const KEY = playCacheKey({ mood: NEUTRAL_MOOD, focus: null, roulette: false, lean: null })

function pick(appid: number, name = `Game ${appid}`): PlayPick {
  return {
    appid,
    name,
    source: 'familiar',
    reason: 'потому что',
    headerImage: null,
    art: null,
    ccu: null,
    ccuAt: null,
    about: null,
    tags: ['Co-op'],
    hoursPlayed: 12,
    store: null,
    storeUrl: null,
    priceFinal: null,
    priceCc: null,
    unsold: false,
    isFree: null,
    discount: null,
    signals: null,
    via: null,
    deferred: null,
    edge: null,
    refund: false,
  }
}

function entry(over: Partial<PlayCache> = {}): PlayCache {
  return {
    v: PLAY_CACHE_VERSION,
    key: KEY,
    viewer: ME,
    at: NOW,
    deal: {
      picks: [pick(10), pick(20), pick(30)],
      discoveries: [pick(40)],
      continueGame: { appid: 570, name: 'Dota 2', recentHours: 3, finishable: false },
      engine: 'heuristic',
      lean: 'fresh',
      scope: 'library',
      seed: null,
      nudge: null,
      nowSec: Math.floor(NOW / 1000),
      viewer: ME,
      playtimeHidden: false,
      plan: { appid: 1145360, name: 'Hades', intent: 'tonight' },
    },
    hero: 20,
    liked: [10],
    planned: [],
    seenAt: NOW,
    ...over,
  }
}

const NO_BANS = new Set<number>()

describe('playCacheKey', () => {
  test('каждая часть запроса из адреса меняет ключ', () => {
    const base = { mood: NEUTRAL_MOOD, focus: null, roulette: false, lean: null } as const
    const keys = [
      playCacheKey(base),
      playCacheKey({ ...base, mood: { ...NEUTRAL_MOOD, time: 'long' } }),
      playCacheKey({ ...base, focus: 'untouched' }),
      playCacheKey({ ...base, roulette: true }),
      playCacheKey({ ...base, lean: 'lowenergy' }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('тот же запрос — тот же ключ', () => {
    const q = { mood: { ...NEUTRAL_MOOD }, focus: null, roulette: false, lean: null } as const
    expect(playCacheKey(q)).toBe(KEY)
  })

  // /play?…&seed= — «похожие на X» со страницы игры. Обычная выдача того же
  // настроения, запомненная минуту назад, не должна встать на их место
  test('затравка с адреса меняет ключ; без неё ключ прежний — старые записи узнаются', () => {
    const base = { mood: NEUTRAL_MOOD, focus: null, roulette: false, lean: null } as const
    expect(playCacheKey({ ...base, seed: 1145360 })).not.toBe(KEY)
    expect(playCacheKey({ ...base, seed: 1145360 })).not.toBe(playCacheKey({ ...base, seed: 620 }))
    expect(playCacheKey({ ...base, seed: null })).toBe(KEY)
    expect(KEY).toBe('medium.chill.solo|||')
  })
})

describe('parsePlayCache', () => {
  test('своя запись проходит туда и обратно через JSON', () => {
    const e = entry()
    expect(parsePlayCache(JSON.parse(JSON.stringify(e)))).toEqual(e)
  })

  test('скрытое время переживает запись; запись до этого поля — без строки о галочке', () => {
    const e = entry()
    const hidden = { ...e, deal: { ...e.deal, playtimeHidden: true } }
    expect(parsePlayCache(JSON.parse(JSON.stringify(hidden)))?.deal.playtimeHidden).toBe(true)
    const old: Record<string, unknown> = { ...e.deal }
    delete old.playtimeHidden
    expect(parsePlayCache({ ...e, deal: old })?.deal.playtimeHidden).toBe(false)
  })

  // Запись до плана на вечер — выдача без него, а не битая запись: план —
  // строка сбоку, и прогрев заново ради неё был бы дороже, чем её потеря
  test('план на вечер переживает запись; запись без него — выдача без плана', () => {
    const e = entry()
    const old: Record<string, unknown> = { ...e.deal }
    delete old.plan
    expect(parsePlayCache({ ...e, deal: old })?.deal.plan).toBeNull()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, plan: { appid: 0 } } })?.deal.plan).toBeNull()
  })

  /*
   * Отложенные на вечер в этом заходе (app/play: «Не то — дальше» у них
   * листает без пропуска) едут с выдачей: иначе «Подробнее» → «Назад» их
   * забывал, и пропуск закрывал план через минуту после того, как он
   * поставлен. Запись до этого поля — выдача без отложенных, а не битая
   * запись: версия та же, и прогрев заново ради пустого списка не нужен.
   */
  test('отложенные на вечер переживают запись; запись без них — пустой список', () => {
    const e = entry({ planned: [20, 1145360] })
    expect(parsePlayCache(JSON.parse(JSON.stringify(e)))?.planned).toEqual([20, 1145360])
    const old: Record<string, unknown> = { ...e }
    delete old.planned
    expect(parsePlayCache(old)?.planned).toEqual([])
    // мусор — поштучно и без потери выдачи: план не стоит прогрева заново
    expect(parsePlayCache({ ...e, planned: 'all' })?.planned).toEqual([])
    expect(parsePlayCache({ ...e, planned: ['20', 30, 1.5] })?.planned).toEqual([30])
  })

  /*
   * Когда выдачу последний раз видели на экране — срок отложенных
   * (heldPlanned), а не приход выдачи. Запись до этого поля и мусор в нём —
   * приход выдачи: срок у списка тот же час, только от at, а запись цела и
   * версия та же — прогрев заново ради одной метки дороже её самой.
   */
  test('время последнего показа переживает запись; без него и с мусором — приход выдачи', () => {
    const e = entry({ at: NOW - 20 * 60_000, seenAt: NOW - 60_000, planned: [20] })
    expect(parsePlayCache(JSON.parse(JSON.stringify(e)))?.seenAt).toBe(NOW - 60_000)
    const old: Record<string, unknown> = { ...e }
    delete old.seenAt
    expect(parsePlayCache(old)?.seenAt).toBe(NOW - 20 * 60_000)
    for (const seenAt of ['вчера', String(NOW), null, Infinity, NaN]) {
      expect(parsePlayCache({ ...e, seenAt })?.seenAt, String(seenAt)).toBe(NOW - 20 * 60_000)
    }
  })

  test('запись прошлой версии сайта не узнаётся', () => {
    expect(parsePlayCache({ ...entry(), v: 0 })).toBeNull()
    expect(parsePlayCache({ ...entry(), v: undefined })).toBeNull()
  })

  test('карточка без региона цены (версия 1) не узнаётся: у её ценника нет валюты', () => {
    expect(PLAY_CACHE_VERSION).toBe(2)
    const e = entry()
    const bare = (p: PlayPick) => {
      const rest: Record<string, unknown> = { ...p }
      delete rest.priceCc
      delete rest.unsold
      return rest
    }
    const v1 = { ...e, v: 1, deal: { ...e.deal, picks: e.deal.picks.map(bare) } }
    expect(parsePlayCache(JSON.parse(JSON.stringify(v1)))).toBeNull()
  })

  test('одна битая карточка — вся запись мимо', () => {
    const e = entry()
    const broken = { ...e, deal: { ...e.deal, picks: [pick(10), { appid: 20, name: 'X' }] } }
    expect(parsePlayCache(broken)).toBeNull()
    const noTags = { ...e, deal: { ...e.deal, discoveries: [{ ...pick(40), tags: 'Co-op' }] } }
    expect(parsePlayCache(noTags)).toBeNull()
  })

  test('мусор вместо записи — null, а не исключение', () => {
    for (const raw of [null, 42, 'deal', [], {}, { ...entry(), at: 'вчера' }, { ...entry(), liked: ['10'] }]) {
      expect(parsePlayCache(raw)).toBeNull()
    }
  })

  test('пустая выдача и чужой источник — не выдача', () => {
    const e = entry()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, picks: [] } })).toBeNull()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, scope: 'everything' } })).toBeNull()
  })

  test('запись и выдача внутри неё обязаны быть одного человека', () => {
    const e = entry()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, viewer: OTHER } })).toBeNull()
  })

  test('мусор в оси — «без оси», запись при этом жива', () => {
    const e = entry()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, lean: 'sideways' } })?.deal.lean).toBeNull()
  })

  test('выдача из соседей «Как «X», но…» возвращается со своей затравкой', () => {
    const e = entry()
    const seeded = { ...e, deal: { ...e.deal, seed: { appid: 1145360, name: 'Hades' } } }
    expect(parsePlayCache(JSON.parse(JSON.stringify(seeded)))?.deal.seed).toEqual({
      appid: 1145360,
      name: 'Hades',
    })
  })

  test('«Уже прошёл» у строки «Продолжить» переживает запись; запись до поля — без кнопки', () => {
    const e = entry()
    const done = { ...e, deal: { ...e.deal, continueGame: { appid: 367520, name: 'Hollow Knight', recentHours: 4, finishable: true } } }
    expect(parsePlayCache(JSON.parse(JSON.stringify(done)))?.deal.continueGame?.finishable).toBe(true)
    const old = { ...e, deal: { ...e.deal, continueGame: { appid: 367520, name: 'Hollow Knight', recentHours: 4 } } }
    expect(parsePlayCache(old)?.deal.continueGame).toEqual({
      appid: 367520,
      name: 'Hollow Knight',
      recentHours: 4,
      finishable: false,
    })
  })

  test('запись до затравки и мусор в ней — обычная выдача, запись жива', () => {
    const old: Record<string, unknown> = { ...entry().deal }
    delete old.seed
    expect(parsePlayCache({ ...entry(), deal: old })?.deal.seed).toBeNull()
    for (const seed of ['Hades', { appid: '1', name: 'Hades' }, { appid: 0, name: 'X' }, { appid: 5, name: '' }]) {
      expect(parsePlayCache({ ...entry(), deal: { ...entry().deal, seed } })?.deal.seed).toBeNull()
    }
  })

  test('выдача по подталкиванию возвращается с ним; запись до них и мусор — без него', () => {
    const e = entry()
    const nudged = { ...e, deal: { ...e.deal, nudge: 'shorter' } }
    expect(parsePlayCache(JSON.parse(JSON.stringify(nudged)))?.deal.nudge).toBe('shorter')
    const old: Record<string, unknown> = { ...e.deal }
    delete old.nudge
    expect(parsePlayCache({ ...e, deal: old })?.deal.nudge).toBeNull()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, nudge: 'faster' } })?.deal.nudge).toBeNull()
  })
})

describe('restoreDeal', () => {
  const q = { key: KEY, viewer: ME, nowMs: NOW + 60_000, banned: NO_BANS }

  test('свежая запись того же запроса возвращается с тем же героем и «Зашло»', () => {
    const back = restoreDeal(entry(), q)
    expect(back?.index).toBe(1)
    expect(back?.deal.picks.map((p) => p.appid)).toEqual([10, 20, 30])
    expect(back?.deal.scope).toBe('library')
    expect(back?.deal.lean).toBe('fresh')
    expect(back?.liked).toEqual([10])
    expect(back?.at).toBe(NOW)
  })

  test('старше пятнадцати минут — уже не та выдача', () => {
    expect(restoreDeal(entry(), { ...q, nowMs: NOW + PLAY_CACHE_TTL_MS })).not.toBeNull()
    expect(restoreDeal(entry(), { ...q, nowMs: NOW + PLAY_CACHE_TTL_MS + 1 })).toBeNull()
  })

  test('запись «из будущего» — часы перевели, возраст неизвестен', () => {
    expect(restoreDeal(entry(), { ...q, nowMs: NOW - 5 * 60_000 })).toBeNull()
  })

  test('другой запрос — другая выдача', () => {
    const other = playCacheKey({ mood: NEUTRAL_MOOD, focus: null, roulette: true, lean: null })
    expect(restoreDeal(entry(), { ...q, key: other })).toBeNull()
  })

  test('другой вход в той же вкладке чужую выдачу не получит', () => {
    expect(restoreDeal(entry(), { ...q, viewer: OTHER })).toBeNull()
    // не знаем, кто вошёл, — не восстанавливаем вовсе
    expect(restoreDeal(entry(), { ...q, viewer: null })).toBeNull()
  })

  test('бан из соседней вкладки убирает игру, а герой остаётся героем', () => {
    const back = restoreDeal(entry(), { ...q, banned: new Set([10, 40]) })
    expect(back?.deal.picks.map((p) => p.appid)).toEqual([20, 30])
    expect(back?.deal.discoveries).toEqual([])
    // герой — по appid, а не по индексу: он сдвинулся, но остался тем же
    expect(back?.index).toBe(0)
    expect(back?.deal.picks[back.index].appid).toBe(20)
  })

  test('забанен сам герой — на экран первая из оставшихся', () => {
    const back = restoreDeal(entry(), { ...q, banned: new Set([20]) })
    expect(back?.deal.picks[back.index].appid).toBe(10)
  })

  // «Уже прошёл» у «Продолжить» или на странице игры, куда ушли «Подробнее»:
  // после «Назад» пройденная игра не зовёт продолжить себя
  test('строка «Продолжить» уходит вместе с баном, выдача остаётся', () => {
    const back = restoreDeal(entry(), { ...q, banned: new Set([570]) })
    expect(back?.deal.continueGame).toBeNull()
    expect(back?.deal.picks.map((p) => p.appid)).toEqual([10, 20, 30])
    expect(restoreDeal(entry(), q)?.deal.continueGame?.appid).toBe(570)
  })

  /*
   * Бан закрывает и план на вечер (closesPlan): «Подробнее» у героя, который
   * и есть план, → «Уже прошёл» на странице игры → «Назад». Герой ушёл из
   * выдачи, planBeside его строку больше не прячет — и «Ставил «X» на
   * загрузку · Запустить» звал бы в игру, которую только что назвали
   * пройденной, а нажатие писало бы ей новый исход.
   */
  test('строка плана на вечер уходит вместе с баном, выдача и «Продолжить» остаются', () => {
    const back = restoreDeal(entry(), { ...q, banned: new Set([1145360]) })
    expect(back?.deal.plan).toBeNull()
    expect(back?.deal.picks.map((p) => p.appid)).toEqual([10, 20, 30])
    expect(back?.deal.continueGame?.appid).toBe(570)
    expect(restoreDeal(entry(), q)?.deal.plan?.appid).toBe(1145360)
    // план — тот же герой: уходят оба, на экран следующая карточка
    const same = entry({ deal: { ...entry().deal, plan: { appid: 20, name: 'Игра 20', intent: 'install' } } })
    const gone = restoreDeal(same, { ...q, banned: new Set([20]) })
    expect(gone?.deal.plan).toBeNull()
    expect(gone?.deal.picks[gone.index].appid).toBe(10)
  })

  /*
   * «Сыграю вечером на ПК» → «Подробнее» → «Назад»: герой, отложенный на
   * вечер, возвращается отложенным, и «Не то — дальше» у него по-прежнему
   * листает, а не пишет пропуск, закрывающий план. Забаненный — уже нет:
   * бан план и так закрыл (closesPlan), а «не то» у него не спросят вовсе.
   */
  test('отложенные на вечер возвращаются с выдачей, забаненные — нет', () => {
    expect(restoreDeal(entry({ planned: [20, 30] }), q)?.planned).toEqual([20, 30])
    expect(restoreDeal(entry({ planned: [20, 30] }), { ...q, banned: new Set([30]) })?.planned).toEqual([20])
    expect(restoreDeal(entry(), q)?.planned).toEqual([])
  })

  test('забанено всё — восстанавливать нечего', () => {
    expect(restoreDeal(entry(), { ...q, banned: new Set([10, 20, 30]) })).toBeNull()
  })

  test('нет записи — нет и выдачи', () => {
    expect(restoreDeal(null, q)).toBeNull()
  })
})

/*
 * «Поставь на загрузку» у своей → «Изменить настроение» → квиз → /play с
 * другим настроением. Новое монтирование, другой ключ: restoreDeal выдачу
 * не вернёт — а отложенные из той же записи обязаны доехать до новой
 * выдачи. Иначе первая же новая выдача ложилась поверх единственной записи
 * с пустым списком, и своя игра, пришедшая героем снова, на «Не то —
 * дальше» → «Просто не сейчас» закрывала план, поставленный минуту назад.
 */
describe('heldPlanned', () => {
  const q = { nowMs: NOW + 60_000, banned: NO_BANS }
  const mood = playCacheKey({ mood: { ...NEUTRAL_MOOD, vibe: 'engaged' }, focus: null, roulette: false, lean: null })

  test('запись другого настроения выдачу не вернёт, а отложенные отдаст — с тем, чьи они', () => {
    const e = entry({ planned: [20, 1145360] })
    expect(restoreDeal(e, { ...q, key: mood, viewer: ME })).toBeNull()
    expect(heldPlanned(e, q)).toEqual({ viewer: ME, appids: [20, 1145360] })
  })

  /*
   * Срок списка — от последнего показа выдачи (seenAt), а не от её прихода
   * (at). Выдача пришла в 19:00, человек листал её и в 19:14 нажал «Сыграю
   * вечером на ПК» у своей X; в 19:15:40 — ⓘ и «Назад». Выдача старше
   * пятнадцати минут (цены и онлайн уже не те), restoreDeal её не вернёт, —
   * а отложенную минуту назад игру список обязан донести до новой: та
   * приходит героем снова (знакомые свои повторяются), и «Не то — дальше» →
   * «Просто не сейчас» закрывал план, поставленный минуту назад. Тот же
   * ключ, то же монтирование заново — что и у «Изменить настроение».
   */
  test('выдача устарела, а план ставили минуту назад — список доезжает до новой', () => {
    const e = entry({ at: NOW - 20 * 60_000, seenAt: NOW - 60_000, planned: [20] })
    expect(restoreDeal(e, { ...q, key: KEY, viewer: ME, nowMs: NOW })).toBeNull()
    expect(heldPlanned(e, { ...q, nowMs: NOW })).toEqual({ viewer: ME, appids: [20] })
    // и под другим ключом — так же
    expect(restoreDeal(e, { ...q, key: mood, viewer: ME, nowMs: NOW })).toBeNull()
    expect(heldPlanned(e, { ...q, nowMs: NOW })?.appids).toEqual([20])
  })

  test('выдачу не видели больше часа — уже не этот заход', () => {
    expect(PLAN_HOLD_MS).toBe(60 * 60_000)
    expect(PLAN_HOLD_MS).toBeGreaterThan(PLAY_CACHE_TTL_MS)
    const e = entry({ planned: [20] })
    expect(heldPlanned(e, { ...q, nowMs: NOW + PLAN_HOLD_MS })).not.toBeNull()
    expect(heldPlanned(e, { ...q, nowMs: NOW + PLAN_HOLD_MS + 1 })).toBeNull()
    // запись до поля — срок тот же час, только от прихода выдачи: за
    // пятнадцать минут (прежний срок от at) список уже не умирает
    const old: Record<string, unknown> = { ...entry({ at: NOW - PLAN_HOLD_MS - 1, planned: [20] }) }
    delete old.seenAt
    expect(heldPlanned(parsePlayCache(old), { ...q, nowMs: NOW })).toBeNull()
    const recent: Record<string, unknown> = { ...entry({ at: NOW - 20 * 60_000, planned: [20] }) }
    delete recent.seenAt
    expect(heldPlanned(parsePlayCache(recent), { ...q, nowMs: NOW })?.appids).toEqual([20])
  })

  test('забаненные не едут: бан план уже закрыл', () => {
    expect(heldPlanned(entry({ planned: [20, 30] }), { ...q, banned: new Set([30]) })?.appids).toEqual([20])
    expect(heldPlanned(entry({ planned: [20] }), { ...q, banned: new Set([20]) })).toBeNull()
  })

  test('нести нечего — null, а не пустой список', () => {
    expect(heldPlanned(entry(), q)).toBeNull()
    expect(heldPlanned(null, q)).toBeNull()
  })
})

describe('hasFreshDeal', () => {
  test('спрашивать, кто вошёл, стоит только при свежей записи того же запроса', () => {
    expect(hasFreshDeal(entry(), KEY, NOW + 1000)).toBe(true)
    expect(hasFreshDeal(entry(), 'другой', NOW + 1000)).toBe(false)
    expect(hasFreshDeal(entry(), KEY, NOW + PLAY_CACHE_TTL_MS + 1)).toBe(false)
    expect(hasFreshDeal(null, KEY, NOW)).toBe(false)
  })
})

describe('метка прогрева', () => {
  const mark = { viewer: ME, at: NOW }

  test('десять минут — пропускаем, дольше — греем снова', () => {
    expect(warmIsFresh(mark, ME, NOW + WARM_MARK_TTL_MS)).toBe(true)
    expect(warmIsFresh(mark, ME, NOW + WARM_MARK_TTL_MS + 1)).toBe(false)
  })

  test('чужой прогрев не в счёт: снимок библиотеки заводит именно он', () => {
    expect(warmIsFresh(mark, OTHER, NOW + 1000)).toBe(false)
    expect(warmIsFresh(mark, null, NOW + 1000)).toBe(false)
    // но повод спросить, кто вошёл, — есть
    expect(hasFreshWarm(mark, NOW + 1000)).toBe(true)
  })

  test('разбор: без viewer и числового времени метки нет', () => {
    expect(parseWarmMark(mark)).toEqual(mark)
    expect(parseWarmMark({ viewer: '', at: NOW })).toBeNull()
    expect(parseWarmMark({ viewer: ME, at: 'сейчас' })).toBeNull()
    expect(parseWarmMark(null)).toBeNull()
  })
})

describe('недавние баны', () => {
  test('новый бан дописывается, протухшие и повторы выбрасываются', () => {
    const old = { appid: 1, at: NOW - PLAY_CACHE_TTL_MS - 1 }
    const recent = { appid: 2, at: NOW - 1000 }
    const list = withBan([old, recent, { appid: 3, at: NOW - 5000 }], 3, NOW)
    expect(list).toEqual([recent, { appid: 3, at: NOW }])
  })

  test('в фильтр идут только свежие', () => {
    const list = [
      { appid: 1, at: NOW - PLAY_CACHE_TTL_MS - 1 },
      { appid: 2, at: NOW - 1000 },
    ]
    expect([...recentlyBanned(list, NOW)]).toEqual([2])
    expect(recentlyBanned(null, NOW).size).toBe(0)
  })

  test('битые элементы выбрасываются поштучно', () => {
    expect(parseRecentBans([{ appid: 5, at: NOW }, { appid: '6', at: NOW }, null, 7])).toEqual([
      { appid: 5, at: NOW },
    ])
    expect(parseRecentBans({ appid: 5 })).toBeNull()
  })
})

describe('кто вошёл', () => {
  test('steamid — только у вошедшего', () => {
    expect(viewerFrom({ authed: true, steamid: ME, writer: true })).toBe(ME)
    expect(viewerFrom({ authed: false })).toBeNull()
    expect(viewerFrom({ authed: true })).toBeNull()
    expect(viewerFrom({ authed: true, steamid: 42 })).toBeNull()
    expect(viewerFrom(null)).toBeNull()
  })

  test('whoAmI спрашивает touch, а любой сбой — «не знаю»', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return Response.json({ authed: true, steamid: ME })
    }) as typeof fetch
    expect(await whoAmI(undefined, ok)).toBe(ME)
    expect(calls[0][0]).toBe('/api/session/touch')
    expect(calls[0][1]?.method).toBe('POST')

    const down = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    expect(await whoAmI(undefined, down)).toBeNull()

    const fail = (async () => new Response('nope', { status: 500 })) as typeof fetch
    expect(await whoAmI(undefined, fail)).toBeNull()

    const junk = (async () => new Response('<html>', { status: 200 })) as typeof fetch
    expect(await whoAmI(undefined, junk)).toBeNull()
  })
})

describe('хранилища', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function fakeStorage() {
    const data: Record<string, string> = {}
    return {
      data,
      area: {
        getItem: (k: string) => (Object.hasOwn(data, k) ? data[k] : null),
        setItem: (k: string, v: string) => {
          data[k] = v
        },
        removeItem: (k: string) => {
          delete data[k]
        },
      },
    }
  }

  test('выдача и метка — во вкладке, баны — на все вкладки; выход забывает всё', () => {
    const session = fakeStorage()
    const local = fakeStorage()
    vi.stubGlobal('sessionStorage', session.area)
    vi.stubGlobal('localStorage', local.area)

    playCacheStore.set(entry())
    warmMarkStore.set({ viewer: ME, at: NOW })
    rememberBan(10, NOW)
    expect(Object.keys(session.data).sort()).toEqual(['imbored.play.deal', 'imbored.play.warm'])
    expect(Object.keys(local.data)).toEqual(['imbored.play.bans'])

    forgetPlay()
    expect(session.data).toEqual({})
    expect(local.data).toEqual({})
    expect(playCacheStore.get()).toBeNull()
    expect(readRecentBans(NOW).size).toBe(0)
  })

  /*
   * Ответ прогрева, начатого квизом (lib/warmup), — про того, кто был вошедшим
   * в момент вызова. Выход без этого оставлял бы его в памяти документа, и
   * следующий вход забрал бы его первым кругом: стену и числа прежнего.
   */
  test('выход забывает и прогрев, начатый квизом', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage().area)
    vi.stubGlobal('localStorage', fakeStorage().area)
    const ok = () => new Response(JSON.stringify({ remaining: 0 }), { status: 200 })
    startPrewarm({ fetchFn: vi.fn(async () => ok()) as unknown as typeof fetch })

    forgetPlay()
    const own = vi.fn(async () => ok())
    expect(await runWarmup({ fetchFn: own as unknown as typeof fetch })).toBe('done')
    expect(own).toHaveBeenCalledTimes(1)
  })

  /**
   * Список банов никто не слушает, а страница живёт через «Подробнее» →
   * «Назад»: модуль тот же, и кэш первого чтения — тоже. Бан соседней вкладки
   * после него обязан быть виден — иначе игру, убранную навсегда, «Назад»
   * возвращает на экран, порой героем.
   */
  test('бан соседней вкладки виден и после первого чтения в этой', () => {
    const local = fakeStorage()
    vi.stubGlobal('localStorage', local.area)
    expect(readRecentBans(NOW).size).toBe(0)

    // соседняя вкладка пишет в хранилище напрямую, события сюда не приходит
    local.data['imbored.play.bans'] = JSON.stringify([{ appid: 20, at: NOW }])

    const back = restoreDeal(entry(), {
      key: KEY,
      viewer: ME,
      nowMs: NOW + 1000,
      banned: readRecentBans(NOW + 1000),
    })
    expect(back?.deal.picks.map((p) => p.appid)).toEqual([10, 30])
  })

  /*
   * План закрыт на странице игры («Запустить» по биту plan) — lib/planforget
   * вычёркивает игру из записи по ключу, мимо модуля выдачи. Модуль в этом
   * документе уже загружен (пришли с /play без перезагрузки) и держит в
   * памяти прежнюю копию; /play при монтировании читает запись из
   * хранилища (fresh) — и видит правку, а правленая запись по-прежнему
   * узнаётся целиком.
   */
  test('отложенная, чей план закрыт не на /play, после «Назад» уже не отложена и не строка плана', () => {
    const session = fakeStorage()
    vi.stubGlobal('sessionStorage', session.area)
    playCacheStore.set(entry({ planned: [20, 30] }))

    forgetPlanned(20)

    const back = restoreDeal(playCacheStore.fresh(), { key: KEY, viewer: ME, nowMs: NOW + 1000, banned: NO_BANS })
    expect(back?.planned).toEqual([30])
    expect(back?.deal.picks.map((p) => p.appid)).toEqual([10, 20, 30])
    expect(back?.liked).toEqual([10])
    expect(back?.deal.plan?.appid).toBe(1145360)

    // запуск плана из строки — та уходит, а выдача остаётся узнанной целиком
    forgetPlanned(1145360)
    const after = restoreDeal(playCacheStore.fresh(), { key: KEY, viewer: ME, nowMs: NOW + 1000, banned: NO_BANS })
    expect(after?.deal.plan).toBeNull()
    expect(after?.deal.continueGame?.appid).toBe(570)
    expect(after?.planned).toEqual([30])
  })

  /*
   * «Не предлагать» сменили на квизе (unkeyDeal в lib/mutetags): выдача,
   * собранная без фильтра, после «Назад» не возвращается — а отложенные на
   * вечер едут к новой, как при смене настроения.
   */
  test('после смены «Не предлагать» выдача не узнаётся, а отложенные на вечер — едут', () => {
    const session = fakeStorage()
    vi.stubGlobal('sessionStorage', session.area)
    playCacheStore.set(entry({ planned: [20] }))
    const q = { key: KEY, viewer: ME, nowMs: NOW + 1000, banned: NO_BANS }
    expect(restoreDeal(playCacheStore.fresh(), q)).not.toBeNull()

    unkeyDeal()

    expect(restoreDeal(playCacheStore.fresh(), q)).toBeNull()
    expect(heldPlanned(playCacheStore.fresh(), q)).toEqual({ viewer: ME, appids: [20] })
  })

  test('свой бан дописывается к хранилищу и не стирает бан соседней вкладки', () => {
    const local = fakeStorage()
    vi.stubGlobal('localStorage', local.area)
    expect(readRecentBans(NOW).size).toBe(0)

    local.data['imbored.play.bans'] = JSON.stringify([{ appid: 20, at: NOW }])
    rememberBan(30, NOW + 1000)

    const stored = parseRecentBans(JSON.parse(local.data['imbored.play.bans']))
    expect(stored?.map((b) => b.appid)).toEqual([20, 30])
    expect([...readRecentBans(NOW + 1000)].sort()).toEqual([20, 30])
  })
})
